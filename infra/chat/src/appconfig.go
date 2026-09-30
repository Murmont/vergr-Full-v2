package main

// Platform switches from app_config/general that the relay must obey.
//
// Today that is one: `allowDirectMessages` (Admin → App Config). Until
// 2026-09-21 the admin screen saved it and nothing read it. The app locks the
// composer (src/hooks/useAppGate.js), but a raw WebSocket client ignores the
// UI, so the relay is where the switch actually holds: while it is false,
// every DM and group-DM send is rejected with reason "dms-paused". Squad chat
// and live-stream chat are NOT direct messages and are not affected.
//
// ⚠ COST: ONE snapshot listener on ONE document for the life of the process.
// Firestore bills a read when it starts and one per change to that doc, which
// only happens when an admin saves config. It does NOT scale with messages or
// users; the per-message check reads an atomic in memory.
//
// ⚠ FAILS OPEN on purpose. Until the listener has delivered the doc once, DMs are
// allowed; if it drops later, the last known value stands while it reconnects.
// A Firestore hiccup must never silently switch every conversation off.

import (
	"context"
	"log"
	"sync/atomic"
	"time"
)

var dmsPaused atomic.Bool

func watchAppConfig(ctx context.Context) {
	for {
		it := fsClient.Collection("app_config").Doc("general").Snapshots(ctx)
		for {
			snap, err := it.Next()
			if err != nil {
				log.Printf("appconfig: listener stopped: %v (DMs stay as last known: paused=%v)", err, dmsPaused.Load())
				break
			}
			paused := false
			if snap.Exists() {
				if v, ok := snap.Data()["allowDirectMessages"].(bool); ok && !v {
					paused = true
				}
			}
			if dmsPaused.Swap(paused) != paused {
				log.Printf("appconfig: direct messages paused=%v", paused)
			}
		}
		it.Stop()
		if ctx.Err() != nil {
			return
		}
		time.Sleep(10 * time.Second)
	}
}
