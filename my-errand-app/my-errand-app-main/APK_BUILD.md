# Build Android APK

## Option A — No PC (recommended for you): GitHub Actions

Build the APK in the cloud and download it on your phone.

### Steps

1. **Push this project to a GitHub repository** (from phone via github.com, or Codespaces).

2. On GitHub (mobile browser is fine):
   - Open the repo → **Actions**
   - Select **Build Android APK**
   - Tap **Run workflow**
   - Optional: enter your backend URL, e.g. `https://your-api.onrender.com`
   - Run workflow

3. Wait until the job is green (~10–20 minutes first time).

4. Open that run → **Artifacts** → download **my-errand-app-debug-apk**

5. Unzip if needed → open **my-errand-app-debug.apk** on the phone  
   (allow “Install unknown apps” for your browser/files app).

### Optional: save your API URL as a secret

Repo → **Settings** → **Secrets and variables** → **Actions** → New secret:

- Name: `MOBILE_API_BASE`
- Value: `https://your-public-backend-url`

Then every APK build embeds that API address automatically.

### Trigger on push

Pushing to `main`/`master` also runs the workflow when client/Cordova files change.

---

## Option B — PC with Android Studio

If you later have a computer:

```bash
npm install && npm run install-client
npx cordova platform add android

export API_BASE="https://YOUR-BACKEND-URL"
export MOBILE_API_BASE="$API_BASE"
npm run apk
```

APK path:

```text
platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Option C — Codespaces (partial)

Codespaces can prepare `www/` and run the web app. Full APK still needs Android SDK; prefer **Option A**.

---

## Requirements reminder

| Need | Why |
|------|-----|
| Public `API_BASE` | Phone cannot use `localhost` |
| Backend online | Login/errands call your server |
| HTTPS preferred | Android cleartext is allowed in config, but HTTPS is safer |

## Scripts

| Command | Use |
|---------|-----|
| `npm run build:cordova` | Web UI → `www/` |
| `npm run apk` | Local debug APK (needs Android SDK) |
