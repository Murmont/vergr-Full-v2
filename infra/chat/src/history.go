// Chat history + ops HTTP API (Telegram-model server storage, A2).
//
//   GET  /history/{convoId}?token=<id>&before=<ms>&after=<ms>&limit=<n≤100>
//   POST /ops/{convoId}?token=<id>     JSON body { op, ... }
//
// Both authenticate with the same Firebase ID token as the WS endpoints and
// gate on conversation membership (reusing loadConversationMembership, cache
// included). These are plain cross-origin fetches from the web/native clients,
// so CORS preflight is handled here (the WS endpoints don't need it).
//
// The actual reads/writes live in store.go; this file is HTTP glue + auth +
// the relay fan-out that lets online clients see reactions/deletes live.

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// setCORS echoes an allow-listed origin and the methods/headers the client
// needs. Returns true if the request was an OPTIONS preflight (already answered).
func setCORS(w http.ResponseWriter, r *http.Request) (preflight bool) {
	o := r.Header.Get("Origin")
	if originAllowed(o) && o != "" {
		w.Header().Set("Access-Control-Allow-Origin", o)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "600")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// authConvo verifies the token and membership for a /history|/ops request.
// Writes the appropriate error response and returns ok=false on failure.
func authConvo(w http.ResponseWriter, r *http.Request, convoID string) (uid string, me membershipEntry, ok bool) {
	if convoID == "" || strings.Contains(convoID, "/") {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	t, err := authClient.VerifyIDToken(r.Context(), token)
	if err != nil {
		http.Error(w, "bad token", http.StatusUnauthorized)
		return
	}
	me, err = loadConversationMembership(r.Context(), convoID)
	if err != nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}
	if !me.members[t.UID] {
		http.Error(w, "not a participant", http.StatusForbidden)
		return
	}
	return t.UID, me, true
}

// GET /history/{convoId}
func handleHistory(w http.ResponseWriter, r *http.Request) {
	if setCORS(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	convoID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/history/"), "/")
	uid, _, ok := authConvo(w, r, convoID)
	if !ok {
		return
	}

	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	rows, err := queryHistory(convoID, uid, before, after, limit)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if !row.Deleted {
			ids = append(ids, row.ID)
		}
	}
	reactions, _ := queryReactions(convoID, ids)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"messages":     rows,
		"reactions":    reactions,
		"hiddenBefore": hiddenWatermark(convoID, uid),
	})
}

type opsBody struct {
	Op       string `json:"op"`
	ID       string `json:"id,omitempty"`       // target message id
	BeforeTS int64  `json:"beforeTs,omitempty"` // deleteForMe watermark
	Emoji    string `json:"emoji,omitempty"`    // react
	On       bool   `json:"on,omitempty"`       // react add/remove
	AlsoFor  bool   `json:"alsoFor,omitempty"`  // deleteChatForAll confirmation
}

// POST /ops/{convoId}
func handleOps(w http.ResponseWriter, r *http.Request) {
	if setCORS(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	convoID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/ops/"), "/")
	uid, me, ok := authConvo(w, r, convoID)
	if !ok {
		return
	}

	var body opsBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	now := time.Now().UnixMilli()
	switch body.Op {
	case "deleteForEveryone":
		if body.ID == "" {
			http.Error(w, "missing id", http.StatusBadRequest)
			return
		}
		// Sender-only, or a group admin.
		sender, found := messageSender(convoID, body.ID)
		isAdmin := me.isGroup && me.admins[uid]
		if !found || (sender != uid && !isAdmin) {
			http.Error(w, "not allowed", http.StatusForbidden)
			return
		}
		if err := markDeletedForEveryone(convoID, body.ID); err != nil {
			http.Error(w, "store error", http.StatusInternalServerError)
			return
		}
		// Propagate to online clients (offline clients get the tombstone stub
		// from /history). Old APK 1.0.44 clients ignore the unknown op.
		fanoutChatFrame(convoID, ChatMsg{
			Type: "msg", Op: "delete", ConvoID: convoID, TargetID: body.ID, UID: uid, TS: now,
		})

	case "deleteForMe":
		// Covers Clear Chat AND Delete Chat (for me). 0 = clear everything up to now.
		before := body.BeforeTS
		if before <= 0 {
			before = now
		}
		if err := setHiddenWatermark(convoID, uid, before); err != nil {
			http.Error(w, "store error", http.StatusInternalServerError)
			return
		}

	case "deleteChatForAll":
		// Telegram "Also delete for X" — 1:1 DMs only. Hide all rows for BOTH
		// participants.
		if me.isGroup {
			http.Error(w, "group not allowed", http.StatusBadRequest)
			return
		}
		for member := range me.members {
			if err := setHiddenWatermark(convoID, member, now); err != nil {
				http.Error(w, "store error", http.StatusInternalServerError)
				return
			}
		}
		// Nobody can reach this history again, so release its media instead of
		// leaving the R2 objects orphaned forever. Best-effort: a GC failure
		// must never fail the user's delete.
		if err := queueConvoMediaForGC(convoID); err != nil {
			log.Printf("deleteChatForAll queueConvoMediaForGC: %v", err)
		}

	case "react":
		if body.ID == "" || body.Emoji == "" {
			http.Error(w, "missing id/emoji", http.StatusBadRequest)
			return
		}
		if err := setReaction(convoID, body.ID, body.Emoji, uid, body.On); err != nil {
			http.Error(w, "store error", http.StatusInternalServerError)
			return
		}
		fanoutChatFrame(convoID, ChatMsg{
			Type: "msg", Op: "react", ConvoID: convoID,
			TargetID: body.ID, Emoji: body.Emoji, UID: uid, On: body.On, TS: now,
		})

	default:
		http.Error(w, "unknown op", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "ts": now})
}
