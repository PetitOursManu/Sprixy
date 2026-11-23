import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, fmtUsd, get, patch, post, timeAgo } from '../api';
import { useAuth } from '../auth';
import { Field, Icon, Modal, Segmented, Spinner, useToast } from '../components/ui';

interface Limits { monthlyCapUsd: number | null; dailyCapUsd: number | null; sharedKeys: boolean }
interface AdminUser {
  id: string; email: string; name: string; role: 'admin' | 'user'; disabled: boolean;
  createdAt: number; createdBy: string | null; limits: Limits; ownKeys: string[];
  spentToday: number; spentMonth: number; jobsToday: number; jobsMonth: number; lastJobAt: number | null;
}
interface UserList { items: AdminUser[]; totals: { spentToday: number; spentMonth: number; allocatedMonth: number } }

type Draft = { name: string; email: string; password: string; role: 'admin' | 'user' } & Limits;

const blank: Draft = { name: '', email: '', password: '', role: 'user', monthlyCapUsd: 10, dailyCapUsd: null, sharedKeys: true };

/** Admin only: create accounts, give each one a spending allowance, share the instance's provider keys. */
export function UsersPage() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin-users'], queryFn: () => get<UserList>('/api/v1/admin/users'), refetchInterval: 30_000 });
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const done = (msg: string) => { toast('success', msg); void qc.invalidateQueries({ queryKey: ['admin-users'] }); };
  const fail = (e: unknown) => toast('error', (e as Error).message);
  const toggle = useMutation({ mutationFn: (u: AdminUser) => patch(`/api/v1/admin/users/${u.id}`, { disabled: !u.disabled }), onSuccess: (_r, u) => done(u.disabled ? `${u.name} can sign in again` : `${u.name} is disabled`), onError: fail });
  const remove = useMutation({ mutationFn: (u: AdminUser) => del(`/api/v1/admin/users/${u.id}`), onSuccess: (_r, u) => done(`${u.name} deleted`), onError: fail });

  if (status?.user?.role !== 'admin') {
    return <div className="page"><div className="notice">This page is for administrators.</div></div>;
  }
  const t = list.data?.totals;
  return (
    <>
      <div className="topbar"><div className="crumbs"><span>Admin</span><span>/</span><strong>Users</strong></div></div>
      <div className="page">
        <div className="page-head">
          <div><h1>Users</h1><p>Create accounts for your team and give each one a spending allowance. Accounts with <em>shared keys</em> generate on your provider keys, within their allowance.</p></div>
          <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> New account</button>
        </div>
        {!list.data ? <Spinner /> : (
          <>
            <div className="grid-3">
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Accounts</span><span className="v">{list.data.items.length}</span></div></div></div>
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Spent this month, all accounts</span><span className="v cost">{fmtUsd(t!.spentMonth, 2)}</span></div><span className="small muted mono">{fmtUsd(t!.spentToday, 2)} today</span></div></div>
              <div className="panel"><div className="panel-body"><div className="stat"><span className="k">Monthly allowances given</span><span className="v cost">{fmtUsd(t!.allocatedMonth, 2)}</span></div><span className="small muted">Accounts without an allowance are not counted</span></div></div>
            </div>
            <div className="panel">
              <table className="table">
                <thead><tr><th>Account</th><th>Role</th><th>This month</th><th>Today</th><th>Keys</th><th>Last job</th><th /></tr></thead>
                <tbody>
                  {list.data.items.map((u) => {
                    const me = u.id === status.user!.id;
                    const cap = u.limits.monthlyCapUsd;
                    const pct = cap ? Math.min(100, (u.spentMonth / cap) * 100) : 0;
                    return (
                      <tr key={u.id} style={u.disabled ? { opacity: 0.55 } : undefined}>
                        <td><strong>{u.name}</strong>{me && <span className="muted"> (you)</span>}<div className="small muted">{u.email}</div></td>
                        <td><span className={`chip ${u.role === 'admin' ? 'accent' : ''}`}>{u.role}</span>{u.disabled && <> <span className="chip red">disabled</span></>}</td>
                        <td style={{ minWidth: 150 }}>
                          <span className="mono">{fmtUsd(u.spentMonth, 2)}</span>{cap !== null ? <span className="muted"> of {fmtUsd(cap, 2)}</span> : <span className="muted small"> · no allowance</span>}
                          {cap !== null && <div style={{ height: 5, marginTop: 4, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? 'var(--red)' : 'var(--accent)' }} /></div>}
                        </td>
                        <td className="mono small">{fmtUsd(u.spentToday, 2)}{u.limits.dailyCapUsd !== null && <span className="muted"> / {fmtUsd(u.limits.dailyCapUsd, 2)}</span>}<div className="muted">{u.jobsToday} job{u.jobsToday === 1 ? '' : 's'}</div></td>
                        <td className="small">
                          {u.ownKeys.length > 0 && <div>Own: {u.ownKeys.join(', ')}</div>}
                          {u.limits.sharedKeys ? <span className="chip cyan">shared</span> : u.ownKeys.length === 0 && <span className="muted">none</span>}
                        </td>
                        <td className="small muted">{u.lastJobAt ? timeAgo(u.lastJobAt) : 'never'}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button className="btn ghost sm" onClick={() => setEditing(u)}><Icon name="edit" size={14} /> Edit</button>
                          {!me && <button className="btn ghost sm" onClick={() => toggle.mutate(u)}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                          {!me && <button className="btn ghost sm danger icon" title="Delete" aria-label={`Delete ${u.name}`}
                            onClick={() => confirm(`Delete ${u.name} (${u.email}) with all their projects, assets and files? This cannot be undone.`) && remove.mutate(u)}><Icon name="trash" size={14} /></button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="notice">
              Allowances are hard limits: a job whose estimate would go over is refused before anything is spent. An account can set
              lower limits for itself under <strong>Usage & budget</strong>, never higher ones. Shared keys are used only when the
              account has no key of its own for that provider; your keys and your provider balance stay hidden from it.
            </div>
          </>
        )}
      </div>
      {editing && <UserModal user={editing === 'new' ? null : editing} self={editing !== 'new' && editing.id === status.user!.id} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); done(m); }} />}
    </>
  );
}

function UserModal({ user, self, onClose, onSaved }: { user: AdminUser | null; self: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(user ? { name: user.name, email: user.email, password: '', role: user.role, ...user.limits } : blank);
  const save = useMutation({
    mutationFn: () => {
      const limits = { monthlyCapUsd: d.monthlyCapUsd, dailyCapUsd: d.dailyCapUsd, sharedKeys: d.sharedKeys };
      if (!user) return post('/api/v1/admin/users', { ...limits, name: d.name, email: d.email, password: d.password, role: d.role });
      return patch(`/api/v1/admin/users/${user.id}`, { ...limits, name: d.name, ...(self ? {} : { role: d.role }), ...(d.password ? { password: d.password } : {}) });
    },
    onSuccess: () => onSaved(user ? `${d.name} updated` : `${d.name} can now sign in`),
    onError: (e) => toast('error', (e as Error).message),
  });
  const money = (k: 'monthlyCapUsd' | 'dailyCapUsd', label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <input className="input mono" type="number" min={0} step={0.5} value={d[k] ?? ''} placeholder="no limit"
        onChange={(e) => setD({ ...d, [k]: e.target.value === '' ? null : Number(e.target.value) })} />
    </Field>
  );
  const valid = d.name.trim() && (user || (/\S+@\S+\.\S+/.test(d.email) && d.password.length >= 8)) && (!d.password || d.password.length >= 8);
  return (
    <Modal title={user ? `Edit ${user.name}` : 'New account'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{user ? 'Save' : 'Create account'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="grid-2">
          <Field label="Name"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
          <Field label="Email" hint={user ? 'Used to sign in' : undefined}><input className="input" type="email" value={d.email} disabled={!!user} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
        </div>
        <Field label={user ? 'New password' : 'Password'} hint={user ? 'Leave empty to keep the current one. Setting one signs the account out everywhere.' : 'At least 8 characters. Give it to the person; they can change it in Settings.'}>
          <input className="input" type="password" autoComplete="new-password" value={d.password} placeholder={user ? 'unchanged' : ''} onChange={(e) => setD({ ...d, password: e.target.value })} />
        </Field>
        {!self && (
          <Field label="Role" hint={d.role === 'admin' ? 'Administrators manage accounts and their allowances.' : 'A regular account sees only its own projects and assets.'}>
            <Segmented value={d.role} onChange={(role) => setD({ ...d, role })} options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} />
          </Field>
        )}
        <div className="grid-2">
          {money('monthlyCapUsd', 'Monthly allowance (USD)', 'Maximum spend per calendar month')}
          {money('dailyCapUsd', 'Daily allowance (USD)', 'Optional, resets at midnight')}
        </div>
        <label className="check"><input type="checkbox" checked={d.sharedKeys} onChange={(e) => setD({ ...d, sharedKeys: e.target.checked })} /> Use the administrators’ provider keys (fal.ai, OpenRouter) when this account has none</label>
      </div>
    </Modal>
  );
}
