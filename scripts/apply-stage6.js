require('dotenv').config();
const fs=require('fs');
const mysql=require('mysql2/promise');
const path=require('path');
(async()=>{const pool=await mysql.createPool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'defaultdb',multipleStatements:true});
try{const sql=fs.readFileSync(path.join(__dirname,'../database/13-stage6-growth-risk.sql'),'utf8'); await pool.query(sql); console.log('Stage 6 migration applied.');}finally{await pool.end();}})().catch(e=>{console.error('Stage 6 migration failed:',e.message);process.exit(1);});
