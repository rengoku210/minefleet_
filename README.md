# ⚡ MineFleet — Lightweight Multi-PC Mining Manager

MineFleet is a centralized management system for computers you own and control. It provides a single web dashboard, 1-command agent installers, and resource controls with adaptive throttling to protect your everyday workloads (dev servers, games, background tasks).

Designed from the ground up for **Vercel Serverless** and **Minimal Storage Footprint (<10-20 MB)**.

---

## 🏗️ Architecture Overview

```
                          VERCEL CLOUD
 ┌─────────────────────────────────────────────────────────────┐
 │  ┌───────────────────────────────┐     ┌─────────────────┐  │
 │  │        React Dashboard        │     │  Serverless API │  │
 │  │          (Vite SPA)           │────▶│    Controller   │  │
 │  └───────────────────────────────┘     └────────┬────────┘  │
 └─────────────────────────────────────────────────┼───────────┘
                                                   │ StorageAdapter (HTTPS REST)
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │      Upstash Redis / Vercel KV  │
                                  │   (Compact Storage < 10-20 MB)  │
                                  │  - 1 Live State Snapshot / PC   │
                                  │  - 10-Day Compact History (TTL) │
                                  │  - Machine Registry & Configs   │
                                  └─────────────────────────────────┘
                                                   ▲
                                                   │ HTTP Heartbeat (every 15–30s)
                                                   │ Carries Live Telemetry & Commands
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │      Target PC Agents       │
                                    │   - Zero idle CPU impact    │
                                    │   - Mining OFF by default   │
                                    │   - Hardware scanned once   │
                                    │   - Safe offline fallback   │
                                    └─────────────────────────────┘
```

### Why PostgreSQL was removed:
- **Zero Heavy Infrastructure**: No expensive 24/7 relational databases or connection pooling issues in serverless functions.
- **Tiny Storage**: Only current live snapshots and a 10-day sliding window of compact history are stored.
- **Serverless Native**: Storage uses a pluggable `StorageAdapter` backed by Upstash Redis (or in-memory mode for development).

---

## 🚀 2-Minute Vercel Deployment

Deploy the entire platform (Dashboard + API + Installers) in **one click** on Vercel:

1. **Import Repository**: Go to **[vercel.com/new](https://vercel.com/new)** and import `rengoku210/minefleet`.
2. **Add Storage (Optional but Recommended)**:
   * In Vercel Project Settings ➔ **Storage** ➔ Connect **Upstash Redis** (Free Tier).
   * Or enter `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in **Environment Variables**.
3. **Set Admin Password**:
   * Add `ADMIN_PASSWORD`: `YourSecurePassword!`
   * Add `ADMIN_EMAIL`: `admin@yourdomain.com`
4. **Deploy**: Click **Deploy**. Your dashboard is live at `https://<your-project>.vercel.app`!

---

## 💻 1-Command PC Installation

### Step 1: Generate Command
1. Open your dashboard and log in with your admin credentials.
2. Go to **Machines** ➔ **+ Add Machine**.
3. Copy the generated single-use command.

### Step 2: Run on Target PC
* **Windows (PowerShell)**:
  ```powershell
  powershell -ExecutionPolicy Bypass -c "irm 'https://<YOUR_VERCEL_URL>/install.ps1?token=<TOKEN>' | iex"
  ```
* **Linux (Bash)**:
  ```bash
  curl -fsSL "https://<YOUR_VERCEL_URL>/install.sh?token=<TOKEN>" | bash
  ```

### What Happens Automatically:
1. Agent downloads and checks hardware (CPU cores, RAM, GPUs) **once**.
2. Machine registers with the controller.
3. Background service is created (NSSM on Windows, systemd on Linux).
4. Service starts in **IDLE state (Mining is strictly OFF by default)**.
5. Machine appears as **Online** on your dashboard.

---

## ⚙️ Safe Mining Controls

From the web dashboard:
- **CPU Utilization Limit**: Cap CPU usage (e.g. 20%, 30%, 50%).
- **Mining Threads**: Limit thread count to leave cores free for OS tasks.
- **Workload Policy (`conservative`)**: Automatically throttles or pauses mining if other applications (Docker, IDEs, games) need CPU.
- **Thermal Protection**: Auto-pauses if temperatures exceed safe limits (e.g., 85°C).

---

## 🛡️ Storage & Data Retention

- **Live State**: 1 compact snapshot per PC (`~200 bytes`).
- **10-Day Compact History**: Telemetry is recorded in a ring buffer with automatic TTL expiration.
- **Total Storage Estimate**: `< 1-2 MB` per machine for 10 full days of telemetry.

---

## 🧪 Local Development

```bash
# Install dependencies
pnpm install

# Build all workspace packages
pnpm build

# Run all test suites
pnpm test

# Start local dev server
pnpm dev
```
