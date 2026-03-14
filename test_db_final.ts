import db from 'better-sqlite3';
import { executeQuery } from './src/lib/db';

const sqlite = new db('data/starrocks-tools.db');
const activeSessionStr = sqlite.prepare("SELECT value FROM settings WHERE key='active_session'").get() as any;
const sessionId = JSON.parse(activeSessionStr.value);

async function run() {
  console.log("Using session ID:", sessionId);
  try {
    const showUsers = await executeQuery(sessionId, 'SHOW USERS');
    let rows = Array.isArray(showUsers.rows) 
      ? (Array.isArray(showUsers.rows[0]) ? showUsers.rows[0] : showUsers.rows) 
      : [];
      
    console.log("Rows output:");
    console.log(JSON.stringify(rows));
    
    if (rows.length > 0) {
      let userIdentities = rows.map((r: any) => {
        if (typeof r === 'string') return r;
        const userVal = r['USER'] || r['User'] || r['user'] || Object.values(r)[0];
        return String(userVal || '');
      }).filter(Boolean);
      console.log("IDENTITIES:", userIdentities);
    }
    
  } catch(e: any) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
run();
