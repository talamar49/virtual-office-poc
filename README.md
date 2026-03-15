# 🏢 OpenClaw Virtual Office

A real-time, isometric virtual office that brings your AI agent team to life. Watch your OpenClaw agents move, work, and chat — all in a pixel-art office environment.

> Built for [OpenClaw](https://openclaw.ai) — works with any OpenClaw Gateway.

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

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/talamar49/virtual-office-poc.git
cd virtual-office-poc
```

### 2. Install dependencies

```bash
npm install
cd server && npm install && cd ..
```

### 3. Configure Gateway

Copy the example env file for the server:

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=your_gateway_token_here
PORT=3001
```

**How to get your Gateway Token:**

```bash
# Option 1: OpenClaw CLI
openclaw gateway status

# Option 2: Check config directly
cat ~/.openclaw/openclaw.json | grep -A5 '"auth"'
```

The token is the value of `auth.token` in the `gateway` section.

**Gateway URL** — defaults to `http://127.0.0.1:18789`. Change if your Gateway runs on a different host/port (e.g., remote server or Tailscale).

### 4. Run in development mode

```bash
npm run dev
```

This starts:
- **Frontend** (Vite + React) → http://localhost:3000
- **Backend** (Express + WebSocket) → http://localhost:3001

Open http://localhost:3000 in your browser.

---

## 🏭 Production Setup

### Build

```bash
npm run build        # Frontend → dist/
cd server && npm run build  # Backend → server/dist/
```

### Run with systemd

Create `/etc/systemd/system/virtual-office.service`:

```ini
[Unit]
Description=OpenClaw Virtual Office Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/virtual-office-poc/server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/path/to/virtual-office-poc/server/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable virtual-office
sudo systemctl start virtual-office
```

Serve the frontend `dist/` folder with nginx or any static file server.

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

---

## ⚙️ Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway URL |
| `GATEWAY_TOKEN` | *(required)* | Gateway auth token |
| `PORT` | `3001` | Backend server port |
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
- Keep canvas rendering logic in `App.tsx`
- Keep Gateway calls in `server/src/services/gateway-client.ts`

---

## 📄 License

MIT — free to use, modify, and distribute.

---

*Built with ❤️ by the OpenClaw team.*
