#!/usr/bin/env bash
# Virtual Office Health Check
# שחר 🛡 — Infrastructure Monitor
# Usage: ./health-check.sh [--json]

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

JSON_MODE=false
[[ "$1" == "--json" ]] && JSON_MODE=true

ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; }
info() { echo -e "${CYAN}ℹ️  $*${NC}"; }

check_port() {
  local name=$1 port=$2
  if ss -tlnp | grep -q ":${port} "; then
    ok "$name — port $port LISTENING"
    return 0
  else
    err "$name — port $port NOT LISTENING"
    return 1
  fi
}

check_http() {
  local name=$1 url=$2
  local code
  code=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [[ "$code" == "200" ]]; then
    ok "$name — HTTP $code"
    return 0
  else
    err "$name — HTTP $code (expected 200)"
    return 1
  fi
}

check_health_json() {
  local url=$1
  local resp
  resp=$(curl -s --max-time 5 "$url" 2>/dev/null)
  if [[ -n "$resp" ]]; then
    ok "Backend /api/proxy/health — responded"
    echo "     Response: $resp" | head -c 200
    echo
    return 0
  else
    err "Backend /api/proxy/health — no response"
    return 1
  fi
}

get_resource_usage() {
  local pid
  pid=$(ss -tlnp | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1)
  if [[ -z "$pid" ]]; then
    echo "N/A"
    return
  fi
  local cpu mem rss
  cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
  mem=$(ps -p "$pid" -o %mem= 2>/dev/null | tr -d ' ')
  rss=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.0fMB", $1/1024}')
  echo "PID=$pid CPU=${cpu}% MEM=${mem}% RSS=${rss}"
}

log_errors() {
  local logfile=$1 name=$2
  if [[ ! -f "$logfile" ]]; then
    warn "$name — log file not found: $logfile"
    return
  fi
  local errors
  errors=$(grep -ciE 'error|fail|crash' "$logfile" 2>/dev/null)
  [[ -z "$errors" ]] && errors=0
  local recent_errors
  recent_errors=$(tail -100 "$logfile" | grep -iE 'error|fail|crash' | tail -3)
  if [[ "$errors" -gt 0 && -n "$recent_errors" ]]; then
    warn "$name — $errors error lines in log"
    echo "$recent_errors" | while read -r line; do echo "     └─ $line"; done
  else
    ok "$name — log clean (no errors)"
  fi
}

# ─── MAIN ──────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🛡 Virtual Office — Health Check"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "【 SERVICES 】"
FRONTEND_UP=false; BACKEND_UP=false; GATEWAY_UP=false

check_port "Frontend  (Vite)"    18000 && FRONTEND_UP=true
check_port "Backend   (Node)"    3001  && BACKEND_UP=true
check_port "Gateway   (OpenClaw)" 18789 && GATEWAY_UP=true

echo ""
echo "【 HTTP HEALTH 】"
$FRONTEND_UP && check_http "Frontend  " "http://localhost:18000"      || err "Frontend — skipped (port down)"
$BACKEND_UP  && check_health_json "http://localhost:3001/api/proxy/health" || err "Backend  — skipped (port down)"
$GATEWAY_UP  && check_http "Gateway   " "http://localhost:18789"      || err "Gateway  — skipped (port down)"

echo ""
echo "【 RESOURCE USAGE 】"
info "Frontend  (port 18000): $(get_resource_usage 18000)"
info "Backend   (port 3001):  $(get_resource_usage 3001)"
info "Gateway   (port 18789): $(get_resource_usage 18789)"

echo ""
echo "【 SYSTEM MEMORY 】"
free -h | awk '/Mem:/ {printf "  Total: %s | Used: %s | Free: %s | Available: %s\n", $2, $3, $4, $7}'

echo ""
echo "【 LOGS 】"
log_errors "/tmp/vo-frontend.log" "Frontend log"
log_errors "/tmp/vo-server.log"   "Server log"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Summary
ISSUES=0
$FRONTEND_UP || ISSUES=$((ISSUES+1))
$BACKEND_UP  || ISSUES=$((ISSUES+1))
$GATEWAY_UP  || ISSUES=$((ISSUES+1))

if [[ $ISSUES -eq 0 ]]; then
  echo -e "${GREEN}  ✅ All services UP${NC}"
elif [[ $ISSUES -lt 3 ]]; then
  echo -e "${YELLOW}  ⚠️  $ISSUES service(s) DOWN — check above${NC}"
else
  echo -e "${RED}  ❌ All services DOWN${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit $ISSUES
