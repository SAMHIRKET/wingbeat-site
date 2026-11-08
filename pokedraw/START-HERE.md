# Run Pokédraw on your own machine

This is the self-hosted Node + SQLite version. It does not need ChatGPT hosting, a ChatGPT account, or a separate database service. The current visuals are a prototype. Music is absent until approved.

The machine needs Linux with Docker Engine and the Docker Compose plugin. A current Docker-capable NAS may also work. The package uses Node 24 in its container, so your laptop's Node 22 installation does not need changing. Exact Docker installation steps depend on the machine's operating system.

## First: run it locally

Extract this folder on the always-on machine. In a terminal inside that folder:

```sh
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Open `http://localhost:3000` on that machine. The first run downloads the container image and builds the app.

To test from a phone or another computer on your home network, change `LAN_BIND` in `.env` to `0.0.0.0`, run `docker compose up -d` again, and open `http://YOUR-SERVER-LAN-IP:3000`. Use the machine's actual LAN address. Do not forward port 3000 from the router. Some browser features, such as native sharing, need HTTPS; the public setup below supplies it.

## Then: use draw.wingbe.at

The existing wingbe.at homepage can stay on GitHub Pages. Only the `draw` subdomain points at this game.

The included public setup uses Caddy to provide HTTPS automatically. It requires a reachable public IP, DNS for `draw.wingbe.at` pointing to it, and TCP ports 80 and 443 forwarded to this machine. UDP 443 is optional for HTTP/3. Reserve the machine's LAN address in the router so the forwarding destination does not change. Use a DNS-only record for this direct setup. Add an AAAA record only if inbound IPv6 is also configured correctly.

If the ISP uses CGNAT, blocks incoming ports, or the public IP changes, finish local testing first. We can choose a tunnel or dynamic DNS route after checking your router and DNS provider. Do not replace your main site's DNS records or move nameservers just to try this package.

Once the DNS and inbound connectivity are ready:

```sh
docker compose -f compose.yaml down
docker compose -f compose.https.yaml up -d --build
docker compose -f compose.https.yaml logs --tail=50 caddy
```

The two configurations use the same project and room volume, so switching preserves rooms. The public configuration exposes only Caddy; the app's HTTP port remains private inside Docker. Use `https://draw.wingbe.at` after certificate issuance succeeds. The server and proxy need to remain running.

## Keep rooms across restarts

Room data lives in the named Docker volume `wingbeat-pokedraw_rooms`, outside the replaceable app container. Restarting or rebuilding the container preserves it. The room engine deletes rooms and their drawings after 24 hours without game activity; host deletion also removes room drawings. Player downloads remain on their devices.

For a normal stop, use `docker compose down` (local) or `docker compose -f compose.https.yaml down` (public). **Do not add `-v`** unless you intend to delete the room database and, for the public setup, saved certificates.

To update the public app, replace the source files while keeping `.env`, then run:

```sh
docker compose -f compose.https.yaml up -d --build
```

If you intentionally want newer base images as well, build with `--pull` before starting. Review updates before applying them to an active game. A restart can briefly disconnect players; their seats and saved drawings persist.

## Checks and source

`npm test` runs the game, hint and HTTP tests on Node 24+. Docker is not needed for those checks. `/healthz` checks that the app and its database are responding; Docker uses it for health reporting. Docker restarts an exited process, but an unhealthy health status alone is not an automatic restart.

The app uses five-character room codes, guest seats, private rooms by default, public-room browsing, server deadlines, autosave, anonymous voting, downloadable cards, and the original 151 prompts. Hints fetch card images from TCGdex; other game state is kept on your server.

The current limits are 200 rooms, 12 active players per room, 10 rounds, 1.5 MB per drawing, 16 MiB of drawings per room and 256 MiB across rooms. Run one app instance against this SQLite database. Host kicking revokes a seat but is not a persistent identity ban; stronger moderation remains future work. Phone layout has browser testing; physical iOS/Android and stylus acceptance still need real-device checks.

Reference setup documentation:
- Docker Engine: https://docs.docker.com/engine/install/
- Docker Compose: https://docs.docker.com/compose/
- Caddy reverse proxy and HTTPS: https://caddyserver.com/docs/quick-starts/reverse-proxy
