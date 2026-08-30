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
  const [cpuLimit, setCpuLimit] = useState(100);
  const [maxThreads, setMaxThreads] = useState(0);
  const [enableGpu, setEnableGpu] = useState(true);
  const [policy, setPolicy] = useState('balanced');
  const [maxTemp, setMaxTemp] = useState(85);

  const loadMachine = async () => {
    try {
      const data = await api(`/api/machines/${id}`);
      setMachine(data);
      if (loading) {
        setNewName(data.name);
        setSelectedGroup(data.group_id || '');
        if (data.config) {
          setCpuLimit(data.config.max_cpu_percent || 100);
          setMaxThreads(data.config.max_threads || 0);
          setEnableGpu(data.config.enable_gpu ?? true);
          setPolicy(data.config.workload_policy || 'balanced');
          setMaxTemp(data.config.max_temp_celsius || 85);
        }
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadMachine();
    api('/api/groups').then(d => setGroups(d.groups)).catch(console.error);
    
    const interval = setInterval(loadMachine, 5000);
    return () => clearInterval(interval);
  }, [id, loading]);

  const updateConfig = async () => {
    try {
      await api(`/api/machines/${id}/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          max_cpu_percent: cpuLimit,
          max_threads: maxThreads,
          enable_gpu: enableGpu,
          workload_policy: policy,
          max_temp_celsius: maxTemp
        })
      });
      alert('Config updated');
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
          group_id: selectedGroup || null
        })
      });
      alert('Machine updated');
      loadMachine();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const executeAction = async (action: string) => {
    try {
      await api(`/api/machines/${id}/${action}`, { method: 'POST' });
      loadMachine();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading && !machine) return <div className="text-[var(--text-muted)]">Loading...</div>;
  if (!machine) return <div>Machine not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{machine.name}</h1>
        <div className="flex gap-2">
          <Link to="/machines" className="text-[var(--text-muted)] hover:underline text-sm">Back to Machines</Link>
        </div>
      </div>

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
            <div>{machine.cpu_model}</div>
            
            <div className="text-[var(--text-muted)]">RAM</div>
            <div>{Math.round((machine.total_ram_mb || 0) / 1024)} GB</div>
            
            <div className="text-[var(--text-muted)]">GPUs</div>
            <div>{machine.gpu_count}</div>
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
          <h2 className="text-lg font-bold">Live Telemetry</h2>
          {machine.telemetry ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">CPU Usage</div>
                <div className="text-xl font-bold">{(machine.telemetry.cpu_usage_percent || 0).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">RAM Usage</div>
                <div className="text-xl font-bold">{(machine.telemetry.ram_usage_percent || 0).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">Temperature</div>
                <div className="text-xl font-bold">{machine.telemetry.cpu_temp_c ? `${machine.telemetry.cpu_temp_c.toFixed(1)}°C` : 'N/A'}</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)]">Power Draw</div>
                <div className="text-xl font-bold">{machine.telemetry.power_draw_watts ? `${machine.telemetry.power_draw_watts.toFixed(1)}W` : 'N/A'}</div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)] col-span-2">
                <div className="text-xs text-[var(--text-muted)]">Hashrate</div>
                <div className="text-xl font-bold">{(machine.telemetry.hashrate_hps || 0).toFixed(1)} H/s</div>
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
            <button onClick={() => executeAction('start')} className="flex-1 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30">Start</button>
            <button onClick={() => executeAction('stop')} className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30">Stop</button>
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
