// One-off schema repair for clients.max_budget_per_errand.
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function buildSsl() {
  const candidates=[path.join(__dirname,'..','ca.pem'),path.join(__dirname,'..','ca.pem.txt'),process.env.MYSQL_CA_PATH].filter(Boolean);
  for(const caPath of candidates){try{if(fs.existsSync(caPath))return {rejectUnauthorized:true,ca:fs.readFileSync(caPath)};}catch(_){} }
  const host=process.env.MYSQL_HOST||'localhost';
  if(host==='localhost'||host==='127.0.0.1') return false;
  if(process.env.NODE_ENV==='production') throw new Error('Verified MySQL CA is required in production');
  return {rejectUnauthorized:false};
}

async function main(){
  const connection=await mysql.createConnection({host:process.env.MYSQL_HOST||process.env.DB_HOST||'localhost',port:Number(process.env.MYSQL_PORT||process.env.DB_PORT||3306),user:process.env.MYSQL_USER||process.env.DB_USER||'root',password:process.env.MYSQL_PASSWORD||process.env.DB_PASSWORD||'',database:process.env.MYSQL_DATABASE||process.env.DB_NAME||'errandsplace',ssl:buildSsl(),connectTimeout:20000});
  try{
    const [cols]=await connection.query(`SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='clients' AND COLUMN_NAME='max_budget_per_errand'`);
    if(!cols.length){console.log('[fix-column] Column not found; nothing to do.');return;}
    if(String(cols[0].COLUMN_TYPE).toLowerCase().startsWith('varchar')){console.log('[fix-column] Already VARCHAR; nothing to do.');return;}
    await connection.query('ALTER TABLE clients MODIFY COLUMN max_budget_per_errand VARCHAR(50)');
    console.log('Done: max_budget_per_errand is VARCHAR(50).');
  } finally { await connection.end(); }
}
main().catch(err=>{console.error('[fix-column] Failed:',err.message);process.exit(1);});
