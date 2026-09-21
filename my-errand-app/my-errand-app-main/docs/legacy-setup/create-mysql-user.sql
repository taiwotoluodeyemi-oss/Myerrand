-- Create a new user for the errand app
CREATE USER IF NOT EXISTS 'errandapp'@'localhost' IDENTIFIED BY 'securepass';

-- Create the database
CREATE DATABASE IF NOT EXISTS errandsplace;

-- Grant all privileges on the database to the user
GRANT ALL PRIVILEGES ON errandsplace.* TO 'errandapp'@'localhost';

-- Flush privileges to apply changes
FLUSH PRIVILEGES;

-- Show the user was created
SELECT User, Host FROM mysql.user WHERE User = 'errandapp';
