-- Gift Card Reward System
-- Lets users convert part of their spendable balance into a redeemable gift card,
-- and lets anyone with the code redeem it into their own spendable wallet.
-- Run this after wallet-system.sql (it depends on the `wallets`, `wallet_transactions`
-- and `users` tables already existing).

USE errandsplace;

-- =======================
-- GIFT_CARDS TABLE
-- =======================
CREATE TABLE IF NOT EXISTS gift_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Unique redeemable code, e.g. GIFT-AB12-CD34-EF56
    code VARCHAR(32) NOT NULL UNIQUE,

    -- Who funded this gift card and how much it is worth
    created_by INT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',

    -- Lifecycle
    status ENUM('active', 'redeemed', 'cancelled', 'expired') DEFAULT 'active',
    redeemed_by INT NULL,
    redeemed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,

    -- Optional note from the sender (e.g. "Happy birthday!")
    message VARCHAR(255) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_code (code),
    INDEX idx_created_by (created_by),
    INDEX idx_redeemed_by (redeemed_by),
    INDEX idx_status (status)
);

-- Extend wallet_transactions to recognize gift card movements.
-- (MySQL requires re-declaring the full ENUM to add new values.)
ALTER TABLE wallet_transactions
  MODIFY COLUMN transaction_type ENUM(
    'deposit', 'withdrawal', 'transfer', 'earning', 'payment', 'refund',
    'fee', 'conversion', 'gift_card_issue', 'gift_card_redeem'
  ) NOT NULL;
