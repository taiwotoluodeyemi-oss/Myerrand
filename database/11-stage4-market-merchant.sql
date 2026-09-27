CREATE TABLE IF NOT EXISTS markets (
 id VARCHAR(80) PRIMARY KEY, name VARCHAR(160) NOT NULL, country_iso2 CHAR(2) NOT NULL, default_currency VARCHAR(10) NOT NULL,
 zones_json JSON NOT NULL, status ENUM('draft','soft_launch','live','paused') NOT NULL DEFAULT 'draft',
 supply_gate_runners INT NOT NULL DEFAULT 15, support_email VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchant_idempotency (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, idem_key VARCHAR(160) NOT NULL, response_json JSON NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_merchant_idem (user_id, idem_key), INDEX idx_merchant_idem_user(user_id)
);

INSERT IGNORE INTO markets (id,name,country_iso2,default_currency,zones_json,status,supply_gate_runners,support_email)
VALUES ('ng-lagos','Lagos','NG','NGN',JSON_ARRAY('Central','North'),'live',15,NULL),
       ('ng-ibadan','Ibadan','NG','NGN',JSON_ARRAY('Central','North'),'draft',15,NULL);

ALTER TABLE errands ADD COLUMN market_id VARCHAR(80) NULL;
CREATE INDEX idx_errands_market_zone ON errands(market_id, zone, created_at);
