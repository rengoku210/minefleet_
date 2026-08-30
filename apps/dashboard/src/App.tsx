import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import Login from './pages/Login.js';
import Dashboard from './pages/Dashboard.js';
import Machines from './pages/Machines.js';
import MachineDetail from './pages/MachineDetail.js';
import Groups from './pages/Groups.js';
import Settings from './pages/Settings.js';
import Layout from './components/Layout.js';

export default function App() {
  const { user, loading, checkAuth } = useAuthStore();

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/machines/:id" element={<MachineDetail />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
