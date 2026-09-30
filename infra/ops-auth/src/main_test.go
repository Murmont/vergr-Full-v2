package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"testing"
	"time"
)

func sign(key []byte, uid string, exp int64) string {
	body := "v1." + uid + "." + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(body))
	return "VergrOps " + body + "." + hex.EncodeToString(mac.Sum(nil))
}

func signV2(key []byte, scope, uid string, exp int64) string {
	body := "v2." + scope + "." + uid + "." + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(body))
	return "VergrOps " + body + "." + hex.EncodeToString(mac.Sum(nil))
}

func TestValidFor(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	other := make([]byte, 32)
	now := time.UnixMilli(1_800_000_000_000)
	exp := now.Add(15 * time.Minute).UnixMilli()
	const adm = "/ops/admin/latest.json"
	const vg = "/ops/vanguard/latest.json"

	cases := []struct {
		name   string
		header string
		uri    string
		want   bool
	}{
		{"v1 admin ticket, admin path (control)", sign(key, "abc", exp), adm, true},
		{"v2 admin ticket, admin path (control)", signV2(key, "admin", "abc", exp), adm, true},
		{"v2 vanguard ticket, vanguard path (control)", signV2(key, "vanguard", "abc", exp), vg + "?x=1", true},
		{"v2 vanguard ticket cannot fetch admin", signV2(key, "vanguard", "abc", exp), adm, false},
		{"v2 admin ticket cannot fetch vanguard", signV2(key, "admin", "abc", exp), vg, false},
		{"v1 ticket cannot fetch vanguard", sign(key, "abc", exp), vg, false},
		{"scope retagged after signing", strings.Replace(signV2(key, "vanguard", "abc", exp), "v2.vanguard.", "v2.admin.", 1), adm, false},
		{"unknown scope", signV2(key, "root", "abc", exp), adm, false},
		{"path with no scope", signV2(key, "admin", "abc", exp), "/ops/latest.json", false},
		{"no header", "", adm, false},
		{"bearer token instead", "Bearer " + sign(key, "abc", exp)[9:], adm, false},
		{"wrong key", signV2(other, "admin", "abc", exp), adm, false},
		{"expired", signV2(key, "admin", "abc", now.Add(-time.Second).UnixMilli()), adm, false},
		{"lives too long", signV2(key, "admin", "abc", now.Add(2*time.Hour).UnixMilli()), adm, false},
		{"tampered uid", strings.Replace(signV2(key, "admin", "abc", exp), ".abc.", ".xyz.", 1), adm, false},
		{"malformed", "VergrOps v2.admin.abc", adm, false},
		{"empty uid", signV2(key, "admin", "", exp), adm, false},
	}
	for _, c := range cases {
		if got, why := validFor(key, c.header, c.uri, now); got != c.want {
			t.Errorf("%s: got %v (%s), want %v", c.name, got, why, c.want)
		}
	}
}
