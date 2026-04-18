# Installation

Install the Maglev CLI and set up the hub.

## Prerequisites

- `git`
- `bun`
- access to the GitLab repo
- `ripgrep` (`rg`) on `PATH`, or set `MAGLEV_RIPGREP_PATH`
- `difftastic` (`difft`) on `PATH`, or set `MAGLEV_DIFFTASTIC_PATH`

## Architecture

Maglev has three pieces:

| Component | Role | Required |
|-----------|------|----------|
| CLI | Starts shell sessions and registers machines | Yes |
| Hub | Persistence, realtime sync, files, review, remote access | Yes |
| Runner | Lets the web app spawn shells remotely | Optional |

Typical workflows:

- **Local only**: `maglev hub` then `maglev shell`
- **Remote access**: `maglev server` then `maglev hub --remote`
- **Remote spawn**: add `maglev runner start`

## Install the CLI

```bash
git clone https://github.com/bmarimuthu-nv/Maglev.git maglev
cd maglev
./install.sh
```

`install.sh` installs `maglev` to `$HOME/.local/bin/maglev` by default.

To change the install directory:

```bash
MAGLEV_INSTALL_DIR="$HOME/.local/bin" ./install.sh
```

## Hub Setup

### Remote mode

```bash
maglev server
maglev auth github login
maglev hub --remote
```

The broker:

- stores state under `~/.maglev/`
- writes its public URL to `~/.maglev/broker-url`
- stores the registration key in `~/.maglev/broker-key`

The hub:

- reads `~/.maglev/broker-url` automatically unless overridden
- prints the browser URL after registration
- uses GitHub device auth for browser sign-in

### Local only

```bash
maglev hub
```

Default URL:

```text
http://localhost:3006
```

On first run Maglev:

1. Creates `~/.maglev/`
2. Generates a CLI token
3. Saves it to `~/.maglev/settings.json`

## Runner Setup

Start the runner if you want the web app to spawn shells:

```bash
maglev runner start
```

The runner keeps a local control server plus a list of tracked shell sessions.

## Storage Layout

```text
~/.maglev/
├── settings.json
├── maglev.db
├── runner.state.json
└── logs/
```

## Common Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAGLEV_API_TOKEN` | Auto-generated | Shared secret for CLI auth and local manual browser login |
| `MAGLEV_API_URL` | `http://localhost:3006` | Hub URL for CLI connections |
| `MAGLEV_LISTEN_HOST` | `127.0.0.1` | Hub bind address |
| `MAGLEV_LISTEN_PORT` | `3006` | Hub port |
| `MAGLEV_PUBLIC_URL` | - | Public HTTPS URL |
| `CORS_ORIGINS` | - | Allowed browser origins |
| `MAGLEV_HOME` | `~/.maglev` | Config directory |
| `DB_PATH` | `~/.maglev/maglev.db` | Database file |
| `TELEGRAM_BOT_TOKEN` | - | Telegram bot token |

## CLI Setup for a Remote Hub

If the hub is not on localhost:

```bash
export MAGLEV_API_URL="http://your-hub:3006"
export MAGLEV_API_TOKEN="your-token"
```

Or use interactive login:

```bash
maglev auth login
```

## Service Management

Linux user services:

```bash
maglev server service install
maglev hub service install
```

Named hub daemons:

```bash
maglev hub start --name devbox-a --remote
maglev hub status --name devbox-a
maglev hub logs --name devbox-a --follow
```

## Notes

- `maglev server` runs the remote broker for coordinating hubs across machines
- browser access is terminal-first; sessions are shells, not chat agents
- files and review continue to work for shell sessions
