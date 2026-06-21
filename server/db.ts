import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
let databasePromise: Promise<Database> | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) =>
        path.resolve(__dirname, `../node_modules/sql.js/dist/${file}`),
    });
  }

  return sqlJsPromise;
}

function runMigrations(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'auditor',
      created_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      total_demands INTEGER NOT NULL,
      billed_value REAL NOT NULL,
      technical_due_value REAL NOT NULL,
      glosable_value REAL NOT NULL,
      snapshot_json TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

export async function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      ensureDataDir();
      const SQL = await loadSqlJs();
      const buffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
      const database = buffer ? new SQL.Database(buffer) : new SQL.Database();
      runMigrations(database);
      persistDatabase(database);
      return database;
    })();
  }

  return databasePromise;
}

export function persistDatabase(database: Database): void {
  ensureDataDir();
  const data = database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}
