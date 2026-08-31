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

      // Ensure stable canonical base URL
      const origin = typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')
        ? window.location.origin
        : 'https://minefleet.vercel.app';
      
      const token = data.token;
      data.installCommandWindows = `powershell -ExecutionPolicy Bypass -c "irm '${origin}/install.ps1?token=${token}' | iex"`;
      data.installCommandLinux = `curl -fsSL "${origin}/install.sh?token=${token}" | bash`;

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

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => { setShowEnroll(false); setEnrollToken(null); setEnrollLabel(''); }}
                className="px-4 py-2 bg-[var(--bg-hover)] text-sm rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Machine list */}
      {machines.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          No machines registered yet. Click "+ Add Machine" to enroll your first machine.
        </div>
      ) : (
        <div className="grid gap-4">
          {machines.map((m) => (
            <div
              key={m.id}
              className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${m.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <div>
                  <Link to={`/machines/${m.id}`} className="font-semibold hover:underline">
                    {m.name || m.hostname}
                  </Link>
                  <div className="text-xs text-[var(--text-muted)]">
                    {m.hostname} • {m.os} • {m.cpu_model || m.cpuModel || 'CPU'} • RAM: {Math.round(((m.ram_bytes || m.ramBytes || 0) / (1024 * 1024 * 1024)))} GB • GPUs: {m.gpu_count ?? (Array.isArray(m.gpus) ? m.gpus.length : 0)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--text-muted)]">
                  Last seen: {(m.last_heartbeat || m.lastHeartbeat) ? new Date(m.last_heartbeat || m.lastHeartbeat).toLocaleTimeString() : 'Never'}
                </span>
                <button
                  onClick={() => deleteMachine(m.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
