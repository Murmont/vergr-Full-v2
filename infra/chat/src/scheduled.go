// Scheduled messages (Lite/Pro). The relay owns the DM/group message store,
// fan-out and push, so it also EXECUTES scheduled sends in-process: a Cloud
// Function (scheduleMessage) validates the sender's tier + participation and
// writes a `scheduled_messages` doc; every ~30s the relay injects any message
// whose sendAt has passed exactly as if the sender had sent it live, then
// deletes the doc. No secret-authed endpoint needed — the relay reads Firestore
// directly (single relay instance = box1, so no double-send).

package main

import (
	"context"
	"log"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

func scheduledMessageLoop(ctx context.Context) {
	time.Sleep(15 * time.Second) // let the store + rooms warm up
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			runScheduledMessages(ctx)
		}
	}
}

func runScheduledMessages(ctx context.Context) {
	now := time.Now()
	// Inequality on a single field uses the automatic index (no composite needed).
	iter := fsClient.Collection("scheduled_messages").
		Where("sendAt", "<=", now).
		Limit(50).Documents(ctx)
	defer iter.Stop()
	for {
		snap, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Printf("scheduled: query err: %v", err)
			return
		}
		d := snap.Data()
		convoID, _ := d["convoId"].(string)
		senderUID, _ := d["senderUid"].(string)
		if convoID == "" || senderUID == "" {
			_, _ = snap.Ref.Delete(ctx)
			continue
		}
		if err := deliverScheduled(ctx, snap.Ref.ID, convoID, senderUID, d); err != nil {
			log.Printf("scheduled: deliver %s err: %v", snap.Ref.ID, err)
			continue // leave the doc for a retry next tick
		}
		if _, err := snap.Ref.Delete(ctx); err != nil {
			log.Printf("scheduled: delete %s err: %v", snap.Ref.ID, err)
		}
	}
}

// deliverScheduled injects one scheduled message. Returns nil (doc will be
// deleted) even for "drop" cases (convo gone / not a member / empty); returns a
// real error only for transient failures worth retrying.
func deliverScheduled(ctx context.Context, docID, convoID, senderUID string, d map[string]interface{}) error {
	me, err := loadConversationMembership(ctx, convoID)
	if err != nil {
		return nil // conversation gone → drop
	}
	if !me.members[senderUID] {
		return nil // sender left → drop
	}

	text, _ := d["text"].(string)
	contentURL, _ := d["contentUrl"].(string)
	videoURL, _ := d["videoUrl"].(string)
	mediaKind, _ := d["mediaKind"].(string)
	hasMedia, _ := d["hasMedia"].(bool)
	msgID, _ := d["msgId"].(string)
	if msgID == "" {
		msgID = "m_sch_" + docID
	}
	if strings.TrimSpace(text) == "" && !hasMedia {
		return nil // empty → drop
	}

	out := ChatMsg{
		Type:       "msg",
		ConvoID:    convoID,
		IsGroup:    me.isGroup,
		ID:         msgID,
		UID:        senderUID,
		Text:       text,
		MediaKind:  mediaKind,
		HasMedia:   hasMedia,
		ContentURL: contentURL,
		VideoURL:   videoURL,
		TS:         time.Now().UnixMilli(),
	}

	room := getOrCreateChatRoom(convoID, me.isGroup, me.members, me.admins, me.adminsOnly)
	for _, peer := range room.snapshotPeers() {
		_ = peer.write(out)
	}
	room.appendBuffer(out)
	persistEnqueue("msg", out)

	online := room.onlineUIDs()
	anyOffline := false
	members := make([]string, 0, len(me.members))
	for uid := range me.members {
		members = append(members, uid)
		if uid != senderUID && !online[uid] {
			anyOffline = true
		}
	}
	if anyOffline {
		backlogEnqueue(convoID, out)
	}

	isSquad := strings.HasPrefix(convoID, "squad:")
	go fireNotifyHook(convoID, me.isGroup && !isSquad, isSquad, senderUID, out.ID, out.MediaKind, out.HasMedia, out.ContentURL, "", out.Text, members, online)

	// Bump conversation metadata + unread so the inbox updates (the WS path has
	// the client do this; for a server-injected message the relay does it).
	preview := text
	if strings.TrimSpace(preview) == "" {
		preview = mediaPreview(mediaKind)
	}
	if r := []rune(preview); len(r) > 140 {
		preview = string(r[:140])
	}
	upd := []firestore.Update{
		{Path: "lastMessageAt", Value: firestore.ServerTimestamp},
		{Path: "lastMessageSenderId", Value: senderUID},
		{Path: "lastMessageText", Value: preview},
		{Path: "lastMessage", Value: preview},
	}
	for uid := range me.members {
		if uid != senderUID {
			upd = append(upd, firestore.Update{Path: "unreadCount." + uid, Value: firestore.Increment(1)})
		}
	}
	if _, err := fsClient.Collection("conversations").Doc(convoID).Update(ctx, upd); err != nil {
		log.Printf("scheduled: convo meta update err: %v", err)
	}
	return nil
}

func mediaPreview(kind string) string {
	switch kind {
	case "image":
		return "\U0001F4F7 Photo"
	case "video", "clip":
		return "\U0001F3AC Video"
	case "voice", "audio":
		return "\U0001F399 Voice"
	case "file":
		return "\U0001F4CE File"
	case "sticker":
		return "Sticker"
	case "giphy", "gif":
		return "GIF"
	}
	return "Message"
}
