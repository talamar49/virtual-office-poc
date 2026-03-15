#!/usr/bin/env bash
set -e

# OpenClaw Virtual Office — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/openclaw/virtual-office/main/install.sh | bash

REPO_URL="https://github.com/openclaw/virtual-office.git"
INSTALL_DIR="$HOME/virtual-office"
SERVICE_NAME="virtual-office"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}🏢 OpenClaw Virtual Office — Installer${NC}"
echo "========================================"
echo ""

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
