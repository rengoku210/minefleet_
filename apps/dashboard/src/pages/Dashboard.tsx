import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

interface MachineListItem {
  id: string;
  name: string;
  hostname: string;
  os: string;
  status: string;
  cpu_model: string;
  gpu_count: number;
  agent_version: string;
  group_id: string | null;
  group_name: string | null;
  last_heartbeat: string | null;
}

export default function Dashboard() {
  const [machines, setMachines] = useState<MachineListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/machines').then((data) => {
      setMachines(data.machines);
      setLoading(false);
    }).catch(() => setLoading(false));

    const interval = setInterval(() => {
      api('/api/machines').then((data) => setMachines(data.machines)).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const online = machines.filter(m => m.status === 'online').length;
  const offline = machines.filter(m => m.status !== 'online').length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <SummaryCard label="Total Machines" value={machines.length} />
        <SummaryCard label="Online" value={online} color="text-green-400" />
        <SummaryCard label="Offline" value={offline} color="text-red-400" />
        <SummaryCard label="Groups" value={new Set(machines.map(m => m.group_name).filter(Boolean)).size} />
      </div>

      {/* Machine cards */}
      {loading ? (
        <div className="text-[var(--text-muted)]">Loading machines...</div>
      ) : machines.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
          <p className="text-[var(--text-muted)] mb-4">No machines registered yet.</p>
          <Link to="/machines" className="text-[var(--primary)] hover:underline text-sm">Add your first machine →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines.map((m) => (
            <MachineCard key={m.id} machine={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
    </div>
  );
}

function MachineCard({ machine: m }: { machine: MachineListItem }) {
  const isOnline = m.status === 'online';
  return (
    <Link to={`/machines/${m.id}`} className="block">
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)] transition-colors">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold truncate">{m.name}</h3>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isOnline ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'}`}></span>
            {m.status}
          </span>
        </div>
        <div className="space-y-1 text-xs text-[var(--text-muted)]">
          <div>OS: {m.os}</div>
          <div>CPU: {m.cpu_model}</div>
          <div>GPUs: {m.gpu_count}</div>
          {m.group_name && <div>Group: {m.group_name}</div>}
          {m.last_heartbeat && <div>Last seen: {new Date(m.last_heartbeat).toLocaleString()}</div>}
        </div>
      </div>
    </Link>
  );
}
