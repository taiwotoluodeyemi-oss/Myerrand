const mysql = require('mysql2/promise');

async function testConnection() {
  const testCases = [
    { user: 'root', password: '', description: 'root with no password' },
    { user: 'root', password: 'root', description: 'root with password "root"' },
    { user: 'root', password: 'mysql', description: 'root with password "mysql"' },
    { user: 'root', password: 'password', description: 'root with password "password"' },
    { user: 'root', password: 'xampp', description: 'root with password "xampp"' }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`🔄 Testing: ${testCase.description}`);
      
      const connection = await mysql.createConnection({
        host: 'localhost',
        user: testCase.user,
        password: testCase.password,
        connectTimeout: 5000
      });

      console.log(`✅ SUCCESS: Connected with ${testCase.description}`);
      
      // Test a simple query
      const [result] = await connection.execute('SELECT VERSION() as version');
      console.log(`   MySQL Version: ${result[0].version}`);
      
      await connection.end();
      
      // Update .env file with working credentials
      console.log(`\n🎉 FOUND WORKING CREDENTIALS!`);
      console.log(`   User: ${testCase.user}`);
      console.log(`   Password: "${testCase.password}"`);
      console.log(`\nPlease update your .env file:`);
      console.log(`MYSQL_USER=${testCase.user}`);
      console.log(`MYSQL_PASSWORD=${testCase.password}`);
      
      return;
      
    } catch (error) {
      console.log(`❌ FAILED: ${testCase.description} - ${error.message}`);
    }
  }
  
  console.log('\n❌ None of the common credentials worked.');
  console.log('You may need to:');
  console.log('1. Reset MySQL root password through XAMPP');
  console.log('2. Check XAMPP Control Panel for MySQL configuration');
  console.log('3. Access phpMyAdmin to check user accounts');
}

testConnection();
