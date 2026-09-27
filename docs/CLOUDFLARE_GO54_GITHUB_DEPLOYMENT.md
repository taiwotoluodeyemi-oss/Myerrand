# My Errand — Cloudflare Pages + GitHub + GO54

## Target architecture

- GitHub repository: `taiwotoluodeyemi-oss/myerrand`
- Public frontend: `https://myerrand.name.ng`
- Cloudflare Pages: React/webpack frontend
- API: `https://api.myerrand.name.ng`
- API hosting: GO54 cPanel Node.js/Passenger
- Database: MySQL/MariaDB on GO54 or the configured external MySQL service
- GitHub Actions: CI checks; Cloudflare Pages Git integration performs the frontend production deployment

Cloudflare Pages should be connected to the GitHub repository rather than using a manually uploaded `dist` directory. This preserves automatic deployments and PR previews.

## 1. Cloudflare Pages project

Create a Pages project from the GitHub repository `taiwotoluodeyemi-oss/myerrand`.

Use these build settings:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `client` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `20` |

Cloudflare Pages environment variable:

```text
API_BASE=https://api.myerrand.name.ng
```

If Google Maps is enabled in the production frontend, add the appropriate public browser key as `GOOGLE_MAPS_API_KEY`. Do not put backend secrets in Pages environment variables.

The repository contains `client/public/_redirects` so React Router routes continue to resolve to `index.html` on direct navigation.

## 2. Custom domain

In Cloudflare Pages:

1. Open the Pages project.
2. Open **Custom domains**.
3. Add `myerrand.name.ng`.
4. Complete the DNS activation shown by Cloudflare.

If `name.ng` is managed as a Cloudflare zone, Cloudflare can create the Pages CNAME automatically after the custom domain is associated with the Pages project. If DNS remains at GO54, create the CNAME shown by Cloudflare at GO54 instead.

Do not create a Pages CNAME manually before associating the custom domain with the Pages project.

## 3. Backend hostname

Use:

```text
api.myerrand.name.ng
```

Point this hostname to the GO54 Node.js application origin. If the `name.ng` zone is managed by Cloudflare, create the DNS record in Cloudflare. Use the actual GO54 origin hostname/IP; never guess it.

Recommended record when GO54 provides a stable hostname:

```text
Type: CNAME
Name: api
Target: <GO54-origin-hostname>
Proxy: as appropriate for the GO54 application
```

If GO54 provides only an origin IP, use an A record instead.

## 4. GO54 Node.js application

The existing backend starts with:

```text
server.js
```

Recommended cPanel Node.js application values:

```text
Application root: /home/<cpanel-user>/myerrand
Application URL: https://api.myerrand.name.ng
Startup file: server.js
Environment: Production
Node.js: 20.x (or the newest compatible LTS offered by GO54)
```

Upload the repository backend files to the application root. Do not upload `.env` files containing secrets through GitHub.

Install dependencies from the GO54 Node.js application environment:

```bash
npm ci --omit=dev
```

If the hosting panel requires a normal install instead, use:

```bash
npm install --omit=dev
```

Set the backend environment variables in cPanel/Node.js App rather than committing them.

Minimum production configuration includes:

```text
NODE_ENV=production
PORT=<GO54-assigned-port-if-required>
USE_MONGO=false
MYSQL_HOST=<GO54-or-external-mysql-host>
MYSQL_PORT=3306
MYSQL_USER=<database-user>
MYSQL_PASSWORD=<database-password>
MYSQL_DATABASE=<database-name>
JWT_SECRET=<long-random-secret>
CLIENT_URL=https://myerrand.name.ng
FRONTEND_URL=https://myerrand.name.ng
```

Also configure the required payment, webhook, MFA/encryption, SMTP/SMS and maps variables from `.env.example` according to the services actually enabled.

## 5. Database

Use the existing database migrations/schema shipped with the repository. Run them against an isolated production database only after reviewing the deployment runbook and taking a backup/rollback point.

Do not put database credentials in GitHub, Cloudflare Pages, or committed files.

## 6. CORS and API base URL

The frontend build uses `API_BASE` for cross-origin API requests. Production Pages must therefore use:

```text
https://api.myerrand.name.ng
```

The backend must allow:

```text
https://myerrand.name.ng
```

The current backend already supports `CLIENT_URL` / `FRONTEND_URL` and includes the production frontend hostname in its allowed-origin configuration.

## 7. Paystack callback URL

The backend payment integration derives the payment callback from `FRONTEND_URL`. Therefore production must set:

```text
FRONTEND_URL=https://myerrand.name.ng
```

Do not use the Pages `*.pages.dev` hostname as the customer-facing callback URL once the custom domain is active.

## 8. GitHub Actions

The repository includes `.github/workflows/ci.yml`.

It performs two independent checks:

1. Backend `npm ci` + `npm test`.
2. Frontend `client/npm ci` + production webpack build with `API_BASE=https://api.myerrand.name.ng`.

Cloudflare Pages Git integration remains responsible for the actual Pages deployment. This avoids duplicating the Pages deployment mechanism with a second CI/CD path.

## 9. Branch flow

Recommended flow:

```text
feature branch
    |
    +--> Pull request
    |       |
    |       +--> GitHub Actions CI
    |       +--> Cloudflare Pages preview
    |
    +--> merge to main
            |
            +--> GitHub Actions CI
            +--> Cloudflare Pages production deployment
```

## 10. Production verification

After both services are deployed:

```text
https://myerrand.name.ng
https://api.myerrand.name.ng/health
```

Verify:

- Pages deployment is successful.
- `myerrand.name.ng` has a valid Cloudflare certificate.
- Frontend requests go to `api.myerrand.name.ng`.
- API CORS accepts `https://myerrand.name.ng`.
- API health endpoint responds successfully.
- Login/registration work against production MySQL.
- Payment callback returns to `https://myerrand.name.ng`.
- Socket.IO connections work through the API hostname if realtime features are enabled.

## Secrets rule

Never commit:

- `.env`
- JWT secrets
- Paystack secret keys
- webhook secrets
- MFA/encryption keys
- database passwords
- SMTP passwords
- private keys

Only non-secret configuration and deployment instructions belong in this repository.
