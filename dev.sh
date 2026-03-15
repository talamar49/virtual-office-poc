#!/bin/bash
# Dev mode — stops systemd service, runs Vite + backend with hot reload
sudo systemctl stop virtual-office
echo "⏹ systemd service stopped"

# Backend with hot reload
cd /home/tal/projects/virtual-office-poc/server
npx tsx watch --env-file=.env src/index.ts &
BACKEND_PID=$!
echo "🔧 Backend (tsx watch) PID: $BACKEND_PID"

# Frontend with HMR
cd /home/tal/projects/virtual-office-poc
npx vite --host --port 18000 &
FRONTEND_PID=$!
echo "🎨 Frontend (vite) PID: $FRONTEND_PID"

echo ""
echo "🏢 Dev mode running:"
echo "   Frontend: http://localhost:18000"
echo "   Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop and restart systemd service"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; sudo systemctl start virtual-office; echo '✅ systemd service restarted'" EXIT
wait
