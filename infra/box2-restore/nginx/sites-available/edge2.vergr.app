server {
    server_name edge2.vergr.app;
    location /ingest/ {
        proxy_pass http://127.0.0.1:8089/ingest/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 16m;
        client_body_buffer_size 1m;
        proxy_request_buffering on;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
    location = /ingest-healthz { proxy_pass http://127.0.0.1:8089/healthz; }

    # SFU WebSocket signaling (squad voice/video + co-host) → vergr-sfu :8088
    location /ws {
        proxy_pass http://127.0.0.1:8088/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
    location = /sfu-healthz { proxy_pass http://127.0.0.1:8088/healthz; }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/edge2.vergr.app/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/edge2.vergr.app/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = edge2.vergr.app) { return 301 https://$host$request_uri; } # managed by Certbot
    listen 80;
    server_name edge2.vergr.app;
    return 404; # managed by Certbot
}
