const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function setupDatabase() {
  let connection;
  
  try {
    console.log('🔄 Connecting to MySQL server...');
    
    // First connect without specifying database
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      multipleStatements: true
    });

    console.log('✅ Connected to MySQL server');
    
    // Read and execute the schema file
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    
    console.log('🔄 Executing database schema...');
    await connection.execute(schema);
    
    console.log('✅ Database schema executed successfully!');
    console.log('✅ Database "errandsplace" created');
    console.log('✅ All tables created including wallets');
    console.log('✅ Sample data inserted');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('Make sure XAMPP MySQL is running');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Check your MySQL credentials in .env file');
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Load environment variables
require('dotenv').config();

setupDatabase();
