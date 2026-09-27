const nodemailer = require('nodemailer');
const axios = require('axios');

class NoopProvider {
  constructor(kind) { this.kind = kind; this.mode = 'off'; }
  async send() { return { ok: false, mode: 'off', reason: 'not_configured' }; }
}

class EmailProvider {
  constructor() {
    this.mode = 'live';
    this.transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  async send({ to, subject, text }) {
    if (!to) return { ok: false, mode: this.mode, reason: 'missing_recipient' };
    const info = await this.transport.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to, subject, text });
    return { ok: true, mode: this.mode, messageId: info.messageId };
  }
}

class SmsProvider {
  constructor() {
    this.mode = 'live';
  }
  async send({ to, message }) {
    if (!to) return { ok: false, mode: this.mode, reason: 'missing_recipient' };
    // Generic HTTP SMS adapter for an already-configured transport; no new provider is required.
    const url = process.env.SMS_WEBHOOK_URL;
    if (!url) return { ok: false, mode: 'off', reason: 'not_configured' };
    const response = await axios.post(url, { to, message }, { timeout: 10000 });
    return { ok: true, mode: this.mode, status: response.status };
  }
}

function configuredEmail() { return Boolean(process.env.SMTP_HOST && (process.env.SMTP_USER || process.env.EMAIL_FROM)); }
function configuredSms() { return Boolean(process.env.SMS_WEBHOOK_URL); }

const emailProvider = configuredEmail() ? new EmailProvider() : new NoopProvider('email');
const smsProvider = configuredSms() ? new SmsProvider() : new NoopProvider('sms');

const Notifier = {
  status() { return { sms: smsProvider.mode === 'live' ? 'live' : 'off', email: emailProvider.mode === 'live' ? 'live' : 'off', push: 'off' }; },
  async sendSms(payload) { try { return await smsProvider.send(payload); } catch (e) { return { ok: false, mode: 'live', error: e.message }; } },
  async sendEmail(payload) { try { return await emailProvider.send(payload); } catch (e) { return { ok: false, mode: 'live', error: e.message }; } },
};

module.exports = { Notifier, NoopProvider };
