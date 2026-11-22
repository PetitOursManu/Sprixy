import { lazy, Suspense, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon, Logo, Spinner, StatusLed } from './components/ui';
import { useActiveJobs, useProjects } from './hooks';
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

const EditorPage = lazy(() => import('./pages/EditorPage'));

function Shell({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const projects = useProjects();
  const jobs = useActiveJobs();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = jobs.data?.items ?? [];
  return (
    <div className={`shell ${open ? 'nav-open' : ''}`} onClick={() => open && setOpen(false)}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">SPRIXY</div>
            <div className="brand-tag">2D ASSET STUDIO</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end><Icon name="grid" /> Projects</NavLink>
          <NavLink to="/jobs"><Icon name="history" /> Jobs {active.length > 0 && <span className="count"><StatusLed status="running" /> {active.length}</span>}</NavLink>
          <NavLink to="/loras"><Icon name="layers" /> LoRAs</NavLink>
          <NavLink to="/datasets"><Icon name="db" /> Datasets</NavLink>
          <NavLink to="/usage"><Icon name="chart" /> Usage & budget</NavLink>
          <NavLink to="/settings"><Icon name="cog" /> Settings</NavLink>
          <div className="nav-label">Projects</div>
          {(projects.data?.items ?? []).slice(0, 12).map((p) => (
            <NavLink key={p.id} to={`/projects/${p.id}`} className={() => (loc.pathname.startsWith(`/projects/${p.id}`) ? 'active' : '')}>
              <Icon name="folder" /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="count">{p.assetCount}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="/api/docs" target="_blank" rel="noreferrer" className="row small muted"><Icon name="book" size={14} /> REST API docs</a>
          <div className="row between">
            <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{status?.user?.name}</span>
            <button className="btn ghost sm icon" onClick={() => void logout()} title="Sign out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      <main className="main">
        <button className="btn ghost icon mobile-only" style={{ position: 'fixed', top: 10, right: 10, zIndex: 30 }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-label="Menu"><Icon name="menu" /></button>
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
