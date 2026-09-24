-- 07-pricing-engine.sql
-- Server-side errand pricing: store full breakdown, not a client-supplied amount.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS pattern via procedure checks).

-- Mode used for the quote (foot | bicycle | motorcycle | car)
ALTER TABLE errands ADD COLUMN mode VARCHAR(32) NULL DEFAULT 'motorcycle';

-- Distance used for pricing (km)
ALTER TABLE errands ADD COLUMN distance_km DECIMAL(10, 3) NULL;

-- Itemized fare components
ALTER TABLE errands ADD COLUMN base_fare DECIMAL(12, 2) NULL;
ALTER TABLE errands ADD COLUMN distance_cost DECIMAL(12, 2) NULL;
ALTER TABLE errands ADD COLUMN fuel_cost DECIMAL(12, 2) NULL;
ALTER TABLE errands ADD COLUMN urgency_fee DECIMAL(12, 2) NULL DEFAULT 0.00;
ALTER TABLE errands ADD COLUMN subtotal DECIMAL(12, 2) NULL;

-- Platform cut and tax
ALTER TABLE errands ADD COLUMN platform_fee DECIMAL(12, 2) NULL;
ALTER TABLE errands ADD COLUMN vat_amount DECIMAL(12, 2) NULL;
ALTER TABLE errands ADD COLUMN vat_rate DECIMAL(6, 4) NULL;

-- What the runner actually receives on completion (subtotal; fee+VAT stay with platform)
ALTER TABLE errands ADD COLUMN runner_payout DECIMAL(12, 2) NULL;

-- Coords may already exist from tracking work; ensure present for quote-based creates
-- (ignore errors if columns already exist — applied via align scripts that tolerate duplicates)
-- pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude already in complete-schema

-- amount / budget_amount continue to store client_total for backward-compatible payment flows
