-- Gift card commerce (manual fulfillment) — additive, does not drop existing tables

CREATE TABLE IF NOT EXISTS gift_card_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  brand VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  denomination DECIMAL(15,2) NOT NULL,
  face_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  region VARCHAR(100) NOT NULL DEFAULT 'United States',
  selling_price_ngn DECIMAL(15,2) NOT NULL,
  supplier_cost_ngn DECIMAL(15,2) NULL,
  description TEXT NULL,
  image_url VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  stock_note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_gcp_status (status),
  INDEX idx_gcp_brand (brand)
);

CREATE TABLE IF NOT EXISTS gift_card_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_ref VARCHAR(64) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  brand VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  denomination DECIMAL(15,2) NOT NULL,
  face_currency VARCHAR(10) NOT NULL,
  region VARCHAR(100) NOT NULL,
  price_ngn DECIMAL(15,2) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending_fulfillment',
  wallet_transaction_id INT NULL,
  gift_code_encrypted TEXT NULL,
  fulfilled_by INT NULL,
  fulfilled_at TIMESTAMP NULL,
  fulfillment_notes TEXT NULL,
  cancelled_at TIMESTAMP NULL,
  refund_transaction_id INT NULL,
  risk_flag VARCHAR(32) DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_gco_user (user_id),
  INDEX idx_gco_status (status),
  INDEX idx_gco_product (product_id)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES
  ('min_deposit_ngn', '1000'),
  ('max_deposit_ngn', '1000000'),
  ('large_deposit_review_ngn', '500000'),
  ('hold_hours_large_deposit', '0');

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NULL,
  target_id INT NULL,
  amount DECIMAL(15,2) NULL,
  details TEXT NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at)
);

-- Seed a few catalog products if empty
INSERT INTO gift_card_products (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, status)
SELECT * FROM (
  SELECT 'Apple' AS brand, 'Apple Gift Card $25' AS product_name, 25.00 AS denomination, 'USD' AS face_currency, 'United States' AS region, 38500.00 AS selling_price_ngn, 36000.00 AS supplier_cost_ngn, 'Apple App Store & iTunes — US region only' AS description, 'active' AS status
) t WHERE NOT EXISTS (SELECT 1 FROM gift_card_products LIMIT 1);

INSERT INTO gift_card_products (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, status)
SELECT 'Apple', 'Apple Gift Card $50', 50.00, 'USD', 'United States', 72500.00, 68000.00, 'Apple App Store & iTunes — US region only', 'active'
FROM DUAL WHERE (SELECT COUNT(*) FROM gift_card_products) < 2;

INSERT INTO gift_card_products (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, status)
SELECT 'Google Play', 'Google Play Gift Card $25', 25.00, 'USD', 'United States', 37000.00, 34500.00, 'Google Play Store — US region only', 'active'
FROM DUAL WHERE (SELECT COUNT(*) FROM gift_card_products) < 3;

INSERT INTO gift_card_products (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, status)
SELECT 'Steam', 'Steam Wallet $20', 20.00, 'USD', 'Global', 32000.00, 29500.00, 'Steam digital wallet code', 'active'
FROM DUAL WHERE (SELECT COUNT(*) FROM gift_card_products) < 4;
