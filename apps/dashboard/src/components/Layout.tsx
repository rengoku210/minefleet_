import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/machines', label: 'Machines', icon: '🖥️' },
  { path: '/groups', label: 'Groups', icon: '📁' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-xl font-bold text-[var(--primary)]">⛏️ MineFleet</h1>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                location.pathname === item.path
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="p-4 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--text-muted)] mb-2">{user?.email}</div>
          <button
            onClick={logout}
            className="text-xs text-[var(--danger)] hover:underline"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
}
