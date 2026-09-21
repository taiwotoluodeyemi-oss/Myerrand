# Building the mobile app (Cordova / Android)

This project wraps the same React web app in Cordova to produce an installable Android app.
The wrapper is already configured (`config.xml`, `scripts/prepare-cordova.js`, Cordova
devDependencies in `package.json`) — you just need to build it on a machine with internet
access and the Android SDK installed (this sandbox has neither, so the build itself could
not be run here).

## Prerequisites
- Node.js 18+
- Android SDK + a configured `ANDROID_HOME` (Android Studio is the easiest way to get this)
- Java JDK 17

## Steps

```bash
npm install
npm run install-client

# Fill in .env from .env.example first (see CHANGES.md), then:
npm run build:cordova     # builds the React app and copies it into www/

npx cordova platform add android   # first time only
npx cordova build android          # produces the .apk under platforms/android/app/build/outputs/apk
```

To run on a connected device/emulator instead of just building:
```bash
npx cordova run android
```

## iOS
Only the Android platform is configured in `config.xml`/`package.json` right now. To target
iOS, add the platform on a Mac with Xcode installed:
```bash
npx cordova platform add ios
npx cordova build ios
```

## Notes
- The app talks to the same backend API as the web version — set `FRONTEND_URL`/API base URL
  appropriately for a device (not `localhost`) before building, since the app will run on a
  phone rather than in a browser on the same machine as the server.
- See `CHANGES.md` for the balance-display fix, the gift card system, and what needs to be
  configured to activate real PayPal/bank-transfer withdrawals.
