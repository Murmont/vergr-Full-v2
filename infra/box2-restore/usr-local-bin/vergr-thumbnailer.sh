#!/bin/bash
# vergr-thumbnailer — every 60s grab one frame from each ACTIVE live stream and
# write thumb.jpg into its dir. r2-sync (inotify moved_to) ships it to R2 with a
# 30s cache, so discovery cards (home live rail, /streams) show a live preview
# at $0 extra cost (no new service, reuses the box's ffmpeg + r2-sync).
#
# ffmpeg reads the local HLS playlist directly, which transparently handles both
# MPEG-TS (OBS/nginx-rtmp) and fMP4 (browser ingest, EXT-X-MAP init.mp4) — no
# need to hand-pick the newest segment or concat the init ourselves.

SRC=/var/www/streams

while true; do
  for d in "$SRC"/*/; do
    [ -d "$d" ] || continue
    # Newest playlist in the dir (index.m3u8 for ingest, may differ for rtmp).
    m3u8="$(ls -t "$d"*.m3u8 2>/dev/null | head -1)"
    [ -n "$m3u8" ] && [ -f "$m3u8" ] || continue
    # Active only: playlist written in the last ~90s. Skips ended/stale dirs
    # whose segments persist on disk.
    [ -n "$(find "$m3u8" -mmin -1.5 2>/dev/null)" ] || continue
    # One frame, scaled to 480 wide (even height). Atomic rename so r2-sync sees
    # a single moved_to on the final file, never a half-written frame.
    if ffmpeg -y -loglevel error -i "$m3u8" -frames:v 1 -vf 'scale=480:-2' "$d/.thumb.tmp.jpg" 2>/dev/null; then
      mv -f "$d/.thumb.tmp.jpg" "$d/thumb.jpg"
    else
      rm -f "$d/.thumb.tmp.jpg" 2>/dev/null
    fi
  done
  sleep 60
done
