import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.APP_JWT_SECRET || 'creci-pr-scire-dev-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TOKEN_EXPIRES_IN = '7d';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'auditor';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: AuthTokenPayload): string {
  if (IS_PRODUCTION && JWT_SECRET === 'creci-pr-scire-dev-secret') {
    throw new Error('APP_JWT_SECRET precisa ser definido em produção.');
  }

  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
