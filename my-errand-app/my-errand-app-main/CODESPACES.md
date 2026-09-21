# GitHub Codespaces / quick start

## Automatic path (recommended)

1. Push this repo to GitHub and open a **Codespace**.
2. The `.devcontainer` runs `npm run setup` after create (installs deps + creates `.env`).
3. After the container is ready:

```bash
npm run bootstrap   # env + install + start MariaDB + wait for DB
npm run dev         # API (5000) + React (3001)
```

Or in one shot after first setup:

```bash
npm run start:all
```

## Manual path

```bash
npm run setup:env   # creates .env + JWT_SECRET, USE_MONGO=false
npm install
npm run install-client
npm run db:start    # Docker MariaDB + schema
npm run dev
```

## Ports

| Port | Service |
|------|---------|
| 5000 | API (`/health`, `/api/...`) |
| 3001 | React client |
| 3306 | MariaDB |

Forward them in the Codespaces **Ports** tab. CORS allows `*.github.dev` when `ALLOW_CODESPACES=true`.

## Notes

- Primary database is **MySQL/MariaDB** (`USE_MONGO=false`). Do not switch to Mongo unless you only need auth experiments.
- Payments need real Paystack/PayPal keys in `.env` for live deposits/withdrawals.
- Demo login: `POST /api/auth/demo-login` (see client Login page).
