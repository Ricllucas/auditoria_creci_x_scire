import crypto from 'node:crypto';
import { getDatabase, persistDatabase } from './db.js';

export interface DbUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'auditor';
  createdAt: string;
}

export interface DbAnalysis {
  id: string;
  userId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  createdAt: string;
  totalDemands: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
  snapshotJson: string;
}

function statementRowToUser(row: unknown[]): DbUser {
  return {
    id: String(row[0]),
    name: String(row[1]),
    email: String(row[2]),
    passwordHash: String(row[3]),
    role: (String(row[4]) as DbUser['role']) || 'auditor',
    createdAt: String(row[5]),
  };
}

function statementRowToAnalysis(row: unknown[]): DbAnalysis {
  return {
    id: String(row[0]),
    userId: String(row[1]),
    name: String(row[2]),
    periodStart: String(row[3]),
    periodEnd: String(row[4]),
    generatedAt: String(row[5]),
    createdAt: String(row[6]),
    totalDemands: Number(row[7]),
    billedValue: Number(row[8]),
    technicalDueValue: Number(row[9]),
    glosableValue: Number(row[10]),
    snapshotJson: String(row[11]),
  };
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const db = await getDatabase();
  const statement = db.prepare(`
    SELECT id, name, email, password_hash, role, created_at
    FROM users
    WHERE email = ?
    LIMIT 1
  `);
  statement.bind([email.toLowerCase()]);
  const row = statement.step() ? statement.get() : null;
  statement.free();
  return row ? statementRowToUser(row) : null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const db = await getDatabase();
  const statement = db.prepare(`
    SELECT id, name, email, password_hash, role, created_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `);
  statement.bind([id]);
  const row = statement.step() ? statement.get() : null;
  statement.free();
  return row ? statementRowToUser(row) : null;
}

export async function createUser(params: {
  name: string;
  email: string;
  passwordHash: string;
  role?: 'admin' | 'auditor';
}): Promise<DbUser> {
  const db = await getDatabase();
  const user: DbUser = {
    id: crypto.randomUUID(),
    name: params.name.trim(),
    email: params.email.trim().toLowerCase(),
    passwordHash: params.passwordHash,
    role: params.role ?? 'auditor',
    createdAt: new Date().toISOString(),
  };

  db.run(
    `
      INSERT INTO users (id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [user.id, user.name, user.email, user.passwordHash, user.role, user.createdAt],
  );
  persistDatabase(db);
  return user;
}

export async function countUsers(): Promise<number> {
  const db = await getDatabase();
  const result = db.exec('SELECT COUNT(*) as total FROM users');
  return Number(result[0]?.values?.[0]?.[0] ?? 0);
}

export async function listAnalysesByUser(userId: string): Promise<DbAnalysis[]> {
  const db = await getDatabase();
  const statement = db.prepare(`
    SELECT id, user_id, name, period_start, period_end, generated_at, created_at, total_demands, billed_value, technical_due_value, glosable_value, snapshot_json
    FROM analyses
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  statement.bind([userId]);
  const rows: DbAnalysis[] = [];
  while (statement.step()) {
    rows.push(statementRowToAnalysis(statement.get()));
  }
  statement.free();
  return rows;
}

export async function findAnalysisById(id: string, userId: string): Promise<DbAnalysis | null> {
  const db = await getDatabase();
  const statement = db.prepare(`
    SELECT id, user_id, name, period_start, period_end, generated_at, created_at, total_demands, billed_value, technical_due_value, glosable_value, snapshot_json
    FROM analyses
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `);
  statement.bind([id, userId]);
  const row = statement.step() ? statement.get() : null;
  statement.free();
  return row ? statementRowToAnalysis(row) : null;
}

export async function saveAnalysis(params: {
  userId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  totalDemands: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
  snapshotJson: string;
}): Promise<DbAnalysis> {
  const db = await getDatabase();
  const analysis: DbAnalysis = {
    id: crypto.randomUUID(),
    userId: params.userId,
    name: params.name,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    generatedAt: params.generatedAt,
    createdAt: new Date().toISOString(),
    totalDemands: params.totalDemands,
    billedValue: params.billedValue,
    technicalDueValue: params.technicalDueValue,
    glosableValue: params.glosableValue,
    snapshotJson: params.snapshotJson,
  };

  db.run(
    `
      INSERT INTO analyses (
        id, user_id, name, period_start, period_end, generated_at, created_at,
        total_demands, billed_value, technical_due_value, glosable_value, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      analysis.id,
      analysis.userId,
      analysis.name,
      analysis.periodStart,
      analysis.periodEnd,
      analysis.generatedAt,
      analysis.createdAt,
      analysis.totalDemands,
      analysis.billedValue,
      analysis.technicalDueValue,
      analysis.glosableValue,
      analysis.snapshotJson,
    ],
  );
  persistDatabase(db);
  return analysis;
}

export async function deleteAnalysis(id: string, userId: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await findAnalysisById(id, userId);
  if (!existing) {
    return false;
  }

  db.run(`DELETE FROM analyses WHERE id = ? AND user_id = ?`, [id, userId]);
  persistDatabase(db);
  return true;
}
