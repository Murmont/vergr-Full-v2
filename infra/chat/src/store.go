// SQLite-backed chat history store (Telegram-model server storage).
//
// Founder direction (HANDOFF_CHAT_SERVER_STORE.md, 2026-06-12): DM + group chat
// history moves from device-only (Dexie + 7-day relay backlog) to
// server-authoritative storage. This REVERSES the old "no message bodies on the
// server" mandate by founder decision. Chats stay PRIVATE + unmoderated (no
// Gemini on DMs/groups). Bodies are stored plaintext at rest; see the risk note
// in the handoff.
//
// Zero-cost: storage = SQLite on box 1 disk (already paid), durability =
// Litestream → R2 (A3, separate systemd unit). NO Firestore message docs.
//
// Hot-path safety: the WS fan-out NEVER blocks on disk. Inserts/edits are handed
// to a buffered channel drained by a single writer goroutine (modernc.org/sqlite
// is pure Go — no CGO, the box builds with plain `go build`).
//
// Scope this session (A1): persist `msg` + `edit` frames, healthz dbOk, kill
// switch. The read/ops helpers (history, hidden, reactions, deleteForEveryone)
// are the data layer for the A2 HTTP API and are included here so A2 is pure
// HTTP glue. Squad rooms (convoId prefixed "squad:") are intentionally NOT
// persisted yet — squad migration is later scope.

package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync/atomic"

	_ "modernc.org/sqlite"
)

var (
	chatDB         *sql.DB
	persistCh      chan persistOp
	persistEnabled bool
	persistDropped atomic.Int64
)

type persistOp struct {
	kind string // "msg" | "edit"
	m    ChatMsg
}

const chatSchema = `
CREATE TABLE IF NOT EXISTS messages (
  convo_id    TEXT NOT NULL,
  id          TEXT NOT NULL,
  sender_uid  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  text        TEXT DEFAULT '',
  media_kind  TEXT DEFAULT '',
  content_url TEXT DEFAULT '',
  video_url   TEXT DEFAULT '',
  waveform    TEXT DEFAULT '',
  reply_to    TEXT DEFAULT '',
  edited_ts   INTEGER DEFAULT 0,
  deleted     INTEGER DEFAULT 0,
  PRIMARY KEY (convo_id, id)
);
CREATE INDEX IF NOT EXISTS idx_msgs_convo_ts ON messages(convo_id, ts);
CREATE TABLE IF NOT EXISTS hidden (
  convo_id  TEXT NOT NULL,
  uid       TEXT NOT NULL,
  before_ts INTEGER NOT NULL,
  PRIMARY KEY (convo_id, uid)
);
CREATE TABLE IF NOT EXISTS reactions (
  convo_id TEXT NOT NULL,
  msg_id   TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  uid      TEXT NOT NULL,
  PRIMARY KEY (convo_id, msg_id, emoji, uid)
);
CREATE TABLE IF NOT EXISTS pending_gc (
  url TEXT NOT NULL,
  ts  INTEGER NOT NULL
);
`

// initStore opens the DB, applies the schema, and starts the writer goroutine.
// Disabled (no-op, relay keeps relaying) when CHAT_PERSIST=0.
func initStore() error {
	persistEnabled = os.Getenv("CHAT_PERSIST") != "0"
	if !persistEnabled {
		log.Printf("chat persistence DISABLED (CHAT_PERSIST=0) — relay-only, no history store")
		return nil
	}
	path := os.Getenv("CHAT_DB_PATH")
	if path == "" {
		path = "/opt/vergr-chat/chat.db"
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			return err
		}
	}
	if _, err := db.Exec(chatSchema); err != nil {
		return err
	}
	// Additive migration: `imported` carries the original-author JSON for rows
	// bulk-inserted by the community-import engine ('' for live messages).
	if !columnExists(db, "messages", "imported") {
		if _, err := db.Exec(`ALTER TABLE messages ADD COLUMN imported TEXT DEFAULT ''`); err != nil {
			return err
		}
	}
	chatDB = db
	persistCh = make(chan persistOp, 4096)
	go persistWriter()
	log.Printf("chat persistence ENABLED at %s", path)
	return nil
}

func columnExists(db *sql.DB, table, col string) bool {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false
		}
		if name == col {
			return true
		}
	}
	return false
}

func persistWriter() {
	for op := range persistCh {
		switch op.kind {
		case "msg":
			insertMessage(op.m)
		case "edit":
			updateEditedText(op.m)
		}
	}
}

// persistEnqueue is called from the WS hot path. Non-blocking: if the buffer is
// full we drop and count rather than stall fan-out (4096 deep — effectively
// never under real load).
func persistEnqueue(kind string, m ChatMsg) {
	if !persistEnabled || persistCh == nil {
		return
	}
	if strings.HasPrefix(m.ConvoID, "squad:") {
		return // squad rooms not persisted this phase
	}
	select {
	case persistCh <- persistOp{kind: kind, m: m}:
	default:
		n := persistDropped.Add(1)
		log.Printf("chat persist buffer full, dropped %s %s/%s (total dropped %d)", kind, m.ConvoID, m.ID, n)
	}
}

func insertMessage(m ChatMsg) {
	wf := ""
	if len(m.Waveform) > 0 {
		if b, err := json.Marshal(m.Waveform); err == nil {
			wf = string(b)
		}
	}
	// Body is plaintext for v1 (Telegram model). If only ciphertext is present
	// (legacy client), fall back to storing it so history isn't silently empty.
	text := m.Text
	if text == "" && m.Ciphertext != "" {
		text = m.Ciphertext
	}
	_, err := chatDB.Exec(
		`INSERT OR IGNORE INTO messages
		 (convo_id,id,sender_uid,ts,text,media_kind,content_url,video_url,waveform,reply_to)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		m.ConvoID, m.ID, m.UID, m.TS, text, m.MediaKind, m.ContentURL, m.VideoURL, wf, m.ReplyToID,
	)
	if err != nil {
		log.Printf("insertMessage %s/%s: %v", m.ConvoID, m.ID, err)
	}
}

// updateEditedText applies an `edit` op frame: new text + edit timestamp on the
// targeted row. No-op if the row doesn't exist yet (insert may still be queued
// ahead of it — rare; the client re-syncs from /history regardless).
func updateEditedText(m ChatMsg) {
	_, err := chatDB.Exec(
		`UPDATE messages SET text=?, edited_ts=? WHERE convo_id=? AND id=? AND deleted=0`,
		m.Text, m.TS, m.ConvoID, m.TargetID,
	)
	if err != nil {
		log.Printf("updateEditedText %s/%s: %v", m.ConvoID, m.TargetID, err)
	}
}

// ============================================================
// Read / ops data layer (used by the A2 HTTP API)
// ============================================================

// HistoryRow is the JSON shape returned by GET /history. Deleted rows come back
// as tombstone stubs (text/urls already nulled at delete time).
type HistoryRow struct {
	ID         string `json:"id"`
	SenderUID  string `json:"uid,omitempty"`
	TS         int64  `json:"ts"`
	Text       string `json:"text,omitempty"`
	MediaKind  string `json:"mediaKind,omitempty"`
	ContentURL string `json:"contentUrl,omitempty"`
	VideoURL   string `json:"videoUrl,omitempty"`
	Waveform   []int  `json:"waveform,omitempty"`
	ReplyToID  string `json:"replyToId,omitempty"`
	EditedTS   int64  `json:"editedTs,omitempty"`
	Deleted    bool   `json:"deleted,omitempty"`
	// Original-author metadata for bulk-imported history (community-import
	// engine): {"name","avatar","source","authorId"}. Empty for live messages.
	Imported json.RawMessage `json:"imported,omitempty"`
}

// queryHistory returns rows for convoID visible to callerUID, newest-bound by
// `before` (exclusive) and `after` (exclusive), capped at limit. Rows older than
// the caller's hidden watermark are excluded entirely. Deleted rows are returned
// as tombstone stubs so clients can purge their local cache.
func queryHistory(convoID, callerUID string, before, after int64, limit int) ([]HistoryRow, error) {
	if chatDB == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	var hiddenBefore int64
	_ = chatDB.QueryRow(`SELECT before_ts FROM hidden WHERE convo_id=? AND uid=?`, convoID, callerUID).Scan(&hiddenBefore)

	q := `SELECT id,sender_uid,ts,text,media_kind,content_url,video_url,waveform,reply_to,edited_ts,deleted,imported
	      FROM messages WHERE convo_id=? AND ts>?`
	args := []interface{}{convoID, hiddenBefore}
	if before > 0 {
		q += ` AND ts<?`
		args = append(args, before)
	}
	if after > 0 {
		q += ` AND ts>?`
		args = append(args, after)
	}
	q += ` ORDER BY ts DESC LIMIT ?`
	args = append(args, limit)

	rows, err := chatDB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistoryRow{}
	for rows.Next() {
		var r HistoryRow
		var wf, imported string
		var deleted int
		if err := rows.Scan(&r.ID, &r.SenderUID, &r.TS, &r.Text, &r.MediaKind, &r.ContentURL, &r.VideoURL, &wf, &r.ReplyToID, &r.EditedTS, &deleted, &imported); err != nil {
			return nil, err
		}
		if deleted == 1 {
			out = append(out, HistoryRow{ID: r.ID, TS: r.TS, Deleted: true})
			continue
		}
		if wf != "" {
			_ = json.Unmarshal([]byte(wf), &r.Waveform)
		}
		if imported != "" && json.Valid([]byte(imported)) {
			r.Imported = json.RawMessage(imported)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// queryReactions returns emoji→[uids] for the given message ids in one scan.
func queryReactions(convoID string, msgIDs []string) (map[string]map[string][]string, error) {
	res := map[string]map[string][]string{}
	if chatDB == nil || len(msgIDs) == 0 {
		return res, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(msgIDs)), ",")
	args := make([]interface{}, 0, len(msgIDs)+1)
	args = append(args, convoID)
	for _, id := range msgIDs {
		args = append(args, id)
	}
	rows, err := chatDB.Query(
		`SELECT msg_id,emoji,uid FROM reactions WHERE convo_id=? AND msg_id IN (`+ph+`)`, args...)
	if err != nil {
		return res, err
	}
	defer rows.Close()
	for rows.Next() {
		var msgID, emoji, uid string
		if err := rows.Scan(&msgID, &emoji, &uid); err != nil {
			return res, err
		}
		if res[msgID] == nil {
			res[msgID] = map[string][]string{}
		}
		res[msgID][emoji] = append(res[msgID][emoji], uid)
	}
	return res, rows.Err()
}

// hiddenWatermark returns the caller's per-user clear/delete-chat watermark
// (0 if none). Returned to clients so EVERY device can converge: a device that
// didn't perform the clear still purges its local cache of anything at/below it.
func hiddenWatermark(convoID, uid string) int64 {
	if chatDB == nil {
		return 0
	}
	var ts int64
	_ = chatDB.QueryRow(`SELECT before_ts FROM hidden WHERE convo_id=? AND uid=?`, convoID, uid).Scan(&ts)
	return ts
}

// messageSender returns the stored sender uid for a message (for the
// deleteForEveryone sender-only authorization check).
func messageSender(convoID, msgID string) (string, bool) {
	if chatDB == nil {
		return "", false
	}
	var uid string
	if err := chatDB.QueryRow(`SELECT sender_uid FROM messages WHERE convo_id=? AND id=?`, convoID, msgID).Scan(&uid); err != nil {
		return "", false
	}
	return uid, true
}

// markDeletedForEveryone tombstones a message and copies its media URLs into
// pending_gc for the weekly R2 cleanup (A4).
func markDeletedForEveryone(convoID, msgID string) error {
	if chatDB == nil {
		return nil
	}
	var contentURL, videoURL string
	_ = chatDB.QueryRow(`SELECT content_url,video_url FROM messages WHERE convo_id=? AND id=?`, convoID, msgID).
		Scan(&contentURL, &videoURL)
	for _, u := range []string{contentURL, videoURL} {
		if u != "" {
			if _, err := chatDB.Exec(`INSERT INTO pending_gc (url,ts) VALUES (?, (strftime('%s','now')*1000))`, u); err != nil {
				log.Printf("pending_gc insert: %v", err)
			}
		}
	}
	_, err := chatDB.Exec(
		`UPDATE messages SET deleted=1, text='', content_url='', video_url='', waveform='' WHERE convo_id=? AND id=?`,
		convoID, msgID)
	return err
}

// queueConvoMediaForGC tombstones every live message in a conversation and
// queues its media for R2 cleanup. Used by deleteChatForAll ("Also delete for
// X"): both participants lose the history, so nobody can ever reach those
// objects again — without this they sat in R2 forever, unreachable but still
// billed for storage.
//
// The bodies are nulled (not just hidden behind a watermark) for two reasons:
// "delete for everyone" should not leave text/media columns in the store, and
// the GC's reference check treats a LIVE (deleted=0) row referencing a url as
// a reason to KEEP the object.
func queueConvoMediaForGC(convoID string) error {
	if chatDB == nil {
		return nil
	}
	rows, err := chatDB.Query(
		`SELECT content_url, video_url FROM messages WHERE convo_id=? AND deleted=0`, convoID)
	if err != nil {
		return err
	}
	var urls []string
	for rows.Next() {
		var c, v string
		if err := rows.Scan(&c, &v); err != nil {
			continue
		}
		if c != "" {
			urls = append(urls, c)
		}
		if v != "" {
			urls = append(urls, v)
		}
	}
	// Close the cursor BEFORE writing — an open read cursor plus a write on the
	// same sqlite connection is how you deadlock this.
	rows.Close()

	for _, u := range urls {
		if _, err := chatDB.Exec(
			`INSERT INTO pending_gc (url,ts) VALUES (?, (strftime('%s','now')*1000))`, u); err != nil {
			log.Printf("queueConvoMediaForGC pending_gc insert: %v", err)
		}
	}
	if _, err := chatDB.Exec(
		`UPDATE messages SET deleted=1, text='', content_url='', video_url='', waveform='' WHERE convo_id=? AND deleted=0`,
		convoID); err != nil {
		return err
	}
	log.Printf("queueConvoMediaForGC: convo=%s queued=%d objects", convoID, len(urls))
	return nil
}

// setHiddenWatermark upserts the per-user hidden watermark (Clear/Delete chat
// for me). Only ever raises it.
func setHiddenWatermark(convoID, uid string, beforeTS int64) error {
	if chatDB == nil {
		return nil
	}
	_, err := chatDB.Exec(
		`INSERT INTO hidden (convo_id,uid,before_ts) VALUES (?,?,?)
		 ON CONFLICT(convo_id,uid) DO UPDATE SET before_ts=MAX(before_ts,excluded.before_ts)`,
		convoID, uid, beforeTS)
	return err
}

// setReaction adds or removes a reaction row.
func setReaction(convoID, msgID, emoji, uid string, on bool) error {
	if chatDB == nil {
		return nil
	}
	if on {
		_, err := chatDB.Exec(
			`INSERT OR IGNORE INTO reactions (convo_id,msg_id,emoji,uid) VALUES (?,?,?,?)`,
			convoID, msgID, emoji, uid)
		return err
	}
	_, err := chatDB.Exec(
		`DELETE FROM reactions WHERE convo_id=? AND msg_id=? AND emoji=? AND uid=?`,
		convoID, msgID, emoji, uid)
	return err
}

// purgeExpired HARD-deletes every message in convoID at or older than cutoffTS
// (disappearing messages / auto-delete). Unlike markDeletedForEveryone this
// leaves no tombstone: the point of the feature is that the row is gone. Media
// urls are queued into pending_gc first so the R2 objects get cleaned up too —
// deleting the row without that would orphan the file forever.
func purgeExpired(convoID string, cutoffTS int64) (int64, error) {
	if chatDB == nil {
		return 0, nil
	}
	rows, err := chatDB.Query(
		`SELECT content_url, video_url FROM messages
		 WHERE convo_id=? AND ts<=? AND (content_url!='' OR video_url!='')`,
		convoID, cutoffTS)
	if err != nil {
		return 0, err
	}
	urls := []string{}
	for rows.Next() {
		var c, v string
		if err := rows.Scan(&c, &v); err != nil {
			rows.Close()
			return 0, err
		}
		for _, u := range []string{c, v} {
			if u != "" {
				urls = append(urls, u)
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, u := range urls {
		if _, err := chatDB.Exec(
			`INSERT INTO pending_gc (url,ts) VALUES (?, (strftime('%s','now')*1000))`, u); err != nil {
			log.Printf("purgeExpired pending_gc insert: %v", err)
		}
	}

	res, err := chatDB.Exec(`DELETE FROM messages WHERE convo_id=? AND ts<=?`, convoID, cutoffTS)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	// Reactions on those messages are dead weight now.
	if n > 0 {
		if _, err := chatDB.Exec(
			`DELETE FROM reactions WHERE convo_id=? AND msg_id NOT IN
			 (SELECT id FROM messages WHERE convo_id=?)`, convoID, convoID); err != nil {
			log.Printf("purgeExpired reactions: %v", err)
		}
	}
	return n, nil
}

// ImportRow is one bulk-imported historical message (community-import engine:
// Discord Phase 2 / WhatsApp export). Inserted with its ORIGINAL timestamp and
// an `imported` JSON blob carrying the original author identity. NO fan-out,
// NO notify, NO backlog — this is history, not live traffic.
type ImportRow struct {
	ID         string          `json:"id"`
	SenderUID  string          `json:"senderUid,omitempty"` // mapped Vergr uid when the original author has linked their account
	TS         int64           `json:"ts"`
	Text       string          `json:"text,omitempty"`
	MediaKind  string          `json:"mediaKind,omitempty"`
	ContentURL string          `json:"contentUrl,omitempty"`
	VideoURL   string          `json:"videoUrl,omitempty"`
	Imported   json.RawMessage `json:"imported"`
}

// bulkInsertImported inserts a batch of historical rows in one transaction.
// INSERT OR IGNORE keyed on (convo_id,id) makes re-runs of the same import
// idempotent (the worker derives ids from the source message identity).
func bulkInsertImported(convoID string, rows []ImportRow) (int64, error) {
	if chatDB == nil {
		return 0, nil
	}
	tx, err := chatDB.Begin()
	if err != nil {
		return 0, err
	}
	stmt, err := tx.Prepare(
		`INSERT OR IGNORE INTO messages
		 (convo_id,id,sender_uid,ts,text,media_kind,content_url,video_url,imported)
		 VALUES (?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	var inserted int64
	for _, r := range rows {
		if r.ID == "" || r.TS <= 0 {
			continue
		}
		imp := ""
		if len(r.Imported) > 0 && json.Valid(r.Imported) {
			imp = string(r.Imported)
		}
		res, err := stmt.Exec(convoID, r.ID, r.SenderUID, r.TS, r.Text, r.MediaKind, r.ContentURL, r.VideoURL, imp)
		if err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted += n
		}
	}
	_ = stmt.Close()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return inserted, nil
}

// claimImportedRows reassigns imported rows whose imported.authorId matches to
// a real Vergr uid (the phone-claim / account-link flow). Only touches rows
// that are still unclaimed.
func claimImportedRows(convoID, authorID, uid string) (int64, error) {
	if chatDB == nil || authorID == "" || uid == "" {
		return 0, nil
	}
	res, err := chatDB.Exec(
		`UPDATE messages SET sender_uid=?
		 WHERE convo_id=? AND sender_uid='' AND imported!=''
		   AND json_extract(imported,'$.authorId')=?`,
		uid, convoID, authorID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// storeRowCount + storeOK back the healthz dbOk field.
func storeOK() (bool, int64) {
	if !persistEnabled {
		return true, -1 // disabled is a healthy state, not a failure
	}
	if chatDB == nil {
		return false, 0
	}
	var n int64
	if err := chatDB.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&n); err != nil {
		return false, 0
	}
	return true, n
}
