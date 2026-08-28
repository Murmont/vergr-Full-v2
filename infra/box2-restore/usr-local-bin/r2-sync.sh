#!/bin/bash
# Watches /var/www/streams for new HLS segments and pushes them to R2.
# Triggered by inotify so latency is sub-second.
#
# Handles two HLS variants:
#   - MPEG-TS (.ts) — produced by nginx-rtmp from OBS RTMP ingest
#   - fMP4 (.m4s + init.mp4) — produced by vergr-ingest from browser MediaRecorder
#
# Delivery: a long-lived `rclone rcd` daemon stays warm so each upload is a
# lightweight `rclone rc operations/copyfile` call against it, instead of
# spawning a full `rclone copy` process (config parse + remote/transport init)
# per segment. Saves ~300-800ms per segment off glass-to-glass latency.
# Per-file Cache-Control is preserved via the rc `_config` Headers override
# (verified: m3u8 -> max-age=1, segments/init -> immutable).

SRC=/var/www/streams
DEST=r2:vergr-media/streams
RC_ADDR=127.0.0.1:5572
RC_URL="http://$RC_ADDR"

CC_IMMUTABLE='public, max-age=31536000, immutable'
CC_MANIFEST='public, max-age=1'
CC_THUMB='public, max-age=30'

# ── Warm rclone daemon ───────────────────────────────────────────────────────
start_rcd() {
  rclone rcd --rc-no-auth --rc-addr "$RC_ADDR" >/tmp/r2-sync-rcd.log 2>&1 &
  RCD_PID=$!
}
start_rcd
trap 'kill "$RCD_PID" 2>/dev/null' EXIT
# Wait for the daemon to accept connections.
for _ in $(seq 1 50); do
  rclone rc --url "$RC_URL" rc/noop >/dev/null 2>&1 && break
  sleep 0.2
done

# rc_copy <filepath> <relpath> <cache-control>: upload one file to R2 via the
# warm daemon with the given Cache-Control. Backgrounded so the inotify loop
# never blocks. If the daemon died, transparently restart it and retry once.
rc_copy() {
  local fp="$1" rel="$2" cc="$3"
  local dstdir; dstdir="$(dirname "$rel")"
  local name; name="$(basename "$fp")"
  rclone rc --url "$RC_URL" operations/copyfile \
    srcFs="$(dirname "$fp")" srcRemote="$name" \
    dstFs="$DEST/$dstdir" dstRemote="$name" \
    _config="{\"Headers\":[{\"Key\":\"Cache-Control\",\"Value\":\"$cc\"}]}" \
    >/dev/null 2>&1 && return 0
  # Daemon may have died — revive and retry once.
  if ! rclone rc --url "$RC_URL" rc/noop >/dev/null 2>&1; then
    start_rcd
    for _ in $(seq 1 50); do
      rclone rc --url "$RC_URL" rc/noop >/dev/null 2>&1 && break
      sleep 0.2
    done
  fi
  rclone rc --url "$RC_URL" operations/copyfile \
    srcFs="$(dirname "$fp")" srcRemote="$name" \
    dstFs="$DEST/$dstdir" dstRemote="$name" \
    _config="{\"Headers\":[{\"Key\":\"Cache-Control\",\"Value\":\"$cc\"}]}" \
    >/dev/null 2>&1
}

# ── Watch + push ─────────────────────────────────────────────────────────────
inotifywait -m -r -e close_write -e moved_to --format '%w%f' "$SRC" 2>/dev/null |
while read -r filepath; do
  relpath="${filepath#$SRC/}"
  case "$filepath" in
    */thumb.jpg)
      # Live discovery thumbnail (written by vergr-thumbnailer every 60s).
      # Short cache so cards refresh within the box's regeneration cadence.
      rc_copy "$filepath" "$relpath" "$CC_THUMB" &
      ;;
    *.ts|*.m4s)
      rc_copy "$filepath" "$relpath" "$CC_IMMUTABLE" &
      ;;
    */init.mp4)
      rc_copy "$filepath" "$relpath" "$CC_IMMUTABLE" &
      ;;
    *.m3u8)
      rc_copy "$filepath" "$relpath" "$CC_MANIFEST" &
      # fMP4 init-segment safety net: vergr-ingest writes init.mp4 the same
      # instant it creates the stream dir, BEFORE inotify has added a watch
      # on the new dir, so init's close_write event is lost and the stream
      # is unplayable (EXT-X-MAP -> 404). Re-check on every manifest write
      # until uploaded once (marker file makes later checks a no-op).
      d="$(dirname "$filepath")"
      if [ -f "$d/init.mp4" ] && [ ! -f "$d/.init-synced" ]; then
        ( rc_copy "$d/init.mp4" "$(dirname "$relpath")/init.mp4" "$CC_IMMUTABLE" && touch "$d/.init-synced" ) &
      fi
      ;;
  esac
done
