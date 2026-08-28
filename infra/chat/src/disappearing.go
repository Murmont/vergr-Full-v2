// Disappearing messages / auto-delete (02_MESSAGING 2.3).
//
// A conversation carries `ttlSeconds` on its Firestore doc (0 / absent = off).
// The relay owns the message bodies, so the relay is what actually deletes them:
// every 60s we sweep the conversations with a timer armed and HARD-delete rows
// older than the cutoff (purgeExpired in store.go — no tombstone, media queued
// into pending_gc for R2 cleanup).
//
// The client ALSO hides expired messages locally by timestamp, which is what
// makes the feature feel exact: the user sees a message vanish on the timer, not
// up to a minute later when the sweep happens to run. The sweep is the thing
// that makes it TRUE (bodies actually leave the server); the client filter is
// the thing that makes it PROMPT. Both are required — a client-only version
// would be a lie, and a server-only version would look laggy.
//
// Telegram durations (founder: "same as Telegram"): 1 day / 1 week / 1 month.
// The relay doesn't care — it honours whatever ttlSeconds it's given.

package main

import (
	"context"
	"log"
	"time"

	"google.golang.org/api/iterator"
)

const (
	disappearSweepInterval = 60 * time.Second
	maxSweepConvos         = 500
)

func disappearingLoop(ctx context.Context) {
	time.Sleep(25 * time.Second) // let the store warm up (offset from the scheduled-msg loop)
	t := time.NewTicker(disappearSweepInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweepDisappearing(ctx)
		}
	}
}

func sweepDisappearing(ctx context.Context) {
	if chatDB == nil {
		return
	}
	// Single-field inequality → automatic index, no composite needed.
	iter := fsClient.Collection("conversations").
		Where("ttlSeconds", ">", 0).
		Limit(maxSweepConvos).Documents(ctx)
	defer iter.Stop()

	now := time.Now().UnixMilli()
	for {
		snap, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Printf("disappearing: query err: %v", err)
			return
		}
		ttl, ok := snap.Data()["ttlSeconds"].(int64)
		if !ok || ttl <= 0 {
			continue
		}
		cutoff := now - (ttl * 1000)
		n, err := purgeExpired(snap.Ref.ID, cutoff)
		if err != nil {
			log.Printf("disappearing: purge %s: %v", snap.Ref.ID, err)
			continue
		}
		if n > 0 {
			log.Printf("disappearing: purged %d msg(s) from %s (ttl %ds)", n, snap.Ref.ID, ttl)
		}
	}
}
