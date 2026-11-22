import { useState, type FormEvent } from 'react';
import { post, ApiError } from '../api';
import { useAuth } from '../auth';
import { Field, Logo } from '../components/ui';

export function AuthPage({ setup, allowSignup }: { setup: boolean; allowSignup: boolean }) {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(setup ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await post('/api/v1/auth/register', { email, name, password });
      else await post('/api/v1/auth/login', { email, password });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={submit}>
        <div className="panel-body" style={{ gap: 16, padding: 24 }}>
          <div className="row">
            <Logo size={34} />
            <div>
              <div className="brand-name" style={{ fontSize: 16 }}>SPRIXY</div>
              <div className="brand-tag">SELF-HOSTED 2D GAME ASSET STUDIO</div>
            </div>
          </div>
          {setup && (
            <div className="notice warn small">
              First launch: create the administrator account of this instance. You will then add your own provider keys (fal.ai, OpenRouter) in Settings.
            </div>
          )}
          {mode === 'register' && (
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
          )}
          <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === 'login'} autoComplete="email" /></Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {error && <div className="notice error small">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{mode === 'register' ? (setup ? 'Create admin account' : 'Create account') : 'Sign in'}</button>
          {!setup && allowSignup && (
            <button type="button" className="btn ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'No account? Sign up' : 'Already have an account? Sign in'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
