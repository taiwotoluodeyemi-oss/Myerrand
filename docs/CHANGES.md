# Changes in this update

## 1. Balance display bug — root cause found and fixed

The actual bug: **MySQL's `mysql2` driver returns `DECIMAL` columns as strings** (e.g. `"50.00"`), not JavaScript numbers. Balances flow from the DB, through `utils/wallet-utils.js`, into API responses, and straight into the React UI — which called `.toFixed(2)` on them directly. Calling `.toFixed()` on a string throws a `TypeError` and crashes that part of the render, which is why balances would show blank/broken.

This was reproduced directly:
```js
0 + "50.00"           // "050.00"  (string concatenation, not addition!)
"50.00".toFixed(2)    // TypeError: "50.00".toFixed is not a function
```

**Fixed at the source** — `utils/wallet-utils.js`'s `getAllWalletBalances()` now `parseFloat`s every balance before it leaves the backend (it was also silently doing string concatenation instead of addition when totaling multiple wallets, e.g. `"50.00" + "20.00"` → `"50.0020.00"`).

**Also hardened defensively on the frontend** (`Number(x || 0).toFixed(2)` instead of `x.toFixed(2)`) everywhere a balance or amount is displayed, so this class of bug can't resurface even if another endpoint ever returns a raw DB value again:
- `client/src/App.jsx` (header balance — this one broke on *every* page since the header renders everywhere)
- `client/src/pages/ClientDashboard.jsx`, `RunnerDashboard.jsx`
- `client/src/pages/Profile.jsx` (`user.balance`)
- `client/src/pages/PayNow.jsx` (`getWalletBalance`)
- `client/src/pages/Home.jsx` (earnings total, balance stat, per-errand amount — `errand.amount` is also a DECIMAL string)
- `client/src/pages/ErrandList.jsx` (per-errand amount)

On top of that root cause, three additional bugs in the Wallet page (`client/src/components/WalletManager.jsx` / `routes/wallet.routes.js`) were also fixed:

1. **Total balance never reflected the selected currency.** The "Total Account Balance" number came from `GET /api/wallet/wallets`, which summed a user's balance across *every* currency they hold (e.g. a $50 USD wallet + a ₦2,000 NGN wallet became "2050"), then labeled that sum with whatever currency was picked in the dropdown.
   - Fixed: `/api/wallet/wallets` now accepts `?currency=` and only sums wallets in that currency.
2. **Switching currency did nothing.** The frontend called `GET /api/wallet/balance-summary` (correctly currency-scoped) but threw the response away, and never re-fetched `/wallets` when the currency dropdown changed.
   - Fixed: the currency `<select>` now re-fetches both wallets and the balance summary.
3. **Spendable/Withdrawable cards were hardcoded to USD.** `getWalletBalance()` filtered wallets with `w.currency === 'USD'` regardless of what was selected.
   - Fixed: now filters by the selected currency.

## 2. Gift card reward system — new

Users can convert part of their **spendable balance** into a gift card, and redeem a gift card code into their spendable balance.

- `database/gift-card-system.sql` — new `gift_cards` table + extends `wallet_transactions.transaction_type` with `gift_card_issue` / `gift_card_redeem`. Run via `npm run setup-gift-cards` (or apply the `.sql` file directly).
- `routes/wallet.routes.js` — new endpoints:
  - `POST /api/wallet/giftcards/create` `{ amount, currency, message? }` — deducts from spendable balance, returns a unique code like `GIFT-AB12-CD34-EF56`.
  - `POST /api/wallet/giftcards/redeem` `{ code }` — credits the caller's spendable balance.
  - `GET /api/wallet/giftcards/mine` — cards the user created and/or redeemed.
- **Redemption safety:** both endpoints run inside a single held DB connection with `SELECT ... FOR UPDATE` row locks, so a code can never be redeemed twice even under concurrent requests — the card's `status` flips from `active` to `redeemed` atomically with the wallet credit.
- `client/src/components/WalletManager.jsx` — new "🎁 Gift Card Rewards" panel: create a card, redeem a code, and view history.

## 3. Payment methods — real logic instead of simulated/dead code

- **Withdrawals were broken for anything but PayPal.** The old code only handled `method_type === 'paypal'` (and even that was hardcoded to `withdrawalSuccessful = true` with a fake ID, never actually calling PayPal). Any bank-transfer withdrawal method silently returned "Withdrawal processing failed" — there was no working payout path at all.
- **Now:**
  - PayPal payouts call the real PayPal Payouts API, gated behind `isPaypalPayoutsConfigured()` — activates once `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, and `PAYPAL_PAYOUTS_ENABLED=true` are set in `.env`.
  - Bank transfer withdrawals call the real Paystack Transfer Recipient + Transfer APIs, gated behind `isPaystackConfigured()` — activates once `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` are set in `.env`.
  - If credentials aren't set, the API now returns a clear `503` explaining exactly which env vars to add, instead of silently faking success or opaquely failing.
  - `utils/payment-config.js` — new helper that centralizes these readiness checks.
- **There was no UI to add a payout method at all**, so the withdraw dropdown was always empty. Added a "+ Add a payout method" form in `WalletManager.jsx` (bank account or PayPal email) that calls the existing `POST /api/wallet/withdrawal-methods` endpoint.
- `.env.example` updated with `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `PAYPAL_PAYOUTS_ENABLED`.

## What you need to do to go live

1. `npm install && npm run install-client` (this environment has no network access, so dependencies were **not** installed here — do this on your machine/server).
2. Fill in `.env` from `.env.example`: MySQL credentials, `JWT_SECRET`, PayPal and Paystack keys.
3. Run the DB setup scripts in order:
   ```
   npm run setup-db
   node scripts/setup-wallet-system.js
   npm run setup-gift-cards
   ```
4. `npm run build` (web) — builds `client/dist`, served automatically when `NODE_ENV=production`.
5. `npm start`.

### For the mobile (Cordova) build
6. `npm run build:cordova` — builds the client and copies it into `www/`.
7. `npx cordova platform add android` (first time only).
8. `npx cordova build android` — produces the installable `.apk`.

> Note: nothing in this environment could reach npm's registry, a live database, or PayPal/Paystack's sandbox, so none of this was run end-to-end here. The code has been reviewed and syntax-checked, but please test the above steps in your own environment before deploying.

## 4. Code-audit pass (no network access, so nothing was run live — static review only)

- **Fixed:** `scripts/setup-database.js` and `scripts/setup-wallet-system.js` read `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`, but `.env.example` only defines `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` (which is what `config/db.mysql.js` actually uses at runtime). Following the README's own setup steps with a `.env` built from `.env.example` would have made these two scripts silently fall back to `localhost` / `root` / no password instead of your real database. Both scripts now check `MYSQL_*` first, falling back to `DB_*` for compatibility (matching the pattern already used in `setup-gift-card-system.js`).
- **Fixed:** a corrupted root-level `QueryBuilder.js` had literal `\`` / `\${` sequences instead of real template-literal syntax — a `SyntaxError` on load. It wasn't required from anywhere (dead code), so it wasn't crashing the running app, but it's now valid JS.
- **Removed dead/duplicate files** that were never `require`'d or imported by the running app, to reduce confusion for future edits: the entire `server/` folder (an older, unused duplicate of `app.js`/`routes`/`services`/etc.), root `QueryBuilder.js`, `services/DatabaseService.js`, `config/db.js`, `sockets/server.js`, `routes/app.js`, `routes/AuthService.js`, and `client/src/src/` (a stray nested copy of one component). None of these were referenced by `server.js` → `app.js` or by any client entry point.
- **Verified:** every relative `require()`/`import` across the server and client resolves to a real file; all server `.js` files pass `node --check`; all client `.jsx`/`.js` files pass a TypeScript syntax-only parse (JSX/ESM syntax, no type errors possible to fully check without `npm install`); the balance-string (`DECIMAL` → JS string) fix from the previous pass is applied consistently everywhere `.toFixed()` is called on a wallet/gift-card amount; the gift card schema, backend routes, and frontend calls agree on column names and response shapes; JWT payload field names (`id`) are used consistently between sign and verify.
- Documented `DB_CONNECTION_LIMIT` / `DB_ACQUIRE_TIMEOUT` (optional MySQL pool tuning, both already had safe defaults) in `.env.example`.
- **What this doesn't cover:** this environment has no network access (same limitation as the prior pass), so nothing was actually installed, started, or hit with a request — no `npm install`, no live DB, no PayPal/Paystack sandbox call. The above is static review (syntax, imports, cross-file consistency), not a live test.

## 5. Critical fix: broken money-movement transactions, + live tracking map — new

- **Fixed (critical):** `routes/wallet.routes.js`'s `/transfer`, `/withdraw`, and `/transfer-to-spendable` all called `db.beginTransaction()` / `db.commit()` / `db.rollback()` directly on the connection **pool**, which mysql2's `PromisePool` doesn't implement (only a checked-out connection does — the gift card routes and `auth.routes.js` already used the correct pattern). This threw a `TypeError` on every call. For `/withdraw` specifically, the real PayPal/Paystack payout API call happens *before* this — so real money was leaving the platform while the balance deduction and transaction record silently failed. All three now use `db.getConnection()` + `connection.beginTransaction()/commit()/rollback()/release()`.
- **Fixed:** `/withdraw`, `/transfer`, and `/transfer-to-spendable` also had an unlocked check-then-update race — the balance check happened as a separate, unlocked read before the update, so concurrent requests could both pass the check. All three now lock the relevant wallet row with `SELECT ... FOR UPDATE` inside the transaction before deducting. For `/withdraw`, the lock is acquired *before* the payout API call, closing the window where two concurrent requests could both trigger a real payout.
- **Removed:** `routes/payment.routes.js` and its mount in `app.js`. It duplicated withdrawal/payment-capture functionality with old, fake logic (`withdrawalSuccessful = true` with no real payout call, no auth ownership check on `capture-order`), was still live at `/api/payments/*`, and the frontend never called it — `routes/wallet.routes.js` is the real implementation.
- **Renamed:** "My Errand App" → "My Errand" across the client UI (`<title>`, headers, login/register pages), `README.md`, and the withdrawal payout email subject line.
- **New: live tracking map.** `ClientDashboard.jsx`'s "Mini Map Placeholder" is now a real Google Map (`components/ErrandTrackingMap.jsx`) once an errand is `assigned`/`in_progress`, showing pickup and delivery pins plus the runner's live position, polled every 8s.
  - `GET /api/errands/:id/tracking` (new, in `errands.routes.js`) geocodes pickup/delivery addresses on first request via `utils/geocode.js` and caches the result on the errand row; returns the runner's last-known position if there's an active engagement.
  - `POST /api/errands/:id/runner-location` (new) lets the assigned runner push their position; `RunnerDashboard.jsx` now calls this automatically via `navigator.geolocation.watchPosition` (throttled to one POST per 10s) whenever the runner has an active errand.
  - New DB columns: `errands.pickup_latitude/longitude`, `errands.delivery_latitude/longitude`, `users.current_latitude/longitude/location_updated_at` — added to `database/complete-schema.sql` (fresh installs) and `scripts/align-schema.js` (existing DBs — run `npm run db:align`).
  - **Needs two Google API keys you provide** (see `.env.example` for the full explanation of why there are two): `GOOGLE_MAPS_API_KEY` — public, baked into the client bundle at build time via webpack, restrict by HTTP referrer, enable "Maps JavaScript API". `GOOGLE_MAPS_SERVER_KEY` — secret, server-only, used for geocoding, restrict by server IP, enable "Geocoding API". Without either key, the map falls back to the old plain-address display instead of breaking.
  - **Not run live here** (no network access in this environment): the map rendering, geocoding calls, and geolocation reporting are all written and syntax-checked, but untested against a real Google Maps key, a real browser's geolocation, or a live DB with the new columns.

## 6. Ratings, runner verification, and chat/notifications — new

- **Ratings:** `routes/ratings.routes.js` (mounted at `/api/ratings`). `POST /:errand_id` — either party on a *completed* errand rates the other (1-5 stars + optional review + sub-ratings), one rating per direction, enforced by the existing DB `UNIQUE(errand_id, rater_id)` constraint. Recomputes and stores `average_rating` on the rated user's `clients`/`runners` row. `GET /user/:user_id` returns a public average + recent reviews. Frontend: `RatingForm.jsx`, shown on completed errand cards in both dashboards.
- **Runner verification:** `routes/verification.routes.js` (mounted at `/api/verification`). This is a manual-review flow — there's no third-party background-check API (Checkr etc.) integrated, so "background check" means a runner uploads an ID document (`POST /submit`, multer → `uploads/verification/`) and an admin approves/rejects it (`POST /admin/:runner_user_id/decision`). **`POST /api/errands/:id/accept` now hard-gates on `background_check_status = 'approved'`** — this is a real behavior change: new signups can't accept errands until approved. Documents are served only via an admin-only, DB-path-only route (`GET /admin/document/:runner_user_id`), not static-served, since they're ID photos. Frontend: a status/upload card in `RunnerDashboard.jsx`, a review queue in `AdminDashboard.jsx`.
- **Chat:** `routes/messages.routes.js` (mounted at `/api/messages`), backed by a new `messages` table. Open only while an errand is `assigned`/`in_progress` (same rule as live tracking). Persists to DB and pushes live via Socket.IO to an `errand:<id>` room. Frontend: `ChatPanel.jsx` on both dashboards.
- **Notifications:** `routes/notifications.routes.js` (mounted at `/api/notifications`) plus `utils/notify.js`, a shared helper used from `errands.routes.js` (accepted / started / completed), `ratings.routes.js` (new rating), `verification.routes.js` (approved/rejected), and `messages.routes.js` (new message). Persists to the existing `notifications` table and pushes live to a `user:<id>` room. Frontend: `NotificationBell.jsx` in the header, polls every 20s as a fallback and listens for the live push.
- **Fixed a real security hole while building this:** `sockets/socketHandler.js`'s `join` handler let any authenticated socket join *any* `user:<id>` or `errand:<id>` room — meaning any logged-in user could have eavesdropped on any other user's chat or notifications just by guessing an ID. It now checks you're joining your own `user:` room, and that you're actually the client or assigned runner before joining an `errand:` room.
- **Infra:** `server.js` now does `app.set('io', io)` so route handlers can reach the socket server via `req.app.get('io')`. `client/src/utils/socket.js` loads the Socket.IO client from a CDN (`cdn.socket.io`, pinned to the server's 4.8.1) rather than an npm dependency — same pattern as the Google Maps loader, since this environment can't `npm install`.
- **Fixed `scripts/seed-demo.js`:** it only ever inserted a `users` row, never the matching `clients`/`runners` detail row the registration endpoint creates — so the seeded demo runner had no verification status at all. It now creates both, and pre-approves the demo runner so the seed account isn't blocked by the new verification gate.
- **Not run live here** (no network access in this environment): all of the above is written and syntax-checked, not exercised against a real DB, a real browser socket connection, or real file uploads.
