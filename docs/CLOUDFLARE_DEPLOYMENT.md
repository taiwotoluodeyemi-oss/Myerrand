# Cloudflare Deployment

See `docs/CLOUDFLARE_GO54_GITHUB_DEPLOYMENT.md` for the current production architecture.

The current architecture is:

- Cloudflare Pages + GitHub for the frontend.
- `myerrand.name.ng` as the public web domain.
- GO54 Node.js/Express for the backend API.
- `api.myerrand.name.ng` as the API hostname.
