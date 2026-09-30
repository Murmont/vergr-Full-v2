package main

// Takedowns: Vergr ending someone else's live stream (functions/streamTakedown.js).
//
// ⚠ Until 2026-09-21 this server checked a stream's status ONCE, at /ingest/init.
// Every later segment rode the in-memory session, so a stream an admin ended
// kept uploading and kept reaching the CDN. The takedown writes `takenDownAt`
// on the stream doc; this listener finalizes the matching session (ENDLIST +
// drop), so the broadcaster's next segment is refused and viewers see the end.
//
// ⚠ COST: a query listener on `takenDownAt >= since`. It returns nothing until a
// takedown happens, then one read per taken-down stream. After handling one,
// the listener restarts from THAT takedown's timestamp, so a taken-down stream
// that keeps being written (viewer counts from the chat relay) falls out of the
// query instead of billing a read per write for the rest of the day.
// Single-field inequality: Firestore's automatic index covers it.

import (
	"context"
	"log"
	"time"

	"cloud.google.com/go/firestore"
)

func watchTakedowns(ctx context.Context) {
	since := time.Now()
	for ctx.Err() == nil {
		it := fsClient.Collection("streams").Where("takenDownAt", ">=", since).Snapshots(ctx)
		restart := false
		for !restart {
			snap, err := it.Next()
			if err != nil {
				log.Printf("takedown: listener stopped: %v", err)
				break
			}
			for _, ch := range snap.Changes {
				if ch.Kind == firestore.DocumentRemoved {
					continue
				}
				id := ch.Doc.Ref.ID
				if t, ok := ch.Doc.Data()["takenDownAt"].(time.Time); ok && t.After(since) {
					since = t
				}
				n := finalizeStream(id)
				log.Printf("takedown: stream=%s ended by Vergr, %d ingest session(s) finalized", id, n)
				restart = true
			}
		}
		it.Stop()
		if !restart && ctx.Err() == nil {
			time.Sleep(10 * time.Second)
		}
		// Strictly after the last handled takedown, so it does not match again.
		since = since.Add(time.Microsecond)
	}
}

// finalizeStream ends every live session for a stream id. Normally one; a
// broadcaster who reconnected could briefly hold two.
func finalizeStream(streamID string) int {
	var hit []*Session
	sessions.mu.RLock()
	for _, s := range sessions.byKey {
		if s.StreamID == streamID {
			hit = append(hit, s)
		}
	}
	sessions.mu.RUnlock()
	for _, s := range hit {
		finalize(s, "takedown")
	}
	return len(hit)
}
