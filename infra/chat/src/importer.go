// Bulk-import entry for the community-import engine (Discord Phase 2 /
// WhatsApp export). The worker (infra/community-import, same box) POSTs
// batches of historical rows here; they go straight into the SQLite store
// with their ORIGINAL timestamps and an `imported` author blob.
//
// Deliberately NOT live traffic: no WS fan-out, no fireNotifyHook, no backlog,
// no conversation-metadata bump — an import must never light up inboxes or
// fire pushes for thousands of historical messages.
//
// Security: this route has NO nginx location block (the chat.vergr.app vhost
// proxies explicit paths only), so it is unreachable from the internet. On top
// of that we require loopback/private-net RemoteAddr AND a shared bearer token
// (CHAT_IMPORT_TOKEN env), so a future nginx misconfig can't expose it.
//
//   POST /internal/import  { convoId, rows: [ImportRow...] }  → { ok, inserted }
//   POST /internal/claim   { convoId, authorId, uid }         → { ok, updated }

package main

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
)

func importAuthOK(r *http.Request) bool {
	token := os.Getenv("CHAT_IMPORT_TOKEN")
	if token == "" {
		return false // unconfigured = closed
	}
	if r.Header.Get("Authorization") != "Bearer "+token {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

type importBody struct {
	ConvoID string      `json:"convoId"`
	Rows    []ImportRow `json:"rows"`
}

func handleInternalImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !importAuthOK(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body importBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if body.ConvoID == "" || len(body.Rows) == 0 || len(body.Rows) > 500 {
		http.Error(w, "convoId + 1..500 rows required", http.StatusBadRequest)
		return
	}
	n, err := bulkInsertImported(body.ConvoID, body.Rows)
	if err != nil {
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "inserted": n})
}

type claimBody struct {
	ConvoID  string `json:"convoId"`
	AuthorID string `json:"authorId"`
	UID      string `json:"uid"`
}

func handleInternalClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !importAuthOK(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body claimBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if body.ConvoID == "" || body.AuthorID == "" || body.UID == "" {
		http.Error(w, "convoId + authorId + uid required", http.StatusBadRequest)
		return
	}
	n, err := claimImportedRows(body.ConvoID, body.AuthorID, body.UID)
	if err != nil {
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "updated": n})
}
