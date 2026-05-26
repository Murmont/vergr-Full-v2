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
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
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
	sharedSecret = os.Getenv("VERGR_OCR_SHARED_SECRET")

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

	// Start the live-score self-loop (AC1). Non-fatal if Firebase init fails —
	// the HTTP OCR endpoint stays up either way.
	if *liveScores {
		ctx := context.Background()
		if err := initFirebase(ctx); err != nil {
			log.Printf("live-score loop DISABLED: firebase init: %v", err)
		} else {
			log.Printf("live-score loop enabled, interval=%s", *liveInterval)
			go runLiveScoreLoop(ctx)
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
