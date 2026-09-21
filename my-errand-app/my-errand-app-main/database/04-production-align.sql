-- Production alignment: columns expected by routes/errands.routes.js and wallet flows
USE errandsplace;

-- Allow admin user type
ALTER TABLE users MODIFY COLUMN user_type ENUM('client', 'runner', 'admin') NOT NULL;

-- Align errands with application code (idempotent-ish via procedure-free checks)
-- Add columns if missing (MySQL 8 doesn't have IF NOT EXISTS for columns in all versions — use simple ALTERs; ignore errors on re-run)

ALTER TABLE errands ADD COLUMN amount DECIMAL(10, 2) NULL AFTER tip_amount;
ALTER TABLE errands ADD COLUMN payment_status ENUM('pending', 'paid', 'escrowed', 'released', 'refunded') DEFAULT NULL AFTER status;
ALTER TABLE errands ADD COLUMN weight_kg DECIMAL(8, 2) DEFAULT 0 AFTER amount;
ALTER TABLE errands ADD COLUMN urgency ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium' AFTER weight_kg;
ALTER TABLE errands ADD COLUMN estimated_hours DECIMAL(6, 2) DEFAULT 1 AFTER urgency;

-- Backfill amount from budget_amount
UPDATE errands SET amount = budget_amount WHERE amount IS NULL AND budget_amount IS NOT NULL;
UPDATE errands SET budget_amount = amount WHERE (budget_amount IS NULL OR budget_amount = 0) AND amount IS NOT NULL;

-- Optional address on users for profile
ALTER TABLE users ADD COLUMN address TEXT NULL;
