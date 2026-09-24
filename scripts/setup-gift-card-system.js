const mysql = require('mysql2/promise');
require('dotenv').config();

const setupGiftCardSystem = async () => {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
      user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
      password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace',
      multipleStatements: true
    });

    console.log('Connected to database');

    const fs = require('fs');
    const sql = fs.readFileSync('./database/gift-card-system.sql', 'utf8');

    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && s.toUpperCase() !== 'USE ERRANDSPLACE');

    for (const statement of statements) {
      try {
        await connection.execute(statement);
        console.log('✅ Executed SQL statement successfully');
      } catch (error) {
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.code === 'ER_DUP_FIELDNAME') {
          console.log('ℹ️  Already applied, skipping:', error.message);
        } else {
          console.error('❌ Error executing statement:', error.message);
        }
      }
    }

    console.log('✅ Gift card system setup completed!');
    console.log('   - Created gift_cards table');
    console.log('   - Extended wallet_transactions with gift_card_issue / gift_card_redeem types');
  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    if (connection) await connection.end();
  }
};

setupGiftCardSystem();
