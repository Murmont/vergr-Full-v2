// Global cross-chat message search (02_MESSAGING 2.4).
//
//   GET /search?token=<idToken>&q=<query>&limit=<n≤50>
//
// The relay owns the message bodies (SQLite, store.go), so search HAS to live
// here — Firestore has no message docs to query. Same Firebase-ID-token auth as
// /history and /ops.
//
// Authorization model (the part that matters): a search spans MANY rooms, so
// unlike /history there's no single convoId to check membership against.
// Instead we resolve the caller's rooms from Firestore (the source of truth for
// membership) and constrain the SQL to exactly those convo_ids. A room the
// caller isn't in can never appear in the result set, even if the query text
// matches a message in it.
//
// Engine note: this is a LIKE scan, NOT FTS. modernc.org/sqlite is a pure-Go
// transpile and enabling FTS5 there is not a given, so v1 deliberately does the
// boring thing: the (convo_id, ts) index narrows to the caller's rooms and the
// scan runs over that slice. At current scale that is far below the noise floor.
// If message volume ever makes this slow, the upgrade path is an FTS5 virtual
// table mirrored on insert — the HTTP shape below does not have to change.

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/api/iterator"
)

const (
	maxSearchConvos  = 200 // rooms scanned per search
	maxSearchResults = 50
	minSearchQuery   = 2
	convoCacheTTL    = 60 * time.Second
)

// A search costs one Firestore query (the caller's conversation list). Searches
// are user-typed and debounced client-side, but a cache keeps a burst of
// keystrokes from re-reading the same list every time.
type convoListEntry struct {
	ids      []string
	cachedAt time.Time
}

var (
	convoListCache   = map[string]convoListEntry{}
	convoListCacheMu sync.Mutex
)

// callerConvoIDs returns the conversation ids the uid is a participant of.
// Squad rooms are skipped: persistEnqueue never stores them, so they'd always
// match nothing.
func callerConvoIDs(ctx context.Context, uid string) ([]string, error) {
	convoListCacheMu.Lock()
	if e, ok := convoListCache[uid]; ok && time.Since(e.cachedAt) < convoCacheTTL {
		convoListCacheMu.Unlock()
		return e.ids, nil
	}
	convoListCacheMu.Unlock()

	iter := fsClient.Collection("conversations").
		Where("participants", "array-contains", uid).
		Limit(maxSearchConvos).Documents(ctx)
	defer iter.Stop()

	ids := []string{}
	for {
		snap, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		if strings.HasPrefix(snap.Ref.ID, "squad:") {
			continue
		}
		ids = append(ids, snap.Ref.ID)
	}

	convoListCacheMu.Lock()
	convoListCache[uid] = convoListEntry{ids: ids, cachedAt: time.Now()}
	convoListCacheMu.Unlock()
	return ids, nil
}

// escapeLike neutralizes the LIKE wildcards so a user typing "100%" searches for
// the literal string rather than matching every message.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

// SearchRow is one hit. The client already knows how to render a chat row, so
// we return just enough to show it and deep-link into the thread.
type SearchRow struct {
	ConvoID   string `json:"convoId"`
	ID        string `json:"id"`
	SenderUID string `json:"uid,omitempty"`
	TS        int64  `json:"ts"`
	Text      string `json:"text,omitempty"`
	MediaKind string `json:"mediaKind,omitempty"`
}

// searchMessages runs the scan across the caller's rooms.
//
// Per-room "clear chat" watermarks are honoured via the LEFT JOIN on `hidden`:
// a message the caller has cleared must not resurface in search. Tombstoned
// (deleted-for-everyone) rows are excluded outright.
func searchMessages(uid string, convoIDs []string, q string, limit int) ([]SearchRow, error) {
	out := []SearchRow{}
	if chatDB == nil || len(convoIDs) == 0 {
		return out, nil
	}
	if limit <= 0 || limit > maxSearchResults {
		limit = maxSearchResults
	}

	ph := strings.TrimSuffix(strings.Repeat("?,", len(convoIDs)), ",")
	args := make([]interface{}, 0, len(convoIDs)+3)
	args = append(args, uid) // hidden join
	for _, id := range convoIDs {
		args = append(args, id)
	}
	args = append(args, "%"+escapeLike(q)+"%", limit)

	rows, err := chatDB.Query(
		`SELECT m.convo_id, m.id, m.sender_uid, m.ts, m.text, m.media_kind
		 FROM messages m
		 LEFT JOIN hidden h ON h.convo_id = m.convo_id AND h.uid = ?
		 WHERE m.convo_id IN (`+ph+`)
		   AND m.deleted = 0
		   AND m.ts > COALESCE(h.before_ts, 0)
		   AND m.text LIKE ? ESCAPE '\'
		 ORDER BY m.ts DESC
		 LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SearchRow
		if err := rows.Scan(&r.ConvoID, &r.ID, &r.SenderUID, &r.TS, &r.Text, &r.MediaKind); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GET /search
func handleSearch(w http.ResponseWriter, r *http.Request) {
	if setCORS(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < minSearchQuery {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"results": []SearchRow{}})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	convoIDs, err := callerConvoIDs(r.Context(), t.UID)
	if err != nil {
		log.Printf("search: convo list for %s: %v", t.UID, err)
		http.Error(w, "lookup error", http.StatusInternalServerError)
		return
	}

	results, err := searchMessages(t.UID, convoIDs, q, limit)
	if err != nil {
		log.Printf("search: query err: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"results": results})
}
