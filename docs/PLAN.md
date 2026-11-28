# Plan: transport tracker for Mainali Tour & Travels

## What we have today

Mehboob keeps one Excel sheet per day, named by date (`251126`, `261126`, ...). Each sheet has:

- **Trips**: Driver name (picked from a list of 13), No of pax (`4`, `6+1`), Place of visit as a short
  code (`3+m`, `m/3+r`, `vm`, `pkg`, `pkg njp`, `L.T.T`, `3p`), Collection (amount, or `cancel` / `no`),
  Amount received (tick box), Remarks (`T`, `cash`, notes).
- **Expenses**: Expense amount and Expense remarks written as "driver + item" (`lakpa oil`,
  `aniraj garage`, `norsang tyre`), plus an `opening balance` line on some days.
- **Totals** at the bottom: total collection, total expenses, and collection minus expenses.

### Problems found in the sheet

1. **Some totals are wrong.** On sheets `281126`, `291126`, `301126` and `copy Sheet` the collection
   total is `=SUM(D10:D17)`, so the first 8 trips of the day are left out. The 25 to 27 Nov sheets use
   `D2:D17` and are fine. Any new day copied from `copy Sheet` will under-count.
2. **Room for only 16 trips a day.** 27 Nov already has 15.
3. **No history of changes.** If an amount is changed later, nobody can see what it was or who changed it.
4. **No view across days.** Per-driver totals, unpaid cash and monthly profit need manual adding up.
5. **"Opening balance" is entered as an expense**, so the day's net mixes cash carried over with real costs.
6. **Same thing written different ways** (`3+R/M` / `3+r/m`, `Abhishek` / `Avishek`, `cancel` / `cancle`),
   which makes totals by place or driver unreliable.

## What the app does (this demo)

### For Mehboob (staff login)
- **Day sheet**: the same columns as Excel, one screen per day, prev/next/date picker.
  Add trip: tick the driver(s), pax, place code (suggested from the list), status, collection, paid by, received.
  Add expense: type "lakpa oil" and the driver and type (Fuel) fill in automatically.
- Totals add themselves up: no formula ranges to break, no row limit.
- **Who took the money**: each trip says whether the driver collected it (he hands it in later) or the
  customer paid the office directly. Each expense says whether the office paid or the driver paid it out of
  the cash he is holding (e.g. fuel on the road).
- **Driver cash**: when a driver comes in and hands over money, Mehboob records it (amount, cash/UPI,
  note like "short by 500"). Every driver has a running balance:
  collected from customers − paid from that cash − handed in = **still holding**.
  Handovers clear the oldest trips first, so every trip shows "with driver" or "handed in".
- Can add and edit, **cannot delete**. Every save is logged.

### For the owner
- **Dashboard** for today / yesterday / 7 days / this month / 30 days / all time:
  collection, expenses, net, cancelled trips, and **cash with drivers right now** (and how old the oldest money is).
  Daily collection vs expenses chart (click a day to open its sheet).
  Per driver: trips, collection, car expenses, net, cash he is holding now.
- **Driver cash** page and a **statement per driver** (like a bank statement: each trip, each fuel bill
  paid from cash, each handover, and the balance after each). Drivers holding money for more than
  3 days are shown in red.
  Expenses by type (fuel, garage, tyres...). Places of visit with average charge vs usual rate (low ones in red).
- **Activity log**: who added, changed or deleted what and when, with old → new values.
  Changes to an earlier day's sheet are flagged, and the dashboard warns when there are any.
- **Drivers & cars**: each driver with car number and model; mark inactive when someone leaves.
  **Places**: write down what each code means and the usual rate.
- **Import / export**: import the Excel file (all day sheets at once), export CSV for backup or the
  accountant, import CSV.

### Data model

| Table | Fields |
|---|---|
| drivers | name, phone, car number, car model, active, notes |
| places | code (`3+m`), meaning, usual rate, active |
| trips | date, driver(s), pax, place, collection, status (done / cancelled / no charge), received, paid by (Cash / T), remarks, entered by, entered at, edited at |
| trips (cont.) | collected by (driver / office) |
| expenses | date, amount, driver, type, paid by (office / driver from cash), remarks, entered by, entered at, edited at |
| handovers | date, driver, amount, how (cash / UPI / bank), received by, note, entered by |
| activity | time, user, action, record, summary, old → new values, earlier-day flag |

Shared trips (`Aniraj, Norsang`) split the money evenly between the drivers in per-driver totals.
Opening balance is kept on the day sheet but left out of expense totals and profit.

## Questions to confirm

1. What does **T** in Remarks mean (online / transfer / something else)? And `s112`, `13S`?
2. What do the place codes mean (`3+m`, `vm`, `L.T.T`, `3p` ...), and the usual rate for each?
3. Is **opening balance** cash carried over from the day before (as the app assumes), or a real cost?
4. Real car numbers for each driver.
5. Do drivers get a salary or per-trip pay that should be tracked as an expense?

## Next steps

1. **Try it** with the real Excel (remove demo data, import). Mehboob uses it next to Excel for a week.
2. **Put it online** so Mehboob can use it from a phone and the owner can check from anywhere.
   Simplest: a small server (Render, Railway or a ₹400-600/month VPS) running `node server.js` with a
   persistent disk for `data/`, plus a domain and HTTPS. Daily backup of `data/db.json`.
3. **Proper logins**: one account per person with a password instead of shared PINs, and a way to
   reset them. Add more staff accounts if others start entering.
4. **Move to a real database** (SQLite on the server, or hosted Postgres such as Supabase) once more than
   a couple of people enter data at the same time, or when we add the items below.
5. **Later, if useful**: daily WhatsApp/email summary to the owner (collection, expenses, cash pending),
   lock a day once the owner has checked it, km readings and fuel efficiency per car, driver pay
   and advances, monthly PDF report, bookings for future dates.
