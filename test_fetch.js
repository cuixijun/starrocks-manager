const db = require('better-sqlite3');
const sqlite = new db('data/starrocks-tools.db');
const sessionRow = sqlite.prepare("SELECT value FROM settings WHERE key='active_session'").get();
const sessionId = JSON.parse(sessionRow.value);

fetch('http://localhost:3099/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, sql: 'SHOW USERS' })
}).then(r => r.json()).then(data => {
  console.log("SHOW USERS Result:");
  console.log(JSON.stringify(data, null, 2));
}).catch(console.error);
