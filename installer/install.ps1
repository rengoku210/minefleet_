# MineFleet Agent Installer for Windows
# Usage: .\install.ps1 -Token TOKEN -Controller https://controller.example.com
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
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -NoProfile -Command `"`$Token='$Token'; `$Controller='$Controller'; irm '$Controller/install.ps1?token=$Token' | iex`""
        exit 0
    } catch {
        Write-Err "Please open PowerShell as Administrator and run the command again."
    }
}

if (-not $Token) { Write-Err "Enrollment token is required. Use -Token <TOKEN>" }
if (-not $Controller) { Write-Err "Controller URL is required. Use -Controller https://your-controller.example.com" }

# Clean trailing slash from Controller URL
$Controller = $Controller.TrimEnd('/')

Write-Info "Installing MineFleet Agent..."
Write-Info "Controller: $Controller"

# Directories
$InstallDir = "C:\Program Files\MineFleet"
$DataDir = "C:\ProgramData\MineFleet"
$LogDir = "$DataDir\logs"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Download agent (try binary first, fall back to standalone bundle)
Write-Info "Downloading agent..."
$hasBinary = $false
try {
    Invoke-WebRequest -Uri "$Controller/api/agent/download?os=windows&arch=x86_64" -OutFile "$InstallDir\minefleet-agent.exe" -UseBasicParsing
    if ((Get-Item "$InstallDir\minefleet-agent.exe").Length -gt 1000) {
        $hasBinary = $true
    }
} catch {
    # Fallback to bundle
}

if (-not $hasBinary) {
    Write-Info "Fetching agent bundle..."
    try {
        Invoke-WebRequest -Uri "$Controller/api/agent/bundle" -OutFile "$InstallDir\agent-bundle.js" -UseBasicParsing
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
    agentVersion = "0.1.0"
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

# Write local agent config (mining disabled by default)
$config = @{
    machineId = $MachineId
    machineUid = $MachineUid
    controllerUrl = $Controller
    apiToken = $ApiToken
    lastConfig = $null
    lastConfigVersion = 0
} | ConvertTo-Json

Set-Content -Path "$DataDir\agent.json" -Value $config

# Download NSSM for reliable Windows Service management
$nssmPath = "$InstallDir\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Info "Configuring Windows Service manager..."
    try {
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip" -UseBasicParsing
        Expand-Archive -Path "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm" -Force
        Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssmPath
        Remove-Item "$env:TEMP\nssm.zip", "$env:TEMP\nssm" -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "Could not download NSSM automatically."
    }
}

# Install and Start Windows Service
if (Test-Path $nssmPath) {
    & $nssmPath stop MineFleetAgent 2>$null
    & $nssmPath remove MineFleetAgent confirm 2>$null

    $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)?.Source

    if (Test-Path "$InstallDir\minefleet-agent.exe") {
        & $nssmPath install MineFleetAgent "$InstallDir\minefleet-agent.exe"
    } elseif ($nodeCmd -and (Test-Path "$InstallDir\agent-bundle.js")) {
        & $nssmPath install MineFleetAgent $nodeCmd "`"$InstallDir\agent-bundle.js`""
    } else {
        Write-Warn "No standalone binary or node runtime found. Agent files placed in $InstallDir"
    }

    & $nssmPath set MineFleetAgent AppDirectory $InstallDir
    & $nssmPath set MineFleetAgent AppStdout "$LogDir\agent.log"
    & $nssmPath set MineFleetAgent AppStderr "$LogDir\agent-error.log"
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
    Write-Info "MineFleet Agent installed. Start manually: node `"$InstallDir\agent-bundle.js`""
}
