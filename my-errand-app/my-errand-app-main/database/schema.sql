-- Complete Database Schema for My Errand App
-- Drop existing database and create fresh one
DROP DATABASE IF EXISTS errandsplace;
CREATE DATABASE errandsplace;
USE errandsplace;

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    user_type ENUM('client', 'runner', 'admin') DEFAULT 'client',
    profile_image VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Nigeria',
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Wallets table for managing different wallet types
CREATE TABLE wallets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    wallet_type ENUM('spendable', 'withdrawable', 'escrow') NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    balance DECIMAL(15, 2) DEFAULT 0.00,
    status ENUM('active', 'inactive', 'frozen') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_wallet (user_id, wallet_type, currency)
);

-- Errands table
CREATE TABLE errands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    runner_id INT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    pickup_address TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    pickup_latitude DECIMAL(10, 8),
    pickup_longitude DECIMAL(11, 8),
    delivery_latitude DECIMAL(10, 8),
    delivery_longitude DECIMAL(11, 8),
    amount DECIMAL(10, 2) NOT NULL,
    estimated_hours INT DEFAULT 1,
    weight_kg DECIMAL(5, 2) DEFAULT 0,
    urgency ENUM('low', 'medium', 'high') DEFAULT 'medium',
    category VARCHAR(100),
    status ENUM('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'disputed') DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'escrowed', 'released', 'refunded') DEFAULT NULL,
    is_paid BOOLEAN DEFAULT FALSE,
    scheduled_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (runner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Wallet transactions table
CREATE TABLE wallet_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_wallet_id INT NULL,
    to_wallet_id INT NULL,
    errand_id INT NULL,
    transaction_type ENUM('deposit', 'withdrawal', 'transfer', 'payment', 'earning', 'refund', 'escrow_hold', 'escrow_release') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    original_amount DECIMAL(15, 2) NULL,
    original_currency VARCHAR(3) NULL,
    exchange_rate DECIMAL(10, 6) DEFAULT 1.000000,
    conversion_fee DECIMAL(15, 2) DEFAULT 0.00,
    gateway_fee DECIMAL(15, 2) DEFAULT 0.00,
    net_amount DECIMAL(15, 2) NULL,
    description TEXT,
    payment_gateway VARCHAR(50),
    gateway_transaction_id VARCHAR(255),
    status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    FOREIGN KEY (to_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL
);

-- Payment records table
CREATE TABLE payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    errand_id INT NOT NULL,
    payer_id INT NOT NULL,
    payee_id INT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50),
    gateway VARCHAR(50),
    gateway_transaction_id VARCHAR(255),
    gateway_response TEXT,
    status ENUM('pending', 'processing', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
    FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Withdrawal methods table
CREATE TABLE withdrawal_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    method_type VARCHAR(50) NOT NULL,
    method_name VARCHAR(100) NOT NULL,
    account_details JSON,
    is_verified BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Currency rates table
CREATE TABLE currency_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate DECIMAL(10, 6) NOT NULL,
    valid_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_currency_pair (from_currency, to_currency)
);

-- Notifications table
CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    errand_id INT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL
);

-- Insert default currency rates
INSERT INTO currency_rates (from_currency, to_currency, rate) VALUES
('USD', 'USD', 1.000000),
('NGN', 'USD', 0.0024),
('USD', 'NGN', 410.00),
('NGN', 'NGN', 1.000000);

-- Insert sample users
INSERT INTO users (name, email, password, user_type, phone) VALUES
('John Client', 'client@example.com', '$2b$10$abcdefghijklmnopqrstuvwxyz', 'client', '+1234567890'),
('Jane Runner', 'runner@example.com', '$2b$10$abcdefghijklmnopqrstuvwxyz', 'runner', '+1234567891'),
('Admin User', 'admin@example.com', '$2b$10$abcdefghijklmnopqrstuvwxyz', 'admin', '+1234567892');

-- Create default wallets for users
INSERT INTO wallets (user_id, wallet_type, currency, balance) VALUES
-- Client wallets
(1, 'spendable', 'USD', 100.00),
(1, 'withdrawable', 'USD', 0.00),
(1, 'escrow', 'USD', 0.00),
-- Runner wallets  
(2, 'spendable', 'USD', 50.00),
(2, 'withdrawable', 'USD', 25.00),
(2, 'escrow', 'USD', 0.00),
-- Admin wallets
(3, 'spendable', 'USD', 1000.00),
(3, 'withdrawable', 'USD', 500.00),
(3, 'escrow', 'USD', 0.00);

-- Insert sample errands
INSERT INTO errands (client_id, title, description, pickup_address, delivery_address, amount, status, payment_status) VALUES
(1, 'Grocery Shopping', 'Buy weekly groceries from the supermarket', '123 Main St, City', '456 Oak Ave, City', 25.00, 'pending', 'pending'),
(1, 'Package Delivery', 'Deliver important documents to downtown office', '789 Pine St, City', '321 Business Ave, City', 15.00, 'assigned', 'escrowed'),
(1, 'Pet Walking', 'Walk my dog for 30 minutes in the park', '555 Home St, City', '555 Home St, City', 20.00, 'completed', 'released');

-- Create indexes for performance
CREATE INDEX idx_errands_status ON errands(status);
CREATE INDEX idx_errands_client ON errands(client_id);
CREATE INDEX idx_errands_runner ON errands(runner_id);
CREATE INDEX idx_wallet_transactions_wallet ON wallet_transactions(from_wallet_id, to_wallet_id);
CREATE INDEX idx_wallet_transactions_errand ON wallet_transactions(errand_id);
CREATE INDEX idx_payments_errand ON payments(errand_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
