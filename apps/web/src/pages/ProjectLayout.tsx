import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { useActiveJobs, useProject } from '../hooks';
import { Icon, Spinner, StatusLed, Swatches } from '../components/ui';
import type { Project } from '../api';

export function useProjectCtx(): Project {
  const { projectId } = useParams();
  const p = useProject(projectId);
  return p.data!;
}

export function ProjectLayout() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const jobs = useActiveJobs(projectId);
  if (project.isLoading) return <div className="page"><Spinner /></div>;
  if (!project.data) return <div className="page"><div className="notice error">Project not found. <Link to="/">Back to projects</Link></div></div>;
  const p = project.data;
  const active = jobs.data?.items.length ?? 0;
  return (
    <>
      <div className="topbar">
        <div className="crumbs">
          <Link to="/">Projects</Link><span>/</span><strong>{p.name}</strong>
        </div>
        <div className="grow" />
        <div className="row small muted hide-mobile">
          <span className="mono">{p.artDirection.spriteSize.width}×{p.artDirection.spriteSize.height}</span>
          <span className="mono">{p.artDirection.perspective}</span>
          {p.effectivePalette.length > 0 && <Swatches colors={p.effectivePalette} size="sm" max={16} />}
        </div>
        <Link to={`/projects/${p.id}/generate`} className="btn primary"><Icon name="wand" /> Generate</Link>
      </div>
      <div className="tabs">
        <NavLink to={`/projects/${p.id}`} end>Library</NavLink>
        <NavLink to={`/projects/${p.id}/generate`}>Generate</NavLink>
        <NavLink to={`/projects/${p.id}/art-direction`}>Art direction</NavLink>
        <NavLink to={`/projects/${p.id}/history`}>History {active > 0 && <span className="chip cyan" style={{ marginLeft: 6 }}><StatusLed status="running" /> {active}</span>}</NavLink>
      </div>
      <Outlet />
    </>
  );
}
