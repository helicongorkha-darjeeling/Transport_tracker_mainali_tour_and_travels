# Transport Tracker · Mainali Tour & Travels

A small web app that replaces the daily Excel sheet Mehboob keeps for the cars and drivers.
Mehboob fills in the same columns as before (driver, pax, place of visit, collection, remarks,
expenses) and records when a driver hands in the cash he collected. The owner gets a live dashboard,
how much cash each driver is holding (with a statement per driver), and a log of every entry and edit.

The plan behind it (features, roles, hosting, next steps) is in [docs/PLAN.md](docs/PLAN.md).

## Run it

You need [Node.js](https://nodejs.org) 18 or newer (the LTS download). Nothing else to install.

- **Mac:** double-click `Start Tracker.command` (the first time, right-click it → Open, because it's
  a downloaded script). It uses Node from your PATH, or finds a Node folder you unzipped into
  Downloads (like `~/Downloads/node-v26.13.1-darwin-arm64`). **Windows:** double-click `Start Tracker.bat`.
- Or in a terminal: `node server.js`

It opens http://localhost:3000. Log in:

| Who | PIN | Sees |
|---|---|---|
| Owner | `1234` | Dashboard, day sheet, driver cash, drivers & cars, activity log, import/export |
| Mehboob (staff) | `1111` | Day sheet and driver cash (records handovers) |

Change the PINs in `data/db.json` (`users`) before real use.

The first start creates `data/db.json` with **made-up demo data** (45 days, the 13 drivers from
the sheet) so the dashboard has something to show. To use your real data:

1. Log in as owner and open **Import / export**.
2. Click **Remove demo entries**.
3. Pick your `Transport Tracker.xlsx`. Each sheet named like `261126` becomes 26 Nov 2026.
   Importing the same file again replaces those days rather than adding them twice.

Other commands:

```bash
node scripts/seed.js --reset          # replace everything with fresh demo data
node scripts/seed.js --reset --empty  # start with an empty tracker (drivers and places kept)
PORT=8080 DATA_DIR=/var/tracker node server.js   # different port / data folder
```

## Putting it on GitHub

```bash
git init -b main && git add . && git commit -m "Transport tracker prototype"
git remote add origin https://github.com/helicongorkha-darjeeling/Transport_tracker_mainali_tour_and_travels.git
git push -u origin main
```

`data/` is in `.gitignore`, so your real numbers stay on your computer.

## What's where

| Path | What |
|---|---|
| `server.js` | Web server and JSON API, roles, activity log, CSV export/import, Excel day import |
| `public/` | The web app (plain HTML, CSS, JavaScript) |
| `public/vendor/xlsx.core.min.js` | SheetJS 0.18.5 (Apache-2.0), reads the .xlsx in the browser |
| `scripts/seed.js` | Demo data in the same shape as the Excel sheet |
| `public/brand/` | Mainali Tour & Travels logo (animated and static) and the knot emblem, adapted from the Mainali Hospitality artwork |
| `public/fonts/` | DM Sans and Inter (SIL Open Font License), bundled so the app works offline |
| `data/db.json` | The data (not committed; back it up) |
