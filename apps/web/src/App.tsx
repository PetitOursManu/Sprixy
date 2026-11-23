import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon, Spinner, StatusLed } from './components/ui';
import { useActiveJobs, useBalances, useProjects, useUsageSummary } from './hooks';
import { fmtUsd } from './api';
import { AuthPage } from './pages/AuthPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectLayout } from './pages/ProjectLayout';
import { LibraryPage } from './pages/LibraryPage';
import { GeneratePage } from './pages/GeneratePage';
import { ArtDirectionPage } from './pages/ArtDirectionPage';
import { HistoryPage } from './pages/HistoryPage';
import { AssetPage } from './pages/AssetPage';
import { LorasPage } from './pages/LorasPage';
import { DatasetsPage, DatasetPage } from './pages/DatasetsPage';
import { UsagePage } from './pages/UsagePage';
import { SettingsPage } from './pages/SettingsPage';

/** Below this, the header balance turns orange. */
const LOW_BALANCE = 1;

const EditorPage = lazy(() => import('./pages/EditorPage'));

function Shell({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const projects = useProjects();
  const jobs = useActiveJobs();
  const usage = useUsageSummary();
  const balances = useBalances();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = jobs.data?.items ?? [];
  const user = status?.user;
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();
  const month = usage.data?.month ?? 0;
  const cap = usage.data?.budget.monthlyBudgetUsd ?? null;
  const inProject = loc.pathname.startsWith('/projects/');
  return (
    <div className={`shell ${open ? 'nav-open' : ''}`} onClick={() => open && setOpen(false)}>
      <header className="header">
        <Link to="/" className="logo-link" aria-label="Sprixy — projects"><img src="/sprixy-logo.png" alt="Sprixy" /></Link>
        <span className="tagline hide-mobile">Your game asset workbench</span>
        <div className="grow" />
        {active.length > 0 && <Link to="/jobs" className="pill" style={{ textDecoration: 'none' }}><StatusLed status="running" /> {active.length} job{active.length > 1 ? 's' : ''} running</Link>}
        {(balances.data?.items ?? []).filter((b) => b.configured && b.status !== 'not_supported').map((b) => (
          b.status === 'ok' && b.balanceUsd !== null ? (
            <Link key={b.provider} to="/settings" className={`pill balance ${b.balanceUsd < LOW_BALANCE ? 'low' : ''}`} title={`${b.name} balance${b.detail ? ` (${b.detail})` : ''} · checked ${new Date(b.checkedAt).toLocaleTimeString()}`}>
              <Icon name="wallet" size={14} /><span className="hide-mobile">{b.name}</span><strong>{fmtUsd(b.balanceUsd, 2)}</strong>
            </Link>
          ) : b.status === 'needs_billing_key' ? (
            <Link key={b.provider} to="/settings" className="pill balance muted hide-mobile" title={b.message}><Icon name="wallet" size={14} />{b.name} balance: add a billing key</Link>
          ) : null
        ))}
        <span className="pill hide-mobile"><span className="led" style={{ background: 'var(--cyan)' }} /> Self-hosted</span>
        <span className="avatar" title={user?.email}>{initial}</span>
        <button className="btn ghost icon mobile-only" style={{ position: 'fixed', top: 11, right: 10, zIndex: 30 }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-label="Menu"><Icon name="menu" /></button>
      </header>
      <aside className="sidebar">
        <nav className="nav" aria-label="Main">
          <div className="nav-label">Workspace</div>
          <NavLink to="/" end className={() => (loc.pathname === '/' || inProject ? 'active' : '')}><Icon name="grid" /> Projects <span className="count">{projects.data?.items.length ?? 0}</span></NavLink>
          {(projects.data?.items.length ?? 0) > 0 && (
            <div className="sub">
              {projects.data!.items.slice(0, 12).map((p) => (
                <NavLink key={p.id} to={`/projects/${p.id}`} className={() => (loc.pathname.startsWith(`/projects/${p.id}`) ? 'active' : '')}>
                  <span className="dot" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </NavLink>
              ))}
            </div>
          )}
          <NavLink to="/jobs"><Icon name="history" /> Jobs {active.length > 0 && <span className="count">{active.length}</span>}</NavLink>
          <NavLink to="/loras"><Icon name="layers" /> LoRAs</NavLink>
          <NavLink to="/datasets"><Icon name="db" /> Datasets</NavLink>
          <div className="nav-label">Account</div>
          <NavLink to="/usage"><Icon name="chart" /> Usage & budget</NavLink>
          <NavLink to="/settings"><Icon name="cog" /> Settings</NavLink>
          <a href="/api/docs" target="_blank" rel="noreferrer"><Icon name="book" /> API docs & MCP</a>
        </nav>
        <div className="sidebar-foot">
          <Link to="/usage" className="budget-card">
            <div className="row between"><span>This month</span>{cap !== null && <span className="mono">{Math.round((month / cap) * 100)}%</span>}</div>
            <div style={{ marginTop: 4 }}><strong>{fmtUsd(month, 2)}</strong>{cap !== null && <span> of {fmtUsd(cap, 0)}</span>}</div>
            {cap !== null && <div className="bar"><i style={{ width: `${Math.min(100, (month / cap) * 100)}%` }} /></div>}
          </Link>
          <div className="user-row">
            <span className="avatar">{initial}</span>
            <span className="who">{user?.name || user?.email}<small>{user?.role}</small></span>
            <button className="btn ghost sm icon" onClick={() => void logout()} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      <main className="main">
        {children}
      </main>
    </div>
  );
}

export function App() {
  const { status } = useAuth();
  if (!status) return <div className="auth-wrap"><Spinner /></div>;
  if (!status.user) return <AuthPage setup={status.setupRequired} allowSignup={status.allowSignup} />;
  return (
    <Shell>
      <Suspense fallback={<div className="page"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<LibraryPage />} />
            <Route path="generate" element={<GeneratePage />} />
            <Route path="art-direction" element={<ArtDirectionPage />} />
            <Route path="history" element={<HistoryPage />} />
          </Route>
          <Route path="/assets/:id" element={<AssetPage />} />
          <Route path="/assets/:id/edit" element={<EditorPage />} />
          <Route path="/jobs" element={<HistoryPage global />} />
          <Route path="/loras" element={<LorasPage />} />
          <Route path="/datasets" element={<DatasetsPage />} />
          <Route path="/datasets/:id" element={<DatasetPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
