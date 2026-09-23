# Finished without external keys

## What is complete without Paystack / PayPal / SMTP / Maps keys

### Core marketplace loop (wallet escrow — no card gateway required)
1. Register client & runner
2. Seed/fund spendable wallet (dev deposit when Paystack keys absent, non-production)
3. Create errand
4. Pay from wallet → escrow
5. Runner accept (approved verification) → start → complete
6. Escrow releases to runner withdrawable balance
7. Cancel unpaid errands
8. Wallet transfer between spendable / withdrawable

### Account & UI
- Real profile statistics from DB
- Change password
- Deactivate account
- Download my data (JSON export)
- Terms of Service + Privacy Policy pages
- Email verification **token** flow (hash + expiry); actual email send needs SMTP
- Maps UI falls back when Google keys missing (no crash)

### Data layer
- MySQL SSL + Aiven port support
- SQL string literals fixed for Aiven
- Multi-type wallets unique key
- Alignment script: `node scripts/apply-qa-alignment.js`
- Gift cards use `created_by`
- Ratings / messages / notifications column compatibility

### Dev deposit without keys
In non-production, if Paystack is not configured, `POST /api/wallet/deposit/create-intent` credits the spendable wallet and labels the transaction `dev_mode`. This is **not** real money.

### What still needs keys (cannot finish in code alone)
| Integration | Env vars |
|-------------|----------|
| Real card deposit / bank payout | PAYSTACK_* and/or PAYPAL_* |
| Real verification emails | SMTP_* |
| Live map geocoding | GOOGLE_MAPS_* |

### Commands
```bash
cd my-errand-app-main
cp env-copy.txt .env   # or edit .env
npm install
node scripts/apply-qa-alignment.js   # when DB reachable
npm test
npm start
```
