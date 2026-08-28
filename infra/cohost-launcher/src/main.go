// VERGR cohost launcher — tiny HTTP service that the Firebase Cloud Function
// `triggerCohostComposite` POSTs to whenever a stream becomes Multi-Guest
// linked / unlinked. We shell out to systemctl to start/stop the templated
// vergr-cohost@<streamId> unit.
//
// Auth: shared bearer token (HOST_OPS_TOKEN env var on box; matching Firebase
// secret on the callable side).
//
// Endpoints:
//   POST /cohost/start  { streamId, streamKey, roomId, hostUid }
//   POST /cohost/stop   { streamId }
//   GET  /healthz
//
// Each `start` writes /etc/vergr-cohost/<streamId>.env containing
// STREAM_KEY / ROOM_ID / HOST_UID, then `systemctl start vergr-cohost@<id>`.
// `stop` runs `systemctl stop` and unlinks the env file.

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	listenAddr = flag.String("listen", "127.0.0.1:8096", "HTTP listen address (proxy via nginx with TLS + bearer auth)")
	envDir     = flag.String("env-dir", "/etc/vergr-cohost", "Directory for per-stream env files")
	unitPrefix = flag.String("unit-prefix", "vergr-cohost@", "Systemd template unit prefix")
	token      = os.Getenv("HOST_OPS_TOKEN")
)

// streamId / streamKey / hostUid must all be safe for filenames + systemd args.
// We allow [a-zA-Z0-9_-] only.
var safe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type startReq struct {
	StreamID  string `json:"streamId"`
	StreamKey string `json:"streamKey"`
	RoomID    string `json:"roomId"`
	HostUID   string `json:"hostUid"`
}
type stopReq struct {
	StreamID string `json:"streamId"`
}

func main() {
	flag.Parse()
	if token == "" {
		log.Fatal("HOST_OPS_TOKEN env var required")
	}
	if err := os.MkdirAll(*envDir, 0o755); err != nil {
		log.Fatalf("mkdir env dir: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("/cohost/start", auth(handleStart))
	mux.HandleFunc("/cohost/stop", auth(handleStop))

	log.Printf("vergr-cohost-launcher listening on %s", *listenAddr)
	if err := http.ListenAndServe(*listenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("Authorization")
		if !strings.HasPrefix(got, "Bearer ") || strings.TrimPrefix(got, "Bearer ") != token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h(w, r)
	}
}

func handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	var req startReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if !safe.MatchString(req.StreamID) || !safe.MatchString(req.StreamKey) ||
		!safe.MatchString(req.RoomID) || !safe.MatchString(req.HostUID) {
		http.Error(w, "bad params", http.StatusBadRequest)
		return
	}

	envPath := filepath.Join(*envDir, req.StreamID+".env")
	contents := fmt.Sprintf("STREAM_KEY=%s\nROOM_ID=%s\nHOST_UID=%s\n", req.StreamKey, req.RoomID, req.HostUID)
	if err := os.WriteFile(envPath, []byte(contents), 0o600); err != nil {
		log.Printf("write env %s: %v", envPath, err)
		http.Error(w, "env write failed", http.StatusInternalServerError)
		return
	}

	unit := *unitPrefix + req.StreamID + ".service"
	cmd := exec.Command("systemctl", "start", unit)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("systemctl start %s: %v\n%s", unit, err, string(out))
		http.Error(w, fmt.Sprintf("start failed: %s", string(out)), http.StatusInternalServerError)
		return
	}
	log.Printf("started %s (host=%s room=%s)", unit, req.HostUID, req.RoomID)
	respondJSON(w, map[string]any{"ok": true, "unit": unit})
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	var req stopReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if !safe.MatchString(req.StreamID) {
		http.Error(w, "bad params", http.StatusBadRequest)
		return
	}
	unit := *unitPrefix + req.StreamID + ".service"
	cmd := exec.Command("systemctl", "stop", unit)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("systemctl stop %s: %v\n%s", unit, err, string(out))
		// Don't 500 — the unit may already be stopped. Just log.
	}
	// Best-effort cleanup of the env file.
	_ = os.Remove(filepath.Join(*envDir, req.StreamID+".env"))
	log.Printf("stopped %s", unit)
	respondJSON(w, map[string]any{"ok": true, "unit": unit})
}

func respondJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
