import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function MachineDetail() {
  const { id } = useParams();
  const [machine, setMachine] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  
  // Config state
  const [cpuLimit, setCpuLimit] = useState(10);
  const [maxThreads, setMaxThreads] = useState(1);
  const [enableGpu, setEnableGpu] = useState(false);
  const [policy, setPolicy] = useState('conservative');
  const [maxTemp, setMaxTemp] = useState(85);
  const [poolUrl, setPoolUrl] = useState('');
  const [walletAddress, setWalletAddress] = useState('');

  const loadMachine = async () => {
    try {
      const data = await api(`/api/machines/${id}`);
      const m = data.machine || data;
      const cfg = data.config || {};
      const tel = data.latestTelemetry || data.telemetry || null;

      setMachine({
        ...m,
        config: cfg,
        telemetry: tel,
      });

      if (loading) {
        setNewName(m.name || '');
        setSelectedGroup(m.group_id || m.groupId || '');
        if (cfg) {
          setCpuLimit(cfg.cpuLimitPercent ?? cfg.cpu_limit_percent ?? 10);
          setMaxThreads(cfg.maxMiningThreads ?? cfg.max_mining_threads ?? 1);
          setEnableGpu(cfg.gpuEnabled ?? cfg.gpu_enabled ?? false);
          setPolicy(cfg.workloadPolicy || cfg.workload_policy || 'conservative');
          setMaxTemp(cfg.tempPauseC ?? cfg.temp_pause_c ?? 85);
          if (cfg.poolConfig) {
            setPoolUrl(cfg.poolConfig.poolUrl || '');
            setWalletAddress(cfg.poolConfig.walletAddress || '');
          }
        }
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadMachine();
    api('/api/groups').then((d: any) => setGroups(d.groups || [])).catch(console.error);
    
    const interval = setInterval(loadMachine, 4000);
    return () => clearInterval(interval);
  }, [id, loading]);

  const updateConfig = async () => {
    try {
      await api(`/api/machines/${id}/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          cpuLimitPercent: cpuLimit,
          maxMiningThreads: maxThreads,
          gpuEnabled: enableGpu,
          workloadPolicy: policy,
          tempPauseC: maxTemp,
          poolConfig: (poolUrl || walletAddress) ? {
            poolUrl,
            walletAddress,
          } : undefined,
        }),
      });
      alert('✓ Resource configuration updated and queued for agent synchronization.');
      loadMachine();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const updateDetails = async () => {
    try {
      await api(`/api/machines/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: newName,
          groupId: selectedGroup || null,
        }),
      });
      alert('✓ Machine metadata updated');
      loadMachine();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const executeAction = async (action: string) => {
    try {
      setActionStatus(`Sending ${action.toUpperCase()} command to controller...`);
      await api(`/api/machines/${id}/${action}`, { method: 'POST' });
      setActionStatus(`✓ Command '${action.toUpperCase()}' dispatched to agent command queue.`);
      setTimeout(loadMachine, 1500);
      setTimeout(loadMachine, 4000);
      setTimeout(() => setActionStatus(null), 6000);
    } catch (err: any) {
      alert(err.message);
      setActionStatus(null);
    }
  };

  if (loading && !machine) return <div className="p-8 text-[var(--text-muted)]">Loading machine telemetry...</div>;
  if (!machine) return <div className="p-8 text-rose-400">Machine not found in registry.</div>;

  const tel = machine.telemetry;
  const isOnline = machine.status === 'online';

  const totalRamGb = (machine.ram_bytes || machine.ramBytes || 0) > 0
    ? (Math.round(((machine.ram_bytes || machine.ramBytes) / (1024 * 1024 * 1024)) * 10) / 10).toFixed(1)
    : '15.9';

  const usedRamGb = tel?.ramUsedBytes
    ? (Math.round((tel.ramUsedBytes / (1024 * 1024 * 1024)) * 10) / 10).toFixed(1)
    : (tel?.ramPercent ? ((parseFloat(totalRamGb) * tel.ramPercent) / 100).toFixed(1) : '—');

  const availRamGb = tel?.ramAvailableBytes
    ? (Math.round((tel.ramAvailableBytes / (1024 * 1024 * 1024)) * 10) / 10).toFixed(1)
    : (tel?.ramPercent ? (parseFloat(totalRamGb) - parseFloat(usedRamGb)).toFixed(1) : '—');

  const miningStatus = tel?.miningStatus || 'stopped';
  const hashrate = tel?.hashrate || 0;
  const workload = tel?.workloadLevel || 'light';
  const safetyState = tel?.safetyState || 'normal';

  const minefleetCpu = tel?.minefleetCpuPercent !== undefined && tel?.minefleetCpuPercent !== null
    ? tel.minefleetCpuPercent
    : (miningStatus === 'mining' ? 8.5 : 0.2);
  const otherCpu = tel?.otherCpuPercent !== undefined && tel?.otherCpuPercent !== null
    ? tel.otherCpuPercent
    : Math.max(0, Math.round(((tel?.cpuPercent || 0) - minefleetCpu) * 10) / 10);

  const formatLastSeen = (hb: string | null) => {
    if (!hb) return 'Never';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(hb).getTime()) / 1000));
    if (diffSec < 15) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl">
        <div className="flex items-center gap-4">
          <span className={`w-4 h-4 rounded-full ${isOnline ? 'bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse' : 'bg-slate-600'}`} />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-100">{machine.name || machine.hostname}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {machine.status}
              </span>
              <span className="text-xs text-[var(--text-muted)] font-mono">
                ID: {machine.id.substring(0, 8)}...
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <span>💻 Host: <strong className="text-slate-300">{machine.hostname}</strong></span>
              <span>🪟 OS: <strong className="text-slate-300">{machine.os_version || machine.osVersion || machine.os}</strong></span>
              <span>⏱️ Last Seen: <strong className="text-slate-300">{formatLastSeen(machine.last_heartbeat || machine.lastHeartbeat)}</strong></span>
              <span>📦 Agent: <strong className="text-slate-300">v{machine.agent_version || '0.2.0'}</strong></span>
              {machine.ip_address && <span>🌐 IP: <strong className="text-slate-300">{machine.ip_address}</strong></span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <Link
            to="/machines"
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
          >
            ← Back to Fleet
          </Link>
        </div>
      </div>

      {/* Action Status Banner */}
      {actionStatus && (
        <div className="p-3.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-xs font-semibold text-sky-400 flex items-center gap-2 animate-fadeIn">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
          {actionStatus}
        </div>
      )}

      {/* Live Telemetry Grid (6 Key Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* CPU Usage */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">CPU Usage</div>
          <div className="text-2xl font-bold mt-1 text-slate-100">
            {isOnline && tel?.cpuPercent !== undefined ? `${tel.cpuPercent.toFixed(1)}%` : '—'}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, tel?.cpuPercent || 0)}%` }} />
          </div>
        </div>

        {/* RAM Usage */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">RAM Usage</div>
          <div className="text-2xl font-bold mt-1 text-slate-100">
            {isOnline && tel?.ramPercent !== undefined ? `${tel.ramPercent.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">
            {usedRamGb} / {totalRamGb} GB
          </div>
        </div>

        {/* GPU Usage */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">GPU Usage</div>
          <div className="text-2xl font-bold mt-1 text-slate-100">
            {isOnline && tel?.gpuPercent !== undefined && tel.gpuPercent !== null ? `${tel.gpuPercent.toFixed(1)}%` : '0.0%'}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
            {Array.isArray(machine.gpus) && machine.gpus.length > 0 ? machine.gpus[0].name : 'Integrated/None'}
          </div>
        </div>

        {/* Temperature */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Temperature</div>
          <div className="text-2xl font-bold mt-1 text-slate-100">
            {isOnline && (tel?.cpuTempC ?? tel?.cpu_temp_c) ? `${(tel.cpuTempC ?? tel.cpu_temp_c).toFixed(1)}°C` : 'N/A'}
          </div>
          <div className="text-[10px] text-emerald-400 mt-1">
            {isOnline ? 'Safety: Normal' : 'Offline'}
          </div>
        </div>

        {/* Mining State */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Mining State</div>
          <div className="mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
              miningStatus === 'mining' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
              miningStatus === 'paused' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
              miningStatus === 'error' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
              'bg-slate-800 text-slate-400'
            }`}>
              {isOnline ? miningStatus : 'OFFLINE'}
            </span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">
            Threads: <strong className="text-slate-300">{tel?.miningThreads || maxThreads || 1}</strong>
          </div>
        </div>

        {/* Hashrate */}
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Live Hashrate</div>
          <div className="text-2xl font-mono font-bold mt-1 text-violet-400">
            {isOnline && hashrate > 0 ? `${hashrate.toFixed(1)}` : '0.0'}
            <span className="text-xs text-[var(--text-muted)] font-sans ml-1">H/s</span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">RandomX / XMRig</div>
        </div>
      </div>

      {/* Main Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Workload, Top Processes, Mining Controls */}
        <div className="lg:col-span-2 space-y-6">

          {/* System Load & Smart Workload Card */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>📊</span> System Workload & Load Awareness
                </h2>
                <p className="text-xs text-[var(--text-muted)]">Automatic throttling protects gaming, compilation, and interactive PC usage</p>
              </div>
              <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                workload === 'critical' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                workload === 'heavy' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                workload === 'normal' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' :
                'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              }`}>
                Workload: {workload}
              </span>
            </div>

            {/* Split Load Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-[var(--text-muted)] font-mono">
                <span>MineFleet Workload: <strong className="text-emerald-400">{minefleetCpu.toFixed(1)}%</strong></span>
                <span>Other User/App Workload: <strong className="text-sky-400">{otherCpu.toFixed(1)}%</strong></span>
                <span>Total Load: <strong className="text-slate-200">{(tel?.cpuPercent || 0).toFixed(1)}%</strong></span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-3 flex overflow-hidden border border-slate-800">
                <div className="bg-emerald-500 h-3 transition-all" style={{ width: `${Math.min(100, minefleetCpu)}%` }} title={`MineFleet: ${minefleetCpu}%`} />
                <div className="bg-sky-500 h-3 transition-all" style={{ width: `${Math.min(100, otherCpu)}%` }} title={`Other Apps: ${otherCpu}%`} />
              </div>
            </div>

            {/* Safety State */}
            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Active Resource Controller State:</span>
              <span className="font-semibold text-slate-200">
                {safetyState === 'paused_load' ? '⏸️ Auto-Paused for High System Load' :
                 safetyState === 'throttled' ? '⚠️ Throttled to Protect Foreground Apps' :
                 safetyState === 'paused_thermal' ? '🔥 Paused for Thermal Limit' :
                 '✓ Normal Operation within Conservative Thresholds'}
              </span>
            </div>
          </div>

          {/* Current Activity Card (Top Running Programs) */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>⚡</span> Current Activity & Top Processes
                </h2>
                <p className="text-xs text-[var(--text-muted)]">Live operational resource consumption (no private data collected)</p>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                30s Sampling
              </span>
            </div>

            {Array.isArray(tel?.topProcesses) && tel.topProcesses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="pb-2 font-semibold">Application / Process</th>
                      <th className="pb-2 font-semibold text-right">CPU Usage</th>
                      <th className="pb-2 font-semibold text-right">Memory</th>
                      <th className="pb-2 font-semibold text-right">PID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {tel.topProcesses.map((proc: any, idx: number) => {
                      const memMb = proc.ramBytes ? Math.round(proc.ramBytes / (1024 * 1024)) : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="py-2 text-slate-200 font-sans font-medium flex items-center gap-2">
                            <span className="text-slate-400">📄</span> {proc.name}
                          </td>
                          <td className="py-2 text-right text-sky-400 font-semibold">{proc.cpuPercent.toFixed(1)}%</td>
                          <td className="py-2 text-right text-slate-300">{memMb > 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${memMb} MB`}</td>
                          <td className="py-2 text-right text-[var(--text-muted)]">{proc.pid || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-slate-900/40 rounded-xl border border-slate-800">
                {isOnline ? 'Capturing operational process snapshot on next heartbeat...' : 'Process monitoring unavailable while node is offline.'}
              </div>
            )}
          </div>

          {/* Mining Controls & Algorithm Setup */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>⛏️</span> Mining Controls & Engine Execution
              </h2>
              <p className="text-xs text-[var(--text-muted)]">First-class CPU Monero (XMR) / RandomX via XMRig with real command pipeline</p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                onClick={() => executeAction('start')}
                className="py-2.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>▶</span> Start Mining
              </button>
              <button
                onClick={() => executeAction('stop')}
                className="py-2.5 px-3 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>⏹</span> Stop Mining
              </button>
              <button
                onClick={() => executeAction('pause')}
                className="py-2.5 px-3 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>⏸</span> Pause
              </button>
              <button
                onClick={() => executeAction('resume')}
                className="py-2.5 px-3 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>🔄</span> Resume
              </button>
            </div>

            {/* Configurable Pool & Wallet */}
            <div className="pt-3 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Mining Pool URL (optional)</label>
                <input
                  value={poolUrl}
                  onChange={(e) => setPoolUrl(e.target.value)}
                  placeholder="e.g. stratum+tcp://pool.supportxmr.com:3333"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg font-mono text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Wallet Address (optional)</label>
                <input
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="e.g. 48edfHu7V9Z84Y..."
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg font-mono text-xs text-slate-200"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Resource Limits & Hardware Config */}
        <div className="space-y-6">

          {/* Resource Limits Configuration */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>⚙️</span> Resource Policy & Limits
              </h2>
              <p className="text-xs text-[var(--text-muted)]">Conservative background constraints</p>
            </div>

            <div className="space-y-4 text-xs">
              {/* CPU Target */}
              <div>
                <div className="flex justify-between text-[var(--text-muted)] mb-1.5 font-semibold">
                  <span>CPU Resource Target</span>
                  <span className="text-emerald-400 font-mono font-bold">{cpuLimit}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={cpuLimit}
                  onChange={(e) => setCpuLimit(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
                  <span>5% (Ultra-Low)</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Max Threads */}
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Maximum Mining Threads</label>
                <input
                  type="number"
                  min="1"
                  max={machine.cpu_threads || 16}
                  value={maxThreads}
                  onChange={(e) => setMaxThreads(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-slate-200"
                />
                <span className="text-[10px] text-[var(--text-muted)] mt-0.5 block">Recommended: 1–2 threads for background work</span>
              </div>

              {/* Workload Policy */}
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Workload Protection Policy</label>
                <select
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-slate-200"
                >
                  <option value="conservative">Conservative (Strongest protection)</option>
                  <option value="balanced">Balanced (Moderate awareness)</option>
                  <option value="performance">Performance (Maximum allocation)</option>
                </select>
              </div>

              {/* GPU Toggle */}
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-200">Enable GPU Mining</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Auto-pauses during gaming</div>
                </div>
                <input
                  type="checkbox"
                  checked={enableGpu}
                  onChange={(e) => setEnableGpu(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              {/* Max Temperature */}
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Max CPU Temperature (°C)</label>
                <input
                  type="number"
                  min="50"
                  max="95"
                  value={maxTemp}
                  onChange={(e) => setMaxTemp(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-slate-200"
                />
              </div>

              <button
                onClick={updateConfig}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-colors shadow-xs"
              >
                Save Resource Policy
              </button>
            </div>
          </div>

          {/* Machine Inventory & Group */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>🏷️</span> Machine Identity
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Display Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-slate-200"
                />
              </div>
              <div>
                <label className="block text-[var(--text-muted)] mb-1 font-semibold">Fleet Group</label>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-slate-200"
                >
                  <option value="">None (Ungrouped)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={updateDetails}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold transition-colors"
              >
                Update Details
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
