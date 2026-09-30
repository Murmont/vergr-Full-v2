// DM + group chat relay endpoints.
//
// Paths:
//   wss://chat.vergr.app/dm/<convoId>?token=<firebase-id-token>     (encrypted 1:1)
//   wss://chat.vergr.app/group/<convoId>?token=<firebase-id-token>  (plaintext fan-out)
//
// FOUNDER MANDATE (non-negotiable, see CLAUDE.md):
//   Messages MUST NOT be stored in Firestore. The server fans out and forgets.
//   DM payloads are CIPHERTEXT (X25519 sealed box) — server cannot read them,
//   so no moderation runs on DMs. Group payloads are plaintext but still
//   never persisted; a small lexicon catches the obvious worst case.
//
// LIFE OF A MESSAGE:
//   1. Client → WS frame { type:'msg', id, ciphertext|text, ts, ... }
//   2. Relay validates membership (cached from conversation doc) + rate-limit.
//   3. Relay fans out to all CONNECTED peers in the room (including sender for ack).
//   4. Relay appends to a tiny per-room ring buffer (50 msgs, ~30s TTL) so a
//      peer that reconnects within the window gets stragglers without polling.
//   5. Relay POSTs a thin notify hook to a Cloud Function for FCM delivery.
//      Payload contains NO message body — only {convoId, senderUid, hasMedia,
//      mediaKind?, msgId}. Service worker decrypts from local Dexie.
//
// ROOM KEY: convoId (the Firestore conversations/{id} doc id) for both DMs and
// groups. Rooms auto-close when empty.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ============================================================
// Config
// ============================================================

const (
	dmRoomBufferSize     = 50
	dmRoomBufferTTL      = 60 * time.Second
	dmMaxCiphertextBytes = 64 * 1024  // 64 KB — covers long text + small key material
	groupMaxTextChars    = 2000        // 10x stream chat (groups are not a firehose)
	membershipCacheTTL   = 30 * time.Second
)

var (
	notifyHookURL = os.Getenv("DM_NOTIFY_HOOK") // e.g. https://europe-west1-vergr-44494.cloudfunctions.net/notifyDmDelivery
	notifyHookKey = os.Getenv("DM_NOTIFY_KEY")  // shared secret header
)

// ============================================================
// Offline backlog
//
// The per-room ring buffer (50 msgs / 60s) only helps a peer that reconnects
// within ~60s, and the room itself is garbage-collected when empty. So a
// message sent while the recipient has the app closed is lost — the inbox
// preview (Firestore metadata) still shows it, but the thread is empty.
//
// This backlog holds the same fan-out frames keyed by convoId so a recipient
// who reopens the conversation later still receives them. In memory only
// (lost on relay restart), bounded + TTL'd. No Firestore writes, no plaintext
// leaves the relay that wasn't already fanned out.
// ============================================================

const (
	backlogTTL        = 7 * 24 * time.Hour
	backlogMaxPerRoom = 300
)

type backlogEntry struct {
	msg ChatMsg
	at  time.Time
}

var (
	convoBacklog   = map[string][]backlogEntry{}
	convoBacklogMu sync.Mutex
)

func backlogEnqueue(convoID string, m ChatMsg) {
	convoBacklogMu.Lock()
	defer convoBacklogMu.Unlock()
	cutoff := time.Now().Add(-backlogTTL)
	q := convoBacklog[convoID]
	out := make([]backlogEntry, 0, len(q)+1)
	for _, e := range q {
		if e.at.After(cutoff) {
			out = append(out, e)
		}
	}
	out = append(out, backlogEntry{msg: m, at: time.Now()})
	if len(out) > backlogMaxPerRoom {
		out = out[len(out)-backlogMaxPerRoom:]
	}
	convoBacklog[convoID] = out
}

func backlogSince(convoID string, since int64) []ChatMsg {
	convoBacklogMu.Lock()
	defer convoBacklogMu.Unlock()
	cutoff := time.Now().Add(-backlogTTL)
	q := convoBacklog[convoID]
	out := []ChatMsg{}
	for _, e := range q {
		if e.at.Before(cutoff) {
			continue
		}
		if since > 0 && e.msg.TS <= since {
			continue
		}
		out = append(out, e.msg)
	}
	return out
}

// ============================================================
// DM/Group room (separate from the stream-chat Room type so we don't
// drag in the host-mod/banned-word machinery that's irrelevant here)
// ============================================================

type ChatRoom struct {
	ID       string           // convoId
	IsGroup  bool             // false = 1:1 DM (ciphertext), true = group (plaintext)
	Members  map[string]bool  // set of allowed UIDs (from conversation.participants)
	Admins   map[string]bool  // group admins + creator (drives onlyAdminsPost)
	AdminsOnly bool           // conversation.onlyAdminsPost — non-admin msg frames rejected
	Banned   map[string]bool  // conversation.banned — refused at connect AND on send
	NoMedia  bool             // permissions.sendMedia == false (members only)
	NoLinks  bool             // permissions.sendLinks == false (members only)
	Peers    map[string]*ChatPeer
	Buffer   []ChatMsg        // ring buffer for reconnect catch-up
	mu       sync.RWMutex
}

// linkRe matches an explicit URL scheme, a www. host, OR a bare domain like
// "spam.biz/x". The bare-domain case matters: a spammer who can only post
// "t.me/whatever" is not meaningfully blocked, so a scheme-only check would
// make the sendLinks permission cosmetic.
var linkRe = regexp.MustCompile(`(?i)\b(?:https?://|www\.|[a-z0-9][-a-z0-9]*\.(?:com|net|org|io|gg|me|co|xyz|biz|info|ru|tk|link|app|dev|to|cc|tv|shop|store|site|online|club|live|top)\b)`)

func containsLink(s string) bool {
	return linkRe.MatchString(s)
}

// applyPolicy copies the moderation policy (bans + member permissions) onto a
// live room. Kept separate from getOrCreateChatRoom so squad rooms — which have
// no conversation doc behind them — don't have to fabricate a policy.
func (r *ChatRoom) applyPolicy(e membershipEntry) {
	r.mu.Lock()
	r.Banned = e.banned
	r.NoMedia = e.noMedia
	r.NoLinks = e.noLinks
	r.mu.Unlock()
}

var (
	chatRoomHub   = map[string]*ChatRoom{}
	chatRoomHubMu sync.Mutex
)

func getOrCreateChatRoom(id string, isGroup bool, members, admins map[string]bool, adminsOnly bool) *ChatRoom {
	chatRoomHubMu.Lock()
	defer chatRoomHubMu.Unlock()
	if r, ok := chatRoomHub[id]; ok {
		// Refresh the membership set so newly-added participants get access
		// without restarting the relay.
		r.mu.Lock()
		r.Members = members
		r.Admins = admins
		r.AdminsOnly = adminsOnly
		r.mu.Unlock()
		return r
	}
	r := &ChatRoom{
		ID:         id,
		IsGroup:    isGroup,
		Members:    members,
		Admins:     admins,
		AdminsOnly: adminsOnly,
		Peers:      map[string]*ChatPeer{},
		Buffer:     make([]ChatMsg, 0, dmRoomBufferSize),
	}
	chatRoomHub[id] = r
	return r
}

// fanoutChatFrame pushes a frame to every connected peer of a room, if the room
// is currently live in the hub. Used by the /ops HTTP handler to propagate
// reactions + delete-for-everyone to online clients (offline clients pick the
// change up from /history). No-op when nobody is connected.
func fanoutChatFrame(convoID string, m ChatMsg) {
	chatRoomHubMu.Lock()
	r, ok := chatRoomHub[convoID]
	chatRoomHubMu.Unlock()
	if !ok {
		return
	}
	for _, peer := range r.snapshotPeers() {
		_ = peer.write(m)
	}
}

func removeChatRoomIfEmpty(id string) {
	chatRoomHubMu.Lock()
	defer chatRoomHubMu.Unlock()
	if r, ok := chatRoomHub[id]; ok {
		r.mu.RLock()
		empty := len(r.Peers) == 0
		r.mu.RUnlock()
		if empty {
			delete(chatRoomHub, id)
		}
	}
}

func (r *ChatRoom) addPeer(p *ChatPeer) {
	r.mu.Lock()
	r.Peers[p.connID] = p
	r.mu.Unlock()
}

func (r *ChatRoom) removePeer(p *ChatPeer) {
	r.mu.Lock()
	delete(r.Peers, p.connID)
	empty := len(r.Peers) == 0
	r.mu.Unlock()
	if empty {
		removeChatRoomIfEmpty(r.ID)
	}
}

func (r *ChatRoom) snapshotPeers() []*ChatPeer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*ChatPeer, 0, len(r.Peers))
	for _, p := range r.Peers {
		out = append(out, p)
	}
	return out
}

func (r *ChatRoom) onlineUIDs() map[string]bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := map[string]bool{}
	for _, p := range r.Peers {
		out[p.uid] = true
	}
	return out
}

func (r *ChatRoom) appendBuffer(m ChatMsg) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := time.Now().Add(-dmRoomBufferTTL).UnixMilli()
	// Prune expired
	i := 0
	for i < len(r.Buffer) && r.Buffer[i].TS < cutoff {
		i++
	}
	if i > 0 {
		r.Buffer = r.Buffer[i:]
	}
	r.Buffer = append(r.Buffer, m)
	if len(r.Buffer) > dmRoomBufferSize {
		r.Buffer = r.Buffer[len(r.Buffer)-dmRoomBufferSize:]
	}
}

func (r *ChatRoom) bufferSince(ts int64) []ChatMsg {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []ChatMsg{}
	for _, m := range r.Buffer {
		if m.TS > ts {
			out = append(out, m)
		}
	}
	return out
}

// ============================================================
// ChatPeer (separate from stream-chat Peer)
// ============================================================

type ChatPeer struct {
	// Required email verification: see Peer.emailOK in main.go.
	emailOK bool
	connID string
	uid    string
	conn   *websocket.Conn
	room   *ChatRoom
	wmu    sync.Mutex
	closed bool
	// Reuse the stream-chat rate limiter shape via inline state.
	tokens     int64
	lastRefill int64
	rateMu     sync.Mutex
	// PER-PEER media gate, distinct from the room-wide ChatRoom.NoMedia.
	//
	// In a 1:1 DM a stranger may send text but not photos or videos until the
	// person they are messaging follows them back. Following is DIRECTIONAL, so
	// this cannot live on the room: in the same conversation the followed party
	// may send media while the stranger may not. Hence a flag on the connection,
	// not on the room.
	noMedia   bool
	policyMu  sync.RWMutex
}

func (p *ChatPeer) setNoMedia(v bool) {
	p.policyMu.Lock()
	p.noMedia = v
	p.policyMu.Unlock()
}

func (p *ChatPeer) mediaBlocked() bool {
	p.policyMu.RLock()
	defer p.policyMu.RUnlock()
	return p.noMedia
}

func newChatPeer(uid string, conn *websocket.Conn, room *ChatRoom) *ChatPeer {
	id := fmt.Sprintf("d%d-%s", peerCounter.Add(1), uid[:6])
	return &ChatPeer{
		connID:     id,
		uid:        uid,
		conn:       conn,
		room:       room,
		tokens:     rateBucketCapacity,
		lastRefill: time.Now().UnixMilli(),
	}
}

func (p *ChatPeer) write(m ChatMsg) error {
	p.wmu.Lock()
	defer p.wmu.Unlock()
	_ = p.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return p.conn.WriteJSON(m)
}

func (p *ChatPeer) close() {
	p.wmu.Lock()
	defer p.wmu.Unlock()
	if p.closed {
		return
	}
	p.closed = true
	_ = p.conn.Close()
}

func (p *ChatPeer) takeToken() bool {
	p.rateMu.Lock()
	defer p.rateMu.Unlock()
	now := time.Now().UnixMilli()
	elapsed := now - p.lastRefill
	if elapsed > 0 {
		add := elapsed / rateBucketRefillMs
		if add > 0 {
			p.tokens += add
			if p.tokens > rateBucketCapacity {
				p.tokens = rateBucketCapacity
			}
			p.lastRefill += add * rateBucketRefillMs
		}
	}
	if p.tokens <= 0 {
		return false
	}
	p.tokens--
	return true
}

// ============================================================
// Wire format
// ============================================================

type ChatMsg struct {
	Type       string `json:"type"`                  // 'hello' | 'msg' | 'reject' | 'system' | 'ack'
	ConvoID    string `json:"convoId,omitempty"`
	You        string `json:"you,omitempty"`
	IsGroup    bool   `json:"isGroup,omitempty"`
	// Outbound (broadcast)
	ID         string `json:"id,omitempty"`         // client-generated msg id (UUID)
	UID        string `json:"uid,omitempty"`        // sender uid
	Ciphertext string `json:"ct,omitempty"`         // base64 sealed-box payload (DM only)
	Text       string `json:"text,omitempty"`       // group rooms only
	MediaKind  string `json:"mediaKind,omitempty"`  // 'image' | 'video' | 'audio' | 'file' (notif hint)
	HasMedia   bool   `json:"hasMedia,omitempty"`
	ContentURL string `json:"contentUrl,omitempty"` // public R2/CDN media URL (photo/gif/sticker/clip/file) — fanned out, never persisted
	VideoURL   string `json:"videoUrl,omitempty"`   // clip mp4 URL (poster is contentUrl)
	Waveform   []int  `json:"waveform,omitempty"`   // voice-note amplitude bars (0-100) — shape metadata, not content
	ReplyToID  string `json:"replyToId,omitempty"`
	// Op frames: content-bearing operations on an existing message. v1: 'edit'
	// (new text for TargetID). Fanned out + backlogged like normal messages so
	// offline members converge on reconnect. 'edit' is persisted (store.go);
	// 'react'/'delete' op frames are fanned out by the /ops HTTP handler so
	// online clients update live (state itself lives in the SQLite store).
	Op         string `json:"op,omitempty"`
	TargetID   string `json:"targetId,omitempty"`
	Emoji      string `json:"emoji,omitempty"` // 'react' op frame
	On         bool   `json:"on,omitempty"`    // 'react' op frame: added (true) / removed (false)
	TS         int64  `json:"ts,omitempty"`
	// Inbound only
	Since      int64  `json:"since,omitempty"`      // catch-up cursor for hello
	Reason     string `json:"reason,omitempty"`
	// Sent on 'hello' (and re-sent as a 'policy' frame when it changes) so the
	// client can explain the restriction BEFORE the user picks a photo, rather
	// than letting them choose one and then rejecting it — which reads as the
	// app being broken.
	NoMedia    bool   `json:"noMedia,omitempty"`
}

// ============================================================
// Membership cache (avoid Firestore hit on every reconnect)
// ============================================================

type membershipEntry struct {
	members map[string]bool
	isGroup bool
	admins  map[string]bool
	adminsOnly bool
	banned  map[string]bool
	noMedia bool
	noLinks bool
	cachedAt time.Time
}

var (
	membershipCache   = map[string]membershipEntry{}
	membershipCacheMu sync.Mutex
)

func loadConversationMembership(ctx context.Context, convoID string) (membershipEntry, error) {
	membershipCacheMu.Lock()
	if e, ok := membershipCache[convoID]; ok && time.Since(e.cachedAt) < membershipCacheTTL {
		membershipCacheMu.Unlock()
		return e, nil
	}
	membershipCacheMu.Unlock()

	snap, err := fsClient.Collection("conversations").Doc(convoID).Get(ctx)
	if err != nil {
		return membershipEntry{}, err
	}
	if !snap.Exists() {
		return membershipEntry{}, fmt.Errorf("conversation not found")
	}
	d := snap.Data()
	members := map[string]bool{}
	if arr, ok := d["participants"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok {
				members[s] = true
			}
		}
	}
	isGroup := false
	if v, ok := d["isGroup"].(bool); ok {
		isGroup = v
	}
	// Group admin set (admins[] + implicit creator) for onlyAdminsPost.
	admins := map[string]bool{}
	if arr, ok := d["admins"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok {
				admins[s] = true
			}
		}
	}
	if s, ok := d["createdBy"].(string); ok && s != "" {
		admins[s] = true
	}
	adminsOnly := false
	if v, ok := d["onlyAdminsPost"].(bool); ok {
		adminsOnly = v
	}
	// Banned members: refused at connect and on send. A ban also removes them
	// from participants, so this is belt-and-braces against a stale cache.
	banned := map[string]bool{}
	if arr, ok := d["banned"].([]interface{}); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok {
				banned[s] = true
			}
		}
	}
	// Member permissions. ABSENT MAP = EVERYTHING ALLOWED — every group created
	// before this feature has no `permissions` field, and must not silently
	// become locked down.
	noMedia, noLinks := false, false
	if perms, ok := d["permissions"].(map[string]interface{}); ok {
		if v, ok := perms["sendMedia"].(bool); ok && !v {
			noMedia = true
		}
		if v, ok := perms["sendLinks"].(bool); ok && !v {
			noLinks = true
		}
	}
	// Status check — refuse deleted/blocked conversations.
	if v, ok := d["status"].(string); ok && v == "deleted" {
		return membershipEntry{}, fmt.Errorf("conversation deleted")
	}

	e := membershipEntry{
		members: members, isGroup: isGroup, admins: admins, adminsOnly: adminsOnly,
		banned: banned, noMedia: noMedia, noLinks: noLinks, cachedAt: time.Now(),
	}
	membershipCacheMu.Lock()
	membershipCache[convoID] = e
	membershipCacheMu.Unlock()
	return e, nil
}

// ============================================================
// Stranger-DM media gate
// ============================================================

type dmFollowEntry struct {
	follows  bool
	cachedAt time.Time
}

var (
	dmFollowCache   = map[string]dmFollowEntry{}
	dmFollowCacheMu sync.Mutex
)

// recipientFollowsSender reports whether `recipient` follows `sender`.
// The follows collection is keyed `{followerId}_{followingId}`, so this is a
// single document GET by exact id — no query, no index.
func recipientFollowsSender(ctx context.Context, recipient, sender string) bool {
	key := recipient + "_" + sender

	dmFollowCacheMu.Lock()
	if e, ok := dmFollowCache[key]; ok && time.Since(e.cachedAt) < membershipCacheTTL {
		dmFollowCacheMu.Unlock()
		return e.follows
	}
	dmFollowCacheMu.Unlock()

	// A missing document is reported as a NotFound ERROR, but the snapshot is
	// still returned with Exists() == false. So "snap is nil" is the only real
	// failure — checking the error alone would read every non-follower as an
	// infrastructure fault.
	snap, err := fsClient.Collection("follows").Doc(key).Get(ctx)
	if snap == nil {
		// A Firestore hiccup must not silently mute media for people who ARE
		// followed. Erring toward ALLOW matches how the group permissions map is
		// treated (absent = everything allowed) and keeps an infra blip from
		// looking like a product restriction. Deliberately not cached, so the
		// next frame re-checks.
		log.Printf("dm-media-gate: follow lookup failed for %s: %v", key, err)
		return true
	}
	follows := snap.Exists()

	dmFollowCacheMu.Lock()
	dmFollowCache[key] = dmFollowEntry{follows: follows, cachedAt: time.Now()}
	dmFollowCacheMu.Unlock()
	return follows
}

// dmMediaBlockedFor decides whether this peer may attach media in this 1:1 DM.
//
// Groups are governed by the room-wide permissions map instead, and a note to
// yourself (participants = [uid, uid]) is never restricted.
func dmMediaBlockedFor(ctx context.Context, members map[string]bool, uid string) bool {
	other := ""
	for m := range members {
		if m != uid {
			other = m
			break
		}
	}
	if other == "" {
		return false // saved-messages / self thread
	}
	return !recipientFollowsSender(ctx, other, uid)
}

// Invalidate cache on participant change (called from a refresh tick — cheap).
func refreshChatRoomMembership(convoID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	e, err := loadConversationMembership(ctx, convoID)
	if err != nil {
		return
	}
	chatRoomHubMu.Lock()
	r, ok := chatRoomHub[convoID]
	chatRoomHubMu.Unlock()
	if !ok {
		return
	}
	r.mu.Lock()
	r.Members = e.members
	r.Admins = e.admins
	r.AdminsOnly = e.adminsOnly
	r.Banned = e.banned
	r.NoMedia = e.noMedia
	r.NoLinks = e.noLinks
	r.mu.Unlock()
}

// ============================================================
// Handlers
// ============================================================

func handleDMWS(w http.ResponseWriter, r *http.Request) {
	convoID := strings.TrimPrefix(r.URL.Path, "/dm/")
	convoID = strings.TrimSuffix(convoID, "/")
	handleConvoWS(w, r, convoID, false)
}

func handleGroupWS(w http.ResponseWriter, r *http.Request) {
	convoID := strings.TrimPrefix(r.URL.Path, "/group/")
	convoID = strings.TrimSuffix(convoID, "/")
	handleConvoWS(w, r, convoID, true)
}

// /squad/<squadId>  — squad chat moves off Firestore. Same fan-out shape as
// groups (plaintext + lexicon), but membership is read from squads/{id}/members/{uid}
// instead of conversations/{id}.participants.
func handleSquadWS(w http.ResponseWriter, r *http.Request) {
	squadID := strings.TrimPrefix(r.URL.Path, "/squad/")
	squadID = strings.TrimSuffix(squadID, "/")
	if squadID == "" || strings.Contains(squadID, "/") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	t, err := authClient.VerifyIDToken(ctx, token)
	if err != nil {
		http.Error(w, "bad token", http.StatusUnauthorized)
		return
	}
	uid := t.UID

	members, err := loadSquadMembership(ctx, squadID)
	if err != nil {
		http.Error(w, "squad not found", http.StatusNotFound)
		return
	}
	if !members[uid] {
		http.Error(w, "not a squad member", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(int64(dmMaxCiphertextBytes + 4096))

	// Use the same ChatRoom machinery — namespace squad room ids with a prefix
	// so they can't collide with conversation ids.
	roomKey := "squad:" + squadID
	// Squad rooms have no admin-post restriction (nil admins, adminsOnly off).
	room := getOrCreateChatRoom(roomKey, true, members, nil, false)
	p := newChatPeer(uid, conn, room)
	p.emailOK = tokenEmailVerified(t)
	room.addPeer(p)
	defer room.removePeer(p)
	defer p.close()

	_ = p.write(ChatMsg{
		Type: "hello", ConvoID: roomKey, You: uid, IsGroup: true, TS: time.Now().UnixMilli(),
	})

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(membershipCacheTTL)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				mm, err := loadSquadMembership(context.Background(), squadID)
				if err == nil {
					room.mu.Lock()
					room.Members = mm
					room.mu.Unlock()
					if !mm[uid] {
						_ = p.write(ChatMsg{Type: "reject", Reason: "removed-from-squad"})
						p.close()
						return
					}
				}
			}
		}
	}()

	p.runChat(ctx)
}

type squadMembershipEntry struct {
	members  map[string]bool
	cachedAt time.Time
}

var (
	squadMembershipCache   = map[string]squadMembershipEntry{}
	squadMembershipCacheMu sync.Mutex
)

func loadSquadMembership(ctx context.Context, squadID string) (map[string]bool, error) {
	squadMembershipCacheMu.Lock()
	if e, ok := squadMembershipCache[squadID]; ok && time.Since(e.cachedAt) < membershipCacheTTL {
		squadMembershipCacheMu.Unlock()
		return e.members, nil
	}
	squadMembershipCacheMu.Unlock()

	// squads/{id}/members/{uid} — one document per member. Cheap scan.
	iter := fsClient.Collection("squads").Doc(squadID).Collection("members").Documents(ctx)
	out := map[string]bool{}
	for {
		snap, err := iter.Next()
		if err != nil {
			break
		}
		if snap == nil {
			continue
		}
		out[snap.Ref.ID] = true
	}
	if len(out) == 0 {
		// Could be a non-existent squad, or a private squad with a different
		// membership shape. Refuse to admit by returning an error.
		return nil, fmt.Errorf("no members")
	}
	squadMembershipCacheMu.Lock()
	squadMembershipCache[squadID] = squadMembershipEntry{members: out, cachedAt: time.Now()}
	squadMembershipCacheMu.Unlock()
	return out, nil
}

func handleConvoWS(w http.ResponseWriter, r *http.Request, convoID string, wantGroup bool) {
	if convoID == "" || strings.Contains(convoID, "/") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	t, err := authClient.VerifyIDToken(ctx, token)
	if err != nil {
		http.Error(w, "bad token", http.StatusUnauthorized)
		return
	}
	uid := t.UID

	me, err := loadConversationMembership(ctx, convoID)
	if err != nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}
	isGroup := me.isGroup
	if isGroup != wantGroup {
		http.Error(w, "wrong endpoint for this conversation", http.StatusBadRequest)
		return
	}
	if !me.members[uid] {
		http.Error(w, "not a participant", http.StatusForbidden)
		return
	}
	if me.banned[uid] {
		http.Error(w, "banned from this group", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(int64(dmMaxCiphertextBytes + 4096))

	room := getOrCreateChatRoom(convoID, isGroup, me.members, me.admins, me.adminsOnly)
	room.applyPolicy(me)
	p := newChatPeer(uid, conn, room)
	p.emailOK = tokenEmailVerified(t)
	// 1:1 only: a stranger gets text until the other person follows them back.
	if !isGroup {
		p.setNoMedia(dmMediaBlockedFor(ctx, me.members, uid))
	}
	room.addPeer(p)
	defer room.removePeer(p)
	defer p.close()

	// Hello. Carries the media gate so the composer can say why the attach
	// button is unavailable instead of failing at send time.
	_ = p.write(ChatMsg{
		Type:    "hello",
		ConvoID: convoID,
		You:     uid,
		IsGroup: isGroup,
		NoMedia: p.mediaBlocked(),
		TS:      time.Now().UnixMilli(),
	})

	// Periodic membership refresh (handles add/remove participants without restart).
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(membershipCacheTTL)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				refreshChatRoomMembership(convoID)
				// If this uid was removed mid-session, hang up.
				r2 := room
				r2.mu.RLock()
				stillIn := r2.Members[uid]
				members := r2.Members
				r2.mu.RUnlock()
				if !stillIn {
					_ = p.write(ChatMsg{Type: "reject", Reason: "removed-from-conversation"})
					p.close()
					return
				}
				// Re-check the stranger gate on the same tick. Someone who
				// follows you back mid-conversation should be able to send a
				// photo immediately, without closing and reopening the thread.
				if !isGroup {
					was := p.mediaBlocked()
					now := dmMediaBlockedFor(context.Background(), members, uid)
					if now != was {
						p.setNoMedia(now)
						_ = p.write(ChatMsg{Type: "policy", ConvoID: convoID, NoMedia: now})
					}
				}
			}
		}
	}()

	p.runChat(ctx)
}

// ============================================================
// Peer loop
// ============================================================

func (p *ChatPeer) runChat(ctx context.Context) {
	// Ping loop — same shape as stream-chat peer.
	go func() {
		t := time.NewTicker(wsPingInterval)
		defer t.Stop()
		for {
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
		var in ChatMsg
		if err := json.Unmarshal(raw, &in); err != nil {
			_ = p.write(ChatMsg{Type: "reject", Reason: "bad-json"})
			continue
		}
		switch in.Type {
		case "catchup":
			// Client asks for messages newer than `since`. Replay the live ring
			// buffer AND the durable offline backlog (deduped client-side by id).
			for _, m := range p.room.bufferSince(in.Since) {
				_ = p.write(m)
			}
			for _, m := range backlogSince(p.room.ID, in.Since) {
				_ = p.write(m)
			}
		case "msg":
			p.handleChatSend(ctx, in)
		default:
			// Ignore unknown verbs.
		}
	}
}

func (p *ChatPeer) handleChatSend(ctx context.Context, in ChatMsg) {
	if !p.emailOK {
		_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "verify-email"})
		return
	}
	if !p.takeToken() {
		_ = p.write(ChatMsg{Type: "reject", Reason: "rate-limit"})
		return
	}
	if in.ID == "" {
		_ = p.write(ChatMsg{Type: "reject", Reason: "missing-id"})
		return
	}

	if p.room.IsGroup {
		// Groups: plaintext, lexicon-only.
		text := strings.TrimSpace(in.Text)
		if text == "" && !in.HasMedia {
			_ = p.write(ChatMsg{Type: "reject", Reason: "empty"})
			return
		}
		if len([]rune(text)) > groupMaxTextChars {
			_ = p.write(ChatMsg{Type: "reject", Reason: "too-long"})
			return
		}
		if hit := matchLexicon(text); hit != "" {
			_ = p.write(ChatMsg{Type: "reject", Reason: "policy:" + hit})
			return
		}
	} else {
		// DMs (v1): accept either plaintext (`text`) or ciphertext (`ct`).
		// Encryption is deferred to a future phase; for now the server fans
		// out in cleartext but NEVER persists, so the founder's "no message
		// bodies on the server" rule is still met (Firestore stores nothing).
		hasText := strings.TrimSpace(in.Text) != ""
		hasCt := in.Ciphertext != ""
		if !hasText && !hasCt && !in.HasMedia {
			_ = p.write(ChatMsg{Type: "reject", Reason: "empty"})
			return
		}
		if hasText && len([]rune(in.Text)) > groupMaxTextChars {
			_ = p.write(ChatMsg{Type: "reject", Reason: "too-long"})
			return
		}
		if hasCt && len(in.Ciphertext) > dmMaxCiphertextBytes {
			_ = p.write(ChatMsg{Type: "reject", Reason: "too-long"})
			return
		}
	}

	// Op frames must reference a target message; only 'edit' is recognised.
	if in.Op != "" && (in.Op != "edit" || in.TargetID == "") {
		_ = p.write(ChatMsg{Type: "reject", Reason: "bad-op"})
		return
	}

	// Group "only admins post": reject msg frames from non-admins (members
	// keep receiving). Client + Firestore rules enforce too; this closes the
	// raw-WS hole.
	p.room.mu.RLock()
	adminsOnly := p.room.AdminsOnly
	isAdmin := p.room.Admins[p.uid]
	isBanned := p.room.Banned[p.uid]
	noMedia := p.room.NoMedia
	noLinks := p.room.NoLinks
	p.room.mu.RUnlock()
	if isBanned {
		_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "banned"})
		return
	}
	// Platform-wide DM pause (Admin → App Config → Allow direct messages).
	// Squad rooms share this handler and are not direct messages.
	if dmsPaused.Load() && !strings.HasPrefix(p.room.ID, "squad:") {
		_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "dms-paused"})
		return
	}
	if p.room.IsGroup && adminsOnly && !isAdmin {
		_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "admins-only"})
		return
	}
	// Stranger DMs are text-only. Someone you have not followed can reach you,
	// but cannot put a picture in front of you — which is the actual harm in an
	// unsolicited message. Lifted the moment you follow them back.
	if !p.room.IsGroup && p.mediaBlocked() &&
		(in.HasMedia || in.ContentURL != "" || in.VideoURL != "") {
		_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "media-needs-follow"})
		return
	}
	// Granular member permissions. Admins are never restricted — the permissions
	// map governs MEMBERS. The client hides the affordances; this is the gate
	// that actually holds, because a raw WS client can ignore the UI entirely.
	if p.room.IsGroup && !isAdmin {
		if noMedia && (in.HasMedia || in.ContentURL != "" || in.VideoURL != "") {
			_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "media-not-allowed"})
			return
		}
		if noLinks && containsLink(in.Text) {
			_ = p.write(ChatMsg{Type: "reject", ID: in.ID, Reason: "links-not-allowed"})
			return
		}
	}

	out := ChatMsg{
		Type:       "msg",
		ConvoID:    p.room.ID,
		IsGroup:    p.room.IsGroup,
		ID:         in.ID,
		UID:        p.uid,
		Ciphertext: in.Ciphertext,
		Text:       in.Text,
		MediaKind:  in.MediaKind,
		HasMedia:   in.HasMedia,
		ContentURL: in.ContentURL,
		VideoURL:   in.VideoURL,
		Waveform:   in.Waveform,
		ReplyToID:  in.ReplyToID,
		Op:         in.Op,
		TargetID:   in.TargetID,
		TS:         time.Now().UnixMilli(),
	}

	// Fan out to all connected peers (including sender — gives them their ack
	// with the server-stamped TS).
	for _, peer := range p.room.snapshotPeers() {
		_ = peer.write(out)
	}
	p.room.appendBuffer(out)

	// Server-authoritative history (Telegram model): persist the server-stamped
	// frame off the hot path. `edit` op frames update the targeted row's text;
	// every other frame is a new message. Squad rooms are skipped inside
	// persistEnqueue (later scope). No-op when CHAT_PERSIST=0.
	if in.Op == "edit" {
		persistEnqueue("edit", out)
	} else {
		persistEnqueue("msg", out)
	}

	// Offline backlog: if any member other than the sender is not currently
	// connected, hold the frame so they receive it when they next open the
	// conversation (past the 60s ring buffer / after the room is GC'd).
	{
		online := p.room.onlineUIDs()
		p.room.mu.RLock()
		anyOffline := false
		for uid := range p.room.Members {
			if uid != p.uid && !online[uid] {
				anyOffline = true
				break
			}
		}
		p.room.mu.RUnlock()
		if anyOffline {
			backlogEnqueue(p.room.ID, out)
		}
	}

	// Op frames (edits) never push a notification — the original message did.
	if in.Op != "" {
		return
	}

	// Push notification fan-out — fire-and-forget. The Cloud Function decides
	// who to notify (members minus online uids minus sender) and what preview
	// to render (data-only — the SW decrypts locally).
	online := p.room.onlineUIDs()
	p.room.mu.RLock()
	members := make([]string, 0, len(p.room.Members))
	for uid := range p.room.Members {
		members = append(members, uid)
	}
	p.room.mu.RUnlock()
	// Detect squad rooms by the namespaced room id we created in handleSquadWS.
	isSquad := strings.HasPrefix(p.room.ID, "squad:")
	go fireNotifyHook(p.room.ID, p.room.IsGroup && !isSquad, isSquad, p.uid, out.ID, out.MediaKind, out.HasMedia, out.ContentURL, out.Ciphertext, out.Text, members, online)
}

// ============================================================
// Push notify hook (calls a Cloud Function — payload never contains the
// message body, encrypted or otherwise)
// ============================================================

type notifyPayload struct {
	ConvoID    string   `json:"convoId"`
	IsGroup    bool     `json:"isGroup"`
	IsSquad    bool     `json:"isSquad,omitempty"`
	SenderUID  string   `json:"senderUid"`
	MsgID      string   `json:"msgId"`
	MediaKind  string   `json:"mediaKind,omitempty"`
	HasMedia   bool     `json:"hasMedia,omitempty"`
	ContentURL string   `json:"contentUrl,omitempty"` // public R2/CDN URL — lets the push render a photo preview (never persisted)
	Ct         string   `json:"ct,omitempty"`         // DM ciphertext, forwarded to the Cloud Function for SW-side decryption
	Text       string   `json:"text,omitempty"`       // plaintext for groups/squads only
	Members    []string `json:"members"`
	OnlineUIDs []string `json:"onlineUids"`
}

func fireNotifyHook(convoID string, isGroup, isSquad bool, senderUID, msgID, mediaKind string, hasMedia bool, contentURL, ct, text string, members []string, online map[string]bool) {
	if notifyHookURL == "" {
		return
	}
	onl := make([]string, 0, len(online))
	for uid := range online {
		onl = append(onl, uid)
	}
	body, _ := json.Marshal(notifyPayload{
		ConvoID: convoID, IsGroup: isGroup, IsSquad: isSquad,
		SenderUID: senderUID, MsgID: msgID,
		MediaKind: mediaKind, HasMedia: hasMedia, ContentURL: contentURL,
		Ct: ct, Text: text,
		Members: members, OnlineUIDs: onl,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, notifyHookURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if notifyHookKey != "" {
		req.Header.Set("X-Notify-Key", notifyHookKey)
	}
	resp, err := (&http.Client{Timeout: 4 * time.Second}).Do(req)
	if err != nil {
		log.Printf("notify hook err: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		bb, _ := io.ReadAll(resp.Body)
		log.Printf("notify hook %d: %s", resp.StatusCode, string(bb))
	}
}

// peerCounter is declared in main.go (atomic.Int64) and shared across both
// stream-chat Peer and ChatPeer to keep connection ids unique.
