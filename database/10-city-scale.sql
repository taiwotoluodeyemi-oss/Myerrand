-- My Errand Stage 3: multi-zone operating control. Additive only.
USE errandsplace;

CREATE TABLE IF NOT EXISTS market_zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  country VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zone VARCHAR(120) NOT NULL,
  launch_focus BOOLEAN NOT NULL DEFAULT FALSE,
  pause_demand BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_market_zone (country, city, zone),
  INDEX idx_market_zone_city (city, zone)
);

CREATE TABLE IF NOT EXISTS expansion_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_zone VARCHAR(120) NOT NULL,
  to_zone VARCHAR(120) NOT NULL,
  city VARCHAR(100) NULL,
  operator_id INT NULL,
  operator_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expansion_city_created (city, created_at),
  INDEX idx_expansion_from_to (from_zone, to_zone)
);

ALTER TABLE errands ADD COLUMN exception_type VARCHAR(50) NULL;
ALTER TABLE errands ADD COLUMN had_address_issue BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE errands ADD INDEX idx_errand_exception (exception_type);
