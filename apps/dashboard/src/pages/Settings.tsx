import { useEffect, useState } from 'react';

export default function Settings() {
  const [electricityPrice, setElectricityPrice] = useState('0.10');
  const [controllerInfo, setControllerInfo] = useState<any>(null);

  useEffect(() => {
    setControllerInfo({
      version: '1.0.0',
      uptime: '2 days 4 hours',
      os: 'Linux'
    });
  }, []);

  const saveSettings = () => {
    localStorage.setItem('electricityPrice', electricityPrice);
    alert('Settings saved');
  };

  useEffect(() => {
    const val = localStorage.getItem('electricityPrice');
    if (val) setElectricityPrice(val);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4">
          <h2 className="text-lg font-bold">General Settings</h2>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Electricity Price ($/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={electricityPrice}
              onChange={(e) => setElectricityPrice(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
            />
          </div>
          <button onClick={saveSettings} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm">Save Settings</button>
        </div>

        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4">
          <h2 className="text-lg font-bold">Controller Info</h2>
          {controllerInfo ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Version</span>
                <span>{controllerInfo.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">OS</span>
                <span>{controllerInfo.os}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Uptime</span>
                <span>{controllerInfo.uptime}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">Loading info...</div>
          )}
        </div>
      </div>
    </div>
  );
}
