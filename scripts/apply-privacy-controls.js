require('dotenv').config();
const fs=require('fs'); const path=require('path'); const {pool}=require('../config/db.mysql');
(async()=>{try{const sql=fs.readFileSync(path.join(__dirname,'../database/21-privacy-controls.sql'),'utf8'); for(const stmt of sql.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean)){await pool.query(stmt);} console.log('Privacy controls migration applied.');}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end().catch(()=>{});}})();
