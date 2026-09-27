# GitHub Actions

The repository uses GitHub Actions for continuous integration.

Workflow:

- `.github/workflows/ci.yml`
- Node.js 20
- backend dependency installation and test suite
- frontend dependency installation and production build
- production frontend build is checked with `API_BASE=https://api.myerrand.name.ng`

Cloudflare Pages is intentionally deployed through its native GitHub integration. The GitHub Action validates the same frontend build but does not contain Cloudflare API tokens or deploy credentials.
