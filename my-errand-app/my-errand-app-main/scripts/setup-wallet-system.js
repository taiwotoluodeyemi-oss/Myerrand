const mysql = require('mysql2/promise');
require('dotenv').config();

const setupWalletSystem = async () => {
  let connection;
  
  try {
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
      user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
      password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace'
    });

    console.log('Connected to database');

    // Read and execute wallet system SQL
    const fs = require('fs');
    const walletSQL = fs.readFileSync('./database/wallet-system.sql', 'utf8');
    
    // Split SQL statements and execute them one by one
    const statements = walletSQL.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await connection.execute(statement);
          console.log('✅ Executed SQL statement successfully');
        } catch (error) {
          if (error.code !== 'ER_TABLE_EXISTS_ERROR') {
            console.error('❌ Error executing statement:', error.message);
          }
        }
      }
    }

    // Add sample withdrawal methods for demo users
    await connection.execute(`
      INSERT INTO withdrawal_methods (user_id, method_type, method_name, account_details, is_verified, is_default)
      SELECT u.id, 'bank_transfer', 'Primary Bank Account', 
             JSON_OBJECT('bank_name', 'Demo Bank', 'account_number', '****1234', 'routing_number', '123456789'),
             true, true
      FROM users u 
      WHERE u.email IN ('client@example.com', 'runner@example.com', 'demo@example.com')
      ON DUPLICATE KEY UPDATE method_name = VALUES(method_name)
    `);

    console.log('✅ Wallet system setup completed successfully!');
    console.log('📊 Summary:');
    console.log('   - Created wallets table for multi-currency support');
    console.log('   - Created wallet_transactions table for detailed transaction tracking');
    console.log('   - Created currency_rates table for exchange rate management');
    console.log('   - Created withdrawal_methods table for user withdrawal preferences');
    console.log('   - Initialized wallets for existing users');
    console.log('   - Added sample withdrawal methods for demo users');

  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

// Run the setup
setupWalletSystem();
