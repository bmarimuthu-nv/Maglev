# maglev

Run AI coding sessions locally and control them remotely from your browser or phone.

## Features

- **Terminal-first** — Every session is a shell wrapping an AI agent (Claude Code, Codex, Gemini).
- **Remote access** — Reconnect from your browser or phone without losing the running shell.
- **Files and review** — Browse files, inspect diffs, and review changes remotely.
- **Runner support** — Spawn sessions remotely on connected machines.
- **Self-hosted** — No hosted relay required. Run everything on your own machines.

## Quick Start

### Install

```bash
git clone https://github.com/bmarimuthu-nv/Maglev.git maglev
cd maglev
./install.sh
```

### Local use (single machine)

```bash
maglev hub start        # start the hub (uses hostname as name, runs in background)
maglev shell            # start an AI session connected to the hub
```

That's it. Open the web UI at `http://localhost:3006` to monitor sessions remotely.

### Remote access (across machines)

For accessing hubs behind firewalls or on ephemeral nodes (e.g., HPC/Slurm jobs):

```bash
# On a stable, reachable machine (login node):
maglev server                    # run the relay server
maglev auth github login         # authenticate once

# On the compute node:
maglev hub start --remote        # hub registers with the relay
maglev shell                     # start a session
```

The relay proxies traffic so your browser/phone can reach hubs that aren't directly accessible.

### Managing hubs

```bash
maglev hub status       # check if hub is running
maglev hub logs -f      # tail hub logs
maglev hub stop         # stop the hub
maglev hub list         # list all hub daemons
```

### Linux systemd services (optional)

For persistent background services that survive logouts:

```bash
maglev hub service install       # hub as systemd user service
maglev server service install    # relay as systemd user service
```

## Commands

| Command | Purpose |
|---------|---------|
| `maglev shell` | Start an AI coding session (default command) |
| `maglev hub start\|stop\|status\|logs\|list` | Manage the hub daemon |
| `maglev server` | Run the relay server for remote access |
| `maglev auth login\|logout\|status` | Manage API token |
| `maglev auth github login\|logout` | GitHub OAuth for remote access |
| `maglev runner start\|stop\|status\|list` | Manage the background runner |
| `maglev doctor [clean]` | Diagnostics and cleanup |

## Requirements

- `git`
- `bun`
- `ripgrep` (`rg`) on `PATH`, or set `MAGLEV_RIPGREP_PATH`
- `difftastic` (`difft`) on `PATH`, or set `MAGLEV_DIFFTASTIC_PATH`

## Build from Source

```bash
bun install
bun run build:standalone
```

Or build and install in one step:

```bash
./build_and_install.sh
```

Both install scripts default to `$HOME/.local/bin`. Override with `MAGLEV_INSTALL_DIR`.

## Docs

- [Quick Start](docs/guide/quick-start.md)
- [Installation](docs/guide/installation.md)
- [How it Works](docs/guide/how-it-works.md)
- [App](docs/guide/pwa.md)
- [Why Maglev](docs/guide/why-maglev.md)
- [FAQ](docs/guide/faq.md)
