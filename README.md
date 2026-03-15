# 🏢 OpenClaw Virtual Office

A real-time, isometric virtual office that brings your AI agent team to life. Watch your OpenClaw agents move, work, and chat — all in a pixel-art office environment.

> Built for [OpenClaw](https://openclaw.ai) — works with any OpenClaw Gateway.

---

## ⚡ One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/talamar49/virtual-office-poc/main/install.sh | bash
```

The script will:
- Clone the repo
- Install all dependencies (frontend + server)
- Build for production
- Ask for your Gateway URL + Token
- Create and enable a systemd service (with auto-restart)
- Print the URL where your office is running

**Get your Gateway Token first:**
```bash
openclaw gateway status
```

---

## ✨ Features

- 🗺️ **Isometric pixel-art office** — agents sit at their desks, move around, and animate in real-time
- 👥 **Dynamic agent discovery** — automatically detects all active agents from your OpenClaw Gateway
- 💬 **Live chat** — send messages to any agent and see responses in the office
- 🎙️ **Voice recording** — record voice messages transcribed via whisper.cpp (optional)
- 📎 **File attachments** — attach files to agent messages
- 🌐 **i18n** — full Hebrew/English support with language toggle
- ⚡ **Real-time WebSocket updates** — agent status refreshes every 2 seconds
- 📱 **Responsive** — works on desktop, tablet, and mobile

---

## 📋 Prerequisites

- **Node.js 18+**
- **npm 9+**
- **OpenClaw Gateway** running (local or remote)
- *(Optional)* **whisper.cpp** for voice transcription

---

## 🚀 Manual Setup

### 1. Get your Gateway Token

```bash
# Option 1: OpenClaw CLI
openclaw gateway status

# Option 2: Check config directly
cat ~/.openclaw/openclaw.json | grep -A5 '"auth"'
```

The token is the value of `auth.token` in the `gateway` section.

### 2. Clone and install

```bash
git clone https://github.com/talamar49/virtual-office-poc.git
cd virtual-office-poc

npm install
cd server && npm install && cd ..
```

### 3. Configure Gateway

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=your_gateway_token_here
PORT=3001
```

### 4. Run in development mode

```bash
npm run dev
```

This starts:
- **Frontend** (Vite + React) → http://localhost:3000
- **Backend** (Express + WebSocket) → http://localhost:3001

Open http://localhost:3000 in your browser.

---

## 🛠️ CLI Tool (`vo`)

After installation, use the `vo` CLI to manage your Virtual Office:

```bash
# Install vo globally
sudo cp vo /usr/local/bin/vo && sudo chmod +x /usr/local/bin/vo
```

### Commands

| Command | Description |
|---------|-------------|
| `vo install` | Full installation (clone + build + systemd) |
| `vo update` | Pull latest version + rebuild + restart |
| `vo start` | Start the service |
| `vo stop` | Stop the service |
| `vo restart` | Restart the service |
| `vo status` | Show status, version, and config |
| `vo logs` | Tail live logs |
| `vo config show` | Show current configuration |
| `vo config set-token <token>` | Update Gateway token |
| `vo config set-url <url>` | Update Gateway URL |
| `vo config set-port <port>` | Update server port |

### Examples

```bash
# Check status
vo status

# Update to latest version
vo update

# Change Gateway token
vo config set-token your_new_token
vo restart

# Connect to a remote Gateway
vo config set-url http://192.168.1.5:18789
vo restart

# View live logs
vo logs
```

---

## 🏭 Production Setup

### Build

```bash
npm run build               # Frontend → dist/
cd server && npm run build  # Backend → server/dist/
```

### systemd service

The `install.sh` script sets this up automatically. To do it manually:

Create `/etc/systemd/system/virtual-office.service`:

```ini
[Unit]
Description=OpenClaw Virtual Office
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/virtual-office-poc/server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/path/to/virtual-office-poc/server/.env
Restart=always
RestartSec=5
WatchdogSec=60

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable virtual-office
sudo systemctl start virtual-office

# View logs
sudo journalctl -u virtual-office -f
```

---

## 🎙️ Voice Recording (Optional)

Voice messages are transcribed using [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

### Install whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
make

# Download a model (small is recommended)
bash ./models/download-ggml-model.sh small
```

### Configure

Add to `server/.env`:

```env
WHISPER_BIN=/path/to/whisper.cpp/main
WHISPER_MODEL=/path/to/whisper.cpp/models/ggml-small.bin
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│              Browser (Frontend)             │
│  React + HTML Canvas (isometric rendering)  │
│  Vite dev server / dist/ in production      │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket
┌──────────────────▼──────────────────────────┐
│           Backend (Express + WS)            │
│  Polls OpenClaw Gateway every 2s            │
│  Broadcasts agent status to all clients     │
│  Proxies chat messages to agents            │
│  Handles voice transcription (whisper.cpp)  │
└──────────────────┬──────────────────────────┘
                   │ HTTP (REST API)
┌──────────────────▼──────────────────────────┐
│          OpenClaw Gateway (:18789)          │
│  sessions_list — active agents + status     │
│  sessions_send — send message to agent      │
│  tools/invoke — generic tool invocation     │
└─────────────────────────────────────────────┘
```

**Key files:**

| Path | Description |
|------|-------------|
| `src/App.tsx` | Main React app + canvas rendering |
| `server/src/index.ts` | Express + WebSocket server |
| `server/src/services/gateway-client.ts` | OpenClaw Gateway API client |
| `server/src/routes/proxy.ts` | Chat proxy route |
| `public/assets/` | Pixel art sprites (characters, furniture, tiles) |
| `install.sh` | One-line installer with systemd setup |

---

## ⚙️ Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway URL |
| `GATEWAY_TOKEN` | *(required)* | Gateway auth token |
| `PORT` | `3001` | Backend server port |
| `STATIC_DIR` | *(optional)* | Serve frontend from server |
| `WHISPER_BIN` | *(optional)* | Path to whisper.cpp binary |
| `WHISPER_MODEL` | *(optional)* | Path to whisper model file |

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes + ensure build passes: `npm run build`
4. Open a Pull Request to `main`

**Code style:**
- TypeScript strict mode
- React functional components + hooks
- Keep canvas rendering logic in `src/App.tsx`
- Keep Gateway calls in `server/src/services/gateway-client.ts`

---

## 📄 License

MIT — free to use, modify, and distribute.

---

*Built with ❤️ by the OpenClaw team.*
