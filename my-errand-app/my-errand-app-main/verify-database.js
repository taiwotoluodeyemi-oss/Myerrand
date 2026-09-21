// Script to verify that database tables are created properly
const { pool } = require('./config/db.mysql');

async function verifyDatabase() {
  try {
    console.log('🔍 Verifying database structure...\n');

    // Check if database exists and can connect
    const [dbResult] = await pool.execute('SELECT DATABASE() as current_db');
    console.log('✅ Connected to database:', dbResult[0].current_db);

    // List all tables
    const [tables] = await pool.execute('SHOW TABLES');
    console.log('\n📋 Available tables:');
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`   - ${tableName}`);
    });

    // Check specific wallet-related tables
    const requiredTables = ['users', 'wallets', 'wallet_transactions', 'errands'];
    console.log('\n🔧 Checking required tables:');
    
    for (const tableName of requiredTables) {
      try {
        const [result] = await pool.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
        console.log(`   ✅ ${tableName}: ${result[0].count} records`);
      } catch (error) {
        console.log(`   ❌ ${tableName}: Table missing or error - ${error.message}`);
      }
    }

    // Check wallet data specifically
    console.log('\n💰 Wallet system verification:');
    try {
      const [wallets] = await pool.execute(`
        SELECT u.name, w.wallet_type, w.balance, w.currency 
        FROM wallets w 
        JOIN users u ON w.user_id = u.id 
        ORDER BY u.id, w.wallet_type
      `);
      
      if (wallets.length > 0) {
        console.log('   ✅ Wallet records found:');
        wallets.forEach(wallet => {
          console.log(`      ${wallet.name} - ${wallet.wallet_type}: $${wallet.balance} ${wallet.currency}`);
        });
      } else {
        console.log('   ⚠️  No wallet records found');
      }
    } catch (error) {
      console.log(`   ❌ Error checking wallets: ${error.message}`);
    }

    // Check errands with payment status
    console.log('\n📦 Errands verification:');
    try {
      const [errands] = await pool.execute(`
        SELECT title, status, payment_status, amount 
        FROM errands 
        ORDER BY id
      `);
      
      if (errands.length > 0) {
        console.log('   ✅ Errand records found:');
        errands.forEach(errand => {
          console.log(`      "${errand.title}" - Status: ${errand.status}, Payment: ${errand.payment_status}, Amount: $${errand.amount}`);
        });
      } else {
        console.log('   ⚠️  No errand records found');
      }
    } catch (error) {
      console.log(`   ❌ Error checking errands: ${error.message}`);
    }

    console.log('\n🎉 Database verification completed!');
    
  } catch (error) {
    console.error('❌ Database verification failed:', error.message);
    console.error('Make sure:');
    console.error('1. XAMPP MySQL is running');
    console.error('2. Database schema has been executed');
    console.error('3. Database connection settings are correct');
  }
  
  process.exit(0);
}

verifyDatabase();
