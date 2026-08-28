# Restoring box 2 (`vergr-stream-2` / `edge2`)

Complete restore bundle, captured **2026-08-17** immediately before the server
was deleted. Everything in this folder came off the live machine.

**Read this first if you are a fresh session being told "we need box 2 back".**
You can do the whole thing from this folder. You do not need the Hetzner
snapshot, and you do not need to find source elsewhere, because for three of
these services **there is no source anywhere else** (see the warning below).

---

## ⚠ Why this bundle exists and why it is the only copy

`vergr-sfu`, `vergr-ingest` and `vergr-rtmp-auth` are Go services whose **source
code is not in this repo and never was**. Only compiled binaries exist. Those
binaries are in `opt/` here, and identical copies live on box 1. `agent.js`
(stream-node-agent) is in the same position: no source in `infra/`, only the
deployed file.

CLAUDE.md refers to `infra/*/deploy.sh` scripts. **They do not exist.** Nothing
in `infra/` has a deploy script. Do not go looking for them.

Consequence: if this folder and box 1 are both lost, those four services are
gone and would have to be rewritten. Box 1 carries the same risk for
`vergr-chat`, `vergr-cohost-launcher`, `vergr-community-import` and
`vergr-ocr` — none of which are backed up anywhere. **That is worth fixing
separately.**

---

## What box 2 was

A `cpx32` (4 dedicated vCPU, 8GB, 160GB disk) in Hetzner NBG1, public
`178.105.238.230`, private `10.0.0.2`, DNS `edge2.vergr.app`.

It was the **primary streaming edge**, not a spare: `stream_nodes/edge2` carried
`priority: 10`, and `functions/streaming.js` sorts nodes by priority descending,
so every normal stream landed here. Box 1 (`priority: 0`) is the automatic
overflow and failover, which is why deleting box 2 did not break streaming.

Four things ran here that ran nowhere else:

| Service | What it did | Reached via |
|---|---|---|
| `vergr-transcode` | adaptive video transcode worker | internal |
| `vergr-vod-archive` | VOD archiving **and server-side clip cutting** (the Safari/iOS fallback for the Clip button) | `archive.vergr.app` → box1 nginx → `10.0.0.2:8097` |
| LibreTranslate (docker) | all translation: `functions/translate.js` + post language detection in `contentAi.js` | `archive.vergr.app/lt/` → box1 nginx → `10.0.0.2:5000` |
| SFU/ingest/rtmp at priority 10 | primary stream edge | `edge2.vergr.app` |

**Box 1's `archive.vergr.app` vhost is a reverse proxy pointing at box 2.** When
box 2 went away that vhost was left returning 502; see step 7.

---

## Restore, step by step

### 1. Provision the server

Hetzner Cloud, **NBG1**, image Ubuntu 24.04.

Type: `cpx32` reproduces the original exactly. **`cx23` (€5.49/mo vs €35.49) is
enough** unless you actually have concurrent streamers — the box sat at load
0.00 with 8.4GB of 150GB used for its entire 74-day life.

Attach it to the **same Hetzner private network** so it gets `10.0.0.2`. Box 1's
nginx proxies to that literal address; if the new box gets a different private
IP you must update `archive.vergr.app` on box 1 to match.

### 2. Base packages

```bash
apt update && apt install -y nginx libnginx-mod-rtmp nodejs npm ffmpeg rclone docker.io
```

`nginx.conf` here contains the RTMP block, so `libnginx-mod-rtmp` is required.

### 3. Copy the payloads

```bash
# from this folder, with $BOX2 = new server IP
scp -r opt/*            root@$BOX2:/opt/
scp usr-local-bin/*     root@$BOX2:/usr/local/bin/
scp systemd/*.service   root@$BOX2:/etc/systemd/system/
scp nginx/nginx.conf    root@$BOX2:/etc/nginx/nginx.conf
scp nginx/sites-available/edge2.vergr.app nginx/sites-available/vergr-stat \
                        root@$BOX2:/etc/nginx/sites-available/
ssh root@$BOX2 'chmod +x /usr/local/bin/r2-sync.sh /usr/local/bin/vergr-thumbnailer.sh \
  /opt/vergr-sfu/vergr-sfu /opt/vergr-ingest/vergr-ingest /opt/vergr-rtmp-auth/vergr-rtmp-auth'
```

`vergr-thumbnailer.sh` lives at `/usr/local/bin/`, **not** in `/opt` — the copy
in `opt/` in this bundle is the same file, kept there by the capture script.

### 4. Node dependencies

`node_modules` was deliberately excluded (it is reinstallable and large):

```bash
ssh root@$BOX2 'cd /opt/vergr-vod-archive && npm ci --omit=dev
                cd /opt/stream-node-agent  && npm ci --omit=dev'
```

### 5. Secrets

None of these are in git. Restore each one:

| File | Where to get it |
|---|---|
| `/etc/vergr-sfu/firebase-admin.json`<br>`/etc/vergr-rtmp-auth/firebase-admin.json` | Same file, used twice. Copy from **box 1** (`/etc/vergr-sfu/firebase-admin.json`), or generate a new one: Firebase Console → Project Settings → Service Accounts → Generate new private key. Project `vergr-44494`. |
| `/etc/vergr-node/agent.env` | Template in `templates/agent.env.example`. Real non-secret values are in § "agent.env values" below; `FIREBASE_CREDS=/etc/vergr-sfu/firebase-admin.json`. |
| `/etc/vergr-vod-archive.env` | Template in `templates/`. `HOST_OPS_TOKEN` must match what `functions/vodArchive.js` sends. R2 values are in Firebase Secret Manager (`R2_*`). |
| `/root/.config/rclone/rclone.conf` | Template in `templates/`. Same R2 access key / secret as above; endpoint is already in the template. |

Permissions: `chmod 600` on every one of them.

#### agent.env values

```
NODE_ID=edge2
RTMP_BASE=rtmp://edge2.vergr.app:1935/live
BROWSER_INGEST_BASE=https://edge2.vergr.app/ingest
SFU_BASE=wss://edge2.vergr.app/ws
MAX_STREAMS=25
PUBLIC_IP=<new public IP>
FIREBASE_CREDS=/etc/vergr-sfu/firebase-admin.json
DB_ID=vgrdb
INTERVAL_MS=15000
```

`PUBLIC_IP` must be the new server's address. It is also baked into the
`vergr-sfu` unit's `-public-ip` flag — **edit `systemd/vergr-sfu.service` too**,
or WebRTC will advertise the dead IP and every connection will fail.

### 6. LibreTranslate

```bash
docker volume create vergr-lt-models
docker run -d --name vergr-translate --restart unless-stopped \
  -p 10.0.0.2:5000:5000 \
  -e LT_LOAD_ONLY=en,es,pt,de,uk,it,nl,pl,tr \
  -v vergr-lt-models:/home/libretranslate/.local \
  libretranslate/libretranslate:latest
```

Models re-download on first boot (a few minutes, a few hundred MB). The volume
was not backed up because it is entirely reconstructible.

Full original container config: `meta/translate-docker-inspect.json`.

### 7. Re-point box 1

`archive.vergr.app` on box 1 was disabled when box 2 was deleted. Restore
`/etc/nginx/sites-available/archive.vergr.app` on **box 1** (it proxies `/` and
`/healthz` to `10.0.0.2:8097` and `/lt/` to `10.0.0.2:5000`, gated on the
`X-Vergr-LT-Key` header) and re-enable the symlink in `sites-enabled/`.

A copy of that vhost is in `box1/archive.vergr.app` in this bundle.

### 8. DNS + TLS

Point `edge2.vergr.app` A record at the new IP, then:

```bash
certbot --nginx -d edge2.vergr.app
```

### 9. Start everything

```bash
systemctl daemon-reload
systemctl enable --now nginx r2-sync vergr-sfu vergr-ingest vergr-rtmp-auth \
                       vergr-thumbnailer vergr-transcode vergr-vod-archive vergr-node-agent
```

### 10. Re-register the node

The node agent writes `stream_nodes/edge2` itself within `INTERVAL_MS` (15s).
Confirm it appears with `status: active` and `priority: 10`; if `priority` is
missing, set it on the document by hand — `functions/streaming.js` defaults a
missing priority to 0, which silently makes the restored box the failover
instead of the primary.

### 11. Verify

```bash
curl -s https://archive.vergr.app/healthz                 # 200, proxied to box 2
curl -s -o /dev/null -w '%{http_code}\n' https://archive.vergr.app/lt/languages   # 403 without the key header = wired correctly
curl -s https://edge2.vergr.app/healthz
```

Then check `stream_nodes/edge2.lastHeartbeat` is moving.

---

## Bundle contents

| Path | What |
|---|---|
| `systemd/` | 8 unit files |
| `nginx/` | `nginx.conf` (contains the RTMP block), `edge2.vergr.app`, `vergr-stat` |
| `opt/` | the 3 Go binaries, `agent.js`, `worker.js`, `launcher.js`, `vergr-thumbnailer.sh`, package manifests |
| `usr-local-bin/` | `r2-sync.sh`, `vergr-thumbnailer.sh` |
| `etc/` | **gitignored secrets** (real values, present only on the machine that took the backup) |
| `templates/` | redacted versions of every secret file, safe to commit |
| `box1/` | box 1's `archive.vergr.app` vhost, needed for step 7 |
| `meta/` | docker inspect, netplan, `ip addr`, running-services list at capture time |

Excluded on purpose: `node_modules` (reinstallable), `*.bak` files, Let's Encrypt
certs (regenerated by certbot), the LibreTranslate model volume (re-downloads),
and `/var/www/hls` + `/var/www/streams` (transient segment data, and both were
empty).
