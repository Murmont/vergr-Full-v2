// VERGR SFU — Pion-based selective forwarding unit for squad streams + co-host ingest.
//
// Routes (per CLAUDE.md "Streaming routing rule"):
//   - Squad rooms: voice-all + ≤2 video publishers, members 1..100
//   - Co-host ingest rooms: 2 broadcasters publish, ffmpeg consumer subscribes server-side
//
// Auth: every WebSocket connect must carry a valid Firebase ID token.
// For squad rooms, the room ID is the squad ID and we verify membership in Firestore.
// For ingest rooms (room ID prefixed "ingest_"), we verify the user is the host of the stream doc.
//
// Single binary, single port (8088), single systemd unit. Logs to stdout (journalctl).
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"google.golang.org/api/option"
)

// ============================================================
// Config
// ============================================================

// Per-room peer cap = max squad size. Squads are capped at 100 members, so
// 100 is the right ceiling for squad voice/video rooms. The Vanguard squad
// (only squad allowed past 100) is rare-edge — bump only when actually needed.
const (
	maxPeersPerRoom    = 100
	maxVideoPublishers = 2
	// Group CALL rooms (roomId "call_<chatId>_<ts>") get a bigger video grid than
	// squad rooms. The cap exists for BANDWIDTH, not correctness: the SFU forwards
	// every publisher to every other peer, so egress grows as publishers×peers
	// (8 publishers in an 8-person call ≈ 56 forwarded streams). 8 matches the
	// WhatsApp group-video grid and is the knob to turn if the box strains —
	// voice participants are NOT limited by this, only cameras.
	maxCallVideoPublishers = 8
	callRoomPrefix         = "call_"
	wsWriteTimeout         = 10 * time.Second
	wsReadTimeout          = 60 * time.Second
	wsPingInterval         = 25 * time.Second
)

// videoCapFor returns the video-publisher ceiling for a room. Squad/co-host
// rooms keep the conservative 2; ad-hoc group calls get the grid.
func videoCapFor(roomID string) int {
	if strings.HasPrefix(roomID, callRoomPrefix) {
		return maxCallVideoPublishers
	}
	return maxVideoPublishers
}

var (
	listenAddr   = flag.String("listen", ":8088", "HTTP listen address")
	bridgeAddr   = flag.String("bridge-listen", "127.0.0.1:8090", "Localhost-only listener for trusted bridges (cohost ffmpeg consumer); empty disables")
	credsPath    = flag.String("creds", "/etc/vergr-sfu/firebase-admin.json", "Firebase service account JSON path")
	allowOrigins = flag.String("origins", "https://vergr.app,https://vergr-44494.web.app,https://vergr-44494.firebaseapp.com,http://localhost:5173", "Comma-separated allowed WebSocket origins")
	publicIP     = flag.String("public-ip", "", "Public IP for ICE candidates (defaults to auto-detect)")
	udpPortMin   = flag.Int("udp-min", 50000, "Minimum UDP port for WebRTC media")
	udpPortMax   = flag.Int("udp-max", 50100, "Maximum UDP port for WebRTC media")
	projectID    = flag.String("project", "vergr-44494", "GCP project ID")
	databaseID   = flag.String("db", "vgrdb", "Firestore database ID (the app uses the NAMED db, not default)")

	allowedOrigins []string
)

// ============================================================
// Firebase
// ============================================================

var (
	authClient *fbauth.Client
	fsClient   *firestore.Client
)

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
	// CRITICAL: the app lives in the NAMED Firestore DB "vgrdb". app.Firestore()
	// silently connects to the (empty) DEFAULT database, so every authorizeRoom
	// doc read returned NotFound — squad rooms, voice channels, and co-host
	// ingest rooms rejected ALL joins. Always connect with the explicit DB id.
	fsClient, err = firestore.NewClientWithDatabase(ctx, *projectID, *databaseID, opt)
	if err != nil {
		return fmt.Errorf("firestore.NewClientWithDatabase: %w", err)
	}
	return nil
}

// verifyToken validates a Firebase ID token and returns the user's UID.
func verifyToken(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", errors.New("missing token")
	}
	t, err := authClient.VerifyIDToken(ctx, token)
	if err != nil {
		return "", err
	}
	return t.UID, nil
}

// authorizeRoom checks that the user is allowed to join the given room.
// For squad rooms (roomId = squad ID): user must be in `squads/{id}.members`.
// For ingest rooms (roomId = "ingest_<streamId>"): user must be the host of the stream doc.
// For group-call rooms (roomId = "call_<callId>"): user must be in `calls/{id}.participants`.
// For voice channel rooms (roomId = "voice_<channelId>"):
//   - Channel doc loaded from voice_channels/{channelId}.
//   - Public channels: any authenticated user allowed.
//   - Private channels: user must be owner OR in allowedUserIds.
//
// NOTE: an unrecognised prefix FALLS THROUGH to the squad lookup at the bottom,
// so a new room type without a branch here is rejected (it looks itself up as a
// squad id and fails). Any new prefix needs its own branch.
func authorizeRoom(ctx context.Context, uid, roomID string) error {
	if strings.HasPrefix(roomID, callRoomPrefix) {
		callID := strings.TrimPrefix(roomID, callRoomPrefix)
		doc, err := fsClient.Collection("calls").Doc(callID).Get(ctx)
		if err != nil {
			return fmt.Errorf("call doc: %w", err)
		}
		partsRaw, err := doc.DataAt("participants")
		if err != nil {
			return errors.New("call has no participants field")
		}
		parts, ok := partsRaw.([]interface{})
		if !ok {
			return errors.New("malformed participants field")
		}
		for _, p := range parts {
			if id, ok := p.(string); ok && id == uid {
				return nil
			}
		}
		return errors.New("not a participant of this call")
	}

	if strings.HasPrefix(roomID, "voice_") {
		channelID := strings.TrimPrefix(roomID, "voice_")
		doc, err := fsClient.Collection("voice_channels").Doc(channelID).Get(ctx)
		if err != nil {
			return fmt.Errorf("voice channel doc: %w", err)
		}
		visRaw, _ := doc.DataAt("visibility")
		visibility, _ := visRaw.(string)
		if visibility == "public" {
			return nil
		}
		ownerRaw, _ := doc.DataAt("ownerId")
		if owner, ok := ownerRaw.(string); ok && owner == uid {
			return nil
		}
		allowedRaw, _ := doc.DataAt("allowedUserIds")
		if allowed, ok := allowedRaw.([]interface{}); ok {
			for _, m := range allowed {
				if id, ok := m.(string); ok && id == uid {
					return nil
				}
			}
		}
		return errors.New("not invited to this voice channel")
	}

	if strings.HasPrefix(roomID, "ingest_") {
		streamID := strings.TrimPrefix(roomID, "ingest_")
		doc, err := fsClient.Collection("streams").Doc(streamID).Get(ctx)
		if err != nil {
			return fmt.Errorf("stream doc: %w", err)
		}
		hostUID, _ := doc.DataAt("hostUid")
		if hostUID == nil {
			hostUID, _ = doc.DataAt("hostId") // tolerate older field name
		}
		if hostUID == uid {
			return nil
		}
		// New (Phase 4): up to 3 co-hosts in coHostUids[]. Fall back to legacy
		// single-cohost fields so old streams keep working.
		if arr, _ := doc.DataAt("coHostUids"); arr != nil {
			if list, ok := arr.([]interface{}); ok {
				for _, m := range list {
					if id, ok := m.(string); ok && id == uid {
						return nil
					}
				}
			}
		}
		coHostUID, _ := doc.DataAt("coHostUid")
		if coHostUID == nil {
			coHostUID, _ = doc.DataAt("coHostId")
		}
		if coHostUID == uid {
			return nil
		}
		return errors.New("not authorized for this ingest room")
	}

	doc, err := fsClient.Collection("squads").Doc(roomID).Get(ctx)
	if err != nil {
		return fmt.Errorf("squad doc: %w", err)
	}
	membersRaw, err := doc.DataAt("members")
	if err != nil {
		return errors.New("squad has no members field")
	}
	members, ok := membersRaw.([]interface{})
	if !ok {
		return errors.New("malformed members field")
	}
	for _, m := range members {
		if id, ok := m.(string); ok && id == uid {
			return nil
		}
	}
	return errors.New("not a squad member")
}

// ============================================================
// Hub / Room / Peer
// ============================================================

type Hub struct {
	Rooms map[string]*Room
	mu    sync.Mutex
}

type Room struct {
	ID    string
	Peers map[string]*Peer
	mu    sync.RWMutex
}

type Peer struct {
	ID     string // unique per connection (uuid-ish)
	UID    string // Firebase user ID
	RoomID string
	Conn   *websocket.Conn
	PC     *webrtc.PeerConnection

	// Locally published tracks, keyed by kind ("audio"|"video"). These are
	// TrackLocalStaticRTP instances we forward incoming RTP into so subscribers
	// can attach them as outgoing senders.
	Pub   map[string]*webrtc.TrackLocalStaticRTP
	pubMu sync.RWMutex // protects Pub

	// Active subscriptions. [otherPeerID][kind] -> RTPSender (so we can remove
	// the sender when the publisher unpublishes or leaves).
	Subs   map[string]map[string]*webrtc.RTPSender
	subsMu sync.Mutex // protects Subs

	wmu    sync.Mutex // serializes WS writes
	closed atomic.Bool
}

func (p *Peer) setPub(kind string, t *webrtc.TrackLocalStaticRTP) {
	p.pubMu.Lock()
	p.Pub[kind] = t
	p.pubMu.Unlock()
}

func (p *Peer) deletePub(kind string) {
	p.pubMu.Lock()
	delete(p.Pub, kind)
	p.pubMu.Unlock()
}

func (p *Peer) getPub(kind string) (*webrtc.TrackLocalStaticRTP, bool) {
	p.pubMu.RLock()
	defer p.pubMu.RUnlock()
	t, ok := p.Pub[kind]
	return t, ok
}

func (p *Peer) pubKinds() []string {
	p.pubMu.RLock()
	defer p.pubMu.RUnlock()
	out := make([]string, 0, len(p.Pub))
	for k := range p.Pub {
		out = append(out, k)
	}
	return out
}

var hub = &Hub{Rooms: map[string]*Room{}}

func (h *Hub) GetOrCreateRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.Rooms[id]; ok {
		return r
	}
	r := &Room{ID: id, Peers: map[string]*Peer{}}
	h.Rooms[id] = r
	return r
}

func (h *Hub) RemoveEmptyRoom(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.Rooms[id]; ok {
		r.mu.RLock()
		empty := len(r.Peers) == 0
		r.mu.RUnlock()
		if empty {
			delete(h.Rooms, id)
		}
	}
}

// ============================================================
// Signaling
// ============================================================

type Msg struct {
	Type      string                    `json:"type"`
	SDP       string                    `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit  `json:"candidate,omitempty"`
	PeerID    string                    `json:"peerId,omitempty"`
	UID       string                    `json:"uid,omitempty"`
	Kind      string                    `json:"kind,omitempty"`
	Members   []MemberInfo              `json:"members,omitempty"`
	Error     string                    `json:"error,omitempty"`
}

type MemberInfo struct {
	PeerID string   `json:"peerId"`
	UID    string   `json:"uid"`
	Tracks []string `json:"tracks"`
}

func (p *Peer) send(m Msg) error {
	if p.closed.Load() {
		return errors.New("peer closed")
	}
	p.wmu.Lock()
	defer p.wmu.Unlock()
	p.Conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return p.Conn.WriteJSON(m)
}

func (p *Peer) sendError(text string) {
	_ = p.send(Msg{Type: "error", Error: text})
}

// ============================================================
// WebSocket handler
// ============================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		for _, o := range allowedOrigins {
			if origin == o {
				return true
			}
		}
		return false
	},
}

// bridgeUpgrader is used by the localhost-only bridge listener. The Go ws
// client we use in the cohost bridge doesn't set an Origin header, so the
// production upgrader rejects it. The bridge listener is bound to 127.0.0.1
// — anything that can hit it is already on the box.
var bridgeUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := r.URL.Query().Get("token")
	roomID := r.URL.Query().Get("room")
	if token == "" || roomID == "" {
		http.Error(w, "missing token or room", http.StatusBadRequest)
		return
	}

	uid, err := verifyToken(ctx, token)
	if err != nil {
		log.Printf("auth: token verify failed: %v", err)
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if err := authorizeRoom(ctx, uid, roomID); err != nil {
		log.Printf("auth: room %s denied for %s: %v", roomID, uid, err)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	upgradeAndServe(w, r, uid, roomID)
}

// handleBridgeWS handles the localhost-only listener used by the co-host ffmpeg
// bridge. No Firebase auth — this listener is bound to 127.0.0.1 and reachable
// only from processes on the same Hetzner box. Bridge peers can only join
// ingest_* rooms (validated below) and are silent subscribers (won't publish).
func handleBridgeWS(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room")
	if roomID == "" {
		http.Error(w, "missing room", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(roomID, "ingest_") {
		http.Error(w, "bridge can only join ingest_* rooms", http.StatusForbidden)
		return
	}
	// Synthesise a fake UID; bridge peers never publish so this is just for logging.
	upgradeAndServe(w, r, "_bridge", roomID)
}

func upgradeAndServe(w http.ResponseWriter, r *http.Request, uid, roomID string) {
	up := upgrader
	if uid == "_bridge" {
		up = bridgeUpgrader
	}
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade: %v", err)
		return
	}

	room := hub.GetOrCreateRoom(roomID)
	room.mu.RLock()
	peerCount := len(room.Peers)
	room.mu.RUnlock()
	if peerCount >= maxPeersPerRoom {
		_ = conn.WriteJSON(Msg{Type: "error", Error: "room full"})
		conn.Close()
		return
	}

	p := newPeer(uid, roomID, conn)
	if p == nil {
		conn.Close()
		return
	}
	go p.run()
}

// ============================================================
// Peer lifecycle
// ============================================================

func newPeer(uid, roomID string, conn *websocket.Conn) *Peer {
	cfg := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	se := webrtc.SettingEngine{}
	if *publicIP != "" {
		se.SetNAT1To1IPs([]string{*publicIP}, webrtc.ICECandidateTypeHost)
	}
	if err := se.SetEphemeralUDPPortRange(uint16(*udpPortMin), uint16(*udpPortMax)); err != nil {
		log.Printf("udp port range: %v", err)
	}
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(cfg)
	if err != nil {
		log.Printf("pc create: %v", err)
		_ = conn.WriteJSON(Msg{Type: "error", Error: "pc create failed"})
		return nil
	}

	// Pre-add transceivers so the offer/answer can carry both directions
	// from the start. This matters because a squad member might join muted
	// and only enable mic later; we still want SDP to allocate the m=audio.
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		log.Printf("addTx audio: %v", err)
	}
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		log.Printf("addTx video: %v", err)
	}

	p := &Peer{
		ID:     genID(),
		UID:    uid,
		RoomID: roomID,
		Conn:   conn,
		PC:     pc,
		Pub:    map[string]*webrtc.TrackLocalStaticRTP{},
		Subs:   map[string]map[string]*webrtc.RTPSender{},
	}

	// Forward local ICE candidates to the client.
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		init := c.ToJSON()
		_ = p.send(Msg{Type: "trickle", Candidate: &init})
	})

	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("peer %s (%s): conn %s", p.ID, p.UID, s)
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			p.close()
		}
	})

	// Whenever the remote publishes a track, fan it into a TrackLocalStaticRTP
	// that other peers can subscribe to.
	pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		kind := remote.Kind().String()
		log.Printf("peer %s published %s (codec=%s)", p.ID, kind, remote.Codec().MimeType)

		// Enforce video-publisher cap per room (max 2).
		if kind == "video" {
			room := hub.GetOrCreateRoom(p.RoomID)
			room.mu.RLock()
			active := 0
			for _, other := range room.Peers {
				if other.ID == p.ID {
					continue
				}
				if _, ok := other.getPub("video"); ok {
					active++
				}
			}
			room.mu.RUnlock()
			cap := videoCapFor(room.ID)
			if active >= cap {
				log.Printf("peer %s video rejected: %d publishers already (cap %d, room %s)", p.ID, active, cap, room.ID)
				p.sendError(fmt.Sprintf("video publisher cap reached (%d). ask one to swap.", cap))
				return
			}
		}

		local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability,
			fmt.Sprintf("%s-%s", kind, p.ID), p.ID)
		if err != nil {
			log.Printf("new local track: %v", err)
			return
		}
		p.setPub(kind, local)

		// Push the new track to all existing peers in the room (for audio,
		// we auto-subscribe; for video, we wait for explicit subscribe).
		if kind == "audio" {
			room := hub.GetOrCreateRoom(p.RoomID)
			room.mu.RLock()
			for _, other := range room.Peers {
				if other.ID != p.ID {
					go other.subscribeTo(p, kind)
				}
			}
			room.mu.RUnlock()
		}

		// Broadcast the publish event to the room so clients can subscribe
		// to video on demand.
		broadcast(p.RoomID, p.ID, Msg{
			Type:   "track-published",
			PeerID: p.ID,
			UID:    p.UID,
			Kind:   kind,
		})

		// Read RTP from the remote and forward into our local track.
		buf := make([]byte, 1500)
		for {
			n, _, err := remote.Read(buf)
			if err != nil {
				log.Printf("peer %s track %s read end: %v", p.ID, kind, err)
				return
			}
			if _, err := local.Write(buf[:n]); err != nil {
				if !errors.Is(err, io.ErrClosedPipe) {
					log.Printf("peer %s track %s write: %v", p.ID, kind, err)
				}
				return
			}
		}
	})

	// Add to room
	room := hub.GetOrCreateRoom(roomID)
	room.mu.Lock()
	room.Peers[p.ID] = p
	room.mu.Unlock()

	// Send the new peer the current room state.
	go p.sendRoomState()

	// Tell existing peers a newcomer arrived.
	broadcast(roomID, p.ID, Msg{Type: "peer-joined", PeerID: p.ID, UID: p.UID})

	// Auto-subscribe newcomer to existing audio publishers.
	room.mu.RLock()
	for _, other := range room.Peers {
		if other.ID == p.ID {
			continue
		}
		if _, ok := other.getPub("audio"); ok {
			go p.subscribeTo(other, "audio")
		}
	}
	room.mu.RUnlock()

	return p
}

func (p *Peer) sendRoomState() {
	room := hub.GetOrCreateRoom(p.RoomID)
	room.mu.RLock()
	defer room.mu.RUnlock()
	members := []MemberInfo{}
	for _, other := range room.Peers {
		if other.ID == p.ID {
			continue
		}
		members = append(members, MemberInfo{
			PeerID: other.ID,
			UID:    other.UID,
			Tracks: other.pubKinds(),
		})
	}
	_ = p.send(Msg{Type: "room-state", Members: members})
}

// subscribeTo attaches a sender on this peer for the given kind from `pub`.
func (p *Peer) subscribeTo(pub *Peer, kind string) {
	if p.closed.Load() {
		return
	}
	track, ok := pub.getPub(kind)
	if !ok {
		return
	}
	sender, err := p.PC.AddTrack(track)
	if err != nil {
		log.Printf("subscribe %s->%s %s: AddTrack: %v", p.ID, pub.ID, kind, err)
		return
	}
	p.subsMu.Lock()
	if p.Subs[pub.ID] == nil {
		p.Subs[pub.ID] = map[string]*webrtc.RTPSender{}
	}
	p.Subs[pub.ID][kind] = sender
	p.subsMu.Unlock()

	// Read RTCP so the SDP negotiation completes cleanly.
	go func() {
		buf := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buf); err != nil {
				return
			}
		}
	}()

	if err := p.renegotiate(); err != nil {
		log.Printf("subscribe renegotiate: %v", err)
	}
}

// renegotiate re-creates an offer and ships it to the client.
func (p *Peer) renegotiate() error {
	offer, err := p.PC.CreateOffer(nil)
	if err != nil {
		return err
	}
	if err := p.PC.SetLocalDescription(offer); err != nil {
		return err
	}
	return p.send(Msg{Type: "offer", SDP: offer.SDP})
}

// run reads WS messages until the connection drops.
func (p *Peer) run() {
	defer p.close()
	p.Conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	p.Conn.SetPongHandler(func(string) error {
		p.Conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		return nil
	})

	// Ping loop.
	go func() {
		t := time.NewTicker(wsPingInterval)
		defer t.Stop()
		for range t.C {
			if p.closed.Load() {
				return
			}
			p.wmu.Lock()
			p.Conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			err := p.Conn.WriteMessage(websocket.PingMessage, nil)
			p.wmu.Unlock()
			if err != nil {
				return
			}
		}
	}()

	for {
		var m Msg
		if err := p.Conn.ReadJSON(&m); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("peer %s read: %v", p.ID, err)
			}
			return
		}
		switch m.Type {
		case "offer":
			// Client offers (used for the initial publish).
			if err := p.PC.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeOffer, SDP: m.SDP,
			}); err != nil {
				p.sendError("setRemoteDescription: " + err.Error())
				continue
			}
			ans, err := p.PC.CreateAnswer(nil)
			if err != nil {
				p.sendError("createAnswer: " + err.Error())
				continue
			}
			if err := p.PC.SetLocalDescription(ans); err != nil {
				p.sendError("setLocalDescription: " + err.Error())
				continue
			}
			_ = p.send(Msg{Type: "answer", SDP: ans.SDP})

		case "answer":
			// Client's answer to a server-initiated offer (after we add a sub track).
			if err := p.PC.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeAnswer, SDP: m.SDP,
			}); err != nil {
				log.Printf("peer %s setRemoteDescription(answer): %v", p.ID, err)
			}

		case "trickle":
			if m.Candidate != nil {
				if err := p.PC.AddICECandidate(*m.Candidate); err != nil {
					log.Printf("peer %s addICE: %v", p.ID, err)
				}
			}

		case "subscribe":
			// Client requests to subscribe to another peer's track (typically video).
			room := hub.GetOrCreateRoom(p.RoomID)
			room.mu.RLock()
			pub, ok := room.Peers[m.PeerID]
			room.mu.RUnlock()
			if !ok {
				p.sendError("unknown peer: " + m.PeerID)
				continue
			}
			go p.subscribeTo(pub, m.Kind)

		case "unsubscribe":
			p.subsMu.Lock()
			senders, ok := p.Subs[m.PeerID]
			if !ok {
				p.subsMu.Unlock()
				continue
			}
			sender, ok := senders[m.Kind]
			if !ok {
				p.subsMu.Unlock()
				continue
			}
			delete(senders, m.Kind)
			p.subsMu.Unlock()
			_ = p.PC.RemoveTrack(sender)
			_ = p.renegotiate()

		case "unpublish":
			// Camera handoff: the peer is dropping their video track without disconnecting.
			p.deletePub(m.Kind)
			broadcast(p.RoomID, "", Msg{
				Type:   "track-unpublished",
				PeerID: p.ID,
				Kind:   m.Kind,
			})

		default:
			// Ignore unknown message types — keeps the protocol forward-compatible.
		}
	}
}

func (p *Peer) close() {
	if !p.closed.CompareAndSwap(false, true) {
		return
	}
	if p.PC != nil {
		_ = p.PC.Close()
	}
	if p.Conn != nil {
		_ = p.Conn.Close()
	}

	room := hub.GetOrCreateRoom(p.RoomID)
	room.mu.Lock()
	delete(room.Peers, p.ID)
	room.mu.Unlock()

	broadcast(p.RoomID, "", Msg{Type: "peer-left", PeerID: p.ID})
	hub.RemoveEmptyRoom(p.RoomID)
	log.Printf("peer %s (%s) closed", p.ID, p.UID)
}

// broadcast sends a message to every peer in a room except the one with `exceptID`.
func broadcast(roomID, exceptID string, m Msg) {
	hub.mu.Lock()
	r, ok := hub.Rooms[roomID]
	hub.mu.Unlock()
	if !ok {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, peer := range r.Peers {
		if peer.ID == exceptID {
			continue
		}
		_ = peer.send(m)
	}
}

// ============================================================
// HTTP plumbing
// ============================================================

func handleHealth(w http.ResponseWriter, r *http.Request) {
	hub.mu.Lock()
	roomCount := len(hub.Rooms)
	peerCount := 0
	for _, r := range hub.Rooms {
		r.mu.RLock()
		peerCount += len(r.Peers)
		r.mu.RUnlock()
	}
	hub.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"rooms":  roomCount,
		"peers":  peerCount,
		"now":    time.Now().UTC().Format(time.RFC3339),
	})
}

// ============================================================
// Util
// ============================================================

func genID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback that's still globally unique enough — never panic the SFU
		// over an entropy hiccup.
		return fmt.Sprintf("p%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// ============================================================
// main
// ============================================================

func main() {
	flag.Parse()
	allowedOrigins = strings.Split(*allowOrigins, ",")
	for i := range allowedOrigins {
		allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
	}

	ctx := context.Background()
	if err := initFirebase(ctx); err != nil {
		log.Fatalf("firebase init: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealth)
	mux.HandleFunc("/ws", handleWS)

	srv := &http.Server{
		Addr:              *listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Localhost-only listener for the cohost ffmpeg bridge. Bound to 127.0.0.1
	// so external traffic can never reach it; firewall'd irrelevant.
	if *bridgeAddr != "" {
		bridgeMux := http.NewServeMux()
		bridgeMux.HandleFunc("/ws", handleBridgeWS)
		bridgeMux.HandleFunc("/healthz", handleHealth)
		go func() {
			bridgeSrv := &http.Server{
				Addr:              *bridgeAddr,
				Handler:           bridgeMux,
				ReadHeaderTimeout: 10 * time.Second,
			}
			log.Printf("vergr-sfu bridge listening on %s (localhost-only, no auth)", *bridgeAddr)
			if err := bridgeSrv.ListenAndServe(); err != nil {
				log.Printf("bridge listen failed: %v", err)
			}
		}()
	}

	log.Printf("vergr-sfu listening on %s (origins=%v, public-ip=%s)", *listenAddr, allowedOrigins, *publicIP)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
