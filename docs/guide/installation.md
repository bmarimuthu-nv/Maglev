# Installation

Install the Maglev CLI and set up the hub.

## Prerequisites

For prebuilt release install:

- `curl` or `wget`
- `tar` for macOS/Linux, or `unzip` for Windows from Git Bash/MSYS

For source builds:

- `git`
- `bun`

Optional but recommended:

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

## Install The CLI

Fast path: install the latest prebuilt release for your machine.

```bash
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | sh
maglev --version
```

The release installer detects:

- macOS Intel and Apple Silicon
- Linux x64 and arm64
- Linux glibc and musl
- Windows x64 from Git Bash/MSYS

It installs to `$HOME/.local/bin/maglev` by default.

To change the install directory:

```bash
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | MAGLEV_INSTALL_DIR="$HOME/bin" sh
```

To install a specific release tag:

```bash
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | MAGLEV_VERSION="v0.16.5" sh
```

If `maglev` is not found after install:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Build From Source

Use this path when working from a checkout, testing unreleased changes, or using a platform without a release artifact.

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

The server:

- stores state under `~/.maglev/`
- writes its public URL to `~/.maglev/server-url`
- stores the registration key in `~/.maglev/server-key`

The hub:

- reads `~/.maglev/server-url` automatically unless overridden
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
| `MAGLEV_SERVER_URL` | `~/.maglev/server-url` | Remote access server URL for `maglev hub --remote` |
| `MAGLEV_SERVER_TOKEN` | `~/.maglev/server-key` | Optional hub registration token override |
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

- `maglev server` runs the remote access server for coordinating hubs across machines
- browser access is terminal-first; sessions are shells, not chat agents
- files and review continue to work for shell sessions
