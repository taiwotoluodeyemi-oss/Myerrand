-- Complete Database Schema for My Errand App
-- This script creates all necessary tables for the errand application

USE errandsplace;

-- =======================
-- USERS TABLE (Base table for all users)
-- =======================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT NULL,
    user_type ENUM('client', 'runner', 'admin') NOT NULL,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    -- Live location (runners only; updated while actively working an
    -- errand — see routes/errands.routes.js POST /:errand_id/runner-location)
    current_latitude DECIMAL(10, 8) NULL,
    current_longitude DECIMAL(11, 8) NULL,
    location_updated_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_type (user_type),
    INDEX idx_email (email),
    INDEX idx_status (status)
);

-- =======================
-- CLIENTS TABLE (Extended information for clients)
-- =======================
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Location Information
    address TEXT,
    city VARCHAR(100),
    zip_code VARCHAR(20),
    
    -- Contact Preferences
    preferred_contact_method ENUM('phone', 'sms', 'email', 'app') DEFAULT 'phone',
    
    -- Client Preferences
    typical_errands TEXT, -- Comma-separated list
    max_budget_per_errand VARCHAR(50),
    special_instructions TEXT,
    emergency_contacts TEXT,
    
    -- Notification Preferences
    sms_notifications BOOLEAN DEFAULT TRUE,
    email_notifications BOOLEAN DEFAULT TRUE,
    push_notifications BOOLEAN DEFAULT TRUE,
    
    -- Agreement Tracking
    terms_accepted BOOLEAN DEFAULT FALSE,
    privacy_accepted BOOLEAN DEFAULT FALSE,
    terms_accepted_at TIMESTAMP NULL,
    privacy_accepted_at TIMESTAMP NULL,
    
    -- Statistics
    total_errands_posted INT DEFAULT 0,
    total_amount_spent DECIMAL(10, 2) DEFAULT 0.00,
    average_rating DECIMAL(3, 2) DEFAULT 0.00,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_city (city),
    INDEX idx_zip_code (zip_code)
);

-- =======================
-- RUNNERS TABLE (Extended information for errand runners)
-- =======================
CREATE TABLE IF NOT EXISTS runners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Runner Details
    vehicle_type ENUM('none', 'bike', 'scooter', 'car') DEFAULT 'none',
    areas_of_service TEXT,
    available_hours TEXT,
    preferred_errand_types TEXT, -- Comma-separated list
    
    -- Insurance and Legal
    insurance_coverage BOOLEAN DEFAULT FALSE,
    insurance_provider VARCHAR(255),
    insurance_policy_number VARCHAR(100),
    
    -- Emergency Contact
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relationship VARCHAR(100),
    
    -- Verification Status
    background_check_status ENUM('pending', 'approved', 'rejected', 'expired') DEFAULT 'pending',
    background_check_date TIMESTAMP NULL,
    background_check_notes TEXT NULL,
    id_document_path VARCHAR(500) NULL,
    identity_verified BOOLEAN DEFAULT FALSE,
    
    -- Notification Preferences
    sms_notifications BOOLEAN DEFAULT TRUE,
    email_notifications BOOLEAN DEFAULT TRUE,
    push_notifications BOOLEAN DEFAULT TRUE,
    
    -- Agreement Tracking
    terms_accepted BOOLEAN DEFAULT FALSE,
    privacy_accepted BOOLEAN DEFAULT FALSE,
    terms_accepted_at TIMESTAMP NULL,
    privacy_accepted_at TIMESTAMP NULL,
    
    -- Performance Metrics
    total_errands_completed INT DEFAULT 0,
    total_earnings DECIMAL(10, 2) DEFAULT 0.00,
    average_rating DECIMAL(3, 2) DEFAULT 0.00,
    completion_rate DECIMAL(5, 2) DEFAULT 0.00,
    
    -- Availability
    is_available BOOLEAN DEFAULT TRUE,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_vehicle_type (vehicle_type),
    INDEX idx_available (is_available),
    INDEX idx_background_check (background_check_status)
);

-- =======================
-- ERRANDS TABLE (Main errand postings)
-- =======================
CREATE TABLE IF NOT EXISTS errands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    runner_id INT NULL,
    
    -- Errand Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    
    -- Location
    pickup_address TEXT,
    delivery_address TEXT,
    pickup_coordinates POINT NULL,
    delivery_coordinates POINT NULL,
    -- Geocoded on demand and cached — see GET /:errand_id/tracking
    pickup_latitude DECIMAL(10, 8) NULL,
    pickup_longitude DECIMAL(11, 8) NULL,
    delivery_latitude DECIMAL(10, 8) NULL,
    delivery_longitude DECIMAL(11, 8) NULL,
    
    -- Timing
    requested_date DATE,
    requested_time_start TIME,
    requested_time_end TIME,
    estimated_duration INT, -- in minutes
    
    -- Pricing
    budget_amount DECIMAL(10, 2) NOT NULL,
    final_amount DECIMAL(10, 2) NULL,
    tip_amount DECIMAL(10, 2) DEFAULT 0.00,
    amount DECIMAL(10, 2) NULL,
    weight_kg DECIMAL(8, 2) DEFAULT 0,
    urgency ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    estimated_hours DECIMAL(6, 2) DEFAULT 1,
    
    -- Status Tracking
    status ENUM('pending', 'assigned', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'escrowed', 'released', 'refunded') DEFAULT NULL,
    
    -- Timestamps
    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    
    -- Special Requirements
    special_instructions TEXT,
    requires_vehicle BOOLEAN DEFAULT FALSE,
    requires_id_verification BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (runner_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_client_id (client_id),
    INDEX idx_runner_id (runner_id),
    INDEX idx_status (status),
    INDEX idx_category (category),
    INDEX idx_posted_date (posted_at)
);

-- =======================
-- RATINGS TABLE (Rating system for both clients and runners)
-- =======================
CREATE TABLE IF NOT EXISTS ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    errand_id INT NOT NULL,
    rater_id INT NOT NULL, -- User who is giving the rating
    rated_id INT NOT NULL, -- User who is being rated
    
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    
    -- Rating categories
    communication_rating INT CHECK (communication_rating >= 1 AND communication_rating <= 5),
    punctuality_rating INT CHECK (punctuality_rating >= 1 AND punctuality_rating <= 5),
    quality_rating INT CHECK (quality_rating >= 1 AND quality_rating <= 5),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
    FOREIGN KEY (rater_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (rated_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_rating (errand_id, rater_id),
    INDEX idx_rated_user (rated_id),
    INDEX idx_rating (rating)
);

-- =======================
-- MESSAGES TABLE (per-errand chat between client and runner)
-- =======================
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    errand_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_errand_id (errand_id),
    INDEX idx_created_at (created_at)
);

-- =======================
-- TRANSACTIONS TABLE (Payment and earning tracking)
-- =======================
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    errand_id INT NULL,
    
    transaction_type ENUM('credit', 'debit', 'refund', 'fee', 'tip', 'withdrawal') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    
    -- Payment Details
    payment_method VARCHAR(50),
    payment_gateway VARCHAR(50),
    gateway_transaction_id VARCHAR(255),
    
    status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_status (status),
    INDEX idx_created_date (created_at)
);

-- =======================
-- USER_SESSIONS TABLE (Track user login sessions)
-- =======================
CREATE TABLE IF NOT EXISTS user_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    device_info TEXT,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    INDEX idx_expires_at (expires_at)
);

-- =======================
-- NOTIFICATIONS TABLE (System notifications)
-- =======================
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    errand_id INT NULL,
    
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'success', 'warning', 'error') DEFAULT 'info',
    
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_type (type)
);

-- =======================
-- INSERT DEMO DATA
-- =======================

-- Demo User (Client)
INSERT INTO users (name, email, password, phone, user_type, balance) 
VALUES ('Demo Client', 'client@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+1234567890', 'client', 125.50)
ON DUPLICATE KEY UPDATE 
    name = 'Demo Client',
    balance = 125.50;

-- Demo User (Runner)
INSERT INTO users (name, email, password, phone, user_type, balance) 
VALUES ('Demo Runner', 'runner@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+1234567891', 'runner', 85.25)
ON DUPLICATE KEY UPDATE 
    name = 'Demo Runner',
    balance = 85.25;

-- Original Demo User (keeping for compatibility)
INSERT INTO users (name, email, password, user_type, balance) 
VALUES ('Demo User', 'demo@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'client', 125.50)
ON DUPLICATE KEY UPDATE 
    name = 'Demo User',
    balance = 125.50;

-- Insert client profile for demo client
INSERT INTO clients (user_id, address, city, zip_code, typical_errands, terms_accepted, privacy_accepted)
SELECT u.id, '123 Main St', 'Demo City', '12345', 'Grocery Shopping,Package Delivery', TRUE, TRUE
FROM users u WHERE u.email = 'client@example.com'
ON DUPLICATE KEY UPDATE 
    address = '123 Main St',
    city = 'Demo City';

-- Insert runner profile for demo runner  
INSERT INTO runners (user_id, vehicle_type, areas_of_service, preferred_errand_types, terms_accepted, privacy_accepted)
SELECT u.id, 'car', 'Downtown,Suburbs', 'Grocery Shopping,Package Delivery,Transportation', TRUE, TRUE
FROM users u WHERE u.email = 'runner@example.com'
ON DUPLICATE KEY UPDATE 
    vehicle_type = 'car',
    areas_of_service = 'Downtown,Suburbs';

-- Note: The password hash above is for 'demo123'
-- You can generate new hashes using bcrypt with salt rounds of 10

-- =======================
-- VIEWS FOR EASIER QUERIES
-- =======================

-- View for complete client information
CREATE OR REPLACE VIEW client_details AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.phone,
    u.balance,
    u.status,
    c.address,
    c.city,
    c.zip_code,
    c.preferred_contact_method,
    c.typical_errands,
    c.total_errands_posted,
    c.total_amount_spent,
    c.average_rating,
    u.created_at
FROM users u
JOIN clients c ON u.id = c.user_id
WHERE u.user_type = 'client' AND u.status = 'active';

-- View for complete runner information
CREATE OR REPLACE VIEW runner_details AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.phone,
    u.balance,
    u.status,
    r.vehicle_type,
    r.areas_of_service,
    r.preferred_errand_types,
    r.background_check_status,
    r.total_errands_completed,
    r.total_earnings,
    r.average_rating,
    r.is_available,
    r.last_active,
    u.created_at
FROM users u
JOIN runners r ON u.id = r.user_id
WHERE u.user_type = 'runner' AND u.status = 'active';

-- View for errand listings with client and runner details
CREATE OR REPLACE VIEW errand_listings AS
SELECT 
    e.id,
    e.title,
    e.description,
    e.category,
    e.budget_amount,
    e.status,
    e.posted_at,
    c.name as client_name,
    c.email as client_email,
    r.name as runner_name,
    r.email as runner_email,
    e.pickup_address,
    e.delivery_address
FROM errands e
JOIN users c ON e.client_id = c.id
LEFT JOIN users r ON e.runner_id = r.id;

COMMIT;
