#!/usr/bin/env bash
set -e

# OpenClaw Virtual Office — Installer
# Usage:
#   Install:  curl -fsSL https://raw.githubusercontent.com/openclaw/virtual-office/main/install.sh | bash
#   Update:   bash ~/virtual-office/install.sh --update
#   Docker:   bash ~/virtual-office/install.sh --docker

REPO_URL="https://github.com/openclaw/virtual-office.git"
INSTALL_DIR="$HOME/virtual-office"
SERVICE_NAME="virtual-office"
MODE="install"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --update) MODE="update" ;;
    --docker) MODE="docker" ;;
    --uninstall) MODE="uninstall" ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}🏢 OpenClaw Virtual Office — Installer${NC}"
echo "========================================"
echo ""

do_install() {

# Check dependencies
for cmd in git node npm; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}❌ Missing dependency: $cmd${NC}"
    echo "   Please install Node.js 18+ and try again."
    exit 1
  fi
done

NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo ok || echo fail)
if [ "$NODE_VER" = "fail" ]; then
  echo -e "${RED}❌ Node.js 18+ required. Current: $(node --version)${NC}"
  exit 1
fi

# Gateway config — auto-detect from OpenClaw config
echo -e "${YELLOW}🔑 OpenClaw Gateway Configuration${NC}"
echo ""

OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
AUTO_TOKEN=""
AUTO_URL=""

if [ -f "$OPENCLAW_CONFIG" ] && command -v python3 &>/dev/null; then
  AUTO_TOKEN=$(python3 -c "
import json, sys
try:
    d = json.load(open('$OPENCLAW_CONFIG'))
    print(d.get('gateway',{}).get('auth',{}).get('token',''))
except: pass
" 2>/dev/null)

  AUTO_PORT=$(python3 -c "
import json, sys
try:
    d = json.load(open('$OPENCLAW_CONFIG'))
    print(d.get('gateway',{}).get('port', 18789))
except: print(18789)
" 2>/dev/null)

  AUTO_URL="http://127.0.0.1:${AUTO_PORT}"
fi

if [ -n "$AUTO_TOKEN" ]; then
  echo -e "  ${GREEN}✅ OpenClaw config detected — token extracted automatically${NC}"
  echo -e "  Gateway URL:  ${CYAN}$AUTO_URL${NC}"
  echo -e "  Token:        ${CYAN}${AUTO_TOKEN:0:12}...${NC}"
  echo ""
  read -rp "Use these settings? [Y/n]: " USE_AUTO
  if [[ "$USE_AUTO" =~ ^[Nn]$ ]]; then
    AUTO_TOKEN=""
  fi
fi

if [ -z "$AUTO_TOKEN" ]; then
  echo "Couldn't auto-detect. Please enter manually:"
  echo ""
  read -rp "Gateway URL [http://127.0.0.1:18789]: " GATEWAY_URL
  GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:18789}"

  read -rp "Gateway Token: " GATEWAY_TOKEN
  if [ -z "$GATEWAY_TOKEN" ]; then
    echo -e "${RED}❌ Gateway token is required.${NC}"
    exit 1
  fi
else
  GATEWAY_URL="$AUTO_URL"
  GATEWAY_TOKEN="$AUTO_TOKEN"
fi

read -rp "Server port [3001]: " PORT
PORT="${PORT:-3001}"

read -rp "Install directory [$INSTALL_DIR]: " CUSTOM_DIR
INSTALL_DIR="${CUSTOM_DIR:-$INSTALL_DIR}"

echo ""
echo -e "${CYAN}📦 Cloning repository...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo "Directory exists — pulling latest..."
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo ""
echo -e "${CYAN}📦 Installing frontend dependencies...${NC}"
cd "$INSTALL_DIR"
npm install --silent

echo ""
echo -e "${CYAN}📦 Installing server dependencies...${NC}"
cd "$INSTALL_DIR/server"
npm install --silent

echo ""
echo -e "${CYAN}🔨 Building frontend...${NC}"
cd "$INSTALL_DIR"
npm run build

echo ""
echo -e "${CYAN}🔨 Building server...${NC}"
cd "$INSTALL_DIR/server"
npm run build

echo ""
echo -e "${CYAN}⚙️ Writing server config...${NC}"
cat > "$INSTALL_DIR/server/.env" <<EOF
GATEWAY_URL=$GATEWAY_URL
GATEWAY_TOKEN=$GATEWAY_TOKEN
PORT=$PORT
STATIC_DIR=$INSTALL_DIR/dist
EOF

echo ""
echo -e "${CYAN}🛠️ Creating systemd service...${NC}"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CURRENT_USER=$(whoami)
NODE_BIN=$(which node)

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=OpenClaw Virtual Office
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$INSTALL_DIR/server
ExecStart=$NODE_BIN dist/index.js
EnvironmentFile=$INSTALL_DIR/server/.env
Restart=always
RestartSec=5
WatchdogSec=60

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 2

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo -e "${GREEN}✅ OpenClaw Virtual Office is running!${NC}"
  echo ""
  echo -e "  🌐 Open in browser: ${CYAN}http://localhost:${PORT}${NC}"
  echo ""
  echo "Useful commands:"
  echo "  sudo systemctl status $SERVICE_NAME    # Check status"
  echo "  sudo systemctl restart $SERVICE_NAME   # Restart"
  echo "  sudo journalctl -u $SERVICE_NAME -f    # View logs"
  echo ""
else
  echo -e "${RED}❌ Service failed to start. Check logs:${NC}"
  echo "  sudo journalctl -u $SERVICE_NAME -n 30"
  exit 1
fi
}

# ─── Update mode ──────────────────────────────────────────────
do_update() {
  [ -d "$INSTALL_DIR" ] || { echo -e "${RED}❌ Not installed. Run without --update first.${NC}"; exit 1; }
  echo -e "${CYAN}🔄 Updating OpenClaw Virtual Office...${NC}"
  git -C "$INSTALL_DIR" pull
  (cd "$INSTALL_DIR" && npm install --silent && npm run build)
  (cd "$INSTALL_DIR/server" && npm install --silent && npm run build)
  sudo systemctl restart "$SERVICE_NAME"
  echo -e "${GREEN}✅ Updated and restarted!${NC}"
}

# ─── Docker mode ──────────────────────────────────────────────
do_docker() {
  command -v docker &>/dev/null || { echo -e "${RED}❌ Docker not found.${NC}"; exit 1; }

  # Clone/update repo
  if [ -d "$INSTALL_DIR" ]; then
    git -C "$INSTALL_DIR" pull --quiet
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi

  # Setup .env if missing
  if [ ! -f "$INSTALL_DIR/server/.env" ]; then
    cp "$INSTALL_DIR/server/.env.example" "$INSTALL_DIR/server/.env"
    echo -e "${YELLOW}⚠️  Fill in GATEWAY_TOKEN in $INSTALL_DIR/server/.env${NC}"
  fi

  # Auto-detect token
  if [ -f "$HOME/.openclaw/openclaw.json" ] && command -v python3 &>/dev/null; then
    TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d.get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null)
    PORT_VAL=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d.get('gateway',{}).get('port',18789))" 2>/dev/null)
    if [ -n "$TOKEN" ]; then
      sed -i "s|^GATEWAY_TOKEN=.*|GATEWAY_TOKEN=$TOKEN|" "$INSTALL_DIR/server/.env"
      sed -i "s|^GATEWAY_URL=.*|GATEWAY_URL=http://host.docker.internal:$PORT_VAL|" "$INSTALL_DIR/server/.env"
      echo -e "${GREEN}✅ Gateway token auto-detected${NC}"
    fi
  fi

  cd "$INSTALL_DIR"
  docker compose up -d --build
  echo -e "${GREEN}✅ Running! → http://localhost:3001${NC}"
}

# ─── Uninstall mode ───────────────────────────────────────────
do_uninstall() {
  echo -e "${YELLOW}⚠️  Uninstalling OpenClaw Virtual Office...${NC}"
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  echo -e "${GREEN}✅ Service removed. Data at $INSTALL_DIR is kept.${NC}"
  echo "To remove data: rm -rf $INSTALL_DIR"
}

# ─── Main ─────────────────────────────────────────────────────
case "$MODE" in
  update)    do_update ;;
  docker)    do_docker ;;
  uninstall) do_uninstall ;;
  install)   do_install ;;
esac
