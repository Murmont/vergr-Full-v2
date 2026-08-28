# infra — Hetzner service source

Go source for the services running on **box 1, `vergr-stream-1` (91.98.79.244)**.

## Why this directory now exists

CLAUDE.md has said for months that `vergr-sfu`, `vergr-ingest`, `vergr-rtmp-auth`
and `stream-node-agent` "exist ONLY as compiled binaries", and that box 1 is not
backed up at all, so if it died those services were gone.

**That was wrong for five of them.** On 2026-08-19 the box was checked directly
and `/opt/<service>/src/` holds the full Go source:

| Service | Source | Pulled here |
|---|---|---|
| `vergr-ingest` | `/opt/vergr-ingest/src` | `infra/ingest/src` |
| `vergr-sfu` | `/opt/vergr-sfu/src` | `infra/sfu/src` |
| `vergr-rtmp-auth` | `/opt/vergr-rtmp-auth/src` | `infra/rtmp-auth/src` |
| `vergr-chat` | `/opt/vergr-chat/src` (9 files) | `infra/chat/src` |
| `vergr-cohost-launcher` | `/opt/vergr-cohost-launcher/src` | `infra/cohost-launcher/src` |

Still genuinely source-less on the box, and still a single point of failure:
**`stream-node-agent`** and **`vergr-community-import`**.

`infra/vergr-ocr/` already had its source tracked, and `infra/box2-restore/`
holds the box-2 binaries.

## Build + deploy (all of them follow this shape)

```bash
scp infra/<svc>/src/*.go root@91.98.79.244:/opt/<real-name>/src/
ssh root@91.98.79.244 'cd /opt/<real-name>/src && go build -o /opt/<real-name>/<real-name>.new . \
  && mv /opt/<real-name>/<real-name>.new /opt/<real-name>/<real-name> \
  && systemctl restart <real-name>'
```

Build to `.new` and move, rather than building over the running binary: a
partial write to a file systemd is executing takes the service down.
Go 1.22.2 is installed on the box. Keep a `.bak.<reason>` copy of the previous
binary, which is what the existing `vergr-ingest.bak.*` files are.

SSH from Windows: `ssh -i ~/.ssh/vergr-streaming.key root@91.98.79.244`.

## These are SNAPSHOTS, not the build source of truth

The box builds from `/opt/<svc>/src`. This directory is a copy taken on
2026-08-19. If someone edits on the box, copy it back here in the same change,
or the two drift and the next person trusts the wrong one.
