# ETH wall monitor

A full-screen information display for an **Odroid H4 running Ubuntu + GNOME**.
It shows different pages depending on the time of day:

| Time            | Page                                                              |
|-----------------|-------------------------------------------------------------------|
| 11:00 – 12:30   | Lunch menus of **Polymensa** and **Clausiusbar**, with dish photos, prices and allergen/diet tags. The whole page alternates between **English and German** every 12 s. |
| 16:00 – 23:59   | **Tram/bus departure board** for *Zürich, ETH/Universitätsspital*, styled like the platform displays (line badge, destination, scheduled time + delay, countdown in minutes). |
| any other time  | A rotating deck of **flex pages** — currently a **RAM price watch** (price history of the 16 GB DDR5 module since the 01.10.2025 purchase at CHF 53.71, and what the 5 modules held are worth now) and the **news board**: a full-screen **20 Minuten** slideshow with a headline ticker, and a slim top bar carrying the clock and the day's schedule — the layout of the SBB platform displays at HB 41/42. |

Everything — time windows, station, mensa list, deck contents, refresh rates and
the revenue model's inputs — lives in [`config.json`](config.json) and is re-read
without restarting the server.

## How it works

```
config.json ──▶ server/server.js ──▶ web/ (vanilla ES modules, no build step)
                   │
                   ├── /api/menu?lang=en|de   ETH Gastro "cookpit" weekly rotas → today's lunch lines
                   ├── /api/tram              transport.opendata.ch stationboard
                   ├── /api/news              20 Minuten RSS front feed (parsed in-process)
                   ├── /api/ram-prices        hand-maintained DDR5 price series
                   ├── /api/image?u=…         photo proxy (ETH host only, disk-cached)
                   └── /api/config            the client half of config.json
```

- **No dependencies.** Node's stdlib only; the front end is plain ES modules.
- **Resilient.** Every upstream response is cached; if the API is unreachable the
  last good payload is served (`stale-on-error`) rather than a blank screen, and
  a failed fetch shows up as `OFFLINE` in the status bar instead of killing the page.
- **Self-healing.** The page reloads nightly at 04:00; `systemd` restarts the server.

## Install on the Odroid

```bash
git clone <this repo> ~/monitor && cd ~/monitor && ./scripts/install.sh
```

`install.sh` installs Node + Chromium if missing, registers a **user systemd unit**
for the data server, enables lingering so it survives logout, and drops a GNOME
**autostart entry** that launches Chromium in `--kiosk` mode on the next login.
The kiosk script also disables screen blanking and idle sleep.

Manual control:

```bash
systemctl --user status eth-monitor     # server
systemctl --user restart eth-monitor
~/monitor/scripts/kiosk.sh              # start the full-screen browser now
```

Local dev on any machine: `npm start`, then open <http://localhost:8080>.

## Keyboard (when a keyboard is attached)

| Key | Action |
|-----|--------|
| `←` / `→` | pin a page manually for 5 minutes |
| `Esc` | back to the schedule |
| `f` | request fullscreen |
| `r` | reload |

## Configuration notes

- `schedule` entries are `HH:MM` local time and may wrap past midnight. The first
  matching slot wins; when none match, `flexPages` rotate every `flexRotationSeconds`.
- `mensa.facilities` uses ETH Gastro facility IDs
  (`9` = Mensa Polyterrasse/Polymensa, `3` = Clausiusbar; the full list is at
  `https://idapps.ethz.ch/cookpit-pub-services/v1/facilities?client-id=ethz-wcms&lang=en`).
  `priceGroup` is `students`, `internal` or `external`.
- `tram.walkMinutes` greys out departures you can no longer catch.
- `news` picks the feed (`https://partner-feeds.20min.ch/rss/20minuten`, the
  20 Minuten front page), how many stories to hold (`count`) and how long each one
  stays up (`rotationSeconds`, 20 s). `flexRotationSeconds` (180 s) decides how long
  the news board holds the screen before the RAM page takes over, i.e. how many
  stories you see per turn. Any RSS 2.0 feed works — swap the URL
  and the `source` badge. Story photos go through the same cached image proxy as the
  mensa dishes; `image.20min.ch` is on the proxy's host allowlist in `server/server.js`,
  so add the image host too if you change feeds.
- `ram` drives the price-watch page: `purchaseDate`, `purchasePriceChf`, `units`
  and `resaleFeeRate` (marketplace/handling cut assumed when selling). The price
  series itself is `data/ram-price-history.json`, served by `/api/ram-prices` and
  **re-read on every request** — edit it and the board updates within 10 minutes
  (or instantly on the next page rotation).

  Each point carries `observed` and `basis`. `observed: true` means a price you
  actually saw in a shop; it renders as a white dot. Everything else is
  **modelled**: the series is anchored on your 53.71 purchase and scaled with the
  published DRAM moves listed in the file's `sources` (TrendForce quarterly
  contract-price revisions plus the reported January 2026 retail peak). Those are
  directionally right but they are *not* Swiss retail quotes — whenever you check
  Digitec/Brack, append the real number with `"observed": true` and the chart,
  KPIs and month-on-month table all follow it.

## Adding a page

Create `web/js/pages/<name>.js` exporting a factory that returns
`{ id, title, mount(stage), unmount() }`, register it in the `PAGES` map in
`web/js/app.js`, then reference `<name>` from `schedule` or `flexPages`.
Use `makeTimers()` from `web/js/util.js` so your intervals are cleaned up on unmount.

## Data sources

- ETH Gastro menus: `idapps.ethz.ch/cookpit-pub-services` (client id `ethz-wcms`), incl. dish images.
- Departures: [transport.opendata.ch](https://transport.opendata.ch) (SBB/VBZ realtime).
