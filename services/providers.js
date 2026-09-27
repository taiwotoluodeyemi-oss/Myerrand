const axios = require('axios');

class NoopProvider {
  constructor(name) { this.name=name; this.mode='off'; }
  async createSession() { return { status:'not_configured', provider:this.name }; }
  async getStatus() { return { status:'not_configured', provider:this.name }; }
  async send() { return { status:'not_configured', provider:this.name }; }
  async offer() { return { status:'not_configured', provider:this.name }; }
}

class HttpProvider {
  constructor(name, url) { this.name=name; this.url=url; this.mode='live'; }
  async call(path, payload) { const r=await axios.post(`${this.url.replace(/\/$/,'')}${path||''}`,payload,{timeout:10000}); return r.data; }
  async createSession(payload) { return this.call('/session',payload); }
  async getStatus(payload) { return this.call('/status',payload); }
  async send(payload) { return this.call('/send',payload); }
  async offer(payload) { return this.call('/offer',payload); }
}

function make(name, env) { return process.env[env] ? new HttpProvider(name,process.env[env]) : new NoopProvider(name); }
const KycProvider=make('kyc','KYC_PROVIDER_URL');
const PushProvider=make('push','PUSH_PROVIDER_URL');
const InsuranceProvider=make('insurance','INSURANCE_PROVIDER_URL');
function providerStatus(){return {kyc:KycProvider.mode,push:PushProvider.mode,insurance:InsuranceProvider.mode};}
module.exports={NoopProvider,KycProvider,PushProvider,InsuranceProvider,providerStatus};
