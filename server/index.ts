import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePassword, hashPassword, signToken, verifyToken } from './auth.js';
import {
  countUsers,
  createUser,
  deleteAnalysis,
  findAnalysisById,
  findUserByEmail,
  findUserById,
  listAnalysesByUser,
  saveAnalysis,
} from './repositories.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../dist');
const allowedOrigins = (process.env.APP_CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const cookieSameSite =
  (process.env.APP_COOKIE_SAMESITE as 'lax' | 'strict' | 'none' | undefined) || 'lax';

app.set('trust proxy', 1);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!allowedOrigins.length && process.env.NODE_ENV !== 'production') {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origem não autorizada por APP_CORS_ORIGIN.'));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));

interface AuthedRequest extends Request {
  auth?: {
    userId: string;
    email: string;
    role: 'admin' | 'auditor';
  };
}

function paramToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function getTokenFromRequest(request: Request): string | null {
  const cookieToken = request.cookies?.auth_token;
  if (cookieToken) {
    return cookieToken;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length);
}

function requireAuth(request: AuthedRequest, response: Response, next: NextFunction): void {
  const token = getTokenFromRequest(request);
  if (!token) {
    response.status(401).json({ message: 'Não autenticado.' });
    return;
  }

  try {
    request.auth = verifyToken(token);
    next();
  } catch {
    response.status(401).json({ message: 'Sessão inválida ou expirada.' });
  }
}

function setAuthCookie(response: Response, token: string): void {
  const secureCookie =
    process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

  response.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: secureCookie,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/api/auth/register', async (request, response) => {
  const { name, email, password } = request.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    response.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    response.status(409).json({ message: 'Já existe um usuário com este e-mail.' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const totalUsers = await countUsers();
  const user = await createUser({
    name,
    email,
    passwordHash,
    role: totalUsers === 0 ? 'admin' : 'auditor',
  });

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  setAuthCookie(response, token);

  response.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

app.post('/api/auth/login', async (request, response) => {
  const { email, password } = request.body as {
    email?: string;
    password?: string;
  };

  if (!email?.trim() || !password?.trim()) {
    response.status(400).json({ message: 'Informe e-mail e senha.' });
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    response.status(401).json({ message: 'Credenciais inválidas.' });
    return;
  }

  const passwordMatches = await comparePassword(password, user.passwordHash);
  if (!passwordMatches) {
    response.status(401).json({ message: 'Credenciais inválidas.' });
    return;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  setAuthCookie(response, token);

  response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie('auth_token');
  response.status(204).send();
});

app.get('/api/auth/me', requireAuth, async (request: AuthedRequest, response) => {
  const auth = request.auth;
  if (!auth) {
    response.status(401).json({ message: 'Não autenticado.' });
    return;
  }

  const user = await findUserById(auth.userId);
  if (!user) {
    response.status(401).json({ message: 'Usuário não encontrado.' });
    return;
  }

  response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

app.get('/api/analyses', requireAuth, async (request: AuthedRequest, response) => {
  const userId = request.auth!.userId;
  const analyses = await listAnalysesByUser(userId);
  response.json({
    analyses: analyses.map((item) => ({
      id: item.id,
      name: item.name,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      generatedAt: item.generatedAt,
      createdAt: item.createdAt,
      totalDemands: item.totalDemands,
      billedValue: item.billedValue,
      technicalDueValue: item.technicalDueValue,
      glosableValue: item.glosableValue,
    })),
  });
});

app.get('/api/analyses/:id', requireAuth, async (request: AuthedRequest, response) => {
  const analysisId = paramToString(request.params.id);
  const analysis = await findAnalysisById(analysisId, request.auth!.userId);
  if (!analysis) {
    response.status(404).json({ message: 'Análise não encontrada.' });
    return;
  }

  response.json({
    analysis: {
      id: analysis.id,
      name: analysis.name,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
      generatedAt: analysis.generatedAt,
      createdAt: analysis.createdAt,
      totalDemands: analysis.totalDemands,
      billedValue: analysis.billedValue,
      technicalDueValue: analysis.technicalDueValue,
      glosableValue: analysis.glosableValue,
      snapshot: JSON.parse(analysis.snapshotJson),
    },
  });
});

app.post('/api/analyses', requireAuth, async (request: AuthedRequest, response) => {
  const { name, periodStart, periodEnd, generatedAt, totalDemands, billedValue, technicalDueValue, glosableValue, snapshot } =
    request.body as {
      name?: string;
      periodStart?: string;
      periodEnd?: string;
      generatedAt?: string;
      totalDemands?: number;
      billedValue?: number;
      technicalDueValue?: number;
      glosableValue?: number;
      snapshot?: unknown;
    };

  if (!name || !generatedAt || !snapshot) {
    response.status(400).json({ message: 'Dados da análise incompletos.' });
    return;
  }

  const analysis = await saveAnalysis({
    userId: request.auth!.userId,
    name,
    periodStart: periodStart ?? '',
    periodEnd: periodEnd ?? '',
    generatedAt,
    totalDemands: Number(totalDemands ?? 0),
    billedValue: Number(billedValue ?? 0),
    technicalDueValue: Number(technicalDueValue ?? 0),
    glosableValue: Number(glosableValue ?? 0),
    snapshotJson: JSON.stringify(snapshot),
  });

  response.status(201).json({
    analysis: {
      id: analysis.id,
      name: analysis.name,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
      generatedAt: analysis.generatedAt,
      createdAt: analysis.createdAt,
      totalDemands: analysis.totalDemands,
      billedValue: analysis.billedValue,
      technicalDueValue: analysis.technicalDueValue,
      glosableValue: analysis.glosableValue,
    },
  });
});

app.delete('/api/analyses/:id', requireAuth, async (request: AuthedRequest, response) => {
  const analysisId = paramToString(request.params.id);
  const deleted = await deleteAnalysis(analysisId, request.auth!.userId);
  if (!deleted) {
    response.status(404).json({ message: 'Análise não encontrada.' });
    return;
  }

  response.status(204).send();
});

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }

    response.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`API CRECI/PR x SCIRE disponível em http://0.0.0.0:${port}`);
});