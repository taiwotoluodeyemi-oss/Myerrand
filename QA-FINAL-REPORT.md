# Final QA — finished without external keys

## Scope
Everything that can be completed without Paystack, PayPal, SMTP, or Google Maps credentials.

## Core status
| Area | Status |
|------|--------|
| Register / login | Code + prior live PASS |
| Wallet escrow pay → accept → start → complete → payout | Prior live PASS |
| Double-accept protection | FOR UPDATE + affectedRows check |
| Dev deposit without Paystack (non-prod) | Explicit `dev_mode` credit |
| Profile stats / password / deactivate / download | Implemented |
| Terms + Privacy | Implemented |
| Email verify tokens | Implemented (send needs SMTP) |
| Gift card created_by | Fixed |
| Ratings / messages columns | Aligned |
| Maps without keys | Fallback UI |
| Static tests | 10/10 pass |
| Live retest this sandbox | BLOCKED (Aiven DNS) |

## External remaining
PAYSTACK_*, PAYPAL_*, SMTP_*, GOOGLE_MAPS_*

## Commands
```bash
npm install
npm test
node scripts/apply-qa-alignment.js
npm start
```
