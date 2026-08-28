server {
    server_name archive.vergr.app;

    # Health probe.
    location /healthz {
        proxy_pass http://10.0.0.2:8097/healthz;
    }

    # LibreTranslate (box 2 over private net), secret-header gated. Only the
    # translateContent Cloud Function knows X-Vergr-LT-Key. Strips /lt/ prefix.
    location /lt/ {
        if ($http_x_vergr_lt_key != "ded8439889793b388aadc5fb710749b9a14969c61b67cbe7") { return 403; }
        proxy_pass http://10.0.0.2:5000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        client_max_body_size 1m;
        proxy_read_timeout 30s;
    }

    # Archive endpoint — Bearer auth handled by the Node service.
    # VOD uploads can be large + long-running, so generous timeouts.
    location / {
        proxy_pass http://10.0.0.2:8097;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 8g;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_request_buffering off;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/archive.vergr.app/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/archive.vergr.app/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = archive.vergr.app) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name archive.vergr.app;
    return 404; # managed by Certbot


}