import {
  AnalysisSnapshot,
  AppUser,
  LoginCredentials,
  RegisterPayload,
  SavedAnalysisRecord,
  SavedAnalysisSummary,
} from '../types';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as { message?: string } & T;
  if (!response.ok) {
    throw new ApiError(payload.message || 'Falha na comunicação com o servidor.', response.status);
  }

  return payload;
}

export async function fetchCurrentUser(): Promise<AppUser | null> {
  try {
    const response = await apiFetch<{ user: AppUser }>('/api/auth/me');
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function registerUser(payload: RegisterPayload): Promise<AppUser> {
  const response = await apiFetch<{ user: AppUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.user;
}

export async function loginUser(payload: LoginCredentials): Promise<AppUser> {
  const response = await apiFetch<{ user: AppUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.user;
}

export async function logoutUser(): Promise<void> {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
  });
}

export async function listSavedAnalyses(): Promise<SavedAnalysisSummary[]> {
  const response = await apiFetch<{ analyses: SavedAnalysisSummary[] }>('/api/analyses');
  return response.analyses;
}

export async function loadSavedAnalysis(id: string): Promise<SavedAnalysisRecord> {
  const response = await apiFetch<{
    analysis: Omit<SavedAnalysisRecord, 'snapshot'> & { snapshot: AnalysisSnapshot };
  }>(`/api/analyses/${id}`);
  return response.analysis;
}

export async function saveAnalysisToApi(payload: {
  name: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  totalDemands: number;
  billedValue: number;
  technicalDueValue: number;
  glosableValue: number;
  snapshot: AnalysisSnapshot;
}): Promise<SavedAnalysisSummary> {
  const response = await apiFetch<{ analysis: SavedAnalysisSummary }>('/api/analyses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.analysis;
}

export async function deleteSavedAnalysis(id: string): Promise<void> {
  await apiFetch(`/api/analyses/${id}`, {
    method: 'DELETE',
  });
}

export { ApiError };