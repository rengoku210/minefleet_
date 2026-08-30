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
  const [cpuLimit, setCpuLimit] = useState(30);
  const [maxThreads, setMaxThreads] = useState(0);
  const [enableGpu, setEnableGpu] = useState(false);
  const [policy, setPolicy] = useState('conservative');
  const [maxTemp, setMaxTemp] = useState(85);

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
          setCpuLimit(cfg.cpuLimitPercent ?? cfg.cpu_limit_percent ?? 30);
          setMaxThreads(cfg.maxMiningThreads ?? cfg.max_mining_threads ?? 0);
          setEnableGpu(cfg.gpuEnabled ?? cfg.gpu_enabled ?? false);
          setPolicy(cfg.workloadPolicy || cfg.workload_policy || 'conservative');
          setMaxTemp(cfg.tempPauseC ?? cfg.temp_pause_c ?? 85);
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
    
    const interval = setInterval(loadMachine, 5000);
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
        }),
      });
      alert('Configuration updated and sent to machine');
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
      alert('Machine updated');
      loadMachine();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const executeAction = async (action: string) => {
    try {
      setActionStatus(`Sending ${action.toUpperCase()} command...`);
      await api(`/api/machines/${id}/${action}`, { method: 'POST' });
      setActionStatus(`✓ Command '${action.toUpperCase()}' dispatched. Awaiting machine acknowledgment...`);
      setTimeout(loadMachine, 1500);
      setTimeout(loadMachine, 4000);
      setTimeout(() => setActionStatus(null), 6000);
    } catch (err: any) {
      alert(err.message);
      setActionStatus(null);
    }
  };

  if (loading && !machine) return <div className="text-[var(--text-muted)]">Loading...</div>;
  if (!machine) return <div>Machine not found</div>;

  const tel = machine.telemetry;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{machine.name}</h1>
        <div className="flex gap-2">
          <Link to="/machines" className="text-[var(--text-muted)] hover:underline text-sm">Back to Machines</Link>
        </div>
      </div>

      {actionStatus && (
        <div className="p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg text-sm text-blue-400 font-medium">
          {actionStatus}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Hardware & Info */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4">
          <h2 className="text-lg font-bold">Details</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-[var(--text-muted)]">Status</div>
            <div className={`font-medium ${machine.status === 'online' ? 'text-green-400' : 'text-red-400'}`}>{machine.status}</div>
            
            <div className="text-[var(--text-muted)]">OS</div>
            <div>{machine.os}</div>
            
            <div className="text-[var(--text-muted)]">CPU</div>
            <div>{machine.cpu_model || machine.cpuModel} ({machine.cpu_cores || machine.cpuCores || 1}C / {machine.cpu_threads || machine.cpuThreads || 1}T)</div>
            
            <div className="text-[var(--text-muted)]">RAM</div>
            <div>{Math.round(((machine.ram_bytes || machine.ramBytes || 0) / (1024 * 1024 * 1024)))} GB Total</div>
            
            <div className="text-[var(--text-muted)]">GPUs</div>
            <div>
              {Array.isArray(machine.gpus) && machine.gpus.length > 0
                ? machine.gpus.map((g: any) => `${g.name} (${g.vendor})`).join(', ')
                : (machine.gpu_count ? `${machine.gpu_count} GPU(s)` : '0 (None detected)')}
            </div>
          </div>
          
          <div className="pt-4 border-t border-[var(--border)] space-y-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Group</label>
              <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm">
                <option value="">None</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button onClick={updateDetails} className="px-3 py-1 bg-[var(--primary)] text-white rounded text-sm w-full">Update Details</button>
          </div>
        </div>

        {/* Live Telemetry */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4">
          <h2 className="text-lg font-bold">Live State</h2>
          {tel ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">CPU Usage</div>
                <div className="text-xl font-bold">{(tel.cpuPercent ?? tel.cpu_percent ?? 0).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">RAM Usage</div>
                <div className="text-xl font-bold">{(tel.ramPercent ?? tel.ram_percent ?? 0).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">Temperature</div>
                <div className="text-xl font-bold">{(tel.cpuTempC ?? tel.cpu_temp_c) ? `${(tel.cpuTempC ?? tel.cpu_temp_c).toFixed(1)}°C` : 'N/A'}</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">Mining Status</div>
                <div className={`text-xl font-bold uppercase ${(tel.miningStatus ?? tel.mining_status) === 'mining' ? 'text-green-400' : 'text-slate-400'}`}>
                  {tel.miningStatus ?? tel.mining_status ?? 'IDLE'}
                </div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)] col-span-2">
                <div className="text-xs text-[var(--text-muted)]">Hashrate</div>
                <div className="text-xl font-bold">{(tel.hashrate ?? 0).toFixed(1)} H/s</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No telemetry data available.</div>
          )}
        </div>

        {/* Controls */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4 col-span-2 lg:col-span-1">
          <h2 className="text-lg font-bold">Mining Controls</h2>
          <div className="flex gap-2">
            <button onClick={() => executeAction('start')} className="flex-1 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30">Start Mining</button>
            <button onClick={() => executeAction('stop')} className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30">Stop Mining</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => executeAction('pause')} className="flex-1 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30">Pause</button>
            <button onClick={() => executeAction('resume')} className="flex-1 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30">Resume</button>
          </div>
        </div>

        {/* Config */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4 col-span-2 lg:col-span-1">
          <h2 className="text-lg font-bold">Resource Configuration</h2>
          <div className="grid gap-3 text-sm">
            <div>
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>CPU Limit</span>
                <span>{cpuLimit}%</span>
              </div>
              <input type="range" min="10" max="100" value={cpuLimit} onChange={e => setCpuLimit(Number(e.target.value))} className="w-full" />
            </div>
            
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Max Threads (0 = Auto)</label>
              <input type="number" min="0" value={maxThreads} onChange={e => setMaxThreads(Number(e.target.value))} className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded" />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">Enable GPU</span>
              <input type="checkbox" checked={enableGpu} onChange={e => setEnableGpu(e.target.checked)} className="w-4 h-4" />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Workload Policy</label>
              <select value={policy} onChange={e => setPolicy(e.target.value)} className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded">
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Performance</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Max Temp (°C)</label>
              <input type="number" min="40" max="100" value={maxTemp} onChange={e => setMaxTemp(Number(e.target.value))} className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded" />
            </div>

            <button onClick={updateConfig} className="mt-2 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium w-full">Save Configuration</button>
          </div>
        </div>
      </div>
    </div>
  );
}
