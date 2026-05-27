// vergr-ocr — Tesseract OCR microservice for tournament AI moderation.
//
// Two jobs:
//
//  1. HTTP /ocr endpoint (used by the winner-detection Cloud Function cron):
//     grabs the last frame of the newest HLS segment, optionally crops it,
//     runs Tesseract, returns raw text (+ optional frame bytes for Vision).
//
//  2. Live-score self-loop (AC1): every 10s, for each LIVE tournament stream
//     with an in_progress match whose game has a calibrated score crop region,
//     OCRs the cropped scoreboard locally and writes match.liveScore.{uid} +
//     match.liveScoreSource.{uid}='ocr' straight to Firestore (no Cloud
//     Function round-trip). The TournamentOverlayNeon overlay reads these.
//
// Listens on 127.0.0.1:8092 (localhost only — nginx-fronted at
// /ocr-internal on sfu.vergr.app, IP-allowlisted to Cloud Function egress).
//
// POST /ocr {
//   "streamKey": "<the HLS stream key>",
//   "game":      "Counter-Strike 2",
//   "frameAt":   "end" | "now",
//   "crop":      { "x":0.43, "y":0.0, "w":0.14, "h":0.08 },  // optional, fractions 0-1
//   "digitsOnly": true                                        // optional, numeric whitelist
// }
// Response: { "ok": true, "text": "...", "durationMs": 1234 }
//
// A VERGR_OCR_SHARED_SECRET env var must be sent in the X-Vergr-Token header.
// Firebase Admin (live-score loop) reads creds from -creds, DB -db (vgrdb).

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"image/png"
	"io"
	"log"
	"math/bits"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"

	"cloud.google.com/go/firestore"
)

var (
	listenAddr   = flag.String("listen", "127.0.0.1:8092", "HTTP listen address")
	streamsDir   = flag.String("streams", "/var/www/streams", "HLS segments directory")
	liveScores   = flag.Bool("live-scores", true, "Enable the AC1 live-score self-loop")
	credsPath    = flag.String("creds", "/etc/vergr-ocr/firebase-admin.json", "Firebase service-account JSON")
	databaseID   = flag.String("db", "vgrdb", "Firestore database ID")
	liveInterval = flag.Duration("live-interval", 10*time.Second, "Live-score scan interval")
	cheatScan    = flag.Bool("cheat-scan", true, "Enable the AC3 live cheat-flag sampling loop")
	cheatEvery   = flag.Duration("cheat-interval", 30*time.Second, "Cheat-scan interval per match")
	sharedSecret = os.Getenv("VERGR_OCR_SHARED_SECRET")
	geminiKey    = os.Getenv("GEMINI_API_KEY")

	fsClient *firestore.Client
)

// CropRegion expresses a scoreboard crop as fractions (0-1) of the frame, so
// it is resolution-independent across 480p/720p/1080p source renditions.
type CropRegion struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func (c CropRegion) valid() bool { return c.W > 0 && c.H > 0 }

// ffmpegExpr builds the -vf crop filter for this region.
func (c CropRegion) ffmpegExpr() string {
	return fmt.Sprintf("crop=in_w*%g:in_h*%g:in_w*%g:in_h*%g", c.W, c.H, c.X, c.Y)
}

// liveScoreRegions — per-game scoreboard crop regions for the AC1 live-score
// loop. MIRROR of the `liveScore` field in src/utils/tournamentGames.js
// (that file is the documented source of truth). Calibrated against the
// broadcast scoreboard; starting values for the top 3 games. Refine against a
// real frame: scoreboard is top-centre for most, top-left for sports tickers.
var liveScoreRegions = map[string]CropRegion{
	// CS2 — top-centre two team scores either side of the round timer.
	"cs2": {X: 0.43, Y: 0.00, W: 0.14, H: 0.08},
	// EA Sports FC 25 (FIFA) — top-left scoreline ticker "ARS 1 - 2 CHE".
	"fc25": {X: 0.02, Y: 0.02, W: 0.30, H: 0.09},
	// NBA 2K — top-centre scoreboard.
	"nba2k": {X: 0.36, Y: 0.02, W: 0.28, H: 0.10},
}

type OCRRequest struct {
	StreamKey         string      `json:"streamKey"`
	Game              string      `json:"game"`
	FrameAt           string      `json:"frameAt"`
	ReturnFrameBase64 bool        `json:"returnFrameBase64"`
	Crop              *CropRegion `json:"crop"`
	DigitsOnly        bool        `json:"digitsOnly"`
}

type OCRResponse struct {
	OK          bool   `json:"ok"`
	Text        string `json:"text,omitempty"`
	Game        string `json:"game,omitempty"`
	FrameAt     string `json:"frameAt,omitempty"`
	FrameBase64 string `json:"frameBase64,omitempty"`
	FrameMime   string `json:"frameMime,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Error       string `json:"error,omitempty"`
}

func main() {
	flag.Parse()
	if sharedSecret == "" {
		log.Println("WARNING: VERGR_OCR_SHARED_SECRET not set — anyone with network access can hit this service")
	}

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "now": time.Now().UTC().Format(time.RFC3339)})
	})
	http.HandleFunc("/ocr", handleOCR)

	// Start the Firebase-backed self-loops (AC1 live-score + AC3 cheat-flag).
	// Non-fatal if Firebase init fails — the HTTP OCR endpoint stays up either way.
	if *liveScores || *cheatScan {
		ctx := context.Background()
		if err := initFirebase(ctx); err != nil {
			log.Printf("firebase loops DISABLED: firebase init: %v", err)
		} else {
			if *liveScores {
				log.Printf("live-score loop enabled, interval=%s", *liveInterval)
				go runLiveScoreLoop(ctx)
			}
			if *cheatScan {
				if geminiKey == "" {
					log.Printf("cheat-scan loop idle: GEMINI_API_KEY not set (no Vision calls until configured)")
				} else {
					log.Printf("cheat-scan loop enabled, interval=%s", *cheatEvery)
				}
				go runCheatScanLoop(ctx)
			}
		}
	}

	log.Printf("vergr-ocr listening on %s, streams=%s", *listenAddr, *streamsDir)
	if err := http.ListenAndServe(*listenAddr, nil); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func initFirebase(ctx context.Context) error {
	opt := option.WithCredentialsFile(*credsPath)
	projectID, err := readProjectID(*credsPath)
	if err != nil {
		return fmt.Errorf("read project id: %w", err)
	}
	if _, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID}, opt); err != nil {
		return fmt.Errorf("firebase NewApp: %w", err)
	}
	fsClient, err = firestore.NewClientWithDatabase(ctx, projectID, *databaseID, opt)
	if err != nil {
		return fmt.Errorf("firestore.NewClientWithDatabase: %w", err)
	}
	return nil
}

func readProjectID(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var meta struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(b, &meta); err != nil {
		return "", err
	}
	if meta.ProjectID == "" {
		return "", fmt.Errorf("project_id missing from creds")
	}
	return meta.ProjectID, nil
}

// ───────────────────────────────────────────────────────────
// Live-score self-loop (AC1)
// ───────────────────────────────────────────────────────────

func runLiveScoreLoop(ctx context.Context) {
	t := time.NewTicker(*liveInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("live-score scan panic: %v", r)
					}
				}()
				scanLiveScores(ctx)
			}()
		}
	}
}

func scanLiveScores(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 9*time.Second)
	defer cancel()

	docs, err := fsClient.Collection("streams").Where("status", "==", "live").Documents(cctx).GetAll()
	if err != nil {
		log.Printf("live-score: streams query: %v", err)
		return
	}
	for _, sd := range docs {
		data := sd.Data()
		streamKey, _ := data["streamKey"].(string)
		if streamKey == "" {
			continue
		}
		tid, _ := data["tournamentId"].(string)
		matchID, _ := data["tournamentMatchId"].(string)
		hostUid, _ := data["hostUid"].(string)

		// Pass 1 — live score (AC1): the tournament broadcast scoreboard.
		if tid != "" {
			processTournamentLiveScore(cctx, tid, streamKey)
		}
		// Pass 2 — lobby-code auto-verification (AC2): this player's OWN
		// gameplay stream. Flips verifyState when the VERGR-XXXX code is seen.
		if tid != "" && matchID != "" && hostUid != "" {
			tryVerifyLobbyCode(cctx, tid, matchID, hostUid, streamKey)
		}
	}
}

func processTournamentLiveScore(ctx context.Context, tid, streamKey string) {
	tSnap, err := fsClient.Collection("tournaments").Doc(tid).Get(ctx)
	if err != nil {
		return
	}
	game, _ := tSnap.Data()["game"].(string)
	region, ok := liveScoreRegions[game]
	if !ok || !region.valid() {
		return // game not calibrated for live score
	}

	mdocs, err := fsClient.Collection("tournaments").Doc(tid).Collection("matches").
		Where("status", "==", "in_progress").Limit(1).Documents(ctx).GetAll()
	if err != nil || len(mdocs) == 0 {
		return
	}
	m := mdocs[0]
	md := m.Data()
	p1 := firstString(md["player1"], md["player1Id"])
	p2 := firstString(md["player2"], md["player2Id"])
	if p1 == "" || p2 == "" {
		return
	}

	segment, err := newestSegment(filepath.Join(*streamsDir, streamKey))
	if err != nil {
		return
	}
	png, err := extractLastFrame(segment, region.ffmpegExpr())
	if err != nil {
		log.Printf("live-score: ffmpeg %s: %v", streamKey, err)
		return
	}
	defer os.Remove(png)

	text, err := runTesseract(png, true)
	if err != nil {
		return
	}
	a, b, ok := parseScorePair(text)
	if !ok {
		return
	}

	_, err = m.Ref.Set(ctx, map[string]any{
		"liveScore":       map[string]any{p1: a, p2: b},
		"liveScoreSource": map[string]any{p1: "ocr", p2: "ocr"},
		"liveScoreAt":     firestore.ServerTimestamp,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("live-score: write %s/%s: %v", tid, m.Ref.ID, err)
	}
}

// ───────────────────────────────────────────────────────────
// Lobby-code auto-verification (AC2)
// ───────────────────────────────────────────────────────────

// lobbyCropRegions — OPTIONAL per "<game>:<verifyMethod>" crop region for the
// lobby-code search, keyed e.g. "cs2:chat". When absent, the full frame is
// OCR'd (robust default that covers all four verifyMethods). Populate entries
// here to tighten accuracy per method×game — that is the AC2 "calibration"
// refinement. Empty = full-frame search.
var lobbyCropRegions = map[string]CropRegion{}

// nonAlnum strips everything but A-Z0-9 for tolerant code matching.
var nonAlnum = regexp.MustCompile(`[^A-Z0-9]`)

func normCode(s string) string {
	return nonAlnum.ReplaceAllString(strings.ToUpper(s), "")
}

// confuse maps glyphs Tesseract commonly swaps so a near-miss still matches.
var confuser = strings.NewReplacer(
	"O", "0", "Q", "0", "D", "0",
	"I", "1", "L", "1",
	"S", "5", "B", "8", "Z", "2", "G", "6",
)

func textContainsCode(text, code string) bool {
	nc := normCode(code)
	if len(nc) < 5 {
		return false
	}
	nt := normCode(text)
	if strings.Contains(nt, nc) {
		return true
	}
	return strings.Contains(confuser.Replace(nt), confuser.Replace(nc))
}

func sideVerified(verifyState map[string]any, uid string) bool {
	side, _ := verifyState[uid].(map[string]any)
	if side == nil {
		return false
	}
	st, _ := side["status"].(string)
	return st == "verified"
}

// tryVerifyLobbyCode OCRs a player's own gameplay stream and, if the match's
// VERGR lobby code is visible, flips verifyState.{uid}='verified' (source ocr)
// and fires the same notifications the ocrVerifyMatchPlayer callable would.
func tryVerifyLobbyCode(ctx context.Context, tid, matchID, hostUid, streamKey string) {
	mRef := fsClient.Collection("tournaments").Doc(tid).Collection("matches").Doc(matchID)
	mSnap, err := mRef.Get(ctx)
	if err != nil {
		return
	}
	md := mSnap.Data()

	switch s, _ := md["status"].(string); s {
	case "completed", "cancelled", "forfeited":
		return // nothing left to verify
	}
	lobbyCode, _ := md["lobbyCode"].(string)
	if lobbyCode == "" {
		return
	}
	verifyState, _ := md["verifyState"].(map[string]any)
	if verifyState == nil {
		verifyState = map[string]any{}
	}
	if sideVerified(verifyState, hostUid) {
		return // already verified — don't re-write/re-notify
	}

	game, _ := md["game"].(string)
	method, _ := md["verifyMethod"].(string)
	cropExpr := ""
	if region, ok := lobbyCropRegions[game+":"+method]; ok && region.valid() {
		cropExpr = region.ffmpegExpr()
	}

	segment, err := newestSegment(filepath.Join(*streamsDir, streamKey))
	if err != nil {
		return
	}
	png, err := extractLastFrame(segment, cropExpr)
	if err != nil {
		return
	}
	defer os.Remove(png)

	text, err := runTesseract(png, false) // full text — need letters, not just digits
	if err != nil {
		return
	}
	if !textContainsCode(text, lobbyCode) {
		return
	}

	// Flip this side to verified (precise field paths — never clobbers the
	// opponent's verifyState entry).
	_, err = mRef.Update(ctx, []firestore.Update{
		{Path: "verifyState." + hostUid + ".status", Value: "verified"},
		{Path: "verifyState." + hostUid + ".source", Value: "ocr"},
		{Path: "verifyState." + hostUid + ".at", Value: firestore.ServerTimestamp},
	})
	if err != nil {
		log.Printf("verify: write %s/%s/%s: %v", tid, matchID, hostUid, err)
		return
	}
	log.Printf("verify: OCR confirmed lobby code for %s in %s/%s", hostUid, tid, matchID)

	p1, _ := md["player1"].(string)
	p2, _ := md["player2"].(string)
	other := p1
	if hostUid == p1 {
		other = p2
	}
	if other != "" {
		addMatchNotification(ctx, other, "tournament_match_verified",
			"Opponent verified — ready to play", tid, matchID)
	}

	// Both sides verified now? Fire the "match ready" ping once.
	pingBothIfReady(ctx, mRef, hostUid, p1, p2, verifyState, md)
}

// pingBothIfReady mirrors the Cloud Function helper: when both sides are
// verified and we haven't pinged yet, stamp bothVerifiedAt + notify both.
// `justVerified` is the uid we flipped this pass (its in-memory verifyState
// is stale, so treat it as verified).
func pingBothIfReady(ctx context.Context, mRef *firestore.DocumentRef, justVerified, p1, p2 string, verifyState, md map[string]any) {
	if p1 == "" || p2 == "" {
		return
	}
	ok1 := p1 == justVerified || sideVerified(verifyState, p1)
	ok2 := p2 == justVerified || sideVerified(verifyState, p2)
	if !ok1 || !ok2 {
		return
	}
	if md["bothVerifiedAt"] != nil {
		return // idempotent
	}
	if _, err := mRef.Update(ctx, []firestore.Update{
		{Path: "bothVerifiedAt", Value: firestore.ServerTimestamp},
	}); err != nil {
		return
	}
	tid := mRef.Parent.Parent.ID
	for _, uid := range []string{p1, p2} {
		addMatchNotification(ctx, uid, "tournament_match_ready",
			"Both sides verified — play your match", tid, mRef.ID)
	}
}

func addMatchNotification(ctx context.Context, recipientID, ntype, title, tid, matchID string) {
	_, _, err := fsClient.Collection("notifications").Add(ctx, map[string]any{
		"recipientId": recipientID,
		"type":        ntype,
		"title":       title,
		"body":        "Tap to view.",
		"data":        map[string]any{"tournamentId": tid, "matchId": matchID},
		"actionUrl":   fmt.Sprintf("/tournaments/%s/match/%s", tid, matchID),
		"read":        false,
		"createdAt":   firestore.ServerTimestamp,
	})
	if err != nil {
		log.Printf("verify: notify %s: %v", recipientID, err)
	}
}

var scorePairRe = regexp.MustCompile(`(\d{1,3})\D+(\d{1,3})`)

// parseScorePair pulls "A - B" (or "A : B", "A vs B") out of OCR text.
func parseScorePair(text string) (int, int, bool) {
	mt := scorePairRe.FindStringSubmatch(text)
	if mt == nil {
		return 0, 0, false
	}
	a := atoiSafe(mt[1])
	b := atoiSafe(mt[2])
	if a < 0 || b < 0 {
		return 0, 0, false
	}
	return a, b, true
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return -1
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func firstString(vals ...any) string {
	for _, v := range vals {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// ───────────────────────────────────────────────────────────
// Live cheat-flag sampling (AC3) — Gemini Flash on gameplay frames
// ───────────────────────────────────────────────────────────
//
// COST CONTROLS (this is for TOURNAMENTS, runs only on in_progress matches):
//   - Only samples live streams that carry tournamentId+matchId+hostUid AND
//     whose match is in_progress.
//   - Sparse cadence (default 30s/match, vs the 10s OCR loop).
//   - Gemini 1.5 FLASH (cheap), not Pro.
//   - app_config/general.liveCheatSampling=false kills it instantly (no deploy).
//   - app_config/general.liveCheatDailyCap (default 3000) hard-caps Vision
//     calls per UTC day; the loop stops calling Gemini once reached.
//   - Review-queue docs are only written when the verdict WORSENS (clean →
//     suspicious → likely_cheat), never every tick — this is a mod hint, the
//     mod still confirms. No auto-DQ.

var (
	cheatMu          sync.Mutex
	lastCheatOverall = map[string]string{} // matchID -> last AC3 overall written
	lastFrameHash    = map[string]uint64{} // streamKey -> last AC6 perceptual hash
	staticCount      = map[string]int{}    // streamKey -> consecutive near-identical frames
	spoofFlagged     = map[string]bool{}   // matchID -> spoof hint already raised this episode
	noFaceCount      = map[string]int{}    // matchID+uid -> consecutive AC4 no-face samples
	lastFaceAt       = map[string]int64{}  // matchID+uid -> last AC4 check unix ms (60s throttle)
	visionDay        string
	visionCount      int
)

const webcamPrizeThreshold = 5000 // mirror WEBCAM_PRIZE_THRESHOLD

// AC6: ~3 min of frozen frames during an in_progress match = spoof/looped-feed hint.
const spoofStaticThreshold = 6

// AC4: 3 consecutive no-face samples (~3 min at the 60s throttle) = face-absent hint.
const faceMissThreshold = 3

const cheatPrompt = `You are reviewing ONE still frame from a live competitive tournament match for visible signs of cheating. Look only for things visible in a single frame: wallhack/ESP overlays (enemy outlines or boxes drawn through walls), injected cheat menus or config windows, radar/map-reveal overlays, and third-party HUD overlays that are not part of the game UI. A single still is weak evidence — respond "clean" unless an overlay/menu is clearly visible; do NOT guess aimbot from a still. Respond with STRICT JSON only, no prose: {"overall":"clean"|"suspicious"|"likely_cheat","flags":[{"type":string,"note":string}]}.`

// AC4 — the proof feed is a composite: game capture + the player's webcam as a
// picture-in-picture inset. We ask only whether a live face is visible in it.
const facePrompt = `This frame is a tournament "proof feed": a game capture with the player's WEBCAM composited as a small picture-in-picture inset. Question: is a live human face visible in the webcam inset? If the webcam shows a wall, ceiling, empty chair, is black, or is absent, the answer is false. STRICT JSON only, no prose: {"face": true|false}.`

func runCheatScanLoop(ctx context.Context) {
	t := time.NewTicker(*cheatEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("cheat-scan panic: %v", r)
					}
				}()
				scanCheatFrames(ctx)
			}()
		}
	}
}

func scanCheatFrames(ctx context.Context) {
	if geminiKey == "" {
		return // no Vision key configured — loop stays idle
	}
	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	enabled, dailyCap := cheatConfig(cctx)
	if !enabled {
		return
	}

	docs, err := fsClient.Collection("streams").Where("status", "==", "live").Documents(cctx).GetAll()
	if err != nil {
		log.Printf("cheat-scan: streams query: %v", err)
		return
	}
	for _, sd := range docs {
		data := sd.Data()
		streamKey, _ := data["streamKey"].(string)
		tid, _ := data["tournamentId"].(string)
		matchID, _ := data["tournamentMatchId"].(string)
		hostUid, _ := data["hostUid"].(string)
		if streamKey == "" || tid == "" || matchID == "" || hostUid == "" {
			continue
		}
		if !budgetOK(dailyCap) {
			log.Printf("cheat-scan: daily Vision cap (%d) reached — pausing until UTC rollover", dailyCap)
			return
		}
		processCheatFrame(cctx, tid, matchID, hostUid, streamKey)
	}
}

// cheatConfig reads the kill-switch + daily cap from app_config/general.
// Default ON with a 3000/day cap when the doc/fields are absent.
func cheatConfig(ctx context.Context) (bool, int) {
	cap := 3000
	snap, err := fsClient.Collection("app_config").Doc("general").Get(ctx)
	if err != nil {
		return true, cap
	}
	d := snap.Data()
	if v, ok := d["liveCheatSampling"].(bool); ok && !v {
		return false, cap
	}
	if v, ok := d["liveCheatDailyCap"].(int64); ok && v > 0 {
		cap = int(v)
	}
	return true, cap
}

func budgetOK(cap int) bool {
	cheatMu.Lock()
	defer cheatMu.Unlock()
	day := time.Now().UTC().Format("2006-01-02")
	if day != visionDay {
		visionDay = day
		visionCount = 0
	}
	return visionCount < cap
}

func bumpBudget() {
	cheatMu.Lock()
	visionCount++
	cheatMu.Unlock()
}

func cheatRank(overall string) int {
	switch overall {
	case "likely_cheat":
		return 3
	case "suspicious":
		return 2
	case "clean":
		return 1
	}
	return 0
}

func processCheatFrame(ctx context.Context, tid, matchID, hostUid, streamKey string) {
	mRef := fsClient.Collection("tournaments").Doc(tid).Collection("matches").Doc(matchID)
	mSnap, err := mRef.Get(ctx)
	if err != nil {
		return
	}
	md := mSnap.Data()
	if s, _ := md["status"].(string); s != "in_progress" {
		return // only sample matches that are actually being played
	}

	segment, err := newestSegment(filepath.Join(*streamsDir, streamKey))
	if err != nil {
		return
	}
	frame, err := extractLastFrame(segment, "")
	if err != nil {
		return
	}
	defer os.Remove(frame)

	// AC6 — free perceptual-hash spoof/frozen-feed heuristic (no Vision call).
	checkSpoof(ctx, mRef, tid, matchID, hostUid, streamKey, frame, md)

	// AC4 — high-stakes webcam face-presence (Vision, throttled 60s/player).
	if tournamentEntryFee(ctx, tid) > webcamPrizeThreshold {
		checkFacePresence(ctx, mRef, tid, matchID, md)
	}

	overall, flags, err := geminiCheatCheck(ctx, frame)
	if err != nil {
		log.Printf("cheat-scan: gemini %s: %v", streamKey, err)
		return
	}
	bumpBudget()

	// Always stamp the latest read on the match (cheap overwrite, overlay/mods read it).
	_, _ = mRef.Set(ctx, map[string]any{
		"liveCheatFlag": map[string]any{
			"overall": overall, "hostUid": hostUid, "at": firestore.ServerTimestamp,
		},
	}, firestore.MergeAll)

	cheatMu.Lock()
	prev := lastCheatOverall[matchID]
	worsened := cheatRank(overall) > cheatRank(prev)
	lastCheatOverall[matchID] = overall
	cheatMu.Unlock()

	if overall == "clean" || !worsened {
		return // only escalate when the verdict first turns / gets worse
	}

	// Queue for a mod (the Vanguard Review Queue consumes tournament_review_queue).
	_, _, err = fsClient.Collection("tournament_review_queue").Add(ctx, map[string]any{
		"tournamentId": tid, "matchId": matchID, "hostUid": hostUid,
		"source": "live_sampling", "overall": overall, "flags": flags,
		"status": "pending", "createdAt": firestore.ServerTimestamp,
	})
	if err != nil {
		log.Printf("cheat-scan: review-queue write: %v", err)
	}
	// Pre-emptive notice to both participants (mirrors aiCheatFlagVod).
	p1, _ := md["player1"].(string)
	p2, _ := md["player2"].(string)
	for _, uid := range []string{p1, p2} {
		if uid != "" {
			addMatchNotification(ctx, uid, "tournament_flagged_for_review",
				"Match flagged for live review", tid, matchID)
		}
	}
	log.Printf("cheat-scan: %s/%s flagged %s", tid, matchID, overall)
}

// geminiVision sends one PNG frame + prompt to Gemini 1.5 Flash and returns the
// trimmed text response (fenced-code markers stripped).
func geminiVision(ctx context.Context, pngPath, prompt string) (string, error) {
	b, err := os.ReadFile(pngPath)
	if err != nil {
		return "", err
	}
	if len(b) > 4*1024*1024 {
		return "", fmt.Errorf("frame too large")
	}
	payload := map[string]any{
		"contents": []any{map[string]any{"parts": []any{
			map[string]any{"text": prompt},
			map[string]any{"inline_data": map[string]any{
				"mime_type": "image/png",
				"data":      base64.StdEncoding.EncodeToString(b),
			}},
		}}},
		"generationConfig": map[string]any{"temperature": 0, "maxOutputTokens": 256},
	}
	body, _ := json.Marshal(payload)
	url := "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + geminiKey
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini status %d", resp.StatusCode)
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return "", nil
	}
	text := out.Candidates[0].Content.Parts[0].Text
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "```json", ""), "```", "")), nil
}

// geminiCheatCheck (AC3). Unparseable / empty responses are treated as "clean"
// so a model hiccup never produces a false cheat flag.
func geminiCheatCheck(ctx context.Context, pngPath string) (string, []any, error) {
	text, err := geminiVision(ctx, pngPath, cheatPrompt)
	if err != nil {
		return "", nil, err
	}
	if text == "" {
		return "clean", nil, nil
	}
	var parsed struct {
		Overall string `json:"overall"`
		Flags   []any  `json:"flags"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return "clean", nil, nil // don't false-flag on unparseable output
	}
	if parsed.Overall == "" {
		parsed.Overall = "clean"
	}
	return parsed.Overall, parsed.Flags, nil
}

// ───────────────────────────────────────────────────────────
// AC6 — stream-source spoof / frozen-feed heuristic (free, no Vision)
// ───────────────────────────────────────────────────────────

// aHash computes a 64-bit average-hash of a PNG by sampling an 8x8 grid of
// cell-centre luminance against the grid mean. Resolution-independent.
func aHash(pngPath string) (uint64, error) {
	f, err := os.Open(pngPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		return 0, err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 8 || h < 8 {
		return 0, fmt.Errorf("image too small")
	}
	var cells [64]float64
	var sum float64
	for i := 0; i < 8; i++ {
		for j := 0; j < 8; j++ {
			x := b.Min.X + (j*w)/8 + w/16
			y := b.Min.Y + (i*h)/8 + h/16
			r, g, bb, _ := img.At(x, y).RGBA()
			gray := 0.299*float64(r) + 0.587*float64(g) + 0.114*float64(bb)
			cells[i*8+j] = gray
			sum += gray
		}
	}
	mean := sum / 64
	var hash uint64
	for i := 0; i < 64; i++ {
		if cells[i] > mean {
			hash |= 1 << uint(i)
		}
	}
	return hash, nil
}

func hamming(a, b uint64) int { return bits.OnesCount64(a ^ b) }

// checkSpoof tracks consecutive near-identical frames. A genuinely live match
// is never frozen for minutes; a paused/looped fake feed is. Low-confidence
// mod HINT only — never an auto-action.
func checkSpoof(ctx context.Context, mRef *firestore.DocumentRef, tid, matchID, hostUid, streamKey, framePath string, md map[string]any) {
	hash, err := aHash(framePath)
	if err != nil {
		return
	}
	cheatMu.Lock()
	prev, had := lastFrameHash[streamKey]
	lastFrameHash[streamKey] = hash
	if had && hamming(prev, hash) < 4 {
		staticCount[streamKey]++
	} else {
		staticCount[streamKey] = 0
		spoofFlagged[matchID] = false // movement resumed — re-arm
	}
	count := staticCount[streamKey]
	already := spoofFlagged[matchID]
	if count >= spoofStaticThreshold && !already {
		spoofFlagged[matchID] = true
	}
	cheatMu.Unlock()

	if count < spoofStaticThreshold || already {
		return
	}
	_, _ = mRef.Set(ctx, map[string]any{
		"liveCheatFlag": map[string]any{
			"spoofSuspected": true, "spoofHostUid": hostUid, "spoofAt": firestore.ServerTimestamp,
		},
	}, firestore.MergeAll)
	_, _, _ = fsClient.Collection("tournament_review_queue").Add(ctx, map[string]any{
		"tournamentId": tid, "matchId": matchID, "hostUid": hostUid,
		"source": "spoof_static", "overall": "suspicious",
		"flags":  []any{map[string]any{"type": "stream_static", "note": "Feed appears frozen/looped for several minutes mid-match."}},
		"status": "pending", "createdAt": firestore.ServerTimestamp,
	})
	log.Printf("cheat-scan: spoof hint (static feed) %s/%s", tid, matchID)
}

// ───────────────────────────────────────────────────────────
// AC4 — high-stakes webcam face-presence (Vision)
// ───────────────────────────────────────────────────────────

func tournamentEntryFee(ctx context.Context, tid string) float64 {
	snap, err := fsClient.Collection("tournaments").Doc(tid).Get(ctx)
	if err != nil {
		return 0
	}
	switch v := snap.Data()["entryFee"].(type) {
	case int64:
		return float64(v)
	case float64:
		return v
	}
	return 0
}

// latestProofChunkURL returns the newest proof-feed chunk URL for a player.
func latestProofChunkURL(md map[string]any, uid string) string {
	pf, _ := md["proofFeed"].(map[string]any)
	if pf == nil {
		return ""
	}
	side, _ := pf[uid].(map[string]any)
	if side == nil {
		return ""
	}
	chunks, _ := side["chunks"].([]any)
	bestIdx := -1.0
	bestURL := ""
	for _, c := range chunks {
		cm, _ := c.(map[string]any)
		if cm == nil {
			continue
		}
		idx, _ := toFloat(cm["idx"])
		url, _ := cm["url"].(string)
		if url != "" && idx >= bestIdx {
			bestIdx = idx
			bestURL = url
		}
	}
	return bestURL
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case int64:
		return float64(n), true
	case float64:
		return n, true
	}
	return 0, false
}

func checkFacePresence(ctx context.Context, mRef *firestore.DocumentRef, tid, matchID string, md map[string]any) {
	for _, uid := range []string{firstString(md["player1"]), firstString(md["player2"])} {
		if uid == "" {
			continue
		}
		key := matchID + "|" + uid
		now := time.Now().UnixMilli()
		cheatMu.Lock()
		if now-lastFaceAt[key] < 55_000 { // ~60s throttle per player
			cheatMu.Unlock()
			continue
		}
		lastFaceAt[key] = now
		cheatMu.Unlock()

		url := latestProofChunkURL(md, uid)
		if url == "" {
			continue // player not recording the proof feed yet
		}
		if !budgetOK(3000) {
			return
		}
		webm, err := fetchToTemp(ctx, url, ".webm")
		if err != nil {
			continue
		}
		frame, err := extractLastFrame(webm, "")
		os.Remove(webm)
		if err != nil {
			continue
		}
		text, err := geminiVision(ctx, frame, facePrompt)
		os.Remove(frame)
		bumpBudget()
		// On error/unparseable, assume a face is present so a hiccup never flags.
		face := true
		if err == nil && text != "" {
			var p struct {
				Face bool `json:"face"`
			}
			if json.Unmarshal([]byte(text), &p) == nil {
				face = p.Face
			}
		}

		cheatMu.Lock()
		if face {
			noFaceCount[key] = 0
			cheatMu.Unlock()
			continue
		}
		noFaceCount[key]++
		n := noFaceCount[key]
		flag := n == faceMissThreshold // fire exactly once at the threshold
		cheatMu.Unlock()
		if !flag {
			continue
		}
		_, _, _ = fsClient.Collection("tournament_review_queue").Add(ctx, map[string]any{
			"tournamentId": tid, "matchId": matchID, "hostUid": uid,
			"source": "face_absent", "overall": "suspicious",
			"flags":  []any{map[string]any{"type": "webcam_no_face", "note": "No face detected in the proof-feed webcam for several minutes."}},
			"status": "pending", "createdAt": firestore.ServerTimestamp,
		})
		addMatchNotification(ctx, uid, "tournament_flagged_for_review",
			"Keep your face in the webcam", tid, matchID)
		log.Printf("cheat-scan: face-absent hint %s in %s/%s", uid, tid, matchID)
	}
}

// fetchToTemp downloads url to a temp file with the given extension.
func fetchToTemp(ctx context.Context, url, ext string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch status %d", resp.StatusCode)
	}
	f, err := os.CreateTemp("", "vergr-proof-*"+ext)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	f.Close()
	return f.Name(), nil
}

// ───────────────────────────────────────────────────────────
// HTTP /ocr endpoint
// ───────────────────────────────────────────────────────────

func handleOCR(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, OCRResponse{OK: false, Error: "POST only"})
		return
	}
	if sharedSecret != "" {
		if r.Header.Get("X-Vergr-Token") != sharedSecret {
			writeJSON(w, http.StatusUnauthorized, OCRResponse{OK: false, Error: "bad token"})
			return
		}
	}

	var req OCRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, OCRResponse{OK: false, Error: "bad json"})
		return
	}
	if req.StreamKey == "" {
		writeJSON(w, http.StatusBadRequest, OCRResponse{OK: false, Error: "streamKey required"})
		return
	}

	start := time.Now()

	segment, err := newestSegment(filepath.Join(*streamsDir, req.StreamKey))
	if err != nil {
		writeJSON(w, http.StatusNotFound, OCRResponse{OK: false, Error: fmt.Sprintf("no segment: %v", err)})
		return
	}

	cropExpr := ""
	if req.Crop != nil && req.Crop.valid() {
		cropExpr = req.Crop.ffmpegExpr()
	}

	tmpPng, err := extractLastFrame(segment, cropExpr)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, OCRResponse{OK: false, Error: fmt.Sprintf("ffmpeg: %v", err)})
		return
	}
	defer os.Remove(tmpPng)

	text, err := runTesseract(tmpPng, req.DigitsOnly)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, OCRResponse{OK: false, Error: fmt.Sprintf("tesseract: %v", err)})
		return
	}

	resp := OCRResponse{
		OK:         true,
		Text:       strings.TrimSpace(text),
		Game:       req.Game,
		FrameAt:    req.FrameAt,
		DurationMs: time.Since(start).Milliseconds(),
	}

	if req.ReturnFrameBase64 {
		pngBytes, err := os.ReadFile(tmpPng)
		if err == nil && len(pngBytes) <= 8*1024*1024 {
			resp.FrameBase64 = base64.StdEncoding.EncodeToString(pngBytes)
			resp.FrameMime = "image/png"
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// newestSegment returns the path to the most recent .ts or .m4s file in dir.
func newestSegment(dir string) (string, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	var candidates []os.FileInfo
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".m4s") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		candidates = append(candidates, fi)
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("no segments in %s", dir)
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].ModTime().After(candidates[j].ModTime())
	})
	return filepath.Join(dir, candidates[0].Name()), nil
}

// extractLastFrame dumps the LAST frame of a media file to a temp PNG,
// optionally applying a crop filter (cropExpr from CropRegion.ffmpegExpr).
func extractLastFrame(mediaPath, cropExpr string) (string, error) {
	out, err := os.CreateTemp("", "vergr-ocr-*.png")
	if err != nil {
		return "", err
	}
	out.Close()

	args := []string{"-y", "-sseof", "-1", "-i", mediaPath}
	if cropExpr != "" {
		args = append(args, "-vf", cropExpr)
	}
	args = append(args, "-update", "1", "-frames:v", "1", out.Name())

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Remove(out.Name())
		return "", fmt.Errorf("%v: %s", err, stderr.String())
	}
	return out.Name(), nil
}

// runTesseract runs Tesseract on a PNG. digitsOnly restricts output to the
// numeric scoreboard charset + single-line page-segmentation (psm 7).
func runTesseract(pngPath string, digitsOnly bool) (string, error) {
	args := []string{pngPath, "-", "-l", "eng"}
	if digitsOnly {
		args = append(args, "--psm", "7", "-c", "tessedit_char_whitelist=0123456789-: ")
	} else {
		args = append(args, "--psm", "6")
	}
	cmd := exec.Command("tesseract", args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%v: %s", err, errBuf.String())
	}
	return out.String(), nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
