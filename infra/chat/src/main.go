// VERGR chat relay — WebSocket-based live-stream chat with server-side
// Gemini moderation, Vanguard identity mask, and ephemeral fan-out.
//
// Path: wss://chat.vergr.app/stream/<streamId>?token=<firebase-id-token>
//
// LIFE OF A MESSAGE (founder spec, non-negotiable):
//   1. Client sends { type:'msg', text } over WS.
//   2. We rate-limit (per-uid token bucket) and validate length/encoding.
//   3. We call Gemini Flash with a "live-chat moderation" prompt.
//        verdict = 'pass' | 'flag' | 'block'
//      - 'block' → reject. Tell sender { type:'reject', reason }.
//                  Append to Firestore content_moderation_log (audit).
//                  Do NOT fan out.
//      - 'flag'  → fan out, BUT also persist to streams/{id}/chat_moderation
//                  for Vanguard review. Recipients get a "flagged" tag.
//      - 'pass'  → fan out. NO Firestore write (ephemeral).
//   4. Identity mask: if the sender is a Vanguard moderator (vanguardRank field
//      on their user doc), we replace displayName + avatar with their public
//      alias before fan-out. Real identity is only sent to other Vanguards.
//   5. Tips ride the same path with type:'tip' — the message text is treated
//      identically (catalog or custom — all goes through Gemini).
//
// ROOMS: keyed by streamId. Rooms auto-close when empty.
//
// AUTH: Firebase Admin ID token verification on connect. We re-verify the
// uid against the streamDoc author (for the host) or just accept any signed-in
// user for viewers.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"github.com/gorilla/websocket"
	"google.golang.org/api/option"
)

// ============================================================
// Config
// ============================================================

const (
	maxMsgChars        = 240
	rateBucketCapacity = 6      // tokens
	rateBucketRefillMs = 600    // ms per token (≈10 msgs/6s burst, then 1.67/s sustained)
	wsWriteTimeout     = 8 * time.Second
	wsReadTimeout      = 75 * time.Second
	wsPingInterval     = 30 * time.Second
	maxMsgPerRoomBurst = 200    // cap fan-out queue per peer to protect slow clients
)

var (
	listenAddr   = flag.String("listen", ":8095", "HTTP listen address")
	credsPath    = flag.String("creds", "/etc/vergr-chat/firebase-admin.json", "Firebase service account JSON path")
	geminiKey    = flag.String("gemini-key", os.Getenv("GEMINI_CHAT_KEY"), "Gemini API key (chat moderation)")
	// ⚠ WAS "gemini-1.5-flash-latest", WHICH NOW 404s. Verified from the box on
	// 2026-08-26: that model and "gemini-2.0-flash" both return HTTP 404 (model
	// retired); only "gemini-flash-latest" resolves. So every moderateGemini()
	// call had been failing for as long as the retirement — which meant
	// user-REPORTED stream messages were never actually reviewed, silently.
	// A moderation call that 404s is worse than none, because the surrounding
	// code believes moderation exists.
	geminiModel  = flag.String("gemini-model", "gemini-flash-latest", "Gemini model name")
	allowOrigins = flag.String("origins", "https://vergr.app,https://vergr-44494.web.app,https://vergr-44494.firebaseapp.com,http://localhost:5173", "Comma-separated allowed WebSocket origins")
	allowed      []string

	authClient *fbauth.Client
	fsClient   *firestore.Client

	dbName = "vgrdb"
)

// ============================================================
// Bootstrap
// ============================================================

func main() {
	flag.Parse()
	allowed = splitCSV(*allowOrigins)
	if *geminiKey == "" {
		log.Fatal("--gemini-key (or GEMINI_CHAT_KEY env) is required")
	}
	ctx := context.Background()
	if err := initFirebase(ctx); err != nil {
		log.Fatalf("firebase init: %v", err)
	}
	defer fsClient.Close()

	// Admin → App Config switches the relay must obey (appconfig.go).
	go watchAppConfig(ctx)

	if err := initStore(); err != nil {
		log.Fatalf("chat store init: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		dbOk, rows := storeOK()
		w.Header().Set("Content-Type", "application/json")
		if !dbOk {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"dbOk":    dbOk,
			"rows":    rows,
			"persist": persistEnabled,
		})
	})
	mux.HandleFunc("/stream/", handleStreamWS)
	mux.HandleFunc("/dm/", handleDMWS)
	mux.HandleFunc("/group/", handleGroupWS)
	mux.HandleFunc("/squad/", handleSquadWS)
	mux.HandleFunc("/history/", handleHistory)
	mux.HandleFunc("/ops/", handleOps)
	mux.HandleFunc("/search", handleSearch)
	// Community-import bulk entry — localhost/private-net + token only; no
	// nginx location block exists for these, so they are never public.
	mux.HandleFunc("/internal/import", handleInternalImport)
	mux.HandleFunc("/internal/claim", handleInternalClaim)

	// Scheduled-message executor (Lite/Pro) — injects due messages in-process.
	go scheduledMessageLoop(context.Background())
	// Disappearing messages — sweeps conversations with ttlSeconds armed.
	go disappearingLoop(context.Background())

	srv := &http.Server{
		Addr:              *listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("vergr-chat listening on %s (model %s)", *listenAddr, *geminiModel)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func initFirebase(ctx context.Context) error {
	opt := option.WithCredentialsFile(*credsPath)
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil {
		return fmt.Errorf("firebase.NewApp: %w", err)
	}
	authClient, err = app.Auth(ctx)
	if err != nil {
		return fmt.Errorf("app.Auth: %w", err)
	}
	fsClient, err = firestore.NewClientWithDatabase(ctx, firebaseProjectID(), dbName, opt)
	if err != nil {
		return fmt.Errorf("firestore.NewClient: %w", err)
	}
	return nil
}

func firebaseProjectID() string {
	// Read project_id out of the service account file.
	data, err := os.ReadFile(*credsPath)
	if err != nil {
		log.Fatalf("read creds: %v", err)
	}
	var sa struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(data, &sa); err != nil || sa.ProjectID == "" {
		log.Fatalf("creds project_id missing: %v", err)
	}
	return sa.ProjectID
}

func splitCSV(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ============================================================
// WebSocket upgrade + per-room dispatch
// ============================================================

// originAllowed reports whether a browser Origin may connect (WS) or read
// (history/ops HTTP). Empty origin = non-browser tool (allowed). Native shells
// (Tauri) serve from a tauri.localhost / tauri:// origin; connections are
// authenticated by a Firebase ID token in the query string, not cookies, so the
// Origin header is not the security boundary here — accept any Tauri origin so
// the native app works.
func originAllowed(o string) bool {
	if o == "" {
		return true
	}
	for _, a := range allowed {
		if o == a {
			return true
		}
	}
	if u, err := url.Parse(o); err == nil {
		if u.Scheme == "tauri" || u.Hostname() == "tauri.localhost" {
			return true
		}
	}
	return false
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1 << 12,
	WriteBufferSize: 1 << 12,
	CheckOrigin: func(r *http.Request) bool {
		return originAllowed(r.Header.Get("Origin"))
	},
}

func handleStreamWS(w http.ResponseWriter, r *http.Request) {
	// Path: /stream/<streamId>
	streamID := strings.TrimPrefix(r.URL.Path, "/stream/")
	streamID = strings.TrimSuffix(streamID, "/")
	if streamID == "" || strings.Contains(streamID, "/") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// ── The moderators-only room ──────────────────────────────────────────
	// ⚠⚠ THIS ROOM IS THE BROADCASTER'S OWN MODERATION TEAM, not Vergr staff.
	// It exists so the people running THIS stream can coordinate ("timeout him,
	// he did it last stream too") without the person being actioned reading it.
	//
	// ⚠ VERGR'S OWN MODERATORS (Vanguard) CAN READ IT, AND THAT IS DELIBERATE.
	// A private room the platform cannot see is a moderation blind spot, and this
	// is the room where it matters most: small, private, and occupied by people
	// with power over other users. If a mod team coordinates harassment, this is
	// the evidence. They are SILENT (see room.add) and every read is audited.
	//
	// ⚠ THE GATE IS HERE, ON THE JOIN, AND NOWHERE ELSE. A client-side filter is
	// not a private channel: whatever the server sends, the client can read.
	modChannel := r.URL.Query().Get("channel") == "mods"
	roomID := streamID
	if modChannel {
		roomID = streamID + ":mods"
	}

	ctx := r.Context()
	t, err := authClient.VerifyIDToken(ctx, token)
	if err != nil {
		http.Error(w, "bad token", http.StatusUnauthorized)
		return
	}
	uid := t.UID

	// Stream existence check (cheap) — refuse rooms for missing streams.
	streamSnap, err := fsClient.Collection("streams").Doc(streamID).Get(ctx)
	if err != nil || !streamSnap.Exists() {
		http.Error(w, "stream not found", http.StatusNotFound)
		return
	}

	user, _ := loadUserProfile(ctx, uid)
	if user == nil {
		http.Error(w, "user not found", http.StatusForbidden)
		return
	}
	if user.Banned {
		http.Error(w, "banned", http.StatusForbidden)
		return
	}

	// Per-stream ban check: the host can ban specific viewers via the
	// banViewer callable, which appends to streams/{id}.bannedUids.
	stream := parseStreamModFields(streamSnap.Data())
	if uid != stream.HostUID && stream.IsBanned(uid) {
		http.Error(w, "banned from stream", http.StatusForbidden)
		return
	}

	// Mod-room gate — see canJoinModRoom for the rule and why it is a function.
	isStreamMod := uid == stream.HostUID || stream.IsModerator(uid)
	isVanguard := user.VanguardRank != ""
	if modChannel && !canJoinModRoom(isStreamMod, isVanguard) {
		http.Error(w, "moderators only", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(64 << 10)

	room := hub.GetOrCreateRoom(roomID)

	// ⚠ SILENT TO THE ROOM, NEVER SILENT IN THE LOG. A Vanguard reading a
	// creator's private room is a real power and needs a record, or the answer to
	// "who read my mod channel" is nobody knows. Same audit collection every other
	// Vanguard action writes to.
	if modChannel && isVanguard && !isStreamMod {
		go auditModChannelRead(streamID, uid, user.VanguardRank)
	}

	// Twitch mirror: if this stream is a Twitch mirror, start the chat bridge
	// (once per room). Vergr viewers see Twitch chat; their messages go back.
	if src, _ := streamSnap.Data()["source"].(string); src == "twitch" {
		ch, _ := streamSnap.Data()["twitchChannel"].(string)
		room.ensureTwitchBridge(stream.HostUID, ch, nil)
	} else if tm, ok := streamSnap.Data()["twitchMirror"].(map[string]interface{}); ok && tm != nil {
		// OUTBOUND mirror (Vergr stream relayed to the streamer's Twitch):
		// bridge the same way so both audiences share one conversation, and
		// honour the owner-configured periodic nudge if the doc carries one.
		if ch, _ := tm["twitchLogin"].(string); ch != "" {
			var nudge *TwitchNudge
			if n, ok := streamSnap.Data()["twitchNudge"].(map[string]interface{}); ok && n != nil {
				enabled, _ := n["enabled"].(bool)
				text, _ := n["text"].(string)
				interval := 20.0
				if v, ok := n["intervalMin"].(int64); ok {
					interval = float64(v)
				} else if v, ok := n["intervalMin"].(float64); ok {
					interval = v
				}
				if enabled && strings.TrimSpace(text) != "" {
					nudge = &TwitchNudge{Text: text, IntervalMin: interval}
				}
			}
			room.ensureTwitchBridge(stream.HostUID, ch, nudge)
		}
	}

	p := newPeer(uid, user, conn, room)
	p.streamMod = stream
	p.emailOK = tokenEmailVerified(t)
	// ⚠ A NAMED VANGUARD IN A THREE-PERSON ROOM DE-ANONYMISES THEM BY ELIMINATION,
	// which is exactly what the identity mask exists to prevent. The product already
	// decided this shape: <VanguardPresence> lets Overseers join streams silently.
	// Reading is silent; if they SPEAK they have chosen to reveal themselves.
	p.silent = modChannel && isVanguard && !isStreamMod
	// Resolve follower status once (cheap, one read) for followers-only mode.
	// Host is always treated as a follower of their own room.
	if uid == stream.HostUID {
		p.isFollower = true
	} else if stream.HostUID != "" {
		if fSnap, ferr := fsClient.Collection("users").Doc(stream.HostUID).
			Collection("followers").Doc(uid).Get(ctx); ferr == nil && fSnap.Exists() {
			p.isFollower = true
		}
	}

	// Subscriber gem: one read at connect for the deterministic per-host sub doc
	// (member_subscriptions/{hostUid}_{uid}). Skipped for the host and for masked
	// Vanguard moderators (a badge would help de-anonymise them).
	if uid != stream.HostUID && stream.HostUID != "" && user.VanguardRank == "" {
		if sSnap, serr := fsClient.Collection("member_subscriptions").
			Doc(stream.HostUID + "_" + uid).Get(ctx); serr == nil && sSnap.Exists() {
			sd := sSnap.Data()
			if st, _ := sd["status"].(string); st == "active" {
				b := &ChatBadge{}
				if t, ok := sd["tierName"].(string); ok { b.Tier = t }
				if bm, ok := sd["badge"].(map[string]interface{}); ok {
					if c, ok := bm["color"].(string); ok { b.Color = c }
					if ic, ok := bm["icon"].(string); ok { b.Icon = ic }
				}
				p.memberBadge = b
			}
		}
	}
	room.add(p)
	defer room.remove(p)

	// Keep the stream-mod snapshot fresh — re-read on a 10s tick. Cheap
	// (one Firestore read per stream per 10s, regardless of viewer count).
	stopMod := room.startModRefresh(streamID)
	defer stopMod()

	// Send room hello. Mod flags whether YOU are a host-designated moderator
	// (or the host) so the client can surface the moderation menu.
	_ = p.write(Msg{Type: "hello", StreamID: streamID, You: uid, Mod: isStreamMod})

	p.run(ctx)
}

// canJoinModRoom decides who may open a broadcaster's moderators-only room.
//
// ⚠⚠ THIS IS A FUNCTION SO IT CAN BE TESTED. It is the whole privacy model of the
// feature in one line, it is inline in an HTTP handler that needs a live stream and
// a real Firebase token to exercise, and "the gate works" is exactly the claim that
// must never rest on reading the code. main_test.go covers all four cases.
//
// ⚠ TWO KINDS OF MODERATOR AND THEY ARE NOT THE SAME THING:
//
//   isStreamMod — the HOST, or someone the host put in streams/{id}.moderatorUids.
//     This room is THEIR tool; they coordinate their own room in it.
//
//   isVanguard  — Vergr's own platform-wide moderators. They get in because a
//     private room the platform cannot see is a moderation blind spot, and this is
//     the room where that matters most: small, private, and occupied by people with
//     power over other users. They are SILENT (Peer.silent) and audited on join.
//
// ⚠ EVERYONE ELSE IS REFUSED HERE, ON THE JOIN. A client-side filter is not a
// private channel — whatever the server sends, the client can read.
func canJoinModRoom(isStreamMod, isVanguard bool) bool {
	return isStreamMod || isVanguard
}

// auditModChannelRead records that a platform moderator opened a broadcaster's
// private mod room.
//
// ⚠⚠ SILENT TO THE ROOM, NEVER SILENT IN THE LOG. Reading someone's private
// channel is a real power; without a record the answer to "who read my mod
// channel" is nobody knows. This is the accountability half of giving Vanguard
// access at all, and it is not optional.
//
// ⚠ ONE ROW PER JOIN, NOT PER MESSAGE. A row per message would be a write per
// line of someone else's conversation — unaffordable and useless. The join is the
// event that matters: it is the moment the power was used.
//
// ⚠ FIRE AND FORGET. This must never delay or block the socket; a failed audit
// write is logged, and the read still happens. Refusing the join on an audit
// failure would let a Firestore blip lock moderators out of an incident.
func auditModChannelRead(streamID, uid, rank string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := fsClient.Collection("vanguard_actions").NewDoc().Set(ctx, map[string]interface{}{
		"kind":      "mod_channel_read",
		"actorUid":  uid,
		"rank":      rank,
		"streamId":  streamID,
		"createdAt": firestore.ServerTimestamp,
	})
	if err != nil {
		log.Printf("audit mod_channel_read %s/%s: %v", streamID, uid, err)
	}
}

// ============================================================
// Hub / Room / Peer
// ============================================================

type Hub struct {
	rooms map[string]*Room
	mu    sync.Mutex
}

var hub = &Hub{rooms: map[string]*Room{}}

func (h *Hub) GetOrCreateRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[id]; ok {
		return r
	}
	r := &Room{ID: id, Peers: map[string]*Peer{}, hub: h, stopPresence: make(chan struct{})}
	h.rooms[id] = r
	// ⚠ THE MODS ROOM HAS NO PRESENCE. startPresence writes
	// streams/{r.ID}.viewerCount every 10s, and r.ID here would be "<id>:mods" —
	// a doc that does not exist. That is a failing Firestore write and a log line
	// every ten seconds, forever, for every stream anyone opens the mod room on.
	// The mods room is also not an audience; its headcount means nothing.
	if !strings.HasSuffix(id, ":mods") {
		r.startPresence()
	}
	return r
}

func (h *Hub) RemoveEmpty(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[id]; ok {
		r.mu.RLock()
		empty := len(r.Peers) == 0
		r.mu.RUnlock()
		if empty {
			r.presenceStop.Do(func() { close(r.stopPresence) })
			delete(h.rooms, id)
		}
	}
}

// startPresence runs ONE goroutine per room: every 10s it writes the live
// viewer count (unique non-host uids holding a socket) to
// streams/{id}.viewerCount — but only when it CHANGES, so a steady stream
// writes nothing (€0). It writes 0 once on room close. This replaces the old
// client-side Firestore increment, which drifted upward when viewers crashed or
// dropped without a clean decrement.
func (r *Room) startPresence() {
	go func() {
		// Resolve host uid + existing peak once (one read per room lifetime).
		hostUID := ""
		peak := 0
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		if snap, err := fsClient.Collection("streams").Doc(r.ID).Get(ctx); err == nil && snap.Exists() {
			if v, ok := snap.Data()["hostUid"].(string); ok {
				hostUID = v
			}
			if v, ok := snap.Data()["peakViewers"].(int64); ok {
				peak = int(v)
			}
		}
		cancel()

		write := func(n int) {
			updates := []firestore.Update{
				{Path: "viewerCount", Value: n},
				{Path: "lastViewedAt", Value: firestore.ServerTimestamp},
			}
			if n > peak {
				peak = n
				updates = append(updates, firestore.Update{Path: "peakViewers", Value: n})
			}
			c, cc := context.WithTimeout(context.Background(), 4*time.Second)
			if _, err := fsClient.Collection("streams").Doc(r.ID).Update(c, updates); err != nil {
				log.Printf("presence write %s: %v", r.ID, err)
			}
			cc()
		}

		last := -1
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-r.stopPresence:
				write(0)
				return
			case <-t.C:
				if n := r.viewerCount(hostUID); n != last {
					last = n
					write(n)
				}
			}
		}
	}()
}

// viewerCount = unique non-host uids currently connected to the room.
func (r *Room) viewerCount(hostUID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen := make(map[string]bool, len(r.Peers))
	for _, p := range r.Peers {
		// A silent observer is not an audience member and must never move a
		// public number that the host (and everyone else) can see.
		if p.uid == "" || p.uid == hostUID || p.silent {
			continue
		}
		seen[p.uid] = true
	}
	return len(seen)
}

type Room struct {
	ID       string
	Peers    map[string]*Peer
	mu       sync.RWMutex
	hub      *Hub
	modMu    sync.RWMutex
	mod      *StreamMod // current host-controlled moderation snapshot
	// Twitch mirror bridge (nil unless this stream is source:'twitch').
	bridgeMu   sync.Mutex
	bridge     *TwitchBridge
	bridgeOnce sync.Once
	// Presence: one flusher goroutine per room writes the live viewer count.
	stopPresence chan struct{}
	presenceStop sync.Once
}

// ensureTwitchBridge starts the Twitch chat bridge once per room (first viewer).
func (r *Room) ensureTwitchBridge(hostUID, channel string, nudge *TwitchNudge) {
	if channel == "" {
		return
	}
	r.bridgeOnce.Do(func() {
		b := startTwitchBridge(r, hostUID, channel, nudge)
		r.bridgeMu.Lock()
		r.bridge = b
		r.bridgeMu.Unlock()
	})
}

func (r *Room) stopTwitchBridge() {
	r.bridgeMu.Lock()
	b := r.bridge
	r.bridge = nil
	r.bridgeMu.Unlock()
	if b != nil {
		b.stop()
	}
}

// relayToTwitch forwards a Vergr chat message to the bridged Twitch channel.
func (r *Room) relayToTwitch(name, text string) {
	r.bridgeMu.Lock()
	b := r.bridge
	r.bridgeMu.Unlock()
	if b != nil {
		b.relayToTwitch(name, text)
	}
}

func (r *Room) setMod(m *StreamMod) {
	r.modMu.Lock()
	r.mod = m
	r.modMu.Unlock()
	// Propagate to all peers so per-message checks see fresh data.
	for _, p := range r.snapshot() {
		p.streamMod = m
	}
}

func (r *Room) startModRefresh(streamID string) func() {
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				snap, err := fsClient.Collection("streams").Doc(streamID).Get(ctx)
				cancel()
				if err == nil && snap.Exists() {
					r.setMod(parseStreamModFields(snap.Data()))
				}
			}
		}
	}()
	return func() { close(stop) }
}

// StreamMod — host-controlled chat moderation state, refreshed periodically
// from streams/{id}. Cheap to evaluate per-message.
type StreamMod struct {
	HostUID       string
	BannedUIDs    map[string]bool
	ModeratorUIDs map[string]bool  // host-designated chat moderators (shield badge + powers)
	MutedUntil    map[string]int64 // uid → ms
	BannedWords   []string         // already lowercased on save
	SlowModeSec   int64            // per-uid send cooldown; 0 = off
	FollowersOnly bool             // only host's followers (+ host + vanguard) may send
	SubsOnly      bool             // only the host's active members (+ host + vanguard) may send
	// Effect 13 (TTS on stream). OFF BY DEFAULT and host-controlled: letting a
	// viewer's words be spoken aloud to a whole audience is the host's call, not
	// ours. A missing field is false, which is the safe direction.
	TtsEnabled    bool
}

func (m *StreamMod) IsBanned(uid string) bool {
	if m == nil { return false }
	return m.BannedUIDs[uid]
}
func (m *StreamMod) IsModerator(uid string) bool {
	if m == nil { return false }
	return m.ModeratorUIDs[uid]
}
func (m *StreamMod) MutedUntilMs(uid string) int64 {
	if m == nil { return 0 }
	return m.MutedUntil[uid]
}

func parseStreamModFields(d map[string]interface{}) *StreamMod {
	m := &StreamMod{
		BannedUIDs:    map[string]bool{},
		ModeratorUIDs: map[string]bool{},
		MutedUntil:    map[string]int64{},
		BannedWords:   []string{},
	}
	if v, ok := d["hostUid"].(string); ok { m.HostUID = v }
	if arr, ok := d["bannedUids"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok { m.BannedUIDs[s] = true }
		}
	}
	if arr, ok := d["moderatorUids"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok { m.ModeratorUIDs[s] = true }
		}
	}
	if mm, ok := d["mutedUids"].(map[string]interface{}); ok {
		for k, v := range mm {
			switch n := v.(type) {
			case int64:   m.MutedUntil[k] = n
			case float64: m.MutedUntil[k] = int64(n)
			}
		}
	}
	if arr, ok := d["bannedWords"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok { m.BannedWords = append(m.BannedWords, s) }
		}
	}
	switch n := d["slowModeSec"].(type) {
	case int64:   m.SlowModeSec = n
	case float64: m.SlowModeSec = int64(n)
	}
	if v, ok := d["followersOnly"].(bool); ok { m.FollowersOnly = v }
	if v, ok := d["subsOnly"].(bool); ok { m.SubsOnly = v }
	if v, ok := d["ttsEnabled"].(bool); ok { m.TtsEnabled = v }
	return m
}

// applyBannedWords replaces any host-banned substring (case-insensitive) with
// black square blocks of matching length. Host's call → no Gemini needed.
func applyBannedWords(text string, banned []string) string {
	if len(banned) == 0 || text == "" {
		return text
	}
	lower := strings.ToLower(text)
	out := []byte(text)
	for _, w := range banned {
		if w == "" { continue }
		start := 0
		for {
			idx := strings.Index(lower[start:], w)
			if idx < 0 { break }
			at := start + idx
			for i := 0; i < len(w); i++ {
				// Use a black square (U+25A0) — printable replacement.
				out[at+i] = '#'
			}
			// Mark in lower so we don't re-match overlapping occurrences.
			for i := 0; i < len(w); i++ {
				lowerBytes := []byte(lower)
				lowerBytes[at+i] = '#'
				lower = string(lowerBytes)
			}
			start = at + len(w)
		}
	}
	return string(out)
}

func (r *Room) add(p *Peer) {
	r.mu.Lock()
	r.Peers[p.connID] = p
	r.mu.Unlock()
}

func (r *Room) remove(p *Peer) {
	r.mu.Lock()
	delete(r.Peers, p.connID)
	empty := len(r.Peers) == 0
	r.mu.Unlock()
	if empty {
		r.stopTwitchBridge() // tear down the Twitch chat bridge when the room empties
		r.hub.RemoveEmpty(r.ID)
	}
}

func (r *Room) snapshot() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Peer, 0, len(r.Peers))
	for _, p := range r.Peers {
		out = append(out, p)
	}
	return out
}

type Peer struct {
	connID    string
	uid       string
	user      *UserProfile
	conn      *websocket.Conn
	room      *Room
	streamMod *StreamMod // pointer to current Room.mod snapshot; refreshed by room
	wmu       sync.Mutex
	closed    atomic.Bool
	// Rate-limit bucket.
	bucketTokens     atomic.Int64
	bucketLastRefill atomic.Int64
	// Followers-only + slow-mode support.
	isFollower bool          // resolved once at connect (host's follower?)
	lastSendMs atomic.Int64  // last successful send, for slow-mode cooldown
	lastHeartMs atomic.Int64 // last heart fan-out, for heart throttle
	memberBadge *ChatBadge   // subscriber gem for THIS host, resolved once at connect
	// ⚠ A SILENT PEER IS PRESENT BUT NOT VISIBLE. Set only for a Vanguard reading
	// the broadcaster’s mods room. They are excluded from viewerCount and from the
	// room’s peer announcements; a named platform moderator in a three-person room
	// de-anonymises them by elimination, which is what the identity mask exists to
	// prevent. Speaking is a deliberate act that reveals them.
	silent bool
	// Required email verification (founder, 2026-09-29): an account whose email
	// is not verified may WATCH and READ chat but may not speak. Read once from
	// the ID token at connect (Firebase Auth's own email_verified claim), so it
	// costs nothing; after verifying, the client reconnects with a fresh token.
	emailOK bool
}

// tokenEmailVerified reads Firebase Auth's email_verified claim off a verified
// ID token. Absent or anything but true means not verified.
func tokenEmailVerified(t *fbauth.Token) bool {
	if t == nil {
		return false
	}
	v, _ := t.Claims["email_verified"].(bool)
	return v
}

var peerCounter atomic.Int64

func newPeer(uid string, user *UserProfile, conn *websocket.Conn, room *Room) *Peer {
	id := fmt.Sprintf("c%d-%s", peerCounter.Add(1), uid[:6])
	p := &Peer{
		connID: id,
		uid:    uid,
		user:   user,
		conn:   conn,
		room:   room,
	}
	p.bucketTokens.Store(rateBucketCapacity)
	p.bucketLastRefill.Store(time.Now().UnixMilli())
	return p
}

func (p *Peer) write(m Msg) error {
	p.wmu.Lock()
	defer p.wmu.Unlock()
	_ = p.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return p.conn.WriteJSON(m)
}

func (p *Peer) close() {
	if p.closed.Swap(true) {
		return
	}
	_ = p.conn.Close()
}

func (p *Peer) takeToken() bool {
	now := time.Now().UnixMilli()
	last := p.bucketLastRefill.Load()
	elapsed := now - last
	if elapsed > 0 {
		add := elapsed / rateBucketRefillMs
		if add > 0 {
			cur := p.bucketTokens.Load()
			n := cur + add
			if n > rateBucketCapacity {
				n = rateBucketCapacity
			}
			p.bucketTokens.Store(n)
			p.bucketLastRefill.Store(last + add*rateBucketRefillMs)
		}
	}
	cur := p.bucketTokens.Load()
	if cur <= 0 {
		return false
	}
	p.bucketTokens.Store(cur - 1)
	return true
}

// ============================================================
// Message types (wire format)
// ============================================================

type Msg struct {
	Type      string `json:"type"`
	StreamID  string `json:"streamId,omitempty"`
	You       string `json:"you,omitempty"`
	// Outbound chat message
	ID        string `json:"id,omitempty"`
	UID       string `json:"uid,omitempty"`
	Name      string `json:"name,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Rank      string `json:"rank,omitempty"`   // 'vanguard' / 'senior' / 'commander' / 'overseer' if masked
	Text      string `json:"text,omitempty"`
	TS        int64  `json:"ts,omitempty"`
	Flagged   bool   `json:"flagged,omitempty"`
	Src       string `json:"src,omitempty"`     // 'twitch' for bridged Twitch-chat messages
	Badge     *ChatBadge `json:"badge,omitempty"` // subscriber gem if sender is a paying member of THIS host
	Mod       bool   `json:"mod,omitempty"`     // sender is a host-designated chat moderator (or, on hello, you are)
	VpLevel   int    `json:"vpLevel,omitempty"` // sender VP level 1-100, for the rank crest beside the name
	N         int    `json:"n,omitempty"`       // coalesced heart count (type:'heart')
	Tts       bool   `json:"tts,omitempty"`     // effect 13: every viewer's client SPEAKS this one
	// Inbound
	Reason    string `json:"reason,omitempty"`
	System    string `json:"system,omitempty"`  // 'joined' | 'left' | 'pinned'
}

// ChatBadge — the subscriber gem shown before a member's name in stream chat.
// Color + icon come from the tier's badge; the client renders the enamel gem.
type ChatBadge struct {
	Color string `json:"color,omitempty"`
	Icon  string `json:"icon,omitempty"`
	Tier  string `json:"tier,omitempty"`
}

// ============================================================
// Peer run loop
// ============================================================

func (p *Peer) run(ctx context.Context) {
	defer p.close()

	// Ping loop.
	go func() {
		t := time.NewTicker(wsPingInterval)
		defer t.Stop()
		for !p.closed.Load() {
			select {
			case <-t.C:
				p.wmu.Lock()
				_ = p.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
				err := p.conn.WriteMessage(websocket.PingMessage, nil)
				p.wmu.Unlock()
				if err != nil {
					p.close()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	p.conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	p.conn.SetPongHandler(func(string) error {
		p.conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		return nil
	})

	for {
		_, raw, err := p.conn.ReadMessage()
		if err != nil {
			return
		}
		var in Msg
		if err := json.Unmarshal(raw, &in); err != nil {
			_ = p.write(Msg{Type: "reject", Reason: "bad-json"})
			continue
		}
		switch in.Type {
		case "msg", "tip":
			p.handleSend(ctx, in)
		case "report":
			p.handleReport(ctx, in)
		case "heart":
			p.handleHeart(in)
		case "tts":
			p.handleTts(ctx, in)
		default:
			// Ignore unknown verbs to allow protocol evolution.
		}
	}
}

// TTS on stream. Effect 13. Doc: docs/effects/13-tts-on-stream.md
//
// ⚠ THIS IS NOT A FLAG ON A NORMAL CHAT MESSAGE, and it deliberately does NOT
// go through handleSend. handleSend is HOST + LEXICON only, on purpose, to keep
// chat fan-out at single-digit milliseconds (see its comment). TTS makes a
// stranger's words AUDIBLE to a whole audience with no human in the loop, so
// the doc requires a full Gemini pass. Those two requirements are incompatible,
// which is exactly why TTS gets its own slower verb.
//
// ⚠ THE AUDIO PLAYS ON THE VIEWERS' MACHINES, not the streamer's. `speechSynthesis`
// output cannot be captured into a MediaStream (WICG/speech-api#69), and the
// browser broadcaster captures mic-only with echoCancellation on, so speaking on
// the streamer's box is inaudible to viewers by construction. Researched 2026-08-26.
const maxTtsChars = 200

func (p *Peer) handleTts(ctx context.Context, in Msg) {
	if !p.emailOK {
		_ = p.write(Msg{Type: "reject", Reason: "verify-email"})
		return
	}
	text := strings.TrimSpace(in.Text)
	if text == "" {
		_ = p.write(Msg{Type: "reject", Reason: "empty"})
		return
	}
	if len([]rune(text)) > maxTtsChars {
		_ = p.write(Msg{Type: "reject", Reason: "too-long"})
		return
	}
	// ⚠ HOST OPT-IN IS CHECKED FIRST and is not optional. Off by default.
	if p.streamMod == nil || !p.streamMod.TtsEnabled {
		_ = p.write(Msg{Type: "reject", Reason: "tts-disabled"})
		return
	}
	// Level OR Pro, mirroring canUseStreamTts() in src/utils/streamTts.js.
	// Ascendant LV2 = 92 (⚠ Ascendant is 91-99; the 81-90 band is Mythic).
	if !(p.user.Role == "admin" || p.user.VpLevel >= 92 || p.user.Plan == "pro") {
		_ = p.write(Msg{Type: "reject", Reason: "tts-locked"})
		return
	}
	// Everything handleSend enforces about WHO may speak applies here too: a
	// banned or muted viewer must not gain a louder channel than chat.
	if p.streamMod.HostUID != p.uid {
		if p.streamMod.IsBanned(p.uid) {
			_ = p.write(Msg{Type: "reject", Reason: "banned"})
			return
		}
		if until := p.streamMod.MutedUntilMs(p.uid); until > 0 && time.Now().UnixMilli() < until {
			_ = p.write(Msg{Type: "reject", Reason: "muted"})
			return
		}
	}
	if !p.takeToken() {
		_ = p.write(Msg{Type: "reject", Reason: "rate-limit"})
		return
	}
	if hit := matchLexicon(text); hit != "" {
		_ = p.write(Msg{Type: "reject", Reason: "policy:" + hit})
		go writeModerationLog(p.room.ID, p.uid, text, "block", "lexicon:"+hit)
		return
	}
	// ⚠ NO GEMINI PASS. THIS IS A DELIBERATE DEPARTURE FROM DOC 13 §3, taken by
	// the founder on 2026-08-26, and the reasoning matters more than the change.
	//
	// The first build ran a full Gemini call here and failed CLOSED, on the
	// argument that speech reaches people who are not reading chat. That
	// argument does not survive the obvious question: THE SAME USER CAN ALREADY
	// PUT THE SAME WORDS IN FRONT OF THE SAME AUDIENCE by typing them into chat,
	// where `handleSend` applies host rules + lexicon and NO Gemini. Demanding a
	// stricter standard for the spoken copy of text that is already permitted is
	// inconsistent, not safer.
	//
	// It was also a hard external dependency: when the Gemini key's project ran
	// out of credit, TTS refused every message and the feature was dead, while
	// chat carried on fine. A control that takes the feature down with it, and
	// that the same text can bypass by being typed instead, is not buying safety.
	//
	// What still gates a spoken message, all of it enforced above:
	//   host opt-in (ttsEnabled, OFF by default) · L92 or Pro · not banned ·
	//   not muted · rate limit · length cap · lexicon
	//
	// ⚠ If this is ever revisited, do NOT "fix" it by failing OPEN. That is the
	// worst of both: the control is present when nothing is wrong and absent at
	// exactly the moment it would matter. Either it runs and blocks, or it is
	// honestly not there, which is what this is.

	name := p.user.DisplayName
	if name == "" {
		name = p.user.Username
	}
	// A masked Vanguard speaks as their persona, same rule as chat.
	if p.user.VanguardRank != "" {
		name = p.user.VanguardAlias
		if name == "" {
			name = "Vanguard"
		}
	}
	out := Msg{
		Type: "tts",
		Tts:  true,
		ID:   fmt.Sprintf("tts-%d", time.Now().UnixNano()),
		UID:  p.uid,
		Name: name,
		Text: text,
		TS:   time.Now().UnixMilli(),
	}
	for _, peer := range p.room.snapshot() {
		_ = peer.write(out)
	}
}

func (p *Peer) handleSend(ctx context.Context, in Msg) {
	if in.Type == "msg" && !p.emailOK {
		_ = p.write(Msg{Type: "reject", Reason: "verify-email"})
		return
	}
	text := strings.TrimSpace(in.Text)
	if text == "" {
		_ = p.write(Msg{Type: "reject", Reason: "empty"})
		return
	}
	if len([]rune(text)) > maxMsgChars {
		_ = p.write(Msg{Type: "reject", Reason: "too-long"})
		return
	}
	if !p.takeToken() {
		_ = p.write(Msg{Type: "reject", Reason: "rate-limit"})
		return
	}

	// Per-stream host-controlled moderation: banned + muted + followers-only + slow-mode.
	if p.streamMod != nil && p.uid != p.streamMod.HostUID {
		if p.streamMod.IsBanned(p.uid) {
			_ = p.write(Msg{Type: "reject", Reason: "banned"})
			return
		}
		if until := p.streamMod.MutedUntilMs(p.uid); until > 0 && time.Now().UnixMilli() < until {
			_ = p.write(Msg{Type: "reject", Reason: "muted"})
			return
		}
		// Followers-only: host's followers + Vanguard moderators exempt.
		if p.streamMod.FollowersOnly && !p.isFollower && p.user.VanguardRank == "" {
			_ = p.write(Msg{Type: "reject", Reason: "followers-only"})
			return
		}
		// Subscribers-only. Until now this was a toggle the host could switch on
		// and the relay had never heard of, so chat carried on exactly as before:
		// an inert control, the same class as the boost that bought a badge.
		//
		// ⚠ IT COSTS NO EXTRA READ. Subscriber status is ALREADY resolved once at
		// connect for the member gem (member_subscriptions/{host}_{uid}), and
		// memberBadge is non-nil only when that doc says status == "active". So
		// this is a field we already have, not a new lookup per message.
		//
		// ⚠ SAME EXEMPTIONS AS FOLLOWERS-ONLY, deliberately: the host is already
		// excluded by the enclosing check, and a Vanguard moderator must be able
		// to speak in a locked room or moderation stops when it is needed most.
		if p.streamMod.SubsOnly && p.memberBadge == nil && p.user.VanguardRank == "" {
			_ = p.write(Msg{Type: "reject", Reason: "subscribers-only"})
			return
		}
		// Slow mode: enforce per-uid cooldown between successful sends.
		if sec := p.streamMod.SlowModeSec; sec > 0 {
			now := time.Now().UnixMilli()
			if last := p.lastSendMs.Load(); last > 0 && now-last < sec*1000 {
				_ = p.write(Msg{Type: "reject", Reason: "slow-mode"})
				return
			}
		}
	}

	// Per-message moderation is HOST + LEXICON only — Gemini is reserved for
	// reported messages (see handleReport below). This keeps chat fan-out
	// latency to single-digit-ms.
	//
	// Lexicon is a small server-side baseline against obviously-illegal
	// content (CSAM grooming language, doxxing patterns). It is NOT a
	// general moderation system; user reports + Gemini do that.
	if hit := matchLexicon(text); hit != "" {
		_ = p.write(Msg{Type: "reject", Reason: "policy:" + hit})
		go writeModerationLog(p.room.ID, p.uid, text, "block", "lexicon:"+hit)
		return
	}
	verdict := "pass"
	reason := ""

	// Identity mask: Vanguard moderators show their public alias. Real
	// identity is only visible to other Vanguard members (not implemented in
	// this v1 — we surface a uniform mask to all readers, which matches the
	// existing applyVanguardMask behavior in the React client).
	displayName := p.user.DisplayName
	if displayName == "" {
		displayName = p.user.Username
	}
	avatar := p.user.Avatar
	rank := ""
	if p.user.VanguardRank != "" {
		rank = p.user.VanguardRank
		// Persona label (matches the client's rankMeta usernameTag, e.g.
		// "Senior Vanguard" — never prefix, it already reads as a full tag).
		displayName = p.user.VanguardAlias
		if displayName == "" {
			displayName = "Vanguard"
		}
		avatar = ""
	}

	// Host's banned-words list — purely lexical, no Gemini needed. Applied
	// AFTER Gemini moderation so we never broadcast the raw original; either
	// it passes (then we redact host's words) or it's blocked entirely.
	finalText := text
	if p.streamMod != nil && len(p.streamMod.BannedWords) > 0 {
		finalText = applyBannedWords(text, p.streamMod.BannedWords)
	}

	// Subscriber gem rides only on real (unmasked) members' messages.
	var badge *ChatBadge
	if rank == "" {
		badge = p.memberBadge
	}

	// VP rank crest rides only on real (unmasked) senders, same rule as the gem.
	// Taken from the profile loaded once at connect, so it adds no per-message cost.
	vpLevel := 0
	if rank == "" {
		vpLevel = p.user.VpLevel
	}

	out := Msg{
		Type:    in.Type,
		ID:      fmt.Sprintf("%d-%s", time.Now().UnixNano(), p.connID),
		UID:     p.uid,
		Name:    displayName,
		Avatar:  avatar,
		Rank:    rank,
		Text:    finalText,
		TS:      time.Now().UnixMilli(),
		Flagged: verdict == "flag",
		Badge:   badge,
		// Moderator shield rides only on real (unmasked) designated mods.
		Mod:     rank == "" && p.streamMod.IsModerator(p.uid),
		VpLevel: vpLevel,
	}

	// Record the successful send time for slow-mode cooldown.
	p.lastSendMs.Store(time.Now().UnixMilli())

	// Fan out to all peers in the room.
	for _, peer := range p.room.snapshot() {
		_ = peer.write(out)
	}

	// Mirror Vergr chat out to Twitch (msg only, not tips). No-op when there's
	// no bridge or it's a read-only (anonymous) connection.
	if in.Type == "msg" {
		p.room.relayToTwitch(displayName, finalText)
	}

	if verdict == "flag" {
		go writeFlagged(p.room.ID, p.uid, text, reason, out.ID)
	}
}

func (p *Peer) handleReport(ctx context.Context, in Msg) {
	// User-initiated report of a previously-broadcast message. We:
	//   1. Persist to chat_moderation for Vanguard review.
	//   2. Fire Gemini to get a verdict (PASS/FLAG/BLOCK).
	//   3. On BLOCK, fan out a "hide" signal so all clients redact the
	//      message retroactively, and add a sender strike.
	//   4. Save the verdict alongside the report so Vanguard sees AI's call.
	if in.ID == "" || in.UID == "" || in.Text == "" {
		_ = p.write(Msg{Type: "reject", Reason: "incomplete-report"})
		return
	}
	go func() {
		verdict, reason, err := moderateGemini(ctx, in.Text)
		if err != nil {
			log.Printf("report-time moderate err: %v", err)
			verdict = "flag"
			reason = "moderation-unavailable"
		}
		writeReport(p.room.ID, in.UID, in.Text, in.ID, p.uid, verdict, reason)
		if verdict == "block" {
			// Retroactive hide — every connected peer redacts the message.
			for _, peer := range p.room.snapshot() {
				_ = peer.write(Msg{
					Type: "hide", ID: in.ID, UID: in.UID, Reason: reason,
				})
			}
			// Strike: append to senders moderation log; Vanguard can escalate.
			go writeModerationLog(p.room.ID, in.UID, in.Text, "block", "post-report:"+reason)
		}
	}()
	_ = p.write(Msg{Type: "system", System: "report-received"})
}

// handleHeart fans out a viewer's like-taps to every OTHER peer in the room so
// the heart storm is shared in real time. Ephemeral: never persisted, never
// moderated, never counted here (the running total is the Firestore
// streams/{id}.hearts counter, batch-incremented by the client). Per-peer
// throttle (≈8 fan-outs/sec) with the count coalesced into N protects the room
// from a tap-spamming client. The sender already renders its own taps locally.
func (p *Peer) handleHeart(in Msg) {
	n := in.N
	if n < 1 {
		n = 1
	}
	if n > 20 {
		n = 20
	}
	now := time.Now().UnixMilli()
	if last := p.lastHeartMs.Load(); now-last < 120 {
		return // drop bursts faster than ~8/s; the client already coalesces
	}
	p.lastHeartMs.Store(now)
	out := Msg{Type: "heart", UID: p.uid, N: n, TS: now}
	for _, peer := range p.room.snapshot() {
		if peer.connID == p.connID {
			continue
		}
		_ = peer.write(out)
	}
}

// matchLexicon returns the matched category name if `text` contains any of
// the hard-coded illegal/grooming/doxxing terms. These are NOT a comprehensive
// moderation system; they are a fail-safe against the obvious worst-case while
// Gemini sits behind user reports for latency reasons.
//
// Keep this list short, surgical, and easily audited. Add words only when
// you have a specific incident to point to.
func matchLexicon(text string) string {
	lower := strings.ToLower(text)
	// CSAM grooming + bestiality terms — comma-delimited lists by category.
	const csam = "loli,lolicon,shota,cp,child porn,kiddie porn,kid porn,jailbait"
	const dox  = "ssn:,social security number,home address:"
	for _, cat := range []struct{ name, list string }{
		{"csam", csam},
		{"dox",  dox},
	} {
		for _, w := range strings.Split(cat.list, ",") {
			w = strings.TrimSpace(w)
			if w == "" { continue }
			if strings.Contains(lower, w) {
				return cat.name
			}
		}
	}
	return ""
}

// writeReport — persists a user-initiated report. Includes the AI verdict
// fetched at report-time so Vanguards see what Gemini said.
func writeReport(streamID, senderUID, text, msgID, reporterUID, verdict, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, err := fsClient.Collection("streams").Doc(streamID).
		Collection("chat_moderation").Doc(msgID).
		Set(ctx, map[string]interface{}{
			"uid":         senderUID,
			"text":        text,
			"reporterUid": reporterUID,
			"verdict":     verdict,
			"reason":      reason,
			"createdAt":   firestore.ServerTimestamp,
		})
	if err != nil {
		log.Printf("report write: %v", err)
	}
}

// ============================================================
// User profile (cached for the WS lifetime)
// ============================================================

type UserProfile struct {
	UID            string
	DisplayName    string
	Username       string
	Avatar         string
	Banned         bool
	VanguardRank   string
	VanguardAlias  string
	VpLevel        int
	// Effect 13. Both read from the SAME snapshot as vpLevel below, so the TTS
	// gate costs ZERO extra Firestore reads — one read per connection, as the
	// rank crest already established.
	Plan           string // 'free' | 'lite' | 'pro'
	Role           string // 'admin' resolves every gate, mirroring isEffectOn()
}

func loadUserProfile(ctx context.Context, uid string) (*UserProfile, error) {
	snap, err := fsClient.Collection("users").Doc(uid).Get(ctx)
	if err != nil {
		return nil, err
	}
	if !snap.Exists() {
		return nil, errors.New("not-found")
	}
	d := snap.Data()
	up := &UserProfile{UID: uid}
	if v, ok := d["displayName"].(string); ok { up.DisplayName = v }
	if v, ok := d["username"].(string); ok { up.Username = v }
	if v, ok := d["avatar"].(string); ok { up.Avatar = v }
	if v, ok := d["banned"].(bool); ok { up.Banned = v }
	// VP level, denormalised onto the user doc by the syncVpLevel trigger.
	// Read from the doc we are ALREADY fetching, so the rank crest in chat
	// costs no extra Firestore read: one read per connection, not per message.
	switch v := d["vpLevel"].(type) {
	case int64:
		up.VpLevel = int(v)
	case float64:
		up.VpLevel = int(v)
	}
	if v, ok := d["role"].(string); ok { up.Role = v }
	// ⚠ THE PLAN HAS TWO HISTORICAL SHAPES on this doc: a bare string, and a
	// map with a `tier`. canUseChatThemes() in src/utils/chatThemes.js reads
	// both for exactly this reason, and the client comment there warns that
	// reading only one is how the gate silently fails. Same both-shapes read.
	switch v := d["subscription"].(type) {
	case string:
		up.Plan = v
	case map[string]interface{}:
		if t, ok := v["tier"].(string); ok { up.Plan = t }
	}
	// Vanguard rank lives at users/{uid}.vanguard.{rank,status} (nested map).
	// The old flat vanguardRank/vanguardAlias reads matched nothing, so the
	// live-chat identity mask silently never fired.
	if vg, ok := d["vanguard"].(map[string]interface{}); ok {
		rank, _ := vg["rank"].(string)
		status, _ := vg["status"].(string)
		if rank != "" && status != "retired" && status != "suspended" {
			up.VanguardRank = rank
			// Persona label matches the client's rankMeta usernameTag.
			switch rank {
			case "recruit":
				up.VanguardAlias = "Recruit"
			case "vanguard":
				up.VanguardAlias = "Vanguard"
			case "senior":
				up.VanguardAlias = "Senior Vanguard"
			case "commander":
				up.VanguardAlias = "Commander"
			case "overseer":
				up.VanguardAlias = "Overseer"
			default:
				up.VanguardAlias = "Vanguard"
			}
		}
	}
	return up, nil
}

// ============================================================
// Gemini moderation
// ============================================================

type geminiReq struct {
	Contents []geminiContent `json:"contents"`
}
type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}
type geminiPart struct {
	Text string `json:"text,omitempty"`
}
type geminiResp struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

const moderationPrompt = `You moderate a live-stream chat. Respond with exactly one of:
PASS — message is fine (allow swearing, banter, mild rudeness, criticism, gaming gore, suggestive-but-not-explicit talk).
FLAG — borderline (slurs that may be in-context, repeated harassment, surface insults at a specific user, doxxing risk, scam links).
BLOCK — must not appear (CSAM, explicit sexual content, real-world violence promotion, doxxing personal info, scams with payment links, hate speech targeting a protected group).

Output FORMAT (exactly two lines, nothing else):
VERDICT: PASS|FLAG|BLOCK
REASON: <short>

Message:
`

func moderateGemini(ctx context.Context, text string) (verdict, reason string, err error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		*geminiModel, *geminiKey)
	body := geminiReq{
		Contents: []geminiContent{{
			Parts: []geminiPart{{Text: moderationPrompt + text}},
		}},
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	cl := &http.Client{Timeout: 4 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bb, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("gemini http %d: %s", resp.StatusCode, string(bb))
	}
	var gr geminiResp
	if err := json.NewDecoder(resp.Body).Decode(&gr); err != nil {
		return "", "", err
	}
	if len(gr.Candidates) == 0 || len(gr.Candidates[0].Content.Parts) == 0 {
		return "pass", "no-candidates", nil
	}
	raw := gr.Candidates[0].Content.Parts[0].Text
	v, r := parseVerdict(raw)
	return v, r, nil
}

func parseVerdict(raw string) (verdict, reason string) {
	verdict = "pass"
	reason = ""
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		up := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(up, "VERDICT:"):
			v := strings.TrimSpace(line[len("VERDICT:"):])
			switch strings.ToLower(v) {
			case "pass", "flag", "block":
				verdict = strings.ToLower(v)
			}
		case strings.HasPrefix(up, "REASON:"):
			reason = strings.TrimSpace(line[len("REASON:"):])
		}
	}
	return verdict, reason
}

// ============================================================
// Persistence: only on block/flag/report
// ============================================================

func writeModerationLog(streamID, uid, text, verdict, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, _, err := fsClient.Collection("content_moderation_log").Add(ctx, map[string]interface{}{
		"kind":     "chat",
		"surface":  "stream-chat",
		"streamId": streamID,
		"uid":      uid,
		"text":     text,
		"verdict":  verdict,
		"reason":   reason,
		"createdAt": firestore.ServerTimestamp,
	})
	if err != nil {
		log.Printf("moderation_log write: %v", err)
	}
}

func writeFlagged(streamID, uid, text, reason, msgID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, err := fsClient.Collection("streams").Doc(streamID).
		Collection("chat_moderation").Doc(msgID).
		Set(ctx, map[string]interface{}{
			"uid":       uid,
			"text":      text,
			"reason":    reason,
			"createdAt": firestore.ServerTimestamp,
		})
	if err != nil {
		log.Printf("flagged write: %v", err)
	}
	// Also log to the global moderation log for audit.
	writeModerationLog(streamID, uid, text, "flag", reason)
}
