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

  const loadMachines = () => {
    api('/api/machines')
      .then((data) => setMachines(data.machines || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadMachines();
    const interval = setInterval(loadMachines, 5000);
    return () => clearInterval(interval);
  }, []);

  const generateToken = async () => {
    try {
      const data = await api('/api/enrollment-tokens', {
        method: 'POST',
        body: JSON.stringify({ label: enrollLabel || undefined, expiresInMinutes: 60 }),
      });

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
    if (!confirm('Delete this machine from registry?')) return;
    await api(`/api/machines/${id}`, { method: 'DELETE' });
    loadMachines();
  };

  // Fleet KPIs
  const totalNodes = machines.length;
  const onlineNodes = machines.filter(m => m.status === 'online').length;
  const offlineNodes = totalNodes - onlineNodes;
  const miningNodes = machines.filter(m => m.telemetry?.miningStatus === 'mining').length;
  const totalHashrate = machines.reduce((acc, m) => acc + (m.telemetry?.hashrate || 0), 0);
  const totalRamGb = Math.round(machines.reduce((acc, m) => acc + (m.ram_bytes || m.ramBytes || 0), 0) / (1024 * 1024 * 1024));

  const formatLastSeen = (hb: string | null) => {
    if (!hb) return 'Never';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(hb).getTime()) / 1000));
    if (diffSec < 15) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ago`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Machine Fleet</h1>
          <p className="text-sm text-[var(--text-muted)]">Real-time node telemetry, hardware discovery, and mining control</p>
        </div>
        <button
          onClick={() => setShowEnroll(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
        >
          <span>+</span> Add Machine
        </button>
      </div>

      {/* Fleet KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Total Nodes</div>
          <div className="text-2xl font-bold mt-1 text-slate-100">{totalNodes}</div>
        </div>
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Online</div>
          <div className="text-2xl font-bold mt-1 text-emerald-400 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            {onlineNodes}
          </div>
        </div>
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Offline</div>
          <div className="text-2xl font-bold mt-1 text-slate-400">{offlineNodes}</div>
        </div>
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Active Miners</div>
          <div className="text-2xl font-bold mt-1 text-cyan-400">{miningNodes}</div>
        </div>
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Fleet Hashrate</div>
          <div className="text-2xl font-bold mt-1 text-violet-400 font-mono">{totalHashrate.toFixed(1)} <span className="text-xs text-[var(--text-muted)] font-sans">H/s</span></div>
        </div>
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs">
          <div className="text-xs text-[var(--text-muted)] font-medium">Fleet Memory</div>
          <div className="text-2xl font-bold mt-1 text-slate-200">{totalRamGb} <span className="text-xs text-[var(--text-muted)] font-sans">GB</span></div>
        </div>
      </div>

      {/* Enrollment modal */}
      {showEnroll && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 w-full max-w-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Enroll Machine</h2>
              <button onClick={() => { setShowEnroll(false); setEnrollToken(null); setEnrollLabel(''); }} className="text-[var(--text-muted)] hover:text-white text-lg">✕</button>
            </div>

            {!enrollToken ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--text-muted)]">Generate a secure, single-use installer command for your Windows PC or Linux server.</p>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">Machine Label (optional)</label>
                  <input
                    value={enrollLabel}
                    onChange={(e) => setEnrollLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="e.g. Workstation PC / Lab Server"
                  />
                </div>
                <button
                  onClick={generateToken}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  Generate One-Command Installer
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">🪟 Windows PowerShell (Run as Administrator)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(enrollToken.installCommandWindows);
                        setCopiedWin(true);
                        setTimeout(() => setCopiedWin(false), 2000);
                      }}
                      className="text-xs px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-md font-medium transition-colors"
                    >
                      {copiedWin ? '✓ Copied!' : 'Copy Command'}
                    </button>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg text-xs font-mono break-all border border-slate-800 select-all text-sky-200">
                    {enrollToken.installCommandWindows}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">🐧 Linux (Bash)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(enrollToken.installCommandLinux);
                        setCopiedLinux(true);
                        setTimeout(() => setCopiedLinux(false), 2000);
                      }}
                      className="text-xs px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-md font-medium transition-colors"
                    >
                      {copiedLinux ? '✓ Copied!' : 'Copy Command'}
                    </button>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg text-xs font-mono break-all border border-slate-800 select-all text-amber-200">
                    {enrollToken.installCommandLinux}
                  </div>
                </div>

                <div className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)] flex items-center justify-between">
                  <span>⏱️ Single-use token expires in 60 minutes</span>
                  <span>Background Service: <strong className="text-emerald-400">MineFleetAgent</strong></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Machine List */}
      {machines.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl space-y-3">
          <div className="text-3xl">🖥️</div>
          <div className="font-semibold text-slate-200">No Machines Registered</div>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Install the MineFleet agent on your Windows or Linux PC to start monitoring hardware and managing distributed workloads.
          </p>
          <button
            onClick={() => setShowEnroll(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold"
          >
            + Add First Machine
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {machines.map((m) => {
            const isOnline = m.status === 'online';
            const tel = m.telemetry;
            const ramGb = (m.ram_bytes || m.ramBytes || 0) > 0
              ? (Math.round(((m.ram_bytes || m.ramBytes) / (1024 * 1024 * 1024)) * 10) / 10).toFixed(1)
              : 'N/A';
            const gpuName = Array.isArray(m.gpus) && m.gpus.length > 0
              ? m.gpus[0].name
              : (m.gpu_count > 0 ? `${m.gpu_count} GPU(s)` : 'None');

            const miningStatus = tel?.miningStatus || 'stopped';
            const hashrate = tel?.hashrate || 0;
            const workload = tel?.workloadLevel || 'light';

            return (
              <div
                key={m.id}
                className={`p-4 sm:p-5 bg-[var(--bg-card)] border rounded-xl transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isOnline ? 'border-[var(--border)] hover:border-emerald-500/40' : 'border-slate-800/80 opacity-75'
                }`}
              >
                {/* Left: Identity & Specs */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-[280px]">
                  <span className={`w-3 h-3 rounded-full mt-1 sm:mt-0 shrink-0 ${isOnline ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-slate-600'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <Link to={`/machines/${m.id}`} className="font-bold text-base hover:text-emerald-400 transition-colors">
                        {m.name || m.hostname}
                      </Link>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {m.status}
                      </span>
                      {m.group_name && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                          {m.group_name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>💻 {m.hostname}</span>
                      <span>⚙️ {m.cpu_model || m.cpuModel || 'CPU'} ({m.cpu_cores || 1}C/{m.cpu_threads || 1}T)</span>
                      <span>🧠 {ramGb} GB RAM</span>
                      <span>🎮 {gpuName}</span>
                    </div>
                  </div>
                </div>

                {/* Center: Live Telemetry & Mining Status */}
                <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs">
                  {/* Load Metrics */}
                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">CPU</div>
                      <div className="font-bold text-slate-200">{isOnline && tel?.cpuPercent !== undefined ? `${tel.cpuPercent.toFixed(1)}%` : '—'}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">RAM</div>
                      <div className="font-bold text-slate-200">{isOnline && tel?.ramPercent !== undefined ? `${tel.ramPercent.toFixed(1)}%` : '—'}</div>
                    </div>
                  </div>

                  {/* Workload Level */}
                  <div className="text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Workload</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      workload === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                      workload === 'heavy' ? 'bg-amber-500/20 text-amber-400' :
                      workload === 'normal' ? 'bg-sky-500/20 text-sky-400' :
                      'bg-emerald-500/20 text-emerald-400'
                    }`}>
                      {isOnline ? workload : '—'}
                    </span>
                  </div>

                  {/* Mining & Hashrate */}
                  <div className="text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Mining</div>
                    <div className="flex items-center gap-1.5 justify-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        miningStatus === 'mining' ? 'bg-emerald-500/20 text-emerald-400' :
                        miningStatus === 'paused' ? 'bg-amber-500/20 text-amber-400' :
                        miningStatus === 'error' ? 'bg-rose-500/20 text-rose-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {isOnline ? miningStatus : 'OFFLINE'}
                      </span>
                    </div>
                  </div>

                  <div className="text-center min-w-[70px]">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Hashrate</div>
                    <div className="font-mono font-bold text-violet-400">{isOnline && hashrate > 0 ? `${hashrate.toFixed(1)} H/s` : '0 H/s'}</div>
                  </div>
                </div>

                {/* Right: Last Seen & Controls */}
                <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--border)]">
                  <div className="text-right">
                    <div className="text-[10px] text-[var(--text-muted)]">Last Heartbeat</div>
                    <div className="text-xs font-medium text-slate-300">{formatLastSeen(m.last_heartbeat || m.lastHeartbeat)}</div>
                  </div>
                  <Link
                    to={`/machines/${m.id}`}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
                  >
                    Manage
                  </Link>
                  <button
                    onClick={() => deleteMachine(m.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Delete Machine"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
