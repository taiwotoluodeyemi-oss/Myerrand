#!/usr/bin/env node
/**
 * Copy webpack build into Cordova www/ and inject mobile API base URL.
 * Usage:
 *   API_BASE=https://your-api.example.com node scripts/prepare-cordova.js
 *   (or set MOBILE_API_BASE)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'client', 'dist');
const target = path.join(root, 'www');

if (!fs.existsSync(source)) {
  console.error('ERROR: client/dist missing. Run: CORDOVA=true npm run build');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

const apiBase = (
  process.env.MOBILE_API_BASE ||
  process.env.API_BASE ||
  process.env.CLIENT_API_URL ||
  ''
).replace(/\/+$/, '');

const indexPath = path.join(target, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  // Ensure cordova.js is present before app bundles
  if (!html.includes('src="cordova.js"') && !html.includes("src='cordova.js'")) {
    html = html.replace('</body>', '  <script src="cordova.js"></script>\n</body>');
  }
  html = html.replace(
    /window\.__API_BASE__\s*=\s*window\.__API_BASE__\s*\|\|\s*['"][^'"]*['"]/,
    `window.__API_BASE__ = ${JSON.stringify(apiBase)}`
  );
  if (!html.includes('window.__API_BASE__')) {
    html = html.replace(
      '<head>',
      `<head>\n    <script>window.__API_BASE__ = ${JSON.stringify(apiBase)};</script>`
    );
  }
  fs.writeFileSync(indexPath, html);
}

// Placeholder so cordova.js path doesn't 404 during browser tests of www/
const cordovaStub = path.join(target, 'cordova.js');
if (!fs.existsSync(cordovaStub)) {
  fs.writeFileSync(
    cordovaStub,
    '/* Cordova runtime injects real cordova.js on device */\n'
  );
}

console.log('Prepared Cordova www/ from client/dist');
console.log('  API_BASE for mobile:', apiBase || '(empty — relative / same host)');
console.log('  Next: npx cordova platform add android && npx cordova build android');
