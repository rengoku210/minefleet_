import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Groups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');

  const loadGroups = async () => {
    try {
      const data = await api('/api/groups');
      setGroups(data.groups);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadGroups(); }, []);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: newGroupName })
      });
      setNewGroupName('');
      loadGroups();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group?')) return;
    try {
      await api(`/api/groups/${id}`, { method: 'DELETE' });
      loadGroups();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Groups</h1>

      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 max-w-md">
        <h2 className="text-lg font-semibold mb-4">Create Group</h2>
        <form onSubmit={createGroup} className="flex gap-2">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group Name"
            required
            className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
          />
          <button type="submit" className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm">Add</button>
        </form>
      </div>

      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Machines</th>
              <th className="px-4 py-3 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                <td className="px-4 py-3 font-medium">{g.name}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{g.machine_count || 0}</td>
                <td className="px-4 py-3">
                  <button onClick={() => deleteGroup(g.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && (
          <div className="p-8 text-center text-[var(--text-muted)]">No groups found.</div>
        )}
      </div>
    </div>
  );
}
