-- Enhanced Wallet System for My Errand App
-- This script adds wallet functionality with spendable and withdrawable accounts

USE errandsplace;

-- =======================
-- WALLETS TABLE (Multi-currency wallet system)
-- =======================
CREATE TABLE IF NOT EXISTS wallets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Wallet Types
    wallet_type ENUM('spendable', 'withdrawable', 'escrow') NOT NULL,
    
    -- Currency Information
    currency VARCHAR(10) DEFAULT 'USD',
    balance DECIMAL(15, 2) DEFAULT 0.00,
    
    -- Wallet Status
    status ENUM('active', 'frozen', 'closed') DEFAULT 'active',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_wallet_type (user_id, wallet_type, currency),
    INDEX idx_user_id (user_id),
    INDEX idx_wallet_type (wallet_type),
    INDEX idx_currency (currency)
);

-- =======================
-- WALLET_TRANSACTIONS TABLE (Enhanced transaction tracking)
-- =======================
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Wallet Information
    from_wallet_id INT NULL,
    to_wallet_id INT NULL,
    
    -- Transaction Details
    transaction_type ENUM('deposit', 'withdrawal', 'transfer', 'earning', 'payment', 'refund', 'fee', 'conversion') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    
    -- Conversion Information (for currency exchange)
    original_amount DECIMAL(15, 2) NULL,
    original_currency VARCHAR(10) NULL,
    exchange_rate DECIMAL(10, 6) NULL,
    conversion_fee DECIMAL(15, 2) DEFAULT 0.00,
    
    -- Reference Information
    errand_id INT NULL,
    reference_id VARCHAR(255) NULL, -- External payment gateway transaction ID
    description TEXT,
    
    -- Payment Gateway Information
    payment_gateway VARCHAR(50) NULL,
    gateway_transaction_id VARCHAR(255) NULL,
    gateway_fee DECIMAL(15, 2) DEFAULT 0.00,
    
    -- Status
    status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded') DEFAULT 'pending',
    
    -- Timestamps
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (from_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    FOREIGN KEY (to_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL,
    INDEX idx_from_wallet (from_wallet_id),
    INDEX idx_to_wallet (to_wallet_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_status (status),
    INDEX idx_created_date (created_at)
);

-- =======================
-- CURRENCY_RATES TABLE (For currency conversion)
-- =======================
CREATE TABLE IF NOT EXISTS currency_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate DECIMAL(15, 8) NOT NULL,
    
    -- Rate Information
    source VARCHAR(50) DEFAULT 'manual', -- e.g., 'coinbase', 'xe', 'manual'
    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_currency_pair_date (from_currency, to_currency, valid_from),
    INDEX idx_currencies (from_currency, to_currency),
    INDEX idx_valid_period (valid_from, valid_until)
);

-- =======================
-- WITHDRAWAL_METHODS TABLE (User withdrawal preferences)
-- =======================
CREATE TABLE IF NOT EXISTS withdrawal_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Method Information
    method_type ENUM('bank_transfer', 'paypal', 'crypto_wallet') NOT NULL,
    method_name VARCHAR(100) NOT NULL, -- User-friendly name
    
    -- Account Details (encrypted in production)
    account_details JSON, -- Store account info as JSON
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_date TIMESTAMP NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_method_type (method_type),
    INDEX idx_is_default (is_default)
);

-- =======================
-- Initialize wallets for existing users
-- =======================

-- Create spendable and withdrawable wallets for all existing users
INSERT INTO wallets (user_id, wallet_type, currency, balance)
SELECT 
    id, 
    'spendable' as wallet_type,
    'USD' as currency,
    balance
FROM users 
WHERE NOT EXISTS (
    SELECT 1 FROM wallets w 
    WHERE w.user_id = users.id AND w.wallet_type = 'spendable' AND w.currency = 'USD'
);

INSERT INTO wallets (user_id, wallet_type, currency, balance)
SELECT 
    id, 
    'withdrawable' as wallet_type,
    'USD' as currency,
    0.00 as balance
FROM users 
WHERE NOT EXISTS (
    SELECT 1 FROM wallets w 
    WHERE w.user_id = users.id AND w.wallet_type = 'withdrawable' AND w.currency = 'USD'
);

-- =======================
-- Sample currency rates (you'll need to update these regularly)
-- =======================
INSERT INTO currency_rates (from_currency, to_currency, rate) VALUES
('USD', 'EUR', 0.85),
('EUR', 'USD', 1.18),
('USD', 'GBP', 0.73),
('GBP', 'USD', 1.37),
('USD', 'CAD', 1.25),
('CAD', 'USD', 0.80)
ON DUPLICATE KEY UPDATE rate = VALUES(rate), updated_at = CURRENT_TIMESTAMP;

-- =======================
-- VIEWS FOR WALLET INFORMATION
-- =======================

-- View for user wallet summary
CREATE OR REPLACE VIEW user_wallet_summary AS
SELECT 
    u.id as user_id,
    u.name,
    u.email,
    u.user_type,
    w.wallet_type,
    w.currency,
    w.balance,
    w.status as wallet_status
FROM users u
JOIN wallets w ON u.id = w.user_id
WHERE u.status = 'active' AND w.status = 'active';

-- View for recent wallet transactions
CREATE OR REPLACE VIEW recent_wallet_transactions AS
SELECT 
    wt.id,
    wt.transaction_type,
    wt.amount,
    wt.currency,
    wt.description,
    wt.status,
    wt.created_at,
    u1.name as from_user,
    u2.name as to_user,
    fw.wallet_type as from_wallet_type,
    tw.wallet_type as to_wallet_type
FROM wallet_transactions wt
LEFT JOIN wallets fw ON wt.from_wallet_id = fw.id
LEFT JOIN wallets tw ON wt.to_wallet_id = tw.id
LEFT JOIN users u1 ON fw.user_id = u1.id
LEFT JOIN users u2 ON tw.user_id = u2.id
ORDER BY wt.created_at DESC;

COMMIT;
