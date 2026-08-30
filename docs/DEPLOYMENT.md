# MineFleet Deployment Guide

## Target Architecture: Vercel Cloud (Unified Serverless)

MineFleet runs entirely on **Vercel** with **Upstash Redis** storage. No PostgreSQL database servers or dedicated VPS instances are required.

---

## 🚀 Step-by-Step Vercel Setup

### 1. Import to Vercel
1. Go to **[vercel.com/new](https://vercel.com/new)**.
2. Select your GitHub repository: **`rengoku210/minefleet`**.
3. Leave **Root Directory** as `.`.

### 2. Configure Persistent Storage (Upstash Redis)
1. On Vercel, go to the **Storage** tab in your project.
2. Click **Create Database** ➔ select **Upstash Redis** (Free tier).
3. Vercel will automatically inject `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into your environment variables.

### 3. Environment Variables
Ensure the following variables are set under **Project Settings ➔ Environment Variables**:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `ADMIN_EMAIL` | Administrator login email | `admin@minefleet.local` |
| `ADMIN_PASSWORD` | Administrator initial password | `Admin1234!` |
| `JWT_SECRET` | 64-character random string | `64_char_random_jwt_secret_key_abc123` |
| `JWT_REFRESH_SECRET` | 64-character random string | `64_char_random_refresh_secret_key_xyz987` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | `https://your-upstash.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | `your_token_here` |

### 4. Deploy
Click **Deploy**. Once finished, you will receive your live dashboard URL (e.g. `https://minefleet.vercel.app`).

---

## 🖥️ Installing Agents on PCs

1. Log into your dashboard at `https://minefleet.vercel.app`.
2. Click **Machines** ➔ **+ Add Machine**.
3. Copy the single-use installation command.
4. On your PC, open PowerShell (as Administrator) and paste:
   ```powershell
   powershell -ExecutionPolicy Bypass -c "irm 'https://minefleet.vercel.app/install.ps1?token=YOUR_TOKEN' | iex"
   ```
5. The machine will enroll, scan hardware once, and start the background service with **Mining: OFF**.
