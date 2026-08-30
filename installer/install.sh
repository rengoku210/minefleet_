#!/usr/bin/env bash
set -euo pipefail

# MineFleet Agent Installer for Linux
# Usage: curl -fsSL https://controller.example.com/install.sh | bash -s -- --token=TOKEN

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# Parse arguments
TOKEN=""
CONTROLLER_URL=""

for arg in "$@"; do
  case $arg in
    --token=*) TOKEN="${arg#*=}" ;;
    --controller=*) CONTROLLER_URL="${arg#*=}" ;;
    *) ;;
  esac
done

# If no controller URL specified, derive from script download origin
if [ -z "$CONTROLLER_URL" ]; then
  # Try to extract from the curl referer or default
  CONTROLLER_URL="${MINEFLEET_CONTROLLER_URL:-}"
  if [ -z "$CONTROLLER_URL" ]; then
    error "Controller URL not specified. Use --controller=https://your-controller.example.com"
  fi
fi

[ -z "$TOKEN" ] && error "Enrollment token required. Use --token=YOUR_TOKEN"

# Check requirements
command -v curl >/dev/null 2>&1 || error "curl is required"
[ "$(id -u)" -eq 0 ] || error "This installer must be run as root (use sudo)"

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
info "Detected OS: $OS, Architecture: $ARCH"

# Create directories
INSTALL_DIR="/opt/minefleet"
DATA_DIR="/var/lib/minefleet"
LOG_DIR="/var/log/minefleet"

mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"

# Create service user
if ! id minefleet >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin minefleet
  info "Created minefleet user"
fi

# Download agent binary
info "Downloading agent..."
curl -fsSL "${CONTROLLER_URL}/api/agent/download?os=${OS}&arch=${ARCH}" -o "${INSTALL_DIR}/minefleet-agent" || {
  warn "Binary download failed — installing from source bundle instead"
  # Fallback: download the JS bundle + use system Node.js
  curl -fsSL "${CONTROLLER_URL}/api/agent/bundle" -o "${INSTALL_DIR}/agent-bundle.js" || error "Failed to download agent"
}

chmod +x "${INSTALL_DIR}/minefleet-agent" 2>/dev/null || true

# Generate machine UID
MACHINE_UID=""
if [ -f /etc/machine-id ]; then
  MACHINE_UID="mf_$(sha256sum /etc/machine-id | cut -c1-32)"
else
  MACHINE_UID="mf_$(cat /proc/sys/kernel/random/uuid | tr -d '-' | cut -c1-32)"
fi

# Collect system info
HOSTNAME_VAL=$(hostname)
OS_VAL=$(uname -s)
OS_VERSION=$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || uname -r)
CPU_MODEL=$(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "Unknown")
CPU_CORES=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)
RAM_BYTES=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
AGENT_VERSION="0.1.0"

# Register with controller
info "Registering with controller..."
ENROLL_RESPONSE=$(curl -fsSL -X POST "${CONTROLLER_URL}/api/machines/enroll" \
  -H "Content-Type: application/json" \
  -d "{
    \"enrollmentToken\": \"${TOKEN}\",
    \"machineUid\": \"${MACHINE_UID}\",
    \"systemInfo\": {
      \"hostname\": \"${HOSTNAME_VAL}\",
      \"os\": \"${OS_VAL}\",
      \"osVersion\": \"${OS_VERSION}\",
      \"cpuModel\": \"${CPU_MODEL}\",
      \"cpuCores\": ${CPU_CORES},
      \"cpuThreads\": ${CPU_CORES},
      \"ramBytes\": ${RAM_BYTES},
      \"gpus\": [],
      \"agentVersion\": \"${AGENT_VERSION}\"
    }
  }") || error "Failed to register with controller"

# Parse response
MACHINE_ID=$(echo "$ENROLL_RESPONSE" | grep -o '"machineId":"[^"]*"' | cut -d'"' -f4)
API_TOKEN=$(echo "$ENROLL_RESPONSE" | grep -o '"machineApiToken":"[^"]*"' | cut -d'"' -f4)

[ -z "$MACHINE_ID" ] && error "Failed to parse machine ID from enrollment response"
[ -z "$API_TOKEN" ] && error "Failed to parse API token from enrollment response"

info "Machine registered: $MACHINE_ID"

# Write config
cat > "${DATA_DIR}/agent.json" <<EOF
{
  "machineId": "${MACHINE_ID}",
  "machineUid": "${MACHINE_UID}",
  "controllerUrl": "${CONTROLLER_URL}",
  "apiToken": "${API_TOKEN}",
  "lastConfig": null,
  "lastConfigVersion": 0
}
EOF

chmod 600 "${DATA_DIR}/agent.json"
chown -R minefleet:minefleet "$DATA_DIR" "$LOG_DIR"

# Detect ExecStart target
EXEC_CMD="${INSTALL_DIR}/minefleet-agent"
if [ ! -f "${INSTALL_DIR}/minefleet-agent" ] && [ -f "${INSTALL_DIR}/agent-bundle.js" ]; then
  NODE_PATH=$(command -v node || echo "/usr/bin/node")
  EXEC_CMD="${NODE_PATH} ${INSTALL_DIR}/agent-bundle.js"
fi

# Install systemd service
cat > /etc/systemd/system/minefleet-agent.service <<EOF
[Unit]
Description=MineFleet Mining Agent
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=minefleet
Group=minefleet
WorkingDirectory=${INSTALL_DIR}
ExecStart=${EXEC_CMD}
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
Environment=AGENT_CONTROLLER_URL=${CONTROLLER_URL}
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

# Verify
sleep 3
if systemctl is-active --quiet minefleet-agent; then
  info "✓ MineFleet Agent installed and running"
  info "  Machine ID:  $MACHINE_ID"
  info "  Machine UID: $MACHINE_UID"
  info "  Controller:  $CONTROLLER_URL"
  info "  Service:     minefleet-agent (systemd)"
  info ""
  info "  Commands:"
  info "    Status:     systemctl status minefleet-agent"
  info "    Logs:       journalctl -u minefleet-agent -f"
  info "    Stop:       systemctl stop minefleet-agent"
  info "    Uninstall:  systemctl stop minefleet-agent && systemctl disable minefleet-agent && rm /etc/systemd/system/minefleet-agent.service"
else
  warn "Agent service may not have started correctly. Check: journalctl -u minefleet-agent"
fi
