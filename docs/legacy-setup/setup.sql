-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS errandsplace;

-- Grant permissions to root user
-- Note: For real production systems, avoid using root without a password
GRANT ALL PRIVILEGES ON errandsplace.* TO 'root'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;

-- Table creation placeholders
-- Replace with actual table creation statements if specific tables are required for the application

-- Example table (replace with actual tables needed for your app)
-- CREATE TABLE errandsplace.example_table (
--   id INT AUTO_INCREMENT PRIMARY KEY,
--   name VARCHAR(255) NOT NULL
-- );
