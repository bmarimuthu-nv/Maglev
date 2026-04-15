# maglev-web

React PWA for monitoring and controlling shell sessions.

## What It Does

- Session list with status, path, and pending approvals.
- Terminal-first session view.
- File browser and diff review.
- Remote shell spawning on connected machines.

## Routes

- `/` - Redirect to `/sessions`
- `/sessions` - Session list
- `/sessions/$sessionId` - Terminal-first session view
- `/sessions/new` - Create new shell session
- `/sessions/$sessionId/files` - File browser
- `/sessions/$sessionId/file` - File viewer with diff support
- `/sessions/$sessionId/terminal` - Terminal view
- `/settings` - Application settings

## Runtime Behavior

- In Telegram, auth uses Telegram WebApp init data.
- In a normal browser, log in with `MAGLEV_API_TOKEN[:namespace]`.
- Live updates come from the hub through SSE.

## Core Features

### Session list

- Active/inactive state
- Shell path and host metadata
- Pending permission count
- Pinned and startup-command state when available

### Terminal

- Remote shell via xterm.js
- Real-time Socket.IO transport
- Resize and reconnect handling

### Files and Review

- Git status
- File search
- File viewer with staged/unstaged diffs

### New session

- Machine selector
- Directory input
- Session type selection (`simple` or `worktree`)
- Optional pinning, auto-respawn, and startup command

## Data Flow

- REST for actions such as spawn, approve, rename, and file reads
- SSE for session and machine updates
- Socket.IO for terminal traffic

## Stack

React 19 + Vite + TanStack Router/Query + Tailwind + xterm.js + socket.io-client + workbox + shiki

## Development

From the repo root:

```bash
bun install
bun run dev:web
```

## Build

```bash
bun run build:web
```

The built assets land in `web/dist` and are served by the hub or embedded in the standalone binary.
