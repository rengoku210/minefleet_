import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

interface EnrollmentToken {
  id: string;
  token: string;
  label: string | null;
  expiresAt: string;
  installCommandLinux: string;
  installCommandWindows: string;
}

export default function Machines() {
  const [machines, setMachines] = useState<any[]>([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollToken, setEnrollToken] = useState<EnrollmentToken | null>(null);
  const [enrollLabel, setEnrollLabel] = useState('');
  const [copiedWin, setCopiedWin] = useState(false);
  const [copiedLinux, setCopiedLinux] = useState(false);

  useEffect(() => {
    loadMachines();
  }, []);

  const loadMachines = () => {
    api('/api/machines').then((data) => setMachines(data.machines)).catch(() => {});
  };

  const generateToken = async () => {
    try {
      const data = await api('/api/enrollment-tokens', {
        method: 'POST',
        body: JSON.stringify({ label: enrollLabel || undefined, expiresInMinutes: 60 }),
      });
      setEnrollToken(data);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteMachine = async (id: string) => {
    if (!confirm('Delete this machine?')) return;
    await api(`/api/machines/${id}`, { method: 'DELETE' });
    loadMachines();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Machines</h1>
        <button
          onClick={() => setShowEnroll(true)}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Add Machine
        </button>
      </div>

      {/* Enrollment modal */}
      {showEnroll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 w-[600px] max-h-[80vh] overflow-auto">
            <h2 className="text-lg font-bold mb-4">Add New Machine</h2>

            {!enrollToken ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--text-muted)] mb-1">Label (optional)</label>
                  <input
                    value={enrollLabel} onChange={(e) => setEnrollLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
                    placeholder="e.g. Office Desktop"
                  />
                </div>
                <button onClick={generateToken}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm">
                  Generate Install Command
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-blue-400">🪟 Windows (PowerShell)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(enrollToken.installCommandWindows);
                        setCopiedWin(true);
                        setTimeout(() => setCopiedWin(false), 2000);
                      }}
                      className="text-xs px-2.5 py-1 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white rounded transition-colors"
                    >
                      {copiedWin ? '✓ Copied!' : 'Copy Command'}
                    </button>
                  </div>
                  <div className="bg-[var(--bg)] p-3 rounded-lg text-xs font-mono break-all border border-[var(--border)] select-all text-slate-200">
                    {enrollToken.installCommandWindows}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-amber-400">🐧 Linux (Bash)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(enrollToken.installCommandLinux);
                        setCopiedLinux(true);
                        setTimeout(() => setCopiedLinux(false), 2000);
                      }}
                      className="text-xs px-2.5 py-1 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white rounded transition-colors"
                    >
                      {copiedLinux ? '✓ Copied!' : 'Copy Command'}
                    </button>
                  </div>
                  <div className="bg-[var(--bg)] p-3 rounded-lg text-xs font-mono break-all border border-[var(--border)] select-all text-slate-200">
                    {enrollToken.installCommandLinux}
                  </div>
                </div>

                <div className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
                  ⏱️ Single-use token expires: {new Date(enrollToken.expiresAt).toLocaleTimeString()}
                </div>
              </div>
            )}

            <button onClick={() => { setShowEnroll(false); setEnrollToken(null); setEnrollLabel(''); }}
              className="mt-4 text-sm text-[var(--text-muted)] hover:underline">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Machine table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">OS</th>
              <th className="px-4 py-3">CPU</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Last Seen</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m: any) => (
              <tr key={m.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                <td className="px-4 py-3">
                  <Link to={`/machines/${m.id}`} className="text-[var(--primary)] hover:underline">{m.name}</Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 ${m.status === 'online' ? 'text-green-400' : 'text-red-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{m.os}</td>
                <td className="px-4 py-3 text-[var(--text-muted)] truncate max-w-48">{m.cpu_model}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{m.group_name || '—'}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {m.last_heartbeat ? new Date(m.last_heartbeat).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => deleteMachine(m.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {machines.length === 0 && (
          <div className="p-8 text-center text-[var(--text-muted)]">No machines registered. Click "Add Machine" to get started.</div>
        )}
      </div>
    </div>
  );
}
