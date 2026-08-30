# MineFleet Agent Installer for Windows
# Usage: .\install.ps1 -Token TOKEN -Controller https://minefleet.vercel.app
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
$InstallDir = "C:\Program Files\MineFleet"
$DataDir = "C:\ProgramData\MineFleet"
$LogDir = "$DataDir\logs"
$LogFile = "$DataDir\installer.log"

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
    Write-Host "`n[ERROR] $msg" -ForegroundColor Red
    Log-Msg "ERROR" $msg
    Write-Host "[INFO] Installation was not completed." -ForegroundColor Yellow
    if (-not $NonInteractive) {
        Write-Host "`nPress Enter to close..." -ForegroundColor Cyan
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
        $elevatedCmd = "-ExecutionPolicy Bypass -NoProfile -NoExit -Command `"`$Token='$Token'; `$Controller='$Controller'; irm '$Controller/install.ps1?token=$Token' | iex`""
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
    Invoke-WebRequest -Uri "$Controller/api/agent/bundle" -OutFile "$InstallDir\agent-bundle.js" -UseBasicParsing
    if ((Get-Item "$InstallDir\agent-bundle.js").Length -gt 500) {
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
$cpu = Get-CimInstance Win32_Processor
$os = Get-CimInstance Win32_OperatingSystem
$cpuName = if ($cpu -is [array]) { $cpu[0].Name } else { $cpu.Name }
$cpuCores = if ($cpu -is [array]) { ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum } else { $cpu.NumberOfCores }
$cpuThreads = if ($cpu -is [array]) { ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum } else { $cpu.NumberOfLogicalProcessors }

$systemInfo = @{
    hostname = $env:COMPUTERNAME
    os = "windows"
    osVersion = ($os.Caption -as [string])
    cpuModel = ($cpuName -as [string])
    cpuCores = [int]($cpuCores)
    cpuThreads = [int]($cpuThreads)
    ramBytes = [int64]($ram)
    gpus = @()
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

Set-Content -Path "$DataDir\agent.json" -Value $config
Write-Info "Configuration saved (Mining: OFF by default)."

# Node.js runtime resolution
$nodeCmd = $null
$nodeCmdObj = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmdObj) {
    $nodeCmd = $nodeCmdObj.Source
}
if (-not $nodeCmd -and -not (Test-Path "$InstallDir\node.exe")) {
    Write-Info "Downloading standalone Node.js runtime..."
    try {
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -OutFile "$InstallDir\node.exe" -UseBasicParsing
        if (Test-Path "$InstallDir\node.exe") {
            $nodeCmd = "$InstallDir\node.exe"
        }
    } catch {
        Write-Warn "Could not download standalone Node.js runtime automatically: $($_.Exception.Message)"
    }
} elseif (Test-Path "$InstallDir\node.exe") {
    $nodeCmd = "$InstallDir\node.exe"
}

# Download NSSM for Windows Service management
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
    Write-Info "=================================================="
    Write-Info "MineFleet Agent installed successfully!"
    Write-Info "  Machine ID:  $MachineId"
    Write-Info "  Mining:      OFF (Waiting for dashboard command)"
    Write-Info "  Start with:  node `"$InstallDir\agent-bundle.js`""
    Write-Info "=================================================="
}

if (-not $NonInteractive) {
    Write-Host "`nInstallation finished. Press Enter to exit..." -ForegroundColor Cyan
    Read-Host
}
