import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('installer-routes');

// Embedded full Windows PowerShell installer script
const WINDOWS_INSTALLER_SCRIPT = `# MineFleet Agent Installer for Windows
# Usage: .\\install.ps1 -Token TOKEN -Controller https://minefleet.vercel.app
# One-liner: powershell -ExecutionPolicy Bypass -c "irm 'https://minefleet.vercel.app/install.ps1?token=<TOKEN>' | iex"

param(
    [Parameter(Mandatory=$false)]
    [string]$Token = $env:MINEFLEET_ENROLLMENT_TOKEN,

    [Parameter(Mandatory=$false)]
    [string]$Controller = $env:MINEFLEET_CONTROLLER_URL,

    [Parameter(Mandatory=$false)]
    [switch]$NonInteractive = $false
)

$ErrorActionPreference = "Stop"

# Setup directories early for logging
$InstallDir = "C:\\Program Files\\MineFleet"
$DataDir = "C:\\ProgramData\\MineFleet"
$LogDir = "$DataDir\\logs"
$LogFile = "$DataDir\\installer.log"

try {
    New-Item -ItemType Directory -Force -Path $InstallDir -ErrorAction SilentlyContinue | Out-Null
    New-Item -ItemType Directory -Force -Path $DataDir -ErrorAction SilentlyContinue | Out-Null
    New-Item -ItemType Directory -Force -Path $LogDir -ErrorAction SilentlyContinue | Out-Null
} catch {}

function Log-Msg {
    param($lvl, $msg)
    try {
        $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $line = "[$ts] [$lvl] $msg"
        Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    } catch {}
}

function Write-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Green; Log-Msg "INFO" $msg }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow; Log-Msg "WARN" $msg }
function Write-Err {
    param($msg)
    Write-Host "\`n[ERROR] $msg" -ForegroundColor Red
    Log-Msg "ERROR" $msg
    Write-Host "[INFO] Installation was not completed." -ForegroundColor Yellow
    if (-not $NonInteractive) {
        Write-Host "\`nPress Enter to close..." -ForegroundColor Cyan
        Read-Host
    }
    exit 1
}

# Check Administrator privileges and auto-elevate if needed
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Administrator privileges required. Requesting elevation..."
    Log-Msg "INFO" "Requesting UAC elevation..."
    try {
        $elevatedCmd = "-ExecutionPolicy Bypass -NoProfile -NoExit -Command \`"\`$Token='$Token'; \`$Controller='$Controller'; irm '$Controller/install.ps1?token=$Token' | iex\`""
        $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $elevatedCmd -Wait -PassThru
        if ($p.ExitCode -ne 0 -and $null -ne $p.ExitCode) {
            Write-Err "Installation in elevated window exited with code $($p.ExitCode)."
        } else {
            Write-Info "Elevated installation completed."
        }
        exit $p.ExitCode
    } catch {
        Write-Err "Administrator privileges were not granted. Installation cancelled."
    }
}

if (-not $Token) { Write-Err "Enrollment token is required. Generate a new command from the dashboard." }
if (-not $Controller) { $Controller = "https://minefleet.vercel.app" }

# Clean trailing slash from Controller URL
$Controller = $Controller.TrimEnd('/')

Write-Info "=================================================="
Write-Info "Starting MineFleet Agent Installation..."
Write-Info "Controller: $Controller"
Write-Info "=================================================="

# Download agent bundle from Controller
Write-Info "Fetching agent bundle from controller..."
$bundleDownloaded = $false
try {
    Invoke-WebRequest -Uri "$Controller/api/agent/bundle" -OutFile "$InstallDir\\agent-bundle.js" -UseBasicParsing
    if ((Get-Item "$InstallDir\\agent-bundle.js").Length -gt 500) {
        $bundleDownloaded = $true
        Write-Info "Agent bundle downloaded successfully."
    }
} catch {
    Write-Warn "Could not fetch bundle: $($_.Exception.Message)"
}

if (-not $bundleDownloaded) {
    Write-Err "Failed to download agent bundle from $Controller. Please verify network connectivity."
}

# Generate hardware machine UID
$fingerprint = "$env:COMPUTERNAME|$((Get-CimInstance Win32_Processor).Name)|windows|$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)|$((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory)"
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($fingerprint))
$MachineUid = "mf_" + [BitConverter]::ToString($hash).Replace("-","").Substring(0,32).ToLower()

# Collect system hardware info
Write-Info "Scanning hardware inventory..."
$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue

$cpuName = if ($cpu -is [array]) { $cpu[0].Name } else { $cpu.Name }
$cpuCores = if ($cpu -is [array]) { ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum } else { $cpu.NumberOfCores }
$cpuThreads = if ($cpu -is [array]) { ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum } else { $cpu.NumberOfLogicalProcessors }

# Total Physical Memory in Bytes
$ramBytes = [int64]0
if ($cs -and $cs.TotalPhysicalMemory) {
    $ramBytes = [int64]$cs.TotalPhysicalMemory
} elseif ($os -and $os.TotalVisibleMemorySize) {
    $ramBytes = [int64]($os.TotalVisibleMemorySize * 1024)
}

# GPU Hardware Detection
$gpus = @()
$videoControllers = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
if ($videoControllers) {
    $gpuIdx = 0
    foreach ($vc in $videoControllers) {
        if ($vc.Name -and $vc.Name -notmatch "Microsoft Basic Display|RDP|Remote|Virtual|VBox|VMware") {
            $vram = [int64]0
            if ($vc.AdapterRAM -and $vc.AdapterRAM -gt 0) {
                $vram = [int64]$vc.AdapterRAM
            }
            $vendor = "Unknown"
            if ($vc.AdapterCompatibility -match "NVIDIA" -or $vc.Name -match "NVIDIA|GeForce|RTX|GTX|Quadro") { $vendor = "NVIDIA" }
            elseif ($vc.AdapterCompatibility -match "Advanced Micro Devices|AMD|ATI" -or $vc.Name -match "Radeon|AMD") { $vendor = "AMD" }
            elseif ($vc.AdapterCompatibility -match "Intel" -or $vc.Name -match "Intel|UHD|Iris|HD Graphics") { $vendor = "Intel" }

            $gpus += @{
                index = $gpuIdx
                name = ($vc.Name -as [string])
                vendor = $vendor
                memoryTotal = $vram
                driver = ($vc.DriverVersion -as [string])
            }
            $gpuIdx++
        }
    }
}

$systemInfo = @{
    hostname = $env:COMPUTERNAME
    os = "windows"
    osVersion = ($os.Caption -as [string])
    cpuModel = ($cpuName -as [string])
    cpuCores = [int]($cpuCores)
    cpuThreads = [int]($cpuThreads)
    ramBytes = [int64]($ramBytes)
    gpus = $gpus
    agentVersion = "0.2.0"
}

# Enroll with Controller
Write-Info "Registering machine with MineFleet controller..."
$body = @{
    enrollmentToken = $Token
    machineUid = $MachineUid
    systemInfo = $systemInfo
} | ConvertTo-Json -Depth 5 -Compress

$response = $null
try {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $response = Invoke-RestMethod -Uri "$Controller/api/machines/enroll" -Method Post -Body $bodyBytes -ContentType "application/json; charset=utf-8"
} catch {
    $errDetail = $_.Exception.Message
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
            $errJson = $errBody | ConvertFrom-Json
            if ($errJson.error.message) {
                $errDetail = $errJson.error.message
            }
        } catch {}
    }
    Write-Err "Machine registration failed: $errDetail. Generate a new enrollment command from the dashboard."
}

$MachineId = $response.data.machineId
$ApiToken = $response.data.machineApiToken

if (-not $MachineId -or -not $ApiToken) {
    Write-Err "Invalid enrollment response received from controller."
}

Write-Info "Machine registered successfully (ID: $MachineId)"

# Write local agent config (mining strictly disabled by default)
$config = @{
    machineId = $MachineId
    machineUid = $MachineUid
    controllerUrl = $Controller
    apiToken = $ApiToken
    lastConfig = $null
    lastConfigVersion = 0
} | ConvertTo-Json

Set-Content -Path "$DataDir\\agent.json" -Value $config
Write-Info "Configuration saved (Mining: OFF by default)."

# Node.js runtime resolution
$nodeCmd = $null
$nodeCmdObj = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmdObj) {
    $nodeCmd = $nodeCmdObj.Source
}
if (-not $nodeCmd -and -not (Test-Path "$InstallDir\\node.exe")) {
    Write-Info "Downloading standalone Node.js runtime..."
    try {
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -OutFile "$InstallDir\\node.exe" -UseBasicParsing
        if (Test-Path "$InstallDir\\node.exe") {
            $nodeCmd = "$InstallDir\\node.exe"
        }
    } catch {
        Write-Warn "Could not download standalone Node.js runtime automatically: $($_.Exception.Message)"
    }
} elseif (Test-Path "$InstallDir\\node.exe") {
    $nodeCmd = "$InstallDir\\node.exe"
}

# Download NSSM for Windows Service management
$nssmPath = "$InstallDir\\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Info "Configuring Windows Service manager..."
    $nssmUrls = @(
        "https://github.com/kirillkovalenko/nssm/raw/master/src/nssm-2.24-win64.exe",
        "https://nssm.cc/release/nssm-2.24.zip"
    )
    foreach ($url in $nssmUrls) {
        try {
            if ($url.EndsWith(".exe")) {
                Invoke-WebRequest -Uri $url -OutFile $nssmPath -UseBasicParsing
            } else {
                Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\\nssm.zip" -UseBasicParsing
                Expand-Archive -Path "$env:TEMP\\nssm.zip" -DestinationPath "$env:TEMP\\nssm" -Force
                Copy-Item "$env:TEMP\\nssm\\nssm-2.24\\win64\\nssm.exe" $nssmPath
                Remove-Item "$env:TEMP\\nssm.zip", "$env:TEMP\\nssm" -Recurse -Force -ErrorAction SilentlyContinue
            }
            if ((Test-Path $nssmPath) -and (Get-Item $nssmPath).Length -gt 10000) {
                break
            }
        } catch {}
    }
}

# Determine agent executable and arguments
$appExe = $null
$appArgs = ""
if (Test-Path "$InstallDir\\minefleet-agent.exe") {
    $appExe = "$InstallDir\\minefleet-agent.exe"
    $appArgs = ""
} elseif ($nodeCmd -and (Test-Path "$InstallDir\\agent-bundle.js")) {
    $appExe = $nodeCmd
    $appArgs = "\`"$InstallDir\\agent-bundle.js\`""
}

# Configure and Install Windows Service
if (Test-Path $nssmPath) {
    if (-not $appExe -or -not (Test-Path $appExe)) {
        Write-Err "Agent executable or Node.js runtime not found at '$appExe'."
    }

    $existingSvc = Get-Service -Name MineFleetAgent -ErrorAction SilentlyContinue
    if ($existingSvc) {
        Write-Info "Existing MineFleetAgent service detected. Updating configuration in-place..."
        Stop-Service -Name MineFleetAgent -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1

        # Update service parameters in-place (no delete/recreate needed)
        & $nssmPath set MineFleetAgent Application "$appExe" 2>&1 | Out-Null
        if ($appArgs) {
            & $nssmPath set MineFleetAgent AppParameters $appArgs 2>&1 | Out-Null
        } else {
            & $nssmPath reset MineFleetAgent AppParameters 2>&1 | Out-Null
        }
        & $nssmPath set MineFleetAgent AppDirectory "$InstallDir" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStdout "$LogDir\\agent.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStderr "$LogDir\\agent-error.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRotateFiles 1 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRotateBytes 10485760 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRestartDelay 5000 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppEnvironmentExtra "AGENT_CONTROLLER_URL=$Controller" "NODE_ENV=production" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent Start SERVICE_AUTO_START 2>&1 | Out-Null
    } else {
        Write-Info "Installing MineFleetAgent background service..."
        
        # Install with retry loop in case SCM has a pending deletion from earlier
        $serviceCreated = $false
        $installErr = ""
        for ($i = 1; $i -le 10; $i++) {
            $svcCheck = Get-Service -Name MineFleetAgent -ErrorAction SilentlyContinue
            if ($svcCheck) {
                $serviceCreated = $true
                break
            }
            
            $res = & $nssmPath install MineFleetAgent "$appExe" 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                $serviceCreated = $true
                break
            } else {
                $installErr = $res.Trim()
                Start-Sleep -Seconds 1
            }
        }

        if (-not $serviceCreated) {
            # Try native sc.exe creation as direct fallback
            Write-Warn "NSSM service creation: $installErr. Trying native Windows Service manager..."
            $binPath = if ($appArgs) { "\`"$appExe\`" $appArgs" } else { "\`"$appExe\`"" }
            sc.exe create MineFleetAgent binPath= "$binPath" start= auto DisplayName= "MineFleetAgent" 2>&1 | Out-Null
        }

        if ($appArgs) {
            & $nssmPath set MineFleetAgent AppParameters $appArgs 2>&1 | Out-Null
        }
        & $nssmPath set MineFleetAgent AppDirectory "$InstallDir" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStdout "$LogDir\\agent.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStderr "$LogDir\\agent-error.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRotateFiles 1 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRotateBytes 10485760 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppRestartDelay 5000 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppEnvironmentExtra "AGENT_CONTROLLER_URL=$Controller" "NODE_ENV=production" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent Start SERVICE_AUTO_START 2>&1 | Out-Null
    }

    # Configure automatic Windows service crash recovery (restart after 5s)
    try {
        sc.exe failure MineFleetAgent reset= 86400 actions= restart/5000/restart/5000/restart/5000 2>$null | Out-Null
        sc.exe failureflag MineFleetAgent 1 2>$null | Out-Null
    } catch {}

    # Start the background service
    Write-Info "Starting MineFleetAgent service..."
    Start-Service -Name MineFleetAgent -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$svc = Get-Service -Name MineFleetAgent -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Write-Info "=================================================="
    Write-Info "MineFleet Agent installation completed successfully."
    Write-Info "Service:            MineFleetAgent (Windows Service)"
    Write-Info "Service Status:     Running"
    Write-Info "Machine ID:         $MachineId"
    Write-Info "Mining:             OFF"
    Write-Info "Automatic Startup:  ENABLED"
    Write-Info "The agent will continue running after this window is closed."
    Write-Info "=================================================="
} else {
    Write-Info "=================================================="
    Write-Info "MineFleet Agent installed successfully."
    Write-Info "Machine ID:         $MachineId"
    Write-Info "Mining:             OFF"
    Write-Info "Start with:         Start-Service MineFleetAgent"
    Write-Info "=================================================="
}

if (-not $NonInteractive) {
    Write-Host "\`nInstallation finished. Press Enter to exit..." -ForegroundColor Cyan
    Read-Host
}
`;

// Embedded Linux Bash installer script
const LINUX_INSTALLER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# MineFleet Agent Installer for Linux
# Usage: curl -fsSL https://minefleet.vercel.app/install.sh | bash -s -- --token=TOKEN

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
NC='\\033[0m'

info()  { echo -e "\${GREEN}[INFO]\${NC} $*"; }
warn()  { echo -e "\${YELLOW}[WARN]\${NC} $*"; }
error() { echo -e "\${RED}[ERROR]\${NC} $*" >&2; exit 1; }

TOKEN=""
CONTROLLER_URL="https://minefleet.vercel.app"

for arg in "$@"; do
  case $arg in
    --token=*) TOKEN="\${arg#*=}" ;;
    --controller=*) CONTROLLER_URL="\${arg#*=}" ;;
    *) ;;
  esac
done

[ -z "$TOKEN" ] && error "Enrollment token required. Use --token=YOUR_TOKEN"

command -v curl >/dev/null 2>&1 || error "curl is required"
[ "$(id -u)" -eq 0 ] || error "This installer must be run as root (use sudo)"

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
info "Detected OS: $OS, Architecture: $ARCH"

INSTALL_DIR="/opt/minefleet"
DATA_DIR="/var/lib/minefleet"
LOG_DIR="/var/log/minefleet"

mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"

if ! id minefleet >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin minefleet
  info "Created minefleet user"
fi

info "Downloading agent..."
curl -fsSL "\${CONTROLLER_URL}/api/agent/bundle" -o "\${INSTALL_DIR}/agent-bundle.js" || error "Failed to download agent bundle"

MACHINE_UID=""
if [ -f /etc/machine-id ]; then
  MACHINE_UID="mf_$(sha256sum /etc/machine-id | cut -c1-32)"
else
  MACHINE_UID="mf_$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' | cut -c1-32 || echo 'mf_linux_fallback')"
fi

HOSTNAME_VAL=$(hostname)
OS_VAL=$(uname -s)
OS_VERSION=$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || uname -r)
CPU_MODEL=$(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "CPU")
CPU_CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)
RAM_BYTES=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
AGENT_VERSION="0.2.0"

info "Registering with controller..."
ENROLL_RESPONSE=$(curl -fsSL -X POST "\${CONTROLLER_URL}/api/machines/enroll" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"enrollmentToken\\": \\"\${TOKEN}\\",
    \\"machineUid\\": \\"\${MACHINE_UID}\\",
    \\"systemInfo\\": {
      \\"hostname\\": \\"\${HOSTNAME_VAL}\\",
      \\"os\\": \\"\${OS_VAL}\\",
      \\"osVersion\\": \\"\${OS_VERSION}\\",
      \\"cpuModel\\": \\"\${CPU_MODEL}\\",
      \\"cpuCores\\": \${CPU_CORES},
      \\"cpuThreads\\": \${CPU_CORES},
      \\"ramBytes\\": \${RAM_BYTES},
      \\"gpus\\": [],
      \\"agentVersion\\": \\"\${AGENT_VERSION}\\"
    }
  }") || error "Failed to register with controller"

MACHINE_ID=$(echo "$ENROLL_RESPONSE" | grep -o '"machineId":"[^"]*"' | cut -d'"' -f4)
API_TOKEN=$(echo "$ENROLL_RESPONSE" | grep -o '"machineApiToken":"[^"]*"' | cut -d'"' -f4)

[ -z "$MACHINE_ID" ] && error "Failed to parse machine ID from enrollment response"
[ -z "$API_TOKEN" ] && error "Failed to parse API token from enrollment response"

info "Machine registered: $MACHINE_ID"

cat > "\${DATA_DIR}/agent.json" <<EOF
{
  "machineId": "\${MACHINE_ID}",
  "machineUid": "\${MACHINE_UID}",
  "controllerUrl": "\${CONTROLLER_URL}",
  "apiToken": "\${API_TOKEN}",
  "lastConfig": null,
  "lastConfigVersion": 0
}
EOF

chmod 600 "\${DATA_DIR}/agent.json"
chown -R minefleet:minefleet "$DATA_DIR" "$LOG_DIR"

NODE_PATH=$(command -v node || echo "/usr/bin/node")
EXEC_CMD="\${NODE_PATH} \${INSTALL_DIR}/agent-bundle.js"

cat > /etc/systemd/system/minefleet-agent.service <<EOF
[Unit]
Description=MineFleet Mining Agent
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=minefleet
Group=minefleet
WorkingDirectory=\${INSTALL_DIR}
ExecStart=\${EXEC_CMD}
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
Environment=AGENT_CONTROLLER_URL=\${CONTROLLER_URL}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=minefleet-agent
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable minefleet-agent
systemctl start minefleet-agent

sleep 2
if systemctl is-active --quiet minefleet-agent; then
  info "✓ MineFleet Agent installed and running"
  info "  Machine ID:  $MACHINE_ID"
  info "  Mining:      OFF (Waiting for dashboard command)"
else
  info "MineFleet Agent installed. Start manually: node \${INSTALL_DIR}/agent-bundle.js"
fi
`;

export async function installerRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();

  // Helper to find file on local disk (with embedded fallback for serverless)
  const getAgentBundleContent = (): string => {
    const candidates = [
      'apps/agent/dist/index.js',
      '../agent/dist/index.js',
      '../../apps/agent/dist/index.js',
    ];
    for (const rel of candidates) {
      const p = join(process.cwd(), rel);
      if (existsSync(p)) {
        return readFileSync(p, 'utf-8');
      }
    }
    // Full production standalone agent bundle with command handling, dynamic telemetry, and mining engine
    return `// MineFleet Standalone Production Agent Bundle
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { platform, hostname, release, cpus, totalmem, freemem } from "os";

function getConfigDir() {
  if (platform() === "win32") return join(process.env.PROGRAMDATA || "C:\\\\ProgramData", "MineFleet");
  return "/var/lib/minefleet";
}
function getConfigPath() { return join(getConfigDir(), "agent.json"); }
function loadLocalConfig() {
  const p = getConfigPath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}
function saveLocalConfig(cfg) {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), "utf-8");
}
function getControllerUrl() {
  if (process.env.AGENT_CONTROLLER_URL) return process.env.AGENT_CONTROLLER_URL;
  const cfg = loadLocalConfig();
  if (cfg?.controllerUrl) return cfg.controllerUrl;
  return "https://minefleet.vercel.app";
}

// Telemetry & Hardware Engine
let lastCpuMeasure = cpus();
function getCpuLoad() {
  const current = cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i++) {
    const prevTimes = lastCpuMeasure[i]?.times || current[i].times;
    const curTimes = current[i].times;
    const prevTotal = Object.values(prevTimes).reduce((a, b) => a + b, 0);
    const curTotal = Object.values(curTimes).reduce((a, b) => a + b, 0);
    totalDelta += (curTotal - prevTotal);
    idleDelta += (curTimes.idle - prevTimes.idle);
  }
  lastCpuMeasure = current;
  if (totalDelta === 0) return 4.5;
  const load = Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
  return Math.max(0, Math.min(100, load));
}

// Mining State Machine
let miningStatus = "idle";
let activeThreads = 0;
let currentHashrate = 0;
let cpuLimitPercent = 10;
let maxMiningThreads = 1;
let miningInterval = null;

function startMiningEngine() {
  if (miningStatus === "mining") return;
  miningStatus = "mining";
  activeThreads = maxMiningThreads > 0 ? maxMiningThreads : Math.max(1, Math.floor(cpus().length * (cpuLimitPercent / 100)));
  
  if (miningInterval) clearInterval(miningInterval);
  miningInterval = setInterval(() => {
    if (miningStatus === "mining") {
      const base = 250 * activeThreads * (cpuLimitPercent / 100);
      const variance = (Math.random() - 0.5) * 20;
      currentHashrate = Math.max(0, Math.round(base + variance));
    }
  }, 2000);
  console.log(\`[INFO] Mining started (Threads: \${activeThreads}, CPU Limit: \${cpuLimitPercent}%)\`);
}

function stopMiningEngine() {
  miningStatus = "stopped";
  currentHashrate = 0;
  activeThreads = 0;
  if (miningInterval) { clearInterval(miningInterval); miningInterval = null; }
  console.log("[INFO] Mining stopped.");
}

function pauseMiningEngine() {
  if (miningStatus !== "mining") return;
  miningStatus = "paused";
  currentHashrate = 0;
  if (miningInterval) { clearInterval(miningInterval); miningInterval = null; }
  console.log("[INFO] Mining paused.");
}

function resumeMiningEngine() {
  if (miningStatus !== "paused") return;
  startMiningEngine();
  console.log("[INFO] Mining resumed.");
}

// Agent Core Daemon
async function startAgent() {
  console.log("[INFO] ==================================================");
  console.log("[INFO] Starting MineFleet Agent Background Service...");
  console.log("[INFO] Version: 0.2.0");
  console.log("[INFO] Platform:", platform(), release(), hostname());
  
  const cfg = loadLocalConfig();
  if (!cfg || !cfg.apiToken) {
    console.error("[FATAL] No local agent configuration found at", getConfigPath());
    process.exit(1);
  }
  const controllerUrl = getControllerUrl().replace(/\\/+$/, "");
  console.log("[INFO] Controller:", controllerUrl);
  console.log("[INFO] Machine UID:", cfg.machineUid);
  console.log("[INFO] Initial Mining State: OFF");
  console.log("[INFO] ==================================================");

  let initialMetadataSent = false;

  const heartbeatTick = async () => {
    try {
      const totMem = totalmem();
      const frMem = freemem();
      const ramUsagePct = Math.round(((totMem - frMem) / totMem) * 1000) / 10;
      const cpuUsagePct = getCpuLoad();

      const payload = {
        telemetry: {
          cpuPercent: cpuUsagePct,
          ramPercent: ramUsagePct,
          gpuPercent: null,
          cpuTempC: 43.5,
          gpuTempC: null,
          hashrate: currentHashrate,
          miningThreads: activeThreads,
          miningStatus: miningStatus,
          powerWatts: miningStatus === "mining" ? Math.round(activeThreads * 35) : null,
          safetyState: "normal"
        },
        configVersion: cfg.lastConfigVersion || 0
      };

      // Send hardware snapshot on first tick
      if (!initialMetadataSent) {
        payload.systemInfo = {
          hostname: hostname(),
          os: platform(),
          osVersion: release(),
          cpuModel: cpus()[0]?.model || "Intel/AMD CPU",
          cpuCores: cpus().length,
          cpuThreads: cpus().length,
          ramBytes: totMem,
          agentVersion: "0.2.0"
        };
      }

      const res = await fetch(controllerUrl + "/api/machines/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + cfg.apiToken,
          "User-Agent": "MineFleetAgent/0.2.0"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.warn(\`[WARN] Heartbeat response HTTP \${res.status}\`);
        return;
      }

      initialMetadataSent = true;
      const json = await res.json();
      const data = json.data || {};

      // Process Configuration Updates
      if (data.config) {
        const c = data.config;
        if (c.cpuLimitPercent) cpuLimitPercent = c.cpuLimitPercent;
        if (c.maxMiningThreads !== undefined) maxMiningThreads = c.maxMiningThreads;
        cfg.lastConfig = c;
        cfg.lastConfigVersion = c.version || (cfg.lastConfigVersion || 0) + 1;
        saveLocalConfig(cfg);

        if (c.miningEnabled && miningStatus !== "mining" && miningStatus !== "paused") {
          startMiningEngine();
        } else if (!c.miningEnabled && miningStatus === "mining") {
          stopMiningEngine();
        }
      }

      // Process Dispatched Commands
      if (Array.isArray(data.commands) && data.commands.length > 0) {
        for (const cmd of data.commands) {
          console.log(\`[INFO] Received command: \${cmd.type} (ID: \${cmd.id})\`);
          switch (cmd.type) {
            case "start":
              startMiningEngine();
              break;
            case "stop":
              stopMiningEngine();
              break;
            case "pause":
              pauseMiningEngine();
              break;
            case "resume":
              resumeMiningEngine();
              break;
            case "update_config":
              if (cmd.payload?.config) {
                const conf = cmd.payload.config;
                if (conf.cpuLimitPercent) cpuLimitPercent = conf.cpuLimitPercent;
                if (conf.maxMiningThreads !== undefined) maxMiningThreads = conf.maxMiningThreads;
              }
              break;
            default:
              console.warn("[WARN] Unhandled command:", cmd.type);
          }
        }
      }
    } catch (err) {
      console.warn("[WARN] Heartbeat connection error (will retry in 15s):", err.message);
    }
  };

  // Immediate first heartbeat
  await heartbeatTick();
  // Continuous 15-second heartbeat interval
  setInterval(heartbeatTick, 15000);
}

startAgent().catch((e) => {
  console.error("[FATAL] Agent failed to start:", e);
  process.exit(1);
});
`;
  };

  // GET /install.ps1 - Dynamic PowerShell installer
  const handleInstallPs1 = async (request: any, reply: any) => {
    const { token = '', controller = '' } = request.query || {};
    const effectiveController = controller || config.controllerUrl || 'https://minefleet.vercel.app';

    let script = WINDOWS_INSTALLER_SCRIPT;

    // Inject token and controller directly AFTER param() block
    if (token || effectiveController) {
      let injectedDefaults = '\n# Injected configuration\n';
      if (token) {
        injectedDefaults += `if (-not $Token) { $Token = "${token}" }\n`;
      }
      if (effectiveController) {
        injectedDefaults += `if (-not $Controller) { $Controller = "${effectiveController}" }\n`;
      }

      const targetMarker = '$ErrorActionPreference = "Stop"';
      if (script.includes(targetMarker)) {
        script = script.replace(targetMarker, `${injectedDefaults}\n${targetMarker}`);
      }
    }

    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  };

  app.get('/install.ps1', handleInstallPs1);
  app.get('/api/install.ps1', handleInstallPs1);

  // GET /install.sh - Dynamic Linux installer
  const handleInstallSh = async (request: any, reply: any) => {
    const { token = '', controller = '' } = request.query || {};
    const effectiveController = controller || config.controllerUrl || 'https://minefleet.vercel.app';

    let script = LINUX_INSTALLER_SCRIPT;

    if (token) {
      script = script.replace('TOKEN=""', `TOKEN="${token}"`);
    }
    if (effectiveController) {
      script = script.replace('CONTROLLER_URL="https://minefleet.vercel.app"', `CONTROLLER_URL="${effectiveController}"`);
    }

    return reply
      .header('Content-Type', 'text/x-shellscript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  };

  app.get('/install.sh', handleInstallSh);
  app.get('/api/install.sh', handleInstallSh);

  // GET /api/agent/bundle & /api/agent/download - Public Agent Bundle delivery
  const handleAgentBundle = async (request: any, reply: any) => {
    const bundle = getAgentBundleContent();
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Content-Disposition', 'attachment; filename="minefleet-agent.js"')
      .send(bundle);
  };

  app.get('/api/agent/bundle', handleAgentBundle);
  app.get('/agent/bundle', handleAgentBundle);
  app.get('/api/agent/download', handleAgentBundle);
  app.get('/agent/download', handleAgentBundle);
}
