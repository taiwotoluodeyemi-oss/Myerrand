## Automatic mode

After `npm run bootstrap`:

- Browser **language** is detected (en/es/fr/pt/de/ar/hi/sw)
- **Currency** is detected from locale (e.g. en-NG → NGN, fr-FR → EUR)
- **FX rates** are fetched and cached in MySQL
- Demo users can be seeded

Users can still override language and currency in the header.

Manual refresh of rates: `npm run international`

# International rollout (My Errand App)

This app is structured to operate **across countries**, with:

- **8 UI languages:** English, Spanish, French, Portuguese, German, Arabic (RTL), Hindi, Swahili  
- **25+ currencies** in the wallet catalog (USD, EUR, GBP, NGN, KES, GHS, ZAR, INR, AED, …)  
- **Live exchange rates** via Frankfurter (ECB-based, free, no API key), cached in MySQL `currency_rates`  
- Multi-currency wallets (spendable / escrow / withdrawable per currency)

## What “worldwide” means in practice

| Layer | Ready now | You still configure per country |
|-------|-----------|----------------------------------|
| Language UI | Core strings in 8 languages | Translate remaining hard-coded screens over time |
| Prices & wallets | Multi-currency + convert API | Seed defaults; pick local default currency |
| FX rates | Live API + DB cache | Monitor; fallback rate=1 if API/DB fail |
| Payments | Paystack / PayPal hooks | Enable providers that support that country |
| Legal / tax / KYC | Not built | Local counsel when you take real money |
| Cross-border errands | Same platform | Product rules (who can accept across borders) |

**Recommended strategy:** launch **country by country** (or region), same codebase.

Example path:
1. Nigeria — EN + NGN + Paystack  
2. Kenya / Ghana — EN/SW + KES/GHS  
3. UK / EU diaspora — EN/FR/ES + GBP/EUR + PayPal  
4. Broader MENA / LATAM / Asia as payment rails allow  

## User experience

- Language: header switcher (saved in browser `localStorage`)  
- Currency: wallet APIs accept `?currency=NGN` etc.  
- Arabic: document direction switches to **RTL** automatically  

## Ops checklist before a new country

1. Default currency in `.env` or app config (e.g. `DEFAULT_CURRENCY=NGN`)  
2. Payment provider that supports that currency/country  
3. CORS / `CLIENT_URL` for your public web URL  
4. Test: register → create errand in local currency → pay → complete  
5. Expand translation keys for any new UI copy  

## API helpers

```http
GET /api/wallet/currencies
GET /api/wallet/exchange-rate?from=USD&to=NGN
GET /api/wallet/convert?amount=10&from=USD&to=EUR
```

Rates: database (if fresh) → live Frankfurter → fallback `1` (log and avoid using fallback for real settlement when possible).
