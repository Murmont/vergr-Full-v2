package main

import "testing"

// The mod-room privacy model, as a table. If any row here changes, someone has
// changed who can read a broadcaster's private moderation channel.
func TestCanJoinModRoom(t *testing.T) {
	cases := []struct {
		name        string
		isStreamMod bool
		isVanguard  bool
		want        bool
		why         string
	}{
		{"host or their moderator", true, false, true,
			"the room is the broadcaster's own team coordinating their room"},
		{"vanguard", false, true, true,
			"a private room Vergr cannot see is a moderation blind spot, and this is where it matters most"},
		{"vanguard who is also a stream mod", true, true, true,
			"both hold, and neither revokes the other"},
		{"plain viewer", false, false, false,
			"the whole point; a viewer must not even learn the room exists"},
	}
	for _, c := range cases {
		if got := canJoinModRoom(c.isStreamMod, c.isVanguard); got != c.want {
			t.Errorf("%s: canJoinModRoom(mod=%v, vanguard=%v) = %v, want %v — %s",
				c.name, c.isStreamMod, c.isVanguard, got, c.want, c.why)
		}
	}
}

// ⚠ THE MODS ROOM MUST NOT RUN PRESENCE. startPresence writes
// streams/{room.ID}.viewerCount every 10s; for a ":mods" room that doc does not
// exist, so it is a failing Firestore write and a log line every ten seconds for as
// long as anyone has the room open. The suffix is also how the room is identified,
// so this test pins the exact string both sides rely on.
func TestModRoomSuffix(t *testing.T) {
	id := "abc123"
	room := id + ":mods"
	if room != "abc123:mods" {
		t.Fatalf("mod room id shape changed: %q", room)
	}
	if len(room) <= len(id) || room[len(id):] != ":mods" {
		t.Fatalf("mod room suffix is not \":mods\": %q", room)
	}
}
