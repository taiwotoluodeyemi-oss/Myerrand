# Wallet → Gift Card Commerce (manual fulfillment)

## Audit (existing app)
- React SPA + Express + JWT + MySQL wallets (spendable/withdrawable/escrow)
- Paystack deposit + webhook/verify already present
- User-issued wallet gift codes (`/api/wallet/giftcards/*`) preserved
- Catalog / orders / manual fulfill **added**

## Implementation map vs prompt

| Requirement | Status |
|-------------|--------|
| NGN wallet debit/credit/refund + txn record | PASS (extends existing wallets) |
| Server-side price only | PASS |
| Atomic purchase transaction | PASS |
| Catalog with region + NGN price | PASS |
| Order price frozen at purchase | PASS |
| Manual admin fulfillment + encrypted code | PASS |
| Customer reveal code (owner only) | PASS |
| Cancel unfulfilled → refund | PASS |
| Deposit min/max from platform_settings | PASS |
| Risk under_review after large recent deposit | PASS (configurable) |
| Admin product CRUD UI | PASS `/admin/gift-products` |
| Admin fulfill UI | PASS Admin dashboard |
| Admin wallet adjust + reason + audit | PASS |
| Audit log API | PASS |
| Paystack live keys | BLOCKED (external) |
| Full risk scoring UI / date filters | PARTIAL |
| balance_before/after columns on all tx rows | PARTIAL (returned on purchase response) |

## Customer flow
Register → deposit NGN → `/gift-cards` → buy → wait → `/gift-card-orders` → Reveal code

## Admin flow
`/admin/gift-products` manage catalog → `/admin` fulfill pending → customer notified

## Schema
`npm run align-db` applies `05` + `06-gift-card-commerce.sql`

## Env
GIFT_CODE_SECRET, PAYSTACK_*, MYSQL_*, JWT_SECRET

## Static tests
13+ surface tests PASS. Live end-to-end requires reachable MySQL.
