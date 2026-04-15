# maglev-hub

HTTP API, realtime sync, persistence, and optional Telegram integrations for shell sessions.

## What It Does

- Serves the web app from `web/dist` or embedded assets.
- Stores sessions and machines in SQLite.
- Streams live updates to web clients.
- Maintains the CLI Socket.IO channel.
- Handles remote spawning, permissions, files, review, and Telegram.

## Configuration

### Required

- `MAGLEV_API_TOKEN` - Shared secret used by CLI auth and local manual browser login. Auto-generated on first run if unset.

### Optional

- `MAGLEV_LISTEN_HOST` - HTTP bind address. Default `127.0.0.1`
- `MAGLEV_LISTEN_PORT` - HTTP port. Default `3006`
- `MAGLEV_PUBLIC_URL` - Public HTTPS URL for Telegram Mini App and browser access
- `MAGLEV_HOME` - Data directory. Default `~/.maglev`
- `DB_PATH` - SQLite database path. Default `MAGLEV_HOME/maglev.db`
- `CORS_ORIGINS` - Comma-separated origins or `*`
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_NOTIFICATION` - Enable or disable Telegram notifications
## Running

Binary:

```bash
export MAGLEV_API_TOKEN="shared-secret"
maglev hub
```

Remote mode:

```bash
maglev broker
maglev auth github login
maglev hub --remote
```

From source:

```bash
bun install
bun run dev:hub
```

## HTTP API

### Auth

- `POST /api/auth`
- `POST /api/bind`

### Sessions

- `GET /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/abort`
- `POST /api/sessions/:id/switch`
- `POST /api/sessions/:id/resume`
- `POST /api/sessions/:id/archive`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/permission-mode`
- `POST /api/sessions/:id/model`
- `POST /api/sessions/:id/upload`
- `POST /api/sessions/:id/upload/delete`

### Permissions

- `POST /api/sessions/:id/permissions/:requestId/approve`
- `POST /api/sessions/:id/permissions/:requestId/deny`

### Machines

- `GET /api/machines`
- `POST /api/machines/:id/spawn`
- `POST /api/machines/:id/paths/exists`

### Files and Git

- `GET /api/sessions/:id/git-status`
- `GET /api/sessions/:id/git-diff-numstat`
- `GET /api/sessions/:id/git-diff-file`
- `GET /api/sessions/:id/file`
- `GET /api/sessions/:id/files`

### Events

- `GET /api/events`
- `POST /api/visibility`

### Push

- `GET /api/push/vapid-public-key`
- `POST /api/push/subscribe`
- `DELETE /api/push/subscribe`

## Realtime

### CLI to hub

- `update-metadata`
- `update-state`
- `session-alive`
- `session-end`
- `machine-alive`
- `rpc-register`
- `rpc-unregister`

### Web terminal

- `terminal:create`
- `terminal:write`
- `terminal:resize`
- `terminal:close`

### Hub broadcasts

- `update`
- `rpc-request`

## Storage

- Sessions with metadata and permission state
- Machines with runner state
- Telegram user bindings by namespace

## Source Structure

- `src/web/` - HTTP routes
- `src/socket/` - Socket.IO setup and handlers
- `src/telegram/` - Telegram bot
- `src/sync/` - Core session and machine logic
- `src/store/` - SQLite persistence
- `src/sse/` - SSE manager
- `src/notifications/` - Push and Telegram notifications
