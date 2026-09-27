const crypto = require('crypto');

const APP_ISSUER = process.env.JWT_ISSUER || 'my-errand-api';

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/=+$/,'').replace(/\s+/g,'');
  let bits = 0, value = 0, out = [];
  for (const c of clean) {
    const idx = alphabet.indexOf(c); if (idx < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function generateSecret() { return base32Encode(crypto.randomBytes(20)); }
function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset]&0x7f)<<24 | (h[offset+1]&0xff)<<16 | (h[offset+2]&0xff)<<8 | (h[offset+3]&0xff)) % 1000000;
  return String(code).padStart(6,'0');
}
function verifyTotp(secret, code, window = 1, now = Date.now()) {
  const supplied = String(code || '').replace(/\s+/g,'');
  if (!/^\d{6}$/.test(supplied)) return false;
  for (let i = -window; i <= window; i++) {
    const expected = totp(secret, now + i * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return true;
  }
  return false;
}
function encryptionKey() {
  const source = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-mfa-key-change-me';
  return crypto.createHash('sha256').update(source + APP_ISSUER).digest();
}
function encryptSecret(secret) {
  const iv = crypto.randomBytes(12), key = encryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted MFA secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64,'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64,'base64url')), decipher.final()]).toString('utf8');
}
function generateRecoveryCodes(count = 10) {
  return Array.from({length: count}, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}
function hashRecoveryCode(code) { return crypto.createHash('sha256').update(String(code).replace(/[^a-zA-Z0-9]/g,'').toUpperCase()).digest('hex'); }
function otpauthUri(email, secret) {
  return `otpauth://totp/My%20Errand:${encodeURIComponent(email)}?secret=${secret}&issuer=My%20Errand&algorithm=SHA1&digits=6&period=30`;
}
module.exports = { generateSecret, totp, verifyTotp, encryptSecret, decryptSecret, generateRecoveryCodes, hashRecoveryCode, otpauthUri };
