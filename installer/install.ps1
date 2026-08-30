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
    $nssmUrls = @(
        "https://github.com/kirillkovalenko/nssm/raw/master/src/nssm-2.24-win64.exe",
        "https://nssm.cc/release/nssm-2.24.zip"
    )
    foreach ($url in $nssmUrls) {
        try {
            if ($url.EndsWith(".exe")) {
                Invoke-WebRequest -Uri $url -OutFile $nssmPath -UseBasicParsing
            } else {
                Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\nssm.zip" -UseBasicParsing
                Expand-Archive -Path "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm" -Force
                Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssmPath
                Remove-Item "$env:TEMP\nssm.zip", "$env:TEMP\nssm" -Recurse -Force -ErrorAction SilentlyContinue
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
if (Test-Path "$InstallDir\minefleet-agent.exe") {
    $appExe = "$InstallDir\minefleet-agent.exe"
    $appArgs = ""
} elseif ($nodeCmd -and (Test-Path "$InstallDir\agent-bundle.js")) {
    $appExe = $nodeCmd
    $appArgs = "`"$InstallDir\agent-bundle.js`""
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
        & $nssmPath set MineFleetAgent AppStdout "$LogDir\agent.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStderr "$LogDir\agent-error.log" 2>&1 | Out-Null
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
            $binPath = if ($appArgs) { "`"$appExe`" $appArgs" } else { "`"$appExe`"" }
            sc.exe create MineFleetAgent binPath= "$binPath" start= auto DisplayName= "MineFleetAgent" 2>&1 | Out-Null
        }

        if ($appArgs) {
            & $nssmPath set MineFleetAgent AppParameters $appArgs 2>&1 | Out-Null
        }
        & $nssmPath set MineFleetAgent AppDirectory "$InstallDir" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStdout "$LogDir\agent.log" 2>&1 | Out-Null
        & $nssmPath set MineFleetAgent AppStderr "$LogDir\agent-error.log" 2>&1 | Out-Null
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
    Write-Host "`nInstallation finished. Press Enter to exit..." -ForegroundColor Cyan
    Read-Host
}
