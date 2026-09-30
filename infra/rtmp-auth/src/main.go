// vergr-rtmp-auth — Broadcaster authentication + bitrate enforcement for
// the nginx-rtmp pipeline on the Hetzner box.
//
// Two responsibilities:
//
// 1. ON_PUBLISH AUTH (POST /auth)
//    nginx-rtmp fires this for every incoming RTMP publish attempt.
//    nginx sends form-encoded body with `name` = stream key.
//    We validate against Firestore:
//      - stream key resolves to a `streams/{id}` doc
//      - doc.status == 'created' or 'live' (resume case)
//      - doc.expiresAt > now (if set)
//    The doc's hostPlan field tells us the tier — no need for a URL param.
//    On success: flip status to 'live', stamp startedAt, return 200.
//    On failure: return non-2xx → nginx drops the connection.
//
// 2. BITRATE WATCHDOG (background goroutine)
//    Every 5 seconds, polls nginx-rtmp's /stat XML endpoint, parses
//    bandwidth per active stream, compares against the stream's plan
//    hard cap. If exceeded for >=15s sustained: hit nginx-rtmp's control
//    endpoint with `app=live_X&name=<key>&control=drop` to disconnect.
//
// Listens on 127.0.0.1:8093 (localhost only — nginx is on the same box).

package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"

	"cloud.google.com/go/firestore"
)

// ─────────────────────────────────────────────────────────────
// Config — plan bitrate caps (LOCKED 2026-05-16 per CLAUDE.md)
// ─────────────────────────────────────────────────────────────
type PlanRule struct {
	TargetKbps int // soft target in Kbps
	HardKbps   int // disconnect after >= this for 15s sustained
	Label      string
}

var PLAN_RULES = map[string]PlanRule{
	"free": {TargetKbps: 3000, HardKbps: 4000, Label: "480p30 @ 3 Mbps"},
	"lite": {TargetKbps: 4500, HardKbps: 6000, Label: "720p60 @ 4.5 Mbps"},
	"pro":  {TargetKbps: 6500, HardKbps: 9000, Label: "1080p60 @ 6.5 Mbps"},
}

// ─────────────────────────────────────────────────────────────
// Flags + state
// ─────────────────────────────────────────────────────────────
var (
	listenAddr   = flag.String("listen", "127.0.0.1:8093", "HTTP listen address")
	credsPath    = flag.String("creds", "/etc/vergr-rtmp-auth/firebase-admin.json", "Firebase service-account JSON")
	statURL      = flag.String("stat", "http://127.0.0.1:80/rtmp-stat", "nginx-rtmp stat XML URL")
	controlURL   = flag.String("control", "http://127.0.0.1:80/rtmp-control", "nginx-rtmp control URL")
	databaseID   = flag.String("db", "vgrdb", "Firestore database ID")
	watchInterval = flag.Duration("watch-interval", 5*time.Second, "Bitrate poll interval")
	overCapTime  = flag.Duration("over-cap-time", 15*time.Second, "Sustained over-cap duration before disconnect")
	localRtmp    = flag.String("local-rtmp", "rtmp://127.0.0.1:1935", "Local nginx-rtmp base for relay pull")
	twitchIngest = flag.String("twitch-ingest", "rtmp://live.twitch.tv/app", "Twitch RTMP ingest base (key appended)")
	ffmpegBin    = flag.String("ffmpeg", "ffmpeg", "ffmpeg binary path")

	fsClient *firestore.Client
	authClient *auth.Client
)

// ─────────────────────────────────────────────────────────────
// Twitch mirror relay — re-pushes the incoming OBS feed (pulled from local
// nginx-rtmp) straight to the streamer's Twitch with `-c copy` (no transcode,
// cheap CPU). One ffmpeg process per mirrored stream, keyed by Vergr streamKey.
// ─────────────────────────────────────────────────────────────
type relayManager struct {
	mu  sync.Mutex
	cmd map[string]*exec.Cmd // streamKey -> running ffmpeg
}

var relays = &relayManager{cmd: make(map[string]*exec.Cmd)}

func (rm *relayManager) start(streamKey, app, twitchKey, docID string) {
	rm.mu.Lock()
	if _, exists := rm.cmd[streamKey]; exists {
		rm.mu.Unlock()
		return // already relaying
	}
	rm.mu.Unlock()

	in := fmt.Sprintf("%s/%s/%s", *localRtmp, app, streamKey)
	out := fmt.Sprintf("%s/%s", *twitchIngest, twitchKey)
	// -c copy passthrough; reconnect flags ride brief nginx hiccups.
	cmd := exec.Command(*ffmpegBin,
		"-nostdin", "-hide_banner", "-loglevel", "warning",
		"-i", in,
		"-c", "copy", "-f", "flv",
		out,
	)
	if err := cmd.Start(); err != nil {
		log.Printf("relay: ffmpeg start failed for %s: %v", docID, err)
		stampMirrorState(docID, "error")
		return
	}
	rm.mu.Lock()
	rm.cmd[streamKey] = cmd
	rm.mu.Unlock()
	log.Printf("relay: started Twitch mirror for stream %s (pid %d)", docID, cmd.Process.Pid)
	stampMirrorState(docID, "relaying")

	// Reap on exit so the map doesn't leak; if it dies unexpectedly while the
	// stream is still live, mark error so the UI can warn.
	go func() {
		err := cmd.Wait()
		rm.mu.Lock()
		delete(rm.cmd, streamKey)
		rm.mu.Unlock()
		if err != nil {
			log.Printf("relay: ffmpeg for %s exited: %v", docID, err)
		}
	}()
}

func (rm *relayManager) stop(streamKey string) {
	rm.mu.Lock()
	cmd := rm.cmd[streamKey]
	delete(rm.cmd, streamKey)
	rm.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		log.Printf("relay: stopped Twitch mirror (key prefix %s)", streamKey[:min(8, len(streamKey))])
	}
}

// stampMirrorState writes streams/{id}.twitchMirrorState so the client can show
// "Mirroring to Twitch" / "Mirror error". Best-effort.
func stampMirrorState(docID, state string) {
	if docID == "" { return }
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, _ = fsClient.Collection("streams").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "twitchMirrorState", Value: state},
	})
}

// maybeStartMirror inspects a stream doc; if twitchMirror.enabled it looks up
// the host's Twitch stream key (server-only secrets doc) and spawns the relay.
func maybeStartMirror(ctx context.Context, streamKey, app, docID string, data map[string]interface{}) {
	tm, ok := data["twitchMirror"].(map[string]interface{})
	if !ok { return }
	if enabled, _ := tm["enabled"].(bool); !enabled { return }
	hostUid, _ := data["hostUid"].(string)
	if hostUid == "" { return }

	sctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	secret, err := fsClient.Collection("twitch_mirror_secrets").Doc(hostUid).Get(sctx)
	if err != nil {
		log.Printf("relay: no twitch_mirror_secrets for %s: %v", hostUid, err)
		stampMirrorState(docID, "error")
		return
	}
	twitchKey, _ := secret.Data()["streamKey"].(string)
	if twitchKey == "" {
		stampMirrorState(docID, "error")
		return
	}
	relays.start(streamKey, app, twitchKey, docID)
}

// overCapTracker — per-stream tracking of when over-cap state started.
// Reset to zero time when bitrate drops back under cap.
type overCapTracker struct {
	mu       sync.Mutex
	starts   map[string]time.Time // key: "app/name", e.g. "live_free/abc123"
}

var oct = &overCapTracker{starts: make(map[string]time.Time)}

// ─────────────────────────────────────────────────────────────
// Firebase setup
// ─────────────────────────────────────────────────────────────
// Read project_id directly from the service account JSON.
func readProjectID(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil { return "", err }
	var meta struct{ ProjectID string `json:"project_id"` }
	if err := json.Unmarshal(b, &meta); err != nil { return "", err }
	if meta.ProjectID == "" { return "", fmt.Errorf("project_id missing from creds") }
	return meta.ProjectID, nil
}

func initFirebase(ctx context.Context) error {
	opt := option.WithCredentialsFile(*credsPath)
	projectID, err := readProjectID(*credsPath)
	if err != nil { return fmt.Errorf("read project id: %w", err) }
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID}, opt)
	if err != nil {
		return fmt.Errorf("firebase NewApp: %w", err)
	}
	authClient, err = app.Auth(ctx)
	if err != nil {
		return fmt.Errorf("auth.Client: %w", err)
	}
	fsClient, err = firestore.NewClientWithDatabase(ctx, projectID, *databaseID, opt)
	if err != nil {
		return fmt.Errorf("firestore.NewClientWithDatabase: %w", err)
	}
	return nil
}

func main() {
	flag.Parse()
	ctx := context.Background()

	if err := initFirebase(ctx); err != nil {
		log.Fatalf("init firebase: %v", err)
	}
	defer fsClient.Close()

	http.HandleFunc("/healthz", handleHealthz)
	http.HandleFunc("/auth", handlePublishAuth)
	http.HandleFunc("/on_done", handlePublishDone)

	go watchdogLoop(ctx)

	log.Printf("vergr-rtmp-auth listening on %s, watching nginx-rtmp every %s", *listenAddr, *watchInterval)
	if err := http.ListenAndServe(*listenAddr, nil); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, `{"ok":true,"now":"%s"}`, time.Now().UTC().Format(time.RFC3339))
}

// ─────────────────────────────────────────────────────────────
// 1. on_publish auth callback
// ─────────────────────────────────────────────────────────────
// streamPlans is a tiny cache so the watchdog can look up each active stream's
// effective tier without hitting Firestore on every poll tick. Populated on
// auth + refreshed by the watchdog every poll (so quality-boost transitions
// take effect within one tick interval, ~5 seconds).
type streamCacheEntry struct {
	BasePlan    string // hostPlan from streams doc
	BoostActive bool
	BoostTier   string // qualityBoost.targetTier if active
	DocID       string // streams/{id} for re-reads
}

var streamPlans = struct {
	mu sync.Mutex
	m  map[string]*streamCacheEntry // streamKey -> entry
}{m: make(map[string]*streamCacheEntry)}

func setStreamPlan(streamKey, plan, docID string) {
	streamPlans.mu.Lock(); defer streamPlans.mu.Unlock()
	streamPlans.m[streamKey] = &streamCacheEntry{BasePlan: plan, DocID: docID}
}
func getStreamPlan(streamKey string) *streamCacheEntry {
	streamPlans.mu.Lock(); defer streamPlans.mu.Unlock()
	return streamPlans.m[streamKey]
}
func dropStreamPlan(streamKey string) {
	streamPlans.mu.Lock(); defer streamPlans.mu.Unlock()
	delete(streamPlans.m, streamKey)
}
// effectiveTier returns the plan that should be used for bitrate enforcement,
// honoring an active quality boost.
func effectiveTier(e *streamCacheEntry) string {
	if e == nil { return "" }
	if e.BoostActive && e.BoostTier != "" { return e.BoostTier }
	return e.BasePlan
}

func handlePublishAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	streamKey := r.Form.Get("name")
	if streamKey == "" {
		http.Error(w, "missing name", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	// Look up the stream by key.
	//
	// The key is a PUBLISH CREDENTIAL, so it is no longer a field on
	// streams/{id} (that document is world-readable, and browser ingest sends
	// this value as a Bearer token). It now lives at stream_keys/{key}, which
	// firestore.rules denies to every client, and this is a document get rather
	// than the collection query it used to be.
	//
	// The old query is kept as a fallback ONLY so a broadcast that was already
	// live when this rolled out does not drop mid-stream. Streams created after
	// the deploy have no streamKey field and never reach it.
	doc, err := resolveStreamDoc(ctx, streamKey)
	if err != nil {
		log.Printf("auth: stream not found for key prefix %s: %v", streamKey[:min(8, len(streamKey))], err)
		http.Error(w, "stream not found", http.StatusForbidden)
		return
	}
	data := doc.Data()

	status, _ := data["status"].(string)
	hostPlan, _ := data["hostPlan"].(string)
	if hostPlan == "" {
		// older docs may not have hostPlan stamped; treat as free for safety
		hostPlan = "free"
	}
	if _, ok := PLAN_RULES[hostPlan]; !ok {
		log.Printf("auth: stream %s has unknown hostPlan %q — rejecting", doc.Ref.ID, hostPlan)
		http.Error(w, "unknown plan tier on stream", http.StatusForbidden)
		return
	}

	if status != "created" && status != "live" {
		log.Printf("auth: stream %s in status %q — rejecting", doc.Ref.ID, status)
		http.Error(w, "stream not in publishable state", http.StatusForbidden)
		return
	}

	// Mark live + record start time + cache plan for the watchdog.
	_, err = doc.Ref.Update(ctx, []firestore.Update{
		{Path: "status", Value: "live"},
		{Path: "startedAt", Value: firestore.ServerTimestamp},
	})
	if err != nil {
		log.Printf("auth: failed to mark live: %v", err)
		// Don't reject — let stream through; status update isn't critical.
	}
	setStreamPlan(streamKey, hostPlan, doc.Ref.ID)

	// Twitch mirror: if this stream opted into mirroring, spawn the relay that
	// re-pushes the OBS feed to the streamer's Twitch. nginx-rtmp sends `app`
	// in the on_publish form; default to "live" if absent.
	app := r.Form.Get("app")
	if app == "" { app = "live" }
	go maybeStartMirror(context.Background(), streamKey, app, doc.Ref.ID, data)

	// Also stamp any active boost right away so the very first watchdog tick
	// uses the boost cap (rather than the base cap).
	if qb, ok := data["qualityBoost"].(map[string]interface{}); ok {
		if active, _ := qb["active"].(bool); active {
			if tt, _ := qb["targetTier"].(string); tt != "" {
				streamPlans.mu.Lock()
				if e := streamPlans.m[streamKey]; e != nil {
					e.BoostActive = true; e.BoostTier = tt
				}
				streamPlans.mu.Unlock()
			}
		}
	}

	log.Printf("auth: stream %s OK (plan=%s, target=%d kbps / hard=%d kbps)",
		doc.Ref.ID, hostPlan, PLAN_RULES[hostPlan].TargetKbps, PLAN_RULES[hostPlan].HardKbps)
	w.WriteHeader(http.StatusOK)
}

// on_done — fired by nginx-rtmp when a publish ends. Mark stream `ended`.
func handlePublishDone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "POST only", 405); return }
	_ = r.ParseForm()
	streamKey := r.Form.Get("name")
	if streamKey == "" { w.WriteHeader(200); return }
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	iter := fsClient.Collection("streams").Where("streamKey", "==", streamKey).Limit(1).Documents(ctx)
	defer iter.Stop()
	doc, err := iter.Next()
	if err == nil {
		_, _ = doc.Ref.Update(ctx, []firestore.Update{
			{Path: "status",  Value: "ended"},
			{Path: "endedAt", Value: firestore.ServerTimestamp},
		})
	}
	// clear any oct entry for this stream + drop from plan cache.
	oct.mu.Lock()
	for k := range oct.starts {
		if strings.HasSuffix(k, "/"+streamKey) { delete(oct.starts, k) }
	}
	oct.mu.Unlock()
	dropStreamPlan(streamKey)
	relays.stop(streamKey) // kill any Twitch mirror relay for this stream
	w.WriteHeader(200)
}

// ─────────────────────────────────────────────────────────────
// 2. Bitrate watchdog — parses /stat XML, drops streams over hard cap
// ─────────────────────────────────────────────────────────────
type RtmpStat struct {
	XMLName xml.Name      `xml:"rtmp"`
	Servers []RtmpServer  `xml:"server"`
}
type RtmpServer struct {
	Applications []RtmpApp `xml:"application"`
}
type RtmpApp struct {
	Name string     `xml:"name"`
	Live struct {
		Streams []RtmpLiveStream `xml:"stream"`
	} `xml:"live"`
}
type RtmpLiveStream struct {
	Name    string `xml:"name"`
	BwIn    int64  `xml:"bw_in"`     // bits/sec inbound
	Time    int64  `xml:"time"`      // ms since publish started
	Active  *struct{} `xml:"active"`
}

func watchdogLoop(ctx context.Context) {
	ticker := time.NewTicker(*watchInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := watchdogTick(); err != nil {
				log.Printf("watchdog tick error: %v", err)
			}
		}
	}
}

func watchdogTick() error {
	resp, err := http.Get(*statURL)
	if err != nil { return err }
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil { return err }
	var stat RtmpStat
	if err := xml.Unmarshal(body, &stat); err != nil {
		return fmt.Errorf("xml unmarshal: %w", err)
	}

	now := time.Now()
	seen := make(map[string]bool)

	for _, srv := range stat.Servers {
		for _, app := range srv.Applications {
			for _, s := range app.Live.Streams {
				if s.Active == nil { continue }
				key := app.Name + "/" + s.Name
				seen[key] = true

				entry := getStreamPlan(s.Name)
				if entry == nil { continue } // not authed via us — skip (e.g. cohost loopback)

				// Refresh boost state every tick (cheap single-doc read) so
				// quality-boost transitions take effect within ~5 seconds.
				// The SAME read carries the takedown marker (functions/
				// streamTakedown.js): a stream Vergr ended is dropped here, at
				// no extra cost, instead of publishing to the CDN forever.
				if refreshBoostState(entry) {
					log.Printf("watchdog: %s was TAKEN DOWN by Vergr — dropping the publisher", key)
					dropStream(app.Name, s.Name)
					dropStreamPlan(s.Name)
					continue
				}

				tier := effectiveTier(entry)
				rules, ok := PLAN_RULES[tier]
				if !ok { continue }

				kbps := s.BwIn / 1000
				oct.mu.Lock()
				start, wasOver := oct.starts[key]
				if kbps > int64(rules.HardKbps) {
					if !wasOver {
						oct.starts[key] = now
						log.Printf("watchdog: %s (tier=%s, boost=%v) entered over-cap (%d kbps > %d hard) — starting timer", key, tier, entry.BoostActive, kbps, rules.HardKbps)
					} else if now.Sub(start) >= *overCapTime {
						oct.mu.Unlock()
						dropStream(app.Name, s.Name)
						oct.mu.Lock()
						delete(oct.starts, key)
					}
				} else if wasOver {
					delete(oct.starts, key)
					log.Printf("watchdog: %s back under cap (%d kbps)", key, kbps)
				}
				oct.mu.Unlock()
			}
		}
	}

	// Clean up trackers for streams that disappeared.
	oct.mu.Lock()
	for k := range oct.starts {
		if !seen[k] { delete(oct.starts, k) }
	}
	oct.mu.Unlock()
	return nil
}

// refreshBoostState polls the streams doc for qualityBoost field updates.
// Called every watchdog tick. Cheap (single Firestore read).
// Returns true when the stream was TAKEN DOWN (takenDownAt set), so the caller
// drops the publisher. A read error returns false: never drop on a hiccup.
func refreshBoostState(entry *streamCacheEntry) bool {
	if entry == nil || entry.DocID == "" { return false }
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	doc, err := fsClient.Collection("streams").Doc(entry.DocID).Get(ctx)
	if err != nil { return false }
	data := doc.Data()
	if _, ok := data["takenDownAt"]; ok {
		return true
	}
	var active bool
	var tier string
	if qb, ok := data["qualityBoost"].(map[string]interface{}); ok {
		active, _ = qb["active"].(bool)
		tier, _ = qb["targetTier"].(string)
	}
	streamPlans.mu.Lock()
	defer streamPlans.mu.Unlock()
	if active != entry.BoostActive || tier != entry.BoostTier {
		log.Printf("watchdog: %s boost transition active %v→%v, tier %q→%q",
			entry.DocID, entry.BoostActive, active, entry.BoostTier, tier)
		entry.BoostActive = active
		entry.BoostTier = tier
	}
	return false
}

func dropStream(app, name string) {
	log.Printf("watchdog: DROPPING %s/%s for exceeding bitrate cap %s", app, name, *overCapTime)
	u, _ := url.Parse(*controlURL)
	q := u.Query()
	q.Set("app", app)
	q.Set("name", name)
	u.RawQuery = q.Encode()
	resp, err := http.Get(u.String() + "&control=drop")
	if err != nil {
		log.Printf("dropStream: %v", err)
		return
	}
	resp.Body.Close()
}

func min(a, b int) int { if a < b { return a }; return b }

// Stub to make Go shut up about unused import; remove if Go complains.
var _ = os.Getenv

// resolveStreamDoc turns a publish key into its stream document.
//
// Primary path: stream_keys/{key} -> { streamId }, a single document get.
// Fallback: the legacy streams.where(streamKey ==) query, for broadcasts that
// were created before the key moved off the public document. Once no such
// stream can still be live, the fallback can be deleted.
func resolveStreamDoc(ctx context.Context, streamKey string) (*firestore.DocumentSnapshot, error) {
	keySnap, err := fsClient.Collection("stream_keys").Doc(streamKey).Get(ctx)
	if err == nil && keySnap.Exists() {
		if streamID, ok := keySnap.Data()["streamId"].(string); ok && streamID != "" {
			if doc, err2 := fsClient.Collection("streams").Doc(streamID).Get(ctx); err2 == nil {
				return doc, nil
			}
		}
	}

	iter := fsClient.Collection("streams").Where("streamKey", "==", streamKey).Limit(1).Documents(ctx)
	defer iter.Stop()
	return iter.Next()
}
