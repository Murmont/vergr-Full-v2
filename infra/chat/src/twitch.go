// Twitch chat bridge for mirrored streams.
//
// When a Vergr stream is a Twitch mirror (streams/{id}.source=='twitch' +
// twitchChannel), we connect to Twitch's IRC-over-WebSocket gateway and bridge
// chat BOTH ways while the Vergr room is occupied:
//
//   Twitch → Vergr: incoming PRIVMSG is fanned out to Vergr peers (src:'twitch').
//   Vergr → Twitch: each Vergr chat message is PRIVMSG'd to the Twitch channel,
//                   sent AS the broadcaster (their chat:edit token from the
//                   server-only twitch_mirror_secrets/{hostUid} doc).
//
// If no usable broadcaster token is present we fall back to an ANONYMOUS read
// connection (Twitch → Vergr still works; Vergr → Twitch is disabled until the
// streamer reconnects Twitch with chat scopes).
//
// No new dependency: Twitch IRC speaks over wss://irc-ws.chat.twitch.tv:443,
// so we reuse gorilla/websocket already vendored for the relay.

package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const twitchIRCURL = "wss://irc-ws.chat.twitch.tv:443"

type TwitchBridge struct {
	channel string // lowercase, no '#'
	room    *Room
	conn    *websocket.Conn
	sendMu  sync.Mutex
	closed  atomic.Bool
	canSend bool
	stopCh  chan struct{}
}

// TwitchNudge is the owner-configured periodic reminder posted in the
// streamer's OWN Twitch chat while their Vergr stream mirrors there
// (14_GROWTH_MIGRATION §4.4). Off unless the stream doc carries an enabled
// twitchNudge config; interval is clamped to ≥10 minutes — their channel +
// their message is within Twitch rules, but spam cadence isn't.
type TwitchNudge struct {
	Text        string
	IntervalMin float64
}

// startTwitchBridge connects + joins, then runs the read loop in a goroutine.
// Returns nil if it can't connect at all (room just won't have a bridge).
func startTwitchBridge(room *Room, hostUID, channel string, nudge *TwitchNudge) *TwitchBridge {
	channel = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(channel), "#"))
	if channel == "" {
		return nil
	}

	// Look up the broadcaster's chat token (optional → anonymous read if absent).
	var token, login string
	if hostUID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		snap, err := fsClient.Collection("twitch_mirror_secrets").Doc(hostUID).Get(ctx)
		cancel()
		if err == nil && snap.Exists() {
			d := snap.Data()
			if v, ok := d["accessToken"].(string); ok {
				token = v
			}
			if v, ok := d["twitchLogin"].(string); ok {
				login = strings.ToLower(v)
			}
		}
	}

	dialer := websocket.Dialer{HandshakeTimeout: 8 * time.Second}
	conn, _, err := dialer.Dial(twitchIRCURL, nil)
	if err != nil {
		log.Printf("twitch bridge: dial failed for #%s: %v", channel, err)
		return nil
	}

	b := &TwitchBridge{channel: channel, room: room, conn: conn, stopCh: make(chan struct{})}

	// Auth: real broadcaster login if we have a token, else anonymous.
	if token != "" && login != "" {
		_ = b.raw("PASS oauth:" + strings.TrimPrefix(token, "oauth:"))
		_ = b.raw("NICK " + login)
		b.canSend = true
	} else {
		_ = b.raw(fmt.Sprintf("NICK justinfan%d", 10000+rand.Intn(89999)))
	}
	_ = b.raw("CAP REQ :twitch.tv/tags twitch.tv/commands")
	_ = b.raw("JOIN #" + channel)

	log.Printf("twitch bridge: joined #%s (canSend=%v)", channel, b.canSend)
	go b.readLoop()

	// Owner-configured nudge: only when the broadcaster token lets us send.
	if nudge != nil && b.canSend {
		interval := time.Duration(nudge.IntervalMin) * time.Minute
		if interval < 10*time.Minute {
			interval = 10 * time.Minute
		}
		go func() {
			t := time.NewTicker(interval)
			defer t.Stop()
			for {
				select {
				case <-b.stopCh:
					return
				case <-t.C:
					b.relayToTwitch("", nudge.Text)
				}
			}
		}()
	}
	return b
}

func (b *TwitchBridge) raw(line string) error {
	b.sendMu.Lock()
	defer b.sendMu.Unlock()
	_ = b.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return b.conn.WriteMessage(websocket.TextMessage, []byte(line+"\r\n"))
}

func (b *TwitchBridge) stop() {
	if b.closed.Swap(true) {
		return
	}
	close(b.stopCh)
	_ = b.conn.Close()
	log.Printf("twitch bridge: left #%s", b.channel)
}

func (b *TwitchBridge) readLoop() {
	defer b.stop()
	for {
		if b.closed.Load() {
			return
		}
		b.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		_, data, err := b.conn.ReadMessage()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(data), "\r\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if strings.HasPrefix(line, "PING") {
				_ = b.raw("PONG :tmi.twitch.tv")
				continue
			}
			if name, text := parsePrivmsg(line); text != "" {
				b.fanIn(name, text)
			}
		}
	}
}

// fanIn pushes a Twitch chat message into the Vergr room.
func (b *TwitchBridge) fanIn(name, text string) {
	if len([]rune(text)) > maxMsgChars {
		text = string([]rune(text)[:maxMsgChars])
	}
	out := Msg{
		Type:   "msg",
		ID:     fmt.Sprintf("tw-%d", time.Now().UnixNano()),
		UID:    "twitch:" + name,
		Name:   name,
		Src:    "twitch",
		Text:   text,
		TS:     time.Now().UnixMilli(),
	}
	for _, p := range b.room.snapshot() {
		_ = p.write(out)
	}
}

// relayToTwitch sends a Vergr chat message out to the Twitch channel, prefixed
// so Twitch viewers can tell it originated on Vergr. No-op if read-only.
func (b *TwitchBridge) relayToTwitch(name, text string) {
	if b == nil || !b.canSend || b.closed.Load() {
		return
	}
	msg := text
	if name != "" {
		msg = name + " (via Vergr): " + text
	}
	// Twitch hard-limits ~500 chars/message.
	if len(msg) > 480 {
		msg = msg[:480]
	}
	_ = b.raw("PRIVMSG #" + b.channel + " :" + msg)
}

// parsePrivmsg extracts the display name + message body from a raw IRC line.
// Handles the IRCv3 tag prefix (display-name=...) and the classic nick prefix.
func parsePrivmsg(line string) (name, text string) {
	idx := strings.Index(line, " PRIVMSG ")
	if idx < 0 {
		return "", ""
	}
	prefix := line[:idx] // tags + source
	rest := line[idx+len(" PRIVMSG "):]

	// Message body is after the first " :" in the remainder.
	colon := strings.Index(rest, " :")
	if colon < 0 {
		return "", ""
	}
	text = rest[colon+2:]

	// Prefer IRCv3 display-name tag.
	if strings.HasPrefix(prefix, "@") {
		for _, tag := range strings.Split(prefix[1:], ";") {
			if strings.HasPrefix(tag, "display-name=") {
				name = strings.TrimPrefix(tag, "display-name=")
				break
			}
		}
	}
	// Fallback: nick from the source `:nick!user@host`.
	if name == "" {
		if at := strings.LastIndex(prefix, ":"); at >= 0 {
			src := prefix[at+1:]
			if bang := strings.Index(src, "!"); bang > 0 {
				name = src[:bang]
			}
		}
	}
	return strings.TrimSpace(name), strings.TrimSpace(text)
}
