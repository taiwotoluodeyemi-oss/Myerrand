#!/usr/bin/env node
/**
 * Auto-create .env from .env.example if missing.
 * Generates a secure JWT_SECRET when the placeholder is still present.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function generateSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

function main() {
  if (!fs.existsSync(examplePath)) {
    console.error('❌ .env.example not found');
    process.exit(1);
  }

  let created = false;
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(examplePath, envPath);
    created = true;
    console.log('✅ Created .env from .env.example');
  } else {
    console.log('ℹ️  .env already exists — updating safe defaults only if needed');
  }

  let content = fs.readFileSync(envPath, 'utf8');

  // Force MySQL primary for this project (wallet/errands are MySQL-only)
  if (!/^USE_MONGO=/m.test(content)) {
    content += '\nUSE_MONGO=false\n';
  } else {
    content = content.replace(/^USE_MONGO=.*/m, 'USE_MONGO=false');
  }

  // Generate JWT if placeholder or missing
  const weakJwt = /JWT_SECRET=(your-super-secure|change-me|secret|your-jwt|$)/im;
  if (!/^JWT_SECRET=/m.test(content) || weakJwt.test(content)) {
    const secret = generateSecret();
    if (/^JWT_SECRET=/m.test(content)) {
      content = content.replace(/^JWT_SECRET=.*/m, `JWT_SECRET=${secret}`);
    } else {
      content += `\nJWT_SECRET=${secret}\n`;
    }
    console.log('✅ Generated secure JWT_SECRET');
  }

  // Sensible local/Codespaces defaults
  const defaults = {
    PORT: '5000',
    AUTO_DETECT_LOCALE: 'true',
    DEFAULT_CURRENCY: 'USD',
    ALLOW_DEMO_LOGIN: 'true',
    NODE_ENV: 'development',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'errand_user',
    MYSQL_PASSWORD: 'errand_dev_password',
    MYSQL_DATABASE: 'errandsplace',
    MYSQL_ROOT_PASSWORD: 'root_dev_password',
    JWT_EXPIRY: '7d',
    CLIENT_URL: 'http://localhost:3001',
    FRONTEND_URL: 'http://localhost:3001',
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!new RegExp(`^${key}=`, 'm').test(content)) {
      content += `\n${key}=${value}`;
    }
  }

  // Codespaces / GitHub preview: allow dynamic origins via flag
  if (!/^ALLOW_CODESPACES=/m.test(content)) {
    content += '\nALLOW_CODESPACES=true\n';
  }

  fs.writeFileSync(envPath, content.replace(/\n{3,}/g, '\n\n').trim() + '\n');
  console.log(created ? '✅ .env ready' : '✅ .env checked/updated');
  console.log('   USE_MONGO=false (MySQL primary)');
  console.log('   ALLOW_CODESPACES=true (CORS relaxed for *.github.dev)');
}

main();
