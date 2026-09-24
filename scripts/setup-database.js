const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Helper function to split SQL statements
function splitSQLStatements(sql) {
  // Remove comments and normalize line endings
  const cleanSQL = sql
    .replace(/--.*$/gm, '') // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n');
  
  // Split on semicolons but preserve those within strings
  const statements = [];
  let current = '';
  let inString = false;
  let stringChar = null;
  
  for (let i = 0; i < cleanSQL.length; i++) {
    const char = cleanSQL[i];
    const nextChar = cleanSQL[i + 1];
    
    if (!inString && (char === '\'' || char === '"' || char === '`')) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === stringChar) {
      // Check for escaped quotes
      if (nextChar === stringChar) {
        current += char + nextChar;
        i++; // Skip next character
      } else {
        inString = false;
        stringChar = null;
        current += char;
      }
    } else if (!inString && char === ';') {
      // End of statement
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add the last statement if it doesn't end with semicolon
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements;
}

function buildSsl() {
  const caCandidates = [
    path.join(__dirname, '..', 'ca.pem'),
    path.join(__dirname, '..', 'ca.pem.txt'),
    process.env.MYSQL_CA_PATH,
  ].filter(Boolean);
  for (const caPath of caCandidates) {
    try {
      if (fs.existsSync(caPath)) {
        console.log('[setup-db] Using CA from', caPath);
        return { rejectUnauthorized: true, ca: fs.readFileSync(caPath) };
      }
    } catch (e) {}
  }
  const host = process.env.MYSQL_HOST || 'localhost';
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return { rejectUnauthorized: false };
}

async function setupDatabase() {
  let connection;
  
  try {
    const baseOpts = {
      host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || '3306', 10),
      user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
      password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
      multipleStatements: true,
      ssl: buildSsl(),
      connectTimeout: 20000,
    };

    // Create connection
    connection = await mysql.createConnection(baseOpts);

    console.log('🔗 Connected to MySQL server');

    // Create database if it doesn't exist (skip on managed DBs like Aiven where you may lack CREATE DATABASE)
    try {
      await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace'}\``);
      console.log('📊 Database created/verified');
    } catch (e) {
      console.warn('⚠️ Could not CREATE DATABASE (normal on Aiven):', e.message);
    }

    // Close initial connection and reconnect to the specific database
    await connection.end();
    
    connection = await mysql.createConnection({
      ...baseOpts,
      database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace',
    });

    // Read and execute the schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'complete-schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    console.log('📋 Executing database schema...');
    
    // Split SQL into individual statements
    const statements = splitSQLStatements(schemaSQL);
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement individually
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement) {
        try {
          await connection.execute(statement);
          console.log(`✅ Statement ${i + 1}/${statements.length} executed successfully`);
        } catch (error) {
          // Log the error but continue with other statements
          console.warn(`⚠️ Warning on statement ${i + 1}: ${error.message}`);
          if (statement.toLowerCase().includes('insert')) {
            console.log('   (This might be a duplicate entry warning, continuing...)');
          }
        }
      }
    }
    
    console.log('✅ Database schema executed successfully');

    // Verify tables were created
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('📋 Created tables:');
    tables.forEach(table => {
      console.log(`  - ${Object.values(table)[0]}`);
    });

    // Check if demo data was inserted
    const [users] = await connection.execute('SELECT COUNT(*) as count FROM users');
    console.log(`👥 Total users in database: ${users[0].count}`);

    console.log('🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    if (error.sql) {
      console.error('SQL Error:', error.sql);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the setup
setupDatabase();
