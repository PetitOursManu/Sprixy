import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveJobs, useProject, useProjects } from '../hooks';
import { Icon, Spinner, StatusLed, Swatches, useToast } from '../components/ui';
import { patch, type Project } from '../api';

export function useProjectCtx(): Project {
  const { projectId } = useParams();
  const p = useProject(projectId);
  return p.data!;
}

export function ProjectLayout() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const jobs = useActiveJobs(projectId);
  const all = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const share = useMutation({
    mutationFn: (on: boolean) => patch<Project>(`/api/v1/projects/${projectId}`, { catalogShared: on }),
    onSuccess: (p) => {
      qc.setQueryData(['project', projectId], p);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast('success', p.catalogShared ? 'Connected apps such as Mocky can now use this project\'s assets' : 'This project is no longer shared');
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  if (project.isLoading) return <div className="page"><Spinner /></div>;
  if (!project.data) return <div className="page"><div className="notice error">Project not found. <Link to="/">Back to projects</Link></div></div>;
  const p = project.data;
  const active = jobs.data?.items.length ?? 0;
  const ad = p.artDirection;
  return (
    <>
      <div className="phead">
        <div className="crumbs"><Link to="/">Projects</Link><Icon name="chevron" size={12} /><strong>{p.name}</strong></div>
        <div className="phead-row">
          <div>
            <div className="eyebrow">Project workspace</div>
            <div className="row" style={{ gap: 10 }}>
              <h1>{p.name}</h1>
              <span className="chip">{all.data?.items.find((x) => x.id === p.id)?.assetCount ?? p.assetCount ?? 0} assets</span>
            </div>
            <div className="meta">
              <span>{ad.spriteSize.width}×{ad.spriteSize.height} sprites</span><span className="sep-dot">·</span>
              <span style={{ textTransform: 'capitalize' }}>{ad.perspective.replace(/-/g, ' ')}</span>
              {p.effectivePalette.length > 0 && <><span className="sep-dot">·</span><Swatches colors={p.effectivePalette} size="sm" max={16} /></>}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className={`btn lg ${p.catalogShared ? 'shared-on' : 'ghost'}`} disabled={share.isPending} onClick={() => share.mutate(!p.catalogShared)}
              aria-pressed={p.catalogShared}
              title={p.catalogShared ? 'Apps you connected with a catalog token (Mocky…) can search and use the assets of this project. Click to stop sharing.' : 'Let apps you connect with a catalog token (Mocky…) search and use the assets of this project, read-only.'}>
              <Icon name="link" /> {p.catalogShared ? 'Shared with apps' : 'Share with apps'}
            </button>
            <Link to={`/projects/${p.id}/generate`} className="btn primary lg"><Icon name="plus" /> Generate asset</Link>
          </div>
        </div>
        <nav className="tabs" aria-label="Project">
          <NavLink to={`/projects/${p.id}`} end>Library</NavLink>
          <NavLink to={`/projects/${p.id}/generate`}>Generate</NavLink>
          <NavLink to={`/projects/${p.id}/art-direction`}>Art direction</NavLink>
          <NavLink to={`/projects/${p.id}/history`}>History {active > 0 && <span className="chip cyan"><StatusLed status="running" /> {active}</span>}</NavLink>
        </nav>
      </div>
      <Outlet />
    </>
  );
}
