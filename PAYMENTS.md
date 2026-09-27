# Payments

The React app calls `/api/wallet/deposit/intent` and `/api/wallet/deposit/verify`; provider-specific Paystack calls stay on the server. `DemoProvider` is always available when Paystack keys are absent and credits a spendable wallet with `is_demo=1`. Paystack is selected only when the existing `PAYSTACK_SECRET_KEY` and public key configuration is present.
