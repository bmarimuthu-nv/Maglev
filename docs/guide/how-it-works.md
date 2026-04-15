# How It Works

Maglev has three main pieces: the CLI, the hub, and the web app.

## Architecture Overview

```text
┌─────────┐  Socket.IO   ┌─────────┐   SSE/REST   ┌─────────┐
│   CLI   │ ──────────── │   Hub   │ ──────────── │   Web   │
│ (shell) │              │ (server)│              │  (PWA)  │
└─────────┘              └─────────┘              └─────────┘
     │                        │                        │
     ├─ runs shell            ├─ SQLite persistence    ├─ session list
     ├─ registers machine     ├─ RPC + terminal mux    ├─ terminal view
     └─ syncs session state   └─ files + permissions   └─ files + review
```

## Components

### CLI

The CLI starts shell sessions, registers them with the hub, and keeps metadata up to date.

Key commands:

```bash
maglev shell
maglev runner start
maglev auth login
```

### Hub

The hub is the central service:

- HTTP API for sessions, files, permissions, and machines
- Socket.IO for CLI connections and terminal traffic
- SSE for live web updates
- SQLite persistence for sessions and machines

### Web App

The web app is terminal-first:

- session list
- terminal reconnect
- file browser
- diff review
- remote shell spawn

## Session Flow

### Starting a Session

```text
1. User runs `maglev shell`
2. CLI registers the machine and session with the hub
3. Hub stores the session and emits an update
4. Web clients receive the update and show the session
5. Terminal attach happens on demand from the web app
```

### Permission Flow

```text
1. Shell-side tooling requests approval
2. CLI sends the request to the hub
3. Hub stores it and publishes updates
4. User approves or denies in the web app or Telegram
5. Hub relays the decision back to the session
```

### Remote Spawn Flow

```text
1. User opens the machine list in the web app
2. Web calls the hub spawn endpoint
3. Hub forwards the request to the runner on that machine
4. Runner starts `maglev shell --started-by runner`
5. New shell session appears in the UI
```

## Remote Access

Maglev supports:

- local-only use on `localhost`
- self-hosted remote access through the broker
- optional public exposure through your own tunnel or reverse proxy

In remote mode the broker handles hub registration and browser routing. The session itself still runs on your machine.

## Seamless Handoff

The important property is that the shell keeps running even when you leave the terminal:

- start locally
- reconnect from the browser or phone
- inspect files or diffs remotely
- return to the machine later and keep using the same shell
