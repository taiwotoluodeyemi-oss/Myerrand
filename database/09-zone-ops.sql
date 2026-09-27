-- My Errand Stage 2: one-zone operating model. Additive only.

ALTER TABLE errands ADD COLUMN country VARCHAR(100) NULL;
ALTER TABLE errands ADD COLUMN city VARCHAR(100) NULL;
ALTER TABLE errands ADD COLUMN zone VARCHAR(120) NULL;
ALTER TABLE errands ADD COLUMN channel VARCHAR(20) NOT NULL DEFAULT 'consumer';
ALTER TABLE errands ADD COLUMN business_reference VARCHAR(120) NULL;
ALTER TABLE errands ADD COLUMN contact_phone VARCHAR(30) NULL;
ALTER TABLE errands ADD INDEX idx_errand_zone_status_created (zone, status, created_at);
ALTER TABLE errands ADD INDEX idx_errand_city_zone (city, zone);

ALTER TABLE runners ADD COLUMN service_zones TEXT NULL;
ALTER TABLE runners ADD INDEX idx_runner_last_active (last_active);

UPDATE errands SET country = COALESCE(country, 'Nigeria') WHERE country IS NULL;
UPDATE errands SET city = COALESCE(city, 'Lagos') WHERE city IS NULL;
UPDATE errands SET zone = COALESCE(zone, 'Central') WHERE zone IS NULL;
UPDATE runners SET service_zones = COALESCE(service_zones, areas_of_service) WHERE service_zones IS NULL;
