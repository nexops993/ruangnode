'use client';

import { useEffect, useState } from 'react';

type Instance = { id: string; name: string; slug: string; status: string; region: string | null };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function DashboardPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [message, setMessage] = useState('Loading instances...');
  const [busy, setBusy] = useState<string | null>(null);

  async function loadInstances(): Promise<void> {
    const response = await fetch(`${apiUrl}/api/v1/instances`, { credentials: 'include' });
    const payload = await response.json() as { data?: { instances?: Instance[] }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? 'Unable to load instances.');
    setInstances(payload.data?.instances ?? []);
    setMessage('');
  }

  useEffect(() => {
    void loadInstances().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load instances.'));
  }, []);

  async function operate(instance: Instance, operation: 'start' | 'stop' | 'restart' | 'delete'): Promise<void> {
    setBusy(instance.id);
    try {
      const response = await fetch(`${apiUrl}/api/v1/instances/${encodeURIComponent(instance.id)}${operation === 'delete' ? '' : `/${operation}`}`, { method: operation === 'delete' ? 'DELETE' : 'POST', credentials: 'include' });
      const payload = await response.json() as { data?: { instance?: Instance }; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? 'Operation failed.');
      if (operation === 'delete') setInstances((current) => current.filter((item) => item.id !== instance.id));
      else setInstances((current) => current.map((item) => item.id === instance.id ? payload.data?.instance ?? item : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <header><p className="eyebrow">RUANGNODE / CONTROL PLANE</p><h1>Your instances</h1><p className="lede">Runtime controls reflect the state reported by the infrastructure agent.</p></header>
      {message !== '' && <p className="notice">{message}</p>}
      <section className="instances" aria-live="polite">
        {instances.map((instance) => <article className="instance" key={instance.id}>
          <div><p className="instance-name">{instance.name}</p><p className="slug">{instance.slug}{instance.region === null ? '' : ` / ${instance.region}`}</p></div>
          <span className={`status status-${instance.status.toLowerCase()}`}>{instance.status}</span>
          <div className="actions">
            {(instance.status === 'STOPPED' || instance.status === 'SUSPENDED') && <button disabled={busy === instance.id} onClick={() => void operate(instance, 'start')}>Start</button>}
            {instance.status === 'ACTIVE' && <button disabled={busy === instance.id} onClick={() => void operate(instance, 'stop')}>Stop</button>}
            {(instance.status === 'ACTIVE' || instance.status === 'STOPPED') && <button disabled={busy === instance.id} onClick={() => void operate(instance, 'restart')}>Restart</button>}
            {['ACTIVE', 'STOPPED', 'ERROR', 'SUSPENDED'].includes(instance.status) && <button className="danger" disabled={busy === instance.id} onClick={() => void operate(instance, 'delete')}>Remove</button>}
          </div>
        </article>)}
        {message === '' && instances.length === 0 && <p className="empty">No managed instances yet.</p>}
      </section>
      <style jsx>{`
        :global(*) { box-sizing: border-box; }
        :global(body) { margin: 0; background: #f2efe8; color: #17221f; font-family: Georgia, serif; }
        .shell { max-width: 960px; margin: 0 auto; padding: 8rem 2rem; }
        header { border-bottom: 2px solid #17221f; padding-bottom: 2rem; }
        .eyebrow, .slug, .status, button { font-family: monospace; letter-spacing: 0; }
        .eyebrow { color: #ad3d28; font-size: .75rem; font-weight: 700; }
        h1 { font-size: clamp(2.8rem, 8vw, 6rem); line-height: .9; margin: 1rem 0; max-width: 8ch; }
        .lede { font-size: 1.15rem; max-width: 42ch; }
        .notice, .empty { margin: 2rem 0; padding: 1rem; border: 1px solid #ad3d28; color: #7e291c; }
        .instances { display: grid; gap: 1rem; margin-top: 2rem; }
        .instance { display: grid; grid-template-columns: 1fr auto; gap: 1rem; align-items: center; background: #fffdf8; border: 1px solid #17221f; padding: 1.25rem; box-shadow: 5px 5px 0 #b9c9bd; }
        .instance-name { font-size: 1.4rem; margin: 0 0 .35rem; }
        .slug { color: #53635d; font-size: .75rem; margin: 0; }
        .status { border: 1px solid #17221f; padding: .35rem .5rem; font-size: .7rem; }
        .status-active { background: #c6e3bd; }
        .status-error { background: #f4b4a6; }
        .actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .5rem; }
        button { background: #17221f; color: #fffdf8; border: 0; padding: .65rem .8rem; cursor: pointer; }
        button.danger { background: #ad3d28; }
        button:disabled { cursor: wait; opacity: .5; }
        @media (max-width: 600px) { .shell { padding: 4rem 1rem; } .instance { grid-template-columns: 1fr; } }
      `}</style>
    </main>
  );
}