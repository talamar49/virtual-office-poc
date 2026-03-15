# Service Setup

## Prerequisites

1. Create `server/.env` from the example:
   ```bash
   cp server/.env.example server/.env
   # Edit server/.env with your actual GATEWAY_TOKEN and GATEWAY_URL
   ```

2. Build the project:
   ```bash
   npm ci && npm run build
   cd server && npm ci && npm run build
   ```

## Install Services

The service files use systemd specifiers:
- `%i` — instance name (your username, passed via `@` syntax)
- `%h` — home directory of the specified user

### Production
```bash
# Copy and enable (replace YOUR_USER with your username)
sudo cp virtual-office.service /etc/systemd/system/virtual-office@.service
sudo systemctl daemon-reload
sudo systemctl enable --now virtual-office@YOUR_USER
```

### Development
```bash
sudo cp virtual-office-dev.service /etc/systemd/system/virtual-office-dev@.service
sudo systemctl daemon-reload
sudo systemctl start virtual-office-dev@YOUR_USER
```

## Environment Variables

The production service reads from `server/.env`. Required vars:
- `GATEWAY_URL` — OpenClaw gateway URL
- `GATEWAY_TOKEN` — OpenClaw gateway token

**Never commit `.env` files or tokens to git!**
