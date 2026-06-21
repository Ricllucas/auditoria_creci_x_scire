import { FormEvent, useState } from 'react';
import { AppUser, LoginCredentials, RegisterPayload } from '../../types';

interface AuthPanelProps {
  onLogin: (credentials: LoginCredentials) => Promise<AppUser>;
  onRegister: (payload: RegisterPayload) => Promise<AppUser>;
  loading: boolean;
}

export function AuthPanel({ onLogin, onRegister, loading }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    try {
      if (mode === 'login') {
        await onLogin({ email, password });
      } else {
        await onRegister({ name, email, password });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao autenticar.');
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <span className="hero__eyebrow">Plataforma institucional com backend, login e banco de dados</span>
        <h1>Auditoria CRECI/PR x SCIRE</h1>
        <p>
          Acesse o sistema para salvar análises no banco, consultar histórico, compartilhar o ambiente com outros
          usuários e manter trilha de auditoria.
        </p>
        <ul className="side-list">
          <li>Autenticação por e-mail e senha</li>
          <li>Persistência de análises em banco de dados</li>
          <li>Histórico recuperável por usuário</li>
          <li>Estrutura pronta para expansão institucional</li>
        </ul>
      </section>

      <section className="auth-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => setMode('login')}
          >
            Entrar
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => setMode('register')}
          >
            Criar conta
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h2>{mode === 'login' ? 'Acesso ao sistema' : 'Cadastro inicial'}</h2>
          <p>
            {mode === 'login'
              ? 'Entre para acessar suas análises salvas e continuar o trabalho.'
              : 'O primeiro usuário criado recebe perfil administrador.'}
          </p>

          {mode === 'register' && (
            <label className="field">
              <span>Nome completo</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required />
            </label>
          )}

          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              required
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              minLength={6}
              required
            />
          </label>

          {errorMessage && <div className="auth-error">{errorMessage}</div>}

          <button type="submit" className="button button--primary auth-submit" disabled={loading}>
            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </section>
    </div>
  );
}