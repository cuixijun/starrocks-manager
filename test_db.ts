import db from 'better-sqlite3';
import mysql from 'mysql2/promise';

const sqlite = new db('data/starrocks-tools.db');
const connRow = sqlite.prepare('SELECT * FROM connections LIMIT 1').get() as any;
const config = JSON.parse(connRow.config);

async function run() {
  const connection = await mysql.createConnection({
    host: config.host,
    port: parseInt(config.port || '9030', 10),
    user: config.user,
    password: config.password,
    database: config.database || undefined,
  });

  const [rows, fields] = await connection.query('SHOW USERS');
  console.log("Is Array?", Array.isArray(rows));
  console.log("Length:", Array.isArray(rows) ? rows.length : 'N/A');
  console.log("First row direct:", Array.isArray(rows) ? rows[0] : rows);
  console.log("First row JSON:", Array.isArray(rows) ? JSON.stringify(rows[0]) : JSON.stringify(rows));
  process.exit(0);
}
run();
