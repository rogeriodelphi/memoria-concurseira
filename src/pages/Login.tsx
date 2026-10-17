import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { APP_NAME, APP_SLOGAN, BrandMark } from '../components/BrandMark';
import { PasswordInput } from '../components/PasswordInput';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../services/api';

export function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/painel" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/painel');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <BrandMark size={36} />
            <span className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{APP_NAME}</span>
          </div>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{APP_SLOGAN}</p>
        </div>

        <div className="card p-8">
          <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Entrar</h1>
          <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">Acesse suas coleções de flashcards.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-field" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
              />
            </div>
            <div>
              <label className="label-field" htmlFor="password">
                Senha
              </label>
              <PasswordInput
                id="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Ainda não tem conta?{' '}
            <Link to="/registrar" className="font-semibold text-brand-600 hover:text-brand-700">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
