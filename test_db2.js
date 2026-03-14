const db = require('better-sqlite3');
const mysql = require('mysql2/promise');

const sqlite = new db('data/starrocks-tools.db');
const connRow = sqlite.prepare('SELECT * FROM connections LIMIT 1').get();

const config = JSON.parse(connRow.config);

async function run() {
  const connection = await mysql.createConnection({
    host: config.host,
    port: parseInt(config.port || '9030', 10),
    user: config.user,
    password: config.password,
    database: config.database || undefined,
  });

  try {
    const [rows] = await connection.query('SHOW USERS');
    console.log("=== EXACT ROWS FROM SHOW USERS ===");
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) { console.log("err =>", e.message); }
  process.exit(0);
}

run();
