# Payment Disputes

A `payment_dispute` is separate from an errand service dispute. Cases move `open -> evidence -> won|lost` or `withdrawn`.

- Lost while an errand hold is still held: prefer the existing `errandMoney.refundHold()` path.
- Lost after a hold was released: record a `platform_loss` ledger entry; do not silently claw back runner funds.
- Won: close the case without reversing a valid errand release.
- All money movement remains inside `errandMoney`; the payment-dispute workflow is an operator process around that engine.
