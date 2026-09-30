// vergr-ops-auth — the lock on the Vergr Admin update channel.
//
// nginx on box 1 serves /ops/ (the admin installer and its update manifest)
// ONLY when this service answers 204 to an auth_request subrequest. It checks a
// short-lived download ticket, nothing else:
//
//	Authorization: VergrOps v2.<scope>.<uid>.<expMs>.<hex HMAC-SHA256(key, "v2.<scope>.<uid>.<expMs>")>
//
// The SCOPE is the app the ticket may download: "admin" for Vergr Admin under
// /ops/admin/, "vanguard" for Vergr Vanguard under /ops/vanguard/. A ticket is
// refused anywhere else, so a moderator cannot fetch the admin console with the
// ticket their own app was given (2026-09-21). The older v1 form
// (v1.<uid>.<expMs>.<sig>) carries no scope and is honoured under /ops/admin/
// ONLY, for Vergr Admin builds that still hold one mid-update.
//
// The ticket is minted by the getMyAdminSecurityStatus callable, and only for
// the operator or an ACTIVE sub-admin (functions/adminSecurity.js). This box
// never sees a Firebase ID token and holds no Firebase credentials: a stolen
// ticket can download a signed installer for 15 minutes and do nothing else,
// while a stolen ID token would be a live admin session. That is why the admin
// sign-in token is NOT what nginx checks.
//
// The key is read once from -key (hex, 32 bytes) and mirrored in Firestore at
// ops_config/update_ticket (server-only: no rule matches that path, so every
// client read is denied). Rotating it = write both, restart this service.
//
// Standard library only, so it builds offline on the box.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var (
	listen  = flag.String("listen", "127.0.0.1:8099", "address nginx auth_request calls")
	keyPath = flag.String("key", "/etc/vergr-ops-auth/key", "hex HMAC key file")
)

// A ticket may not claim to live longer than this, whatever its exp says, so a
// leaked key cannot mint a ticket that stays valid for a year.
const maxTicketLife = 20 * time.Minute

func main() {
	flag.Parse()
	raw, err := os.ReadFile(*keyPath)
	if err != nil {
		log.Fatalf("read key: %v", err)
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) < 32 {
		log.Fatalf("key must be at least 32 bytes of hex")
	}

	http.HandleFunc("/verify", func(w http.ResponseWriter, r *http.Request) {
		if ok, why := validFor(key, r.Header.Get("Authorization"), r.Header.Get("X-Original-URI"), time.Now()); !ok {
			log.Printf("deny: %s (%s)", why, r.Header.Get("X-Original-URI"))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	log.Printf("vergr-ops-auth listening on %s", *listen)
	log.Fatal(http.ListenAndServe(*listen, nil))
}

// validFor checks the ticket AND that its scope matches the path requested.
// The path comes from nginx (X-Original-URI); a request that names no /ops/
// scope at all is refused rather than guessed at.
func validFor(key []byte, header, uri string, now time.Time) (bool, string) {
	scope, ok, why := valid(key, header, now)
	if !ok {
		return false, why
	}
	want := scopeOf(uri)
	if want == "" {
		return false, "no scope in path"
	}
	if scope != want {
		return false, "ticket scope " + scope + " cannot fetch " + want
	}
	return true, ""
}

// scopeOf returns "admin" or "vanguard" for /ops/<scope>/..., else "".
func scopeOf(uri string) string {
	if i := strings.IndexByte(uri, '?'); i >= 0 {
		uri = uri[:i]
	}
	for _, s := range []string{"admin", "vanguard"} {
		if strings.HasPrefix(uri, "/ops/"+s+"/") {
			return s
		}
	}
	return ""
}

// valid returns the ticket's scope and whether the header carries a live,
// correctly signed ticket.
func valid(key []byte, header string, now time.Time) (string, bool, string) {
	const scheme = "VergrOps "
	if !strings.HasPrefix(header, scheme) {
		return "", false, "no ticket"
	}
	parts := strings.Split(strings.TrimPrefix(header, scheme), ".")
	var scope, uid, expStr, sigHex, body string
	switch {
	case len(parts) == 4 && parts[0] == "v1":
		scope, uid, expStr, sigHex = "admin", parts[1], parts[2], parts[3]
		body = parts[0] + "." + parts[1] + "." + parts[2]
	case len(parts) == 5 && parts[0] == "v2" && (parts[1] == "admin" || parts[1] == "vanguard"):
		scope, uid, expStr, sigHex = parts[1], parts[2], parts[3], parts[4]
		body = parts[0] + "." + parts[1] + "." + parts[2] + "." + parts[3]
	default:
		return "", false, "malformed"
	}
	if uid == "" {
		return "", false, "malformed"
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", false, "bad exp"
	}
	nowMs := now.UnixMilli()
	if exp <= nowMs {
		return "", false, "expired"
	}
	if exp-nowMs > maxTicketLife.Milliseconds() {
		return "", false, "exp too far out"
	}
	got, err := hex.DecodeString(sigHex)
	if err != nil {
		return "", false, "bad sig encoding"
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(body))
	if !hmac.Equal(got, mac.Sum(nil)) {
		return "", false, "bad sig"
	}
	return scope, true, ""
}
