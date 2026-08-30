import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('installer-routes');

// Embedded full Windows PowerShell installer script
const WINDOWS_INSTALLER_SCRIPT = `# MineFleet Agent Installer for Windows
# Usage: .\\install.ps1 -Token TOKEN -Controller https://controller.example.com
# Or via one-liner: powershell -ExecutionPolicy Bypass -c "irm 'https://<CONTROLLER>/install.ps1?token=<TOKEN>' | iex"

param(
    [Parameter(Mandatory=$false)]
    [string]$Token = $env:MINEFLEET_ENROLLMENT_TOKEN,

    [Parameter(Mandatory=$false)]
    [string]$Controller = $env:MINEFLEET_CONTROLLER_URL
)

$ErrorActionPreference = "Stop"

function Write-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

# Check admin and auto-elevate if needed
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Administrator privileges required. Requesting elevation..."
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -NoProfile -Command \`"\`$Token='$Token'; \`$Controller='$Controller'; irm '$Controller/install.ps1?token=$Token' | iex\`""
        exit 0
    } catch {
        Write-Err "Please open PowerShell as Administrator and run the command again."
    }
}

if (-not $Token) { Write-Err "Enrollment token is required. Use -Token <TOKEN>" }
if (-not $Controller) { $Controller = "https://minefleet.vercel.app" }

# Clean trailing slash from Controller URL
$Controller = $Controller.TrimEnd('/')

Write-Info "Installing MineFleet Agent..."
Write-Info "Controller: $Controller"

# Directories
$InstallDir = "C:\\Program Files\\MineFleet"
$DataDir = "C:\\ProgramData\\MineFleet"
$LogDir = "$DataDir\\logs"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Download agent (try binary first, fall back to standalone bundle)
Write-Info "Downloading agent..."
$hasBinary = $false
try {
    Invoke-WebRequest -Uri "$Controller/api/agent/download?os=windows&arch=x86_64" -OutFile "$InstallDir\\minefleet-agent.exe" -UseBasicParsing
    if ((Get-Item "$InstallDir\\minefleet-agent.exe").Length -gt 1000) {
        $hasBinary = $true
    }
} catch {
    # Fallback to bundle
}

if (-not $hasBinary) {
    Write-Info "Fetching agent bundle..."
    try {
        Invoke-WebRequest -Uri "$Controller/api/agent/bundle" -OutFile "$InstallDir\\agent-bundle.js" -UseBasicParsing
    } catch {
        Write-Err "Failed to download agent from $Controller"
    }
}

# Generate machine UID
$fingerprint = "$env:COMPUTERNAME|$((Get-CimInstance Win32_Processor).Name)|windows|$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)|$((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory)"
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($fingerprint))
$MachineUid = "mf_" + [BitConverter]::ToString($hash).Replace("-","").Substring(0,32).ToLower()

# Collect system info
$cpu = Get-CimInstance Win32_Processor
$os = Get-CimInstance Win32_OperatingSystem
$ram = $os.TotalVisibleMemorySize * 1024

$systemInfo = @{
    hostname = $env:COMPUTERNAME
    os = "windows"
    osVersion = $os.Caption
    cpuModel = $cpu.Name
    cpuCores = $cpu.NumberOfCores
    cpuThreads = $cpu.NumberOfLogicalProcessors
    ramBytes = $ram
    gpus = @()
    agentVersion = "0.2.0"
}

# Enroll with Controller
Write-Info "Registering machine with controller..."
$body = @{
    enrollmentToken = $Token
    machineUid = $MachineUid
    systemInfo = $systemInfo
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-RestMethod -Uri "$Controller/api/machines/enroll" -Method Post -Body $body -ContentType "application/json"
} catch {
    Write-Err "Failed to register with controller: $($_.Exception.Message)"
}

$MachineId = $response.data.machineId
$ApiToken = $response.data.machineApiToken

if (-not $MachineId -or -not $ApiToken) {
    Write-Err "Invalid enrollment response from controller."
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

# Download NSSM for reliable Windows Service management
$nssmPath = "$InstallDir\\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Info "Configuring Windows Service manager..."
    try {
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\\nssm.zip" -UseBasicParsing
        Expand-Archive -Path "$env:TEMP\\nssm.zip" -DestinationPath "$env:TEMP\\nssm" -Force
        Copy-Item "$env:TEMP\\nssm\\nssm-2.24\\win64\\nssm.exe" $nssmPath
        Remove-Item "$env:TEMP\\nssm.zip", "$env:TEMP\\nssm" -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "Could not download NSSM automatically."
    }
}

# Install and Start Windows Service
if (Test-Path $nssmPath) {
    & $nssmPath stop MineFleetAgent 2>$null
    & $nssmPath remove MineFleetAgent confirm 2>$null

    $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)?.Source

    if (Test-Path "$InstallDir\\minefleet-agent.exe") {
        & $nssmPath install MineFleetAgent "$InstallDir\\minefleet-agent.exe"
    } elseif ($nodeCmd -and (Test-Path "$InstallDir\\agent-bundle.js")) {
        & $nssmPath install MineFleetAgent $nodeCmd "\`"$InstallDir\\agent-bundle.js\`""
    } else {
        Write-Warn "No standalone binary or node runtime found. Agent files placed in $InstallDir"
    }

    & $nssmPath set MineFleetAgent AppDirectory $InstallDir
    & $nssmPath set MineFleetAgent AppStdout "$LogDir\\agent.log"
    & $nssmPath set MineFleetAgent AppStderr "$LogDir\\agent-error.log"
    & $nssmPath set MineFleetAgent AppRotateFiles 1
    & $nssmPath set MineFleetAgent AppRotateBytes 10485760
    & $nssmPath set MineFleetAgent AppRestartDelay 5000
    & $nssmPath set MineFleetAgent AppEnvironmentExtra "AGENT_CONTROLLER_URL=$Controller" "NODE_ENV=production"
    & $nssmPath set MineFleetAgent Start SERVICE_AUTO_START
    & $nssmPath start MineFleetAgent
}

Start-Sleep -Seconds 2

$svc = Get-Service MineFleetAgent -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Write-Info "=================================================="
    Write-Info "MineFleet Agent installed and running!"
    Write-Info "  Machine ID:  $MachineId"
    Write-Info "  Mining:      OFF (Waiting for dashboard command)"
    Write-Info "  Service:     MineFleetAgent (Windows Service)"
    Write-Info "=================================================="
} else {
    Write-Info "MineFleet Agent installed. Start manually: node \`"$InstallDir\\agent-bundle.js\`""
}
`;

// Embedded Linux Bash installer script
const LINUX_INSTALLER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# MineFleet Agent Installer for Linux
# Usage: curl -fsSL https://controller.example.com/install.sh | bash -s -- --token=TOKEN

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
}
