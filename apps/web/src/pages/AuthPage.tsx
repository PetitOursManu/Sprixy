import { useState, type FormEvent } from 'react';
import { post, ApiError } from '../api';
import { useAuth } from '../auth';
import { Field, Icon } from '../components/ui';

/* Decorative pixel sprites (inline, no network): what Sprixy makes. */
const PAL: Record<string, string> = {
  k: '#181425', s: '#E8B796', w: '#FFFFFF', W: '#C0CBDC', b: '#124E89', r: '#733E39', R: '#A2522C', g: '#FEAE34', h: '#8B9BB4',
  E: '#63C74D', l: '#265C42', P: '#E43B44', t: '#BE4A2F', u: '#EAD4AA',
};
const SPRITES: [string, string[]][] = [
  ['Dwarf', ['......kkkk......', '.....kssssk..hh.', '....ksskksk.khhk', '....ksssssk..kr.', '...kwwwwwwwk.kr.', '...kwwWkWwwk.kr.', '..kbkwwwwwkbkkr.', '..kbbkwWwkbbskr.', '..kbbbbbbbbbsk..', '..kssrgggrbk....', '...kbbbbbbk.....', '...kbbkkbbk.....', '...krrk.krrk....', '...kkkk.kkkk....']],
  ['Goblin', ['.....kkkkk......', '....kEEEEEk.....', '..kkEkEEkEkk....', '..kEEEEEEEEk....', '...kEEkkEEk.r...', '....kEEEEk..r...', '...klllllllkr...', '..kElllllllEr...', '..kE.krrrk.Ek...', '....kllkllk.....', '....kRk.kRk.....', '....kkk.kkk.....']],
  ['Chest', ['................', '...kkkkkkkkkk...', '..kRRRRRRRRRRk..', '..kRggRRRRggRk..', '..krrrrrrrrrrk..', '..kkkkkkkkkkkk..', '..kRRRRggRRRRk..', '..kRRRgkkgRRRk..', '..krrrrggrrrrk..', '..krggrrrrggrk..', '..kkkkkkkkkkkk..']],
  ['Skeleton', ['.....kkkkk......', '....kWWWWWk.....', '....kWkWkWk.....', '....kWWWWWk..h..', '.....kWkWk..h...', '....kkWWWkk.h...', '...kW.kWk.Wkh...', '...k.kWWWk.kh...', '.....kWkWk..g...', '.....kW.Wk......', '.....kk.kk......']],
  ['Potion', ['......kkkk......', '......kuuk......', '......kRRk......', '.....kWWWWk.....', '....kWPPPPWk....', '...kPPwPPPPPk...', '...kPwPPPPPPk...', '...kPPPPPPPPk...', '...ktPPPPPPtk...', '....kttttttk....', '.....kkkkkk.....']],
];

function Sprite({ map }: { map: string[] }) {
  return (
    <svg viewBox={`0 0 ${map[0].length} ${map.length}`} width={58} height={(58 * map.length) / map[0].length} shapeRendering="crispEdges" aria-hidden>
      {map.flatMap((row, y) => [...row].map((c, x) => (PAL[c] ? <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={PAL[c]} /> : null)))}
    </svg>
  );
}

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

  const canSwitch = !setup && allowSignup;
  return (
    <div className="auth-page">
      <header className="auth-top">
        <img src="/sprixy-logo.png" alt="Sprixy" />
        <span className="row small" style={{ gap: 18, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <span className="row" style={{ gap: 8 }}><span className="led" style={{ background: 'var(--accent)' }} /> Your self-hosted studio</span>
          <a href="https://github.com/PetitOursManu/Sprixy" target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>GitHub →</a>
        </span>
      </header>
      <main className="auth-grid">
        <section className="auth-pitch">
          <div className="eyebrow">Your creative workbench</div>
          <h1>Pixel-perfect game assets with AI <em>—</em> on your own server.</h1>
          <p className="lead">Generate sprites, tilesets and animations with your own fal.ai or OpenRouter keys. No GPU, no subscription.</p>
          <ul className="auth-points" style={{ padding: 0, margin: '26px 0 0' }}>
            <li><span className="ic"><Icon name="image" /></span><div><b>Pixels that stay pixels</b><span>True pixel grid, palettes and cleanup. Free and deterministic.</span></div></li>
            <li><span className="ic"><Icon name="users" /></span><div><b>One character, every direction</b><span>4-direction sheets and walk cycles, all in one call.</span></div></li>
            <li><span className="ic"><Icon name="bolt" /></span><div><b>Plugs into your workflow</b><span>REST API + MCP server for Claude, Godot and Phaser.</span></div></li>
          </ul>
          <div className="auth-sprites hide-mobile">
            <div className="row between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <span className="eyebrow" style={{ margin: 0, color: 'var(--text)' }}>A little of what you can make</span>
              <span className="mono small muted">SPRITES / 01–05</span>
            </div>
            <div className="cells">{SPRITES.map(([n, m]) => <div key={n}><div className="pic"><Sprite map={m} /></div>{n}</div>)}</div>
          </div>
        </section>
        <form className="auth-card" onSubmit={submit}>
          <div className="in">
            <div>
              <div className="eyebrow" style={{ color: 'var(--accent-2)' }}>{setup ? 'First launch' : 'Your instance'}</div>
              <h2 style={{ fontSize: 28, letterSpacing: '-0.035em' }}>{setup ? 'Create the admin account' : mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="muted" style={{ marginTop: 6 }}>{setup ? 'You will then add your provider keys (fal.ai, OpenRouter) in Settings.' : mode === 'login' ? 'Sign in to pick up where you left off.' : 'Join this Sprixy instance.'}</p>
            </div>
            <div className="notice small row" style={{ gap: 8, background: 'var(--bg)' }}><Icon name="link" size={14} className="muted" /><span className="mono">{location.host}</span></div>
            {canSwitch && (
              <nav className="tabs" style={{ marginTop: 0 }}>
                <a href="#" className={mode === 'login' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setMode('login'); }} style={{ flex: 1, justifyContent: 'center' }}>Sign in</a>
                <a href="#" className={mode === 'register' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setMode('register'); }} style={{ flex: 1, justifyContent: 'center' }}>Create account</a>
              </nav>
            )}
            {mode === 'register' && (
              <Field label="Name"><input className="input" style={{ height: 44 }} value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
            )}
            <Field label="Email address"><input className="input" style={{ height: 44 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === 'login'} autoComplete="email" placeholder="you@studio.dev" /></Field>
            <Field label="Password" hint="At least 8 characters.">
              <input className="input" style={{ height: 44 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Enter your password" />
            </Field>
            {error && <div className="notice error small">{error}</div>}
            <button className="btn primary lg" style={{ height: 46 }} disabled={busy}>{mode === 'register' ? (setup ? 'Create admin account' : 'Create account') : 'Sign in'} →</button>
          </div>
          <div className="first-run"><Icon name="lock" size={14} /><span><b style={{ color: 'var(--text)' }}>First run?</b> The first account created becomes the admin; sign-ups then close unless the admin opens them.</span></div>
        </form>
      </main>
      <footer className="auth-foot"><span>Sprixy · MIT · github.com/PetitOursManu/Sprixy</span><span>Your server. Your keys. Your creations.</span></footer>
    </div>
  );
}
