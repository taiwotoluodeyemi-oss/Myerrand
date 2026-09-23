MYSQL + REGISTRATION FIX
========================

1. WHY .env WAS MISSING ON YOUR PHONE
   - The file is named ".env" (starts with a DOT) so mobile file managers hide it.
   - Turn on "Show hidden files" in your file manager, OR use the visible file
     "env-copy.txt" and rename it to .env on your server.

2. WHY MYSQL KEPT SAYING "CANNOT CONNECT"
   - Your DB is on Aiven Cloud (port 28348).
   - The old config/db.mysql.js had ssl: false and no port.
   - Aiven REJECTS non-SSL connections. That is the error you saw.

3. WHAT I FIXED
   - config/db.mysql.js  → SSL with ca.pem + correct port
   - server.js           → was missing (package.json expects it)
   - scripts/setup-database.js → same SSL support
   - I connected to your live Aiven DB and confirmed tables exist:
       users, clients, runners, wallets

4. HOW TO APPLY
   - Replace config/db.mysql.js with the one in this folder
   - Put ca.pem (or ca.pem.txt) in the project root next to package.json
   - Put server.js in the project root
   - Make sure .env has the MYSQL_* values (see env-copy.txt)
   - Restart your server (Render / Railway / VPS / whatever hosts the API)

5. Registration endpoint: POST /api/auth/register
   It already uses MySQL when USE_MONGO=false (which is set in your .env).

After deploying these files, registration should succeed.
