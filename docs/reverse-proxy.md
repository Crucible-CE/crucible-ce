# Reverse proxy and TLS

The app speaks plain HTTP on port 3000. For anything beyond localhost, put a reverse proxy with TLS in front of it.

## Settings

| Variable | Set to |
| --- | --- |
| `PUBLIC_URL` | The exact https address users open, for example `https://crucible.example.com` |
| `TRUSTED_PROXY_HOPS` | The number of proxies that append to `X-Forwarded-For`. `1` for one proxy. |
| `CRUCIBLE_PORT` | The host port the proxy forwards to (default `3000`) |

Example `.env` for a proxy on the same host:

```env
PUBLIC_URL=https://crucible.example.com
CRUCIBLE_PORT=3000
TRUSTED_PROXY_HOPS=1
```

Apply changes with `docker compose up -d`.

### PUBLIC_URL

The app reads it at startup. It builds email links and acknowledge links, checks Twilio signatures, and sets the allowed Socket.io origins. If it doesn't match what the browser shows, realtime chat is rejected and Twilio callbacks fail.

### TRUSTED_PROXY_HOPS

| Value | Use |
| --- | --- |
| `0` (default) | Clients connect directly. `X-Forwarded-For` and `X-Real-IP` are ignored. |
| `1` | One reverse proxy (Caddy, nginx, Traefik). The client address is the rightmost `X-Forwarded-For` entry. |
| `2` | For example, a CDN in front of your proxy. Add one per appending hop. |

- **Required behind a proxy.** At `0`, every client appears as the proxy. They share one rate-limit bucket for sign-in, setup and password reset.
- The server logs a warning if it sees `X-Forwarded-For` while the value is `0`.
- Never set it higher than the number of proxies you run. Clients could then spoof their IP.

### CRUCIBLE_PORT

If the proxy runs on the same host, bind the app to loopback. Change the `ports` line in `docker-compose.yml` to `"127.0.0.1:${CRUCIBLE_PORT:-3000}:3000"`. Don't put the proxy's public port in `CRUCIBLE_PORT`. Put it in `PUBLIC_URL` (443 needs no port).

## Proxy requirements

- Pass WebSocket upgrades. Socket.io uses `/socket.io` on the app port. Caddy does this by default. nginx needs the `Upgrade` and `Connection` headers below.
- Pass `Host` unchanged.
- Set `X-Forwarded-Proto`.
- `Strict-Transport-Security` is sent only on requests that arrived over https.

Origin checks:

- API writes (POST, PUT, PATCH, DELETE under `/api/`) must come from `PUBLIC_URL`, `AUTH_URL` or `NEXTAUTH_URL`. Other `Origin` or `Referer` values get a 403.
- Requests with neither header (curl, scripts) are allowed.
- Twilio webhooks under `/api/public/twilio/` are exempt.
- Socket.io refuses other origins. Add extra hostnames to `SOCKET_EXTRA_ALLOWED_ORIGINS` (comma-separated).

## Caddy

Caddy gets and renews certificates. `reverse_proxy` handles WebSockets and sets the forwarding headers.

```caddy
crucible.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

If Caddy runs in another compose service on a shared network, use `reverse_proxy app:3000`.

## nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name crucible.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name crucible.example.com;

    ssl_certificate     /etc/letsencrypt/live/crucible.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crucible.example.com/privkey.pem;

    # Evidence uploads. The app's own limit is MAX_ATTACHMENT_BYTES (default 100 MB).
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade for Socket.io
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Keep idle realtime connections open
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
```

nginx's default `client_max_body_size` is 1 MB. Without the line above, evidence uploads fail with a 413.

## TLS

- Use certificates from a public CA (Caddy or certbot). Twilio won't call a self-signed endpoint.
- Twilio callbacks and voice "press 1" need an https `PUBLIC_URL` reachable from the internet. The paths are `/api/public/twilio/inbound`, `/api/public/twilio/status` and `/api/public/twilio/voice`.
- Acknowledge links under `/api/public/page-ack/` must be reachable by everyone who gets pages.
- Count a cloud load balancer or CDN as a hop in `TRUSTED_PROXY_HOPS` if it appends to `X-Forwarded-For`.
- Redirect HTTP to HTTPS. Caddy does this by default.

## Check it

1. Open `https://crucible.example.com/api/health`. Expect an OK response.
2. Sign in and open an incident chat.
3. Send a message. If it appears without a refresh, WebSockets work.
