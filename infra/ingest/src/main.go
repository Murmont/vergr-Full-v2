// VERGR ingest — browser fMP4 chunked uploader → HLS segments on disk → r2-sync → R2 → CDN.
//
// Why this exists: free-tier broadcasters use a browser, browsers can't push RTMP.
// MediaRecorder produces fragmented MP4 (fMP4) chunks every 2 seconds. We write
// them straight to disk as HLS-fMP4 segments — no ffmpeg, no transcode, ~1% CPU
// per stream. nginx-rtmp's existing r2-sync.service watches the directory and
// pushes everything to R2 as it lands.
//
// Auth: every request carries `Authorization: Bearer <streamKey>` where streamKey
// is the secret token issued by createStreamSession (Firebase Function). The
// first /init request looks the key up in Firestore; subsequent requests hit an
// in-memory cache to avoid Firestore reads on every chunk.
//
// Endpoints:
//   POST /ingest/init        — first chunk; we parse the ftyp+moov boxes out of
//                              it and write them as init.mp4, then write the
//                              remaining moof+mdat as seg-0.m4s.
//   POST /ingest/seg/<n>     — subsequent media segments (n=1,2,3,...).
//   POST /ingest/end         — finalize playlist with #EXT-X-ENDLIST, drop session.
//   GET  /healthz            — health.
//
// Single binary, port 8089, systemd unit `vergr-ingest.service`. Logs to journalctl.
package main

import (
	"context"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/option"
)

// ============================================================
// Config
// ============================================================

const (
	maxChunkBytes      = 12 * 1024 * 1024 // 12 MB — at 6 Mbps × 2s = 1.5 MB; 12 is safe headroom
	playlistWindow     = 18               // segments visible in live playlist (~18s DVR at 1s segs; absorbs mobile-network jitter so players don't fall off the window and loop; segments persist on R2 so cost is nil)
	segmentDurationSec = 1.0              // matches client MediaRecorder 1s chunks (low-latency: ~4-6s glass-to-glass). #EXTINF + TARGETDURATION derive from this; keep in lockstep with streamIngest.js chunkIntervalMs.
	idleTimeout        = 5 * time.Minute  // sessions with no chunks in N minutes auto-finalize
)

var (
	listenAddr   = flag.String("listen", ":8089", "HTTP listen address")
	credsPath    = flag.String("creds", "/etc/vergr-sfu/firebase-admin.json", "Firebase service account JSON path (shared with vergr-sfu)")
	streamsDir   = flag.String("streams-dir", "/var/www/streams", "Directory for HLS output (must match nginx-rtmp hls_path)")
	projectID    = flag.String("project", "vergr-44494", "GCP project ID")
	databaseID   = flag.String("db", "vgrdb", "Firestore database ID (the app uses the NAMED db, not default)")
)

// ============================================================
// Firebase
// ============================================================

var fsClient *firestore.Client

func initFirebase(ctx context.Context) error {
	// CRITICAL: the app lives in the NAMED Firestore DB "vgrdb". The Firebase
	// SDK's app.Firestore() silently connects to the (empty) DEFAULT database,
	// which made every streamKey lookup fail ("unknown stream key") and broke
	// ALL browser go-lives. Always connect with the explicit database ID.
	var err error
	fsClient, err = firestore.NewClientWithDatabase(ctx, *projectID, *databaseID, option.WithCredentialsFile(*credsPath))
	if err != nil {
		return fmt.Errorf("firestore.NewClientWithDatabase: %w", err)
	}
	return nil
}

// resolveStreamKey looks up a streamKey in Firestore and returns the matching
// stream ID + host UID + plan. Rejects keys whose ingestType isn't 'browser'
// — RTMP-issued keys must not be re-used through this HTTP path.
func resolveStreamKey(ctx context.Context, key string) (streamID, hostUID, plan string, err error) {
	// THE PUBLISH KEY IS NOT ON THE `streams` DOCUMENT ANY MORE.
	//
	// This used to run `Collection("streams").Where("streamKey","==",key)`.
	// createStreamSession moved the key OFF that public document on purpose: it
	// is a publish credential, and the HLS path is
	// cdn.vergr.app/streams/<streamKey>/index.m3u8, so any viewer who could read
	// it could both hijack the publish and rebuild a paid stream's playback URL
	// by hand. The key now lives at `stream_keys/{streamKey}`, which client
	// rules deny outright.
	//
	// Nobody updated this service, so the query matched nothing and EVERY
	// browser go-live got 401 "invalid stream key" — the stream doc said LIVE,
	// discovery listed it, the viewer counter ticked, and not one byte of media
	// was ever accepted (audit A44).
	//
	// Resolving by document id is also cheaper than the collection query it
	// replaces, which is the same move vergr-rtmp-auth already made.
	keySnap, err := fsClient.Collection("stream_keys").Doc(key).Get(ctx)
	if err != nil || keySnap == nil || !keySnap.Exists() {
		return "", "", "", errors.New("unknown stream key")
	}
	keyData := keySnap.Data()
	sid, _ := keyData["streamId"].(string)
	if sid == "" {
		return "", "", "", errors.New("stream key has no streamId")
	}

	// The stream document still owns the LIFECYCLE (status, ingestType), so it
	// is still consulted — just fetched by id now instead of searched by key.
	doc, err := fsClient.Collection("streams").Doc(sid).Get(ctx)
	if err != nil || doc == nil || !doc.Exists() {
		return "", "", "", errors.New("stream not found for key")
	}
	data := doc.Data()

	status, _ := data["status"].(string)
	if status != "created" && status != "live" {
		return "", "", "", fmt.Errorf("stream not in live state (status=%s)", status)
	}

	ingestType, _ := data["ingestType"].(string)
	if ingestType != "" && ingestType != "browser" {
		return "", "", "", fmt.Errorf("stream not configured for browser ingest (ingestType=%s)", ingestType)
	}

	// Prefer the values stamped alongside the key: stream_keys is written in the
	// same transaction that mints the key, so it is the authoritative record of
	// who this credential belongs to. Fall back to the stream doc's own fields
	// for any key minted before that collection existed.
	host, _ := keyData["hostUid"].(string)
	if host == "" {
		host, _ = data["hostUid"].(string)
	}
	if host == "" {
		host, _ = data["hostId"].(string) // tolerate older field names
	}
	if host == "" {
		host, _ = data["uid"].(string)
	}
	pl, _ := keyData["hostPlan"].(string)
	if pl == "" {
		pl, _ = data["hostPlan"].(string)
	}
	if pl == "" {
		pl = "free"
	}
	return doc.Ref.ID, host, pl, nil
}

// ============================================================
// Session state
// ============================================================

type Segment struct {
	Seq      int
	Filename string
	Duration float64
}

type Session struct {
	StreamID    string
	HostUID     string
	Plan        string
	StreamKey   string
	DirPath     string
	WebPath     string // path used in m3u8 (no leading dir, just files)
	NextSeq     int    // sequence of next expected segment after init (init produces seg-0; NextSeq starts at 1)
	Segments    []Segment
	InitWritten bool
	StartedAt   time.Time
	LastChunkAt time.Time
	Ended       bool
	mu          sync.Mutex
}

type Sessions struct {
	byKey map[string]*Session
	mu    sync.RWMutex
}

var sessions = &Sessions{byKey: map[string]*Session{}}

func (s *Sessions) get(key string) *Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.byKey[key]
}

func (s *Sessions) put(key string, sess *Session) {
	s.mu.Lock()
	s.byKey[key] = sess
	s.mu.Unlock()
}

func (s *Sessions) drop(key string) {
	s.mu.Lock()
	delete(s.byKey, key)
	s.mu.Unlock()
}

// ============================================================
// fMP4 box parsing — split first chunk into init + first media segment
// ============================================================

// splitMP4InitFromFirstChunk reads top-level boxes and returns
// everything before the first `moof` box (init segment) and everything from
// `moof` onward (first media segment).
//
// A first chunk with NO moof at all is VALID: Chrome's mp4 MediaRecorder can
// emit the bare init segment (ftyp+moov) as its first ondataavailable blob,
// with the first media fragment only arriving in chunk 2. In that case the
// whole chunk is the init segment and `media` comes back empty — the caller
// starts the session with zero segments and the first /seg POST supplies the
// first fragment. (Rejecting that case 400'd every real browser go-live.)
func splitMP4InitFromFirstChunk(data []byte) (init, media []byte, err error) {
	pos := 0
	for pos < len(data) {
		if pos+8 > len(data) {
			return nil, nil, fmt.Errorf("truncated box header at %d", pos)
		}
		size := uint64(binary.BigEndian.Uint32(data[pos : pos+4]))
		boxType := string(data[pos+4 : pos+8])

		if size == 1 {
			if pos+16 > len(data) {
				return nil, nil, fmt.Errorf("truncated 64-bit size at %d", pos)
			}
			size = binary.BigEndian.Uint64(data[pos+8 : pos+16])
		} else if size == 0 {
			// Box extends to end of file — valid only for last box (mdat usually).
			size = uint64(len(data) - pos)
		}

		if boxType == "moof" {
			// Init data is everything we've seen so far.
			return data[:pos], data[pos:], nil
		}
		if boxType == "mdat" {
			return nil, nil, errors.New("mdat before moof")
		}

		pos += int(size)
		if pos < 0 || pos > len(data) {
			return nil, nil, fmt.Errorf("box size overflow at %d", pos)
		}
	}
	// Clean walk to the end with no moof/mdat: a pure init segment.
	return data, nil, nil
}

// ============================================================
// HLS playlist
// ============================================================

// writePlaylist regenerates index.m3u8 reflecting the current session state.
// Always emits the last `playlistWindow` segments. When `ended` is true,
// appends #EXT-X-ENDLIST so HLS clients know to stop polling.
func writePlaylist(sess *Session, ended bool) error {
	segs := sess.Segments
	startIdx := 0
	if !ended && len(segs) > playlistWindow {
		startIdx = len(segs) - playlistWindow
	}
	visible := segs[startIdx:]

	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:7\n")
	b.WriteString("#EXT-X-TARGETDURATION:")
	b.WriteString(strconv.Itoa(int(segmentDurationSec) + 1))
	b.WriteString("\n")
	b.WriteString("#EXT-X-MEDIA-SEQUENCE:")
	if len(visible) > 0 {
		b.WriteString(strconv.Itoa(visible[0].Seq))
	} else {
		b.WriteString("0")
	}
	b.WriteString("\n")
	b.WriteString("#EXT-X-MAP:URI=\"init.mp4\"\n")
	for _, s := range visible {
		b.WriteString(fmt.Sprintf("#EXTINF:%.3f,\n%s\n", s.Duration, s.Filename))
	}
	if ended {
		b.WriteString("#EXT-X-ENDLIST\n")
	}

	// Write atomically: write to tmp file, rename. Avoids r2-sync seeing partial playlists.
	tmp := filepath.Join(sess.DirPath, ".index.m3u8.tmp")
	final := filepath.Join(sess.DirPath, "index.m3u8")
	if err := os.WriteFile(tmp, []byte(b.String()), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

// ============================================================
// HTTP handlers
// ============================================================

func writeJSON(w http.ResponseWriter, code int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(body))
}

func errResp(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, fmt.Sprintf(`{"error":%q}`, msg))
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
}

// CORS preflight — browsers POSTing chunks with an Authorization header
// trigger preflight. Allow it from the production + dev origins.
func corsPreflight(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "3600")
	w.WriteHeader(http.StatusNoContent)
}

func handleInit(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		corsPreflight(w, r)
		return
	}
	if r.Method != http.MethodPost {
		errResp(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	key := extractBearer(r)
	if key == "" {
		errResp(w, http.StatusUnauthorized, "missing Bearer token")
		return
	}

	// Reject if a session already exists for this key — /init is once-per-stream.
	if existing := sessions.get(key); existing != nil {
		errResp(w, http.StatusConflict, "session already initialised")
		return
	}

	// Resolve key against Firestore.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	streamID, hostUID, plan, err := resolveStreamKey(ctx, key)
	if err != nil {
		log.Printf("init: resolve key failed: %v", err)
		errResp(w, http.StatusUnauthorized, "invalid stream key")
		return
	}

	// Read chunk body.
	body, err := io.ReadAll(io.LimitReader(r.Body, maxChunkBytes))
	if err != nil {
		errResp(w, http.StatusBadRequest, "body read failed")
		return
	}
	if len(body) < 32 {
		errResp(w, http.StatusBadRequest, "chunk too small")
		return
	}

	// Split first chunk into init + first segment.
	initData, mediaData, err := splitMP4InitFromFirstChunk(body)
	if err != nil {
		log.Printf("init: split failed for stream %s: %v", streamID, err)
		errResp(w, http.StatusBadRequest, "malformed first chunk: "+err.Error())
		return
	}

	// Set up session directory. Dir name is streamKey to match nginx-rtmp's
	// HLS path convention (cdn.vergr.app/streams/<streamKey>/index.m3u8).
	dirPath := filepath.Join(*streamsDir, key)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		log.Printf("init: mkdir %s: %v", dirPath, err)
		errResp(w, http.StatusInternalServerError, "mkdir failed")
		return
	}

	if err := os.WriteFile(filepath.Join(dirPath, "init.mp4"), initData, 0o644); err != nil {
		errResp(w, http.StatusInternalServerError, "write init failed")
		return
	}
	// First chunk may be init-only (no media fragment yet) — see
	// splitMP4InitFromFirstChunk. Only write seg-0 when media data exists.
	segments := []Segment{}
	if len(mediaData) > 0 {
		seg0 := "seg-0.m4s"
		if err := os.WriteFile(filepath.Join(dirPath, seg0), mediaData, 0o644); err != nil {
			errResp(w, http.StatusInternalServerError, "write seg-0 failed")
			return
		}
		segments = append(segments, Segment{Seq: 0, Filename: seg0, Duration: segmentDurationSec})
	}

	now := time.Now()
	sess := &Session{
		StreamID:    streamID,
		HostUID:     hostUID,
		Plan:        plan,
		StreamKey:   key,
		DirPath:     dirPath,
		NextSeq:     1,
		InitWritten: true,
		StartedAt:   now,
		LastChunkAt: now,
		Segments:    segments,
	}

	if err := writePlaylist(sess, false); err != nil {
		errResp(w, http.StatusInternalServerError, "write playlist failed: "+err.Error())
		return
	}
	sessions.put(key, sess)

	// Best-effort: flip Firestore status to 'live'. Don't block the response on this.
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = fsClient.Collection("streams").Doc(streamID).Update(bg, []firestore.Update{
			{Path: "status", Value: "live"},
			{Path: "startedAt", Value: now},
			{Path: "ingestType", Value: "fmp4"},
		})
	}()

	log.Printf("init: stream=%s host=%s plan=%s init=%dB seg0=%dB", streamID, hostUID, plan, len(initData), len(mediaData))
	writeJSON(w, http.StatusOK, fmt.Sprintf(`{"status":"ok","streamId":%q,"seq":0}`, streamID))
}

func handleSeg(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		corsPreflight(w, r)
		return
	}
	if r.Method != http.MethodPost {
		errResp(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	key := extractBearer(r)
	if key == "" {
		errResp(w, http.StatusUnauthorized, "missing Bearer token")
		return
	}

	sess := sessions.get(key)
	if sess == nil {
		errResp(w, http.StatusNotFound, "session not initialised — call /ingest/init first")
		return
	}

	// Path is /ingest/seg/<n> — last segment is the seq number.
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		errResp(w, http.StatusBadRequest, "missing seq in path")
		return
	}
	seq, err := strconv.Atoi(parts[len(parts)-1])
	if err != nil || seq < 1 {
		errResp(w, http.StatusBadRequest, "bad seq")
		return
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.Ended {
		errResp(w, http.StatusGone, "session ended")
		return
	}
	if seq < sess.NextSeq {
		// Duplicate — silently OK.
		writeJSON(w, http.StatusOK, fmt.Sprintf(`{"status":"duplicate","expected":%d}`, sess.NextSeq))
		return
	}
	if seq > sess.NextSeq {
		errResp(w, http.StatusConflict, fmt.Sprintf("seq gap: expected %d got %d", sess.NextSeq, seq))
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxChunkBytes))
	if err != nil || len(body) == 0 {
		errResp(w, http.StatusBadRequest, "body read failed")
		return
	}

	filename := fmt.Sprintf("seg-%d.m4s", seq)
	if err := os.WriteFile(filepath.Join(sess.DirPath, filename), body, 0o644); err != nil {
		log.Printf("seg: write %s: %v", filename, err)
		errResp(w, http.StatusInternalServerError, "write failed")
		return
	}

	sess.Segments = append(sess.Segments, Segment{Seq: seq, Filename: filename, Duration: segmentDurationSec})
	sess.NextSeq = seq + 1
	sess.LastChunkAt = time.Now()

	if err := writePlaylist(sess, false); err != nil {
		log.Printf("seg: playlist update: %v", err)
	}

	writeJSON(w, http.StatusOK, fmt.Sprintf(`{"status":"ok","seq":%d}`, seq))
}

func handleEnd(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		corsPreflight(w, r)
		return
	}
	if r.Method != http.MethodPost {
		errResp(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	key := extractBearer(r)
	if key == "" {
		errResp(w, http.StatusUnauthorized, "missing Bearer token")
		return
	}

	sess := sessions.get(key)
	if sess == nil {
		// Already ended — be idempotent.
		writeJSON(w, http.StatusOK, `{"status":"already-ended"}`)
		return
	}

	finalize(sess, "client-end")
	writeJSON(w, http.StatusOK, `{"status":"ended"}`)
}

// handleProbe is a throughput sink for the client's pre-flight uplink test. It
// reads (and discards) the POSTed body and reports how many bytes it received,
// so the broadcaster can measure real upload bandwidth to THIS box before going
// live and pick a starting bitrate/fps the network can actually sustain. No
// session, no disk write — pure bandwidth measurement.
func handleProbe(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		corsPreflight(w, r)
		return
	}
	if r.Method != http.MethodPost {
		errResp(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	// Require a Bearer token so this can't be used as an open bandwidth sink.
	if extractBearer(r) == "" {
		errResp(w, http.StatusUnauthorized, "missing Bearer token")
		return
	}
	n, _ := io.Copy(io.Discard, io.LimitReader(r.Body, maxChunkBytes))
	writeJSON(w, http.StatusOK, fmt.Sprintf(`{"status":"ok","bytes":%d}`, n))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	sessions.mu.RLock()
	n := len(sessions.byKey)
	sessions.mu.RUnlock()
	writeJSON(w, http.StatusOK, fmt.Sprintf(`{"status":"ok","activeSessions":%d,"now":%q}`, n, time.Now().UTC().Format(time.RFC3339)))
}

// finalize writes #EXT-X-ENDLIST and removes the session from active map.
// Files remain on disk for r2-sync to push the final playlist + last segments.
func finalize(sess *Session, reason string) {
	sess.mu.Lock()
	if sess.Ended {
		sess.mu.Unlock()
		return
	}
	sess.Ended = true
	if err := writePlaylist(sess, true); err != nil {
		log.Printf("finalize: playlist: %v", err)
	}
	streamID := sess.StreamID
	key := sess.StreamKey
	segCount := len(sess.Segments)
	dur := time.Since(sess.StartedAt)
	sess.mu.Unlock()

	sessions.drop(key)

	// Best-effort Firestore status flip.
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = fsClient.Collection("streams").Doc(streamID).Update(bg, []firestore.Update{
			{Path: "status", Value: "ended"},
			{Path: "endedAt", Value: time.Now()},
			{Path: "endReason", Value: reason},
		})
	}()

	log.Printf("finalize: stream=%s segs=%d duration=%s reason=%s", streamID, segCount, dur, reason)
}

// idleSweeper finalizes sessions that haven't received chunks in idleTimeout.
// Catches broadcasters who closed the tab without calling /ingest/end.
func idleSweeper() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for range t.C {
		now := time.Now()
		var stale []*Session
		sessions.mu.RLock()
		for _, s := range sessions.byKey {
			s.mu.Lock()
			if !s.Ended && now.Sub(s.LastChunkAt) > idleTimeout {
				stale = append(stale, s)
			}
			s.mu.Unlock()
		}
		sessions.mu.RUnlock()
		for _, s := range stale {
			finalize(s, "idle-timeout")
		}
	}
}

// ============================================================
// main
// ============================================================

func main() {
	flag.Parse()

	ctx := context.Background()
	if err := initFirebase(ctx); err != nil {
		log.Fatalf("firebase init: %v", err)
	}

	// Ensure the streams dir exists (it does — nginx-rtmp uses it — but harmless).
	if err := os.MkdirAll(*streamsDir, 0o755); err != nil {
		log.Fatalf("streams dir: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealth)
	mux.HandleFunc("/ingest/init", handleInit)
	mux.HandleFunc("/ingest/probe", handleProbe)
	mux.HandleFunc("/ingest/end", handleEnd)
	// "/ingest/seg/" is a prefix; the seq is the last path component.
	mux.HandleFunc("/ingest/seg/", handleSeg)

	go idleSweeper()

	srv := &http.Server{
		Addr:              *listenAddr,
		Handler:           mux,
		ReadTimeout:       30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      15 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	log.Printf("vergr-ingest listening on %s, streams-dir=%s", *listenAddr, *streamsDir)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
