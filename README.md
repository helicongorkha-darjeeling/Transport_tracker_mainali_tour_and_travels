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
| Mehboob (staff) | `1111` | Dashboard (to look at), day sheet and driver cash (records handovers) |

Change the PINs before real use: log in as owner, **Import / export → Logins and PINs**.

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

## Online (Vercel + a Postgres database)

The same app runs online so Mehboob can use it from a phone and the owner can check from anywhere.
Vercel serves the pages and runs `api/index.js` for the data. The data is kept in a Postgres
database, in its own `tracker` section. The easiest database is a free **Neon** one added from
inside Vercel, which fills in the database address by itself. Any Postgres works (Supabase too).

One-time setup:

1. **Add a database.** In the Vercel project, open **Storage → Create Database**, pick **Neon**
   (Serverless Postgres), choose the free plan and the **Mumbai (ap-south-1)** region, and connect it
   to this project. Vercel adds the database address to the project's settings for you (the tracker
   finds it whether it's called `DATABASE_URL`, `POSTGRES_URL` or `STORAGE_URL`, with or without a prefix).
2. **Set the first PINs.** Under **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `OWNER_PIN` | the owner's PIN (4 to 8 digits) |
   | `STAFF_PIN` | Mehboob's PIN |

   They are only used the first time, when the tracker creates its tables, so the demo PINs never
   work online. After that, change PINs and add staff logins in the app under
   **Import / export → Logins and PINs**.
3. **Redeploy** (Deployments → the latest one → Redeploy). The first visit creates the tables and the
   demo entries. Remove the demo entries and import the Excel from **Import / export** when you're
   ready. Set `NO_SEED=1` as well to start empty.

With another Postgres instead of Neon, put its address in `DATABASE_URL` yourself (for Supabase, use
the **Transaction pooler** address from **Connect**, because Vercel can't reach the direct one).

Online, 10 wrong PINs from one place lock that place out for 15 minutes, and the login page shows the
demo PINs only while they still work. To bring data from a computer copy online, export the CSVs there
and import them online.

To try the online version on your own computer: `npm install`, then
`DATABASE_URL=postgres://... node server.js`.

## What's where

| Path | What |
|---|---|
| `server.js` | Runs the tracker on your own computer (web pages + API, data in `data/db.json`) |
| `lib/tracker.js` | The JSON API: roles, logins and PINs, activity log, CSV export/import, Excel day import |
| `lib/store-file.js`, `lib/store-pg.js` | Where the data is kept: a JSON file, or Postgres (online) |
| `api/index.js`, `vercel.json` | The online version on Vercel |
| `public/` | The web app (plain HTML, CSS, JavaScript) |
| `public/vendor/xlsx.core.min.js` | SheetJS 0.18.5 (Apache-2.0), reads the .xlsx in the browser |
| `scripts/seed.js` | Demo data in the same shape as the Excel sheet |
| `public/brand/` | Mainali Tour & Travels logo (animated and static) and the knot emblem, adapted from the Mainali Hospitality artwork |
| `public/fonts/` | DM Sans and Inter (SIL Open Font License), bundled so the app works offline |
| `data/db.json` | The data (not committed; back it up) |
