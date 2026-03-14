import db from 'better-sqlite3';
import { executeQuery } from './src/lib/db';

const sqlite = new db('data/starrocks-tools.db');
const activeSessionStr = sqlite.prepare("SELECT value FROM settings WHERE key='active_session'").get() as any;
const sessionId = JSON.parse(activeSessionStr.value);

async function run() {
  console.log("Using session ID:", sessionId);
  try {
    const result = await executeQuery(sessionId, 'SHOW USERS');
    console.log("executeQuery result:");
    console.log("Has rows array?", Array.isArray(result.rows));
    console.log("Rows length:", Array.isArray(result.rows) ? result.rows.length : 'N/A');
    if (Array.isArray(result.rows) && result.rows.length > 0) {
      console.log("First row:");
      console.log(result.rows[0]);
    }
  } catch(e: any) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
run();
