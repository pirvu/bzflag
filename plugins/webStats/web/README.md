# webStats web service

The web page for the bzfs `webStats` plugin: live log and history, player
statistics, and push notifications when somebody opens a game.

It needs Node.js 22.13 or newer and has no npm dependencies. Storage is the
built-in `node:sqlite` module, and Web Push is implemented with `node:crypto`.

## Running

```sh
cd plugins/webStats/web
INGEST_KEY=some-secret PORT=8080 npm start
```

Then load the plugin on bzfs with the same key (see `../webStats.cfg`):

```ini
[webStats]
  url = http://127.0.0.1:8080/api/ingest
  key = some-secret
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | SQLite database and the VAPID keys |
| `INGEST_KEY` | empty | Key the plugin must send. When empty only requests from localhost (not through a proxy) are accepted |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact address sent to the push services. Put a real address here |
| `NOTIFY_COOLDOWN_MIN` | `10` | No new notification if the previous game on that server ended less than this many minutes ago |

Keep `data/vapid.json`. If it is lost every browser has to subscribe again.

## In the multiplayer Docker image

`docker/Dockerfile.multiplayer` bundles the plugin and this service: the
page is at `/stats/` on the game's port, with its data in `/data`. See
`docs/PORT_PROGRESS.md` for the details. The pages only use relative URLs,
so they work under such a prefix.

## HTTPS is required for notifications

Browsers only allow push notifications on HTTPS pages (or `localhost`). Put
the service behind a reverse proxy with a certificate, for example Caddy:

```
stats.example.org {
  reverse_proxy 127.0.0.1:8080
}
```

The live log uses Server-Sent Events (`/api/stream`), so the proxy must not
buffer responses. Caddy doesn't; for nginx set `proxy_buffering off` on that path.

Then open the page, go to **Notificări** and press **Activează**. On an
iPhone the page must first be added to the home screen.

## Importing a file

If the plugin also writes a file (`file = ...` in its config), missed events
can be imported at any time. Events already stored are skipped:

```sh
node server.js import /var/log/bzfs/webstats.jsonl
```

## API

| Method | Path | |
|---|---|---|
| POST | `/api/ingest` | events from the plugin |
| GET | `/api/stream` | live events (Server-Sent Events) |
| GET | `/api/events?types=kill,chat&player=KEY&q=text&before=ID&limit=100` | history |
| GET | `/api/live` | servers, online players, recent games, totals |
| GET | `/api/sessions` | games (from the first player joining until the server is empty) |
| GET | `/api/players?sort=kills&days=7` | leaderboard |
| GET | `/api/players/KEY` | statistics of one player |
| GET | `/api/push/key` | VAPID public key |
| POST | `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test` | push subscriptions |

Player keys are `bz:<BZID>` for players verified by the BZFlag list server,
and `cs:<lowercase callsign>` for everybody else.

## Tests

```sh
npm test
```
