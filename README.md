<p align="center">
  <img src="docs/public/logo.svg" alt="maglev" width="200">
</p>

<h1 align="center">maglev</h1>

<p align="center">Run AI coding sessions locally, then control them from your browser or phone.</p>

## Start Here

Pick the setup that matches where your sessions will run:

| Use case | Best fit | Open the UI from |
|----------|----------|------------------|
| Local laptop or devbox | Hub and sessions on the same machine | The URL printed by `maglev hub start` |
| SSH workstation | Hub on the remote machine, browser through an SSH tunnel | The forwarded URL on your laptop |
| Slurm/HPC node | Server on a reachable login/VNC node, hub inside the allocation | The URL printed by `maglev hub start --remote` |

## Direct vs Server Mode

Maglev does not guess whether your browser can reach a hub. You choose the mode when starting the hub.

Use direct mode when your browser can reach the hub URL directly, including through an SSH tunnel:

```bash
maglev hub start --name devbox
```

Use server mode when the hub runs somewhere your browser cannot reach directly, such as inside a Slurm allocation or container:

```bash
maglev hub start --name "slurm-${SLURM_JOB_ID:-manual}" --remote
```

In server mode, the hub still listens on a local port, but it also registers with `maglev server`. The server URL is discovered from `~/.maglev/server-url` written by `maglev server`, from saved settings, or from `--server-url <url>`.

## Install

Fast path: install the latest prebuilt release for your machine.

```bash
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | sh
maglev --version
```

The release installer detects macOS Intel/Apple Silicon, Linux x64/arm64, Linux glibc/musl, and Windows x64 from Git Bash/MSYS. It installs `maglev` to `$HOME/.local/bin` by default.

Common variants:

```bash
# Install somewhere else
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | MAGLEV_INSTALL_DIR="$HOME/bin" sh

# Install a specific release tag
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | MAGLEV_VERSION="v0.16.2" sh
```

If `maglev` is not found after install:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Build From Source

Use this path when working from a checkout, testing unreleased changes, or using a platform without a release artifact.

Prerequisites:

- `git`
- `bun`
- Optional but recommended: `rg` and `difft`

```bash
git clone https://github.com/bmarimuthu-nv/Maglev.git maglev
cd maglev
./install.sh
maglev --version
```

`./install.sh` builds the standalone binary from source and installs `maglev` to `$HOME/.local/bin`.

Common variants:

```bash
# Install somewhere else
MAGLEV_INSTALL_DIR="$HOME/bin" ./install.sh

# Force dependency reinstall before building
FORCE=1 ./install.sh

# Build only, without installing
bun install
bun run build:standalone
```

## Local Setup

Use this direct-mode setup when your browser and coding environment are on the same machine.

```bash
maglev hub start --name local
```

Open:

```text
The URL printed by `maglev hub start`.
```

By default, `maglev hub start` chooses a free local port to avoid conflicts. If you want the traditional fixed local URL, pin the port explicitly:

```bash
maglev hub start --name local --port 3006
```

Then open `http://localhost:3006`.

Create sessions from the web UI. `maglev hub start` also starts the local runner for that hub, so you do not need to run `maglev shell` or `maglev runner start` manually for the normal flow.

## SSH Setup

Use this direct-mode setup when Maglev runs on a remote workstation and your browser reaches it through an SSH tunnel.

On the remote workstation:

```bash
maglev hub start --name devbox --host 127.0.0.1
```

By default, the remote hub also chooses a free local port to avoid conflicts. Use the port printed by `maglev hub start` in your SSH tunnel. Example, if the hub prints `http://127.0.0.1:43891`:

On your laptop:

```bash
ssh -L 43891:127.0.0.1:43891 user@devbox
```

Then open this on your laptop:

```text
http://localhost:43891
```

If you prefer a stable tunnel command, pin the remote hub port:

```bash
maglev hub start --name devbox --host 127.0.0.1 --port 3006
```

Then forward `3006`:

```bash
ssh -L 3006:127.0.0.1:3006 user@devbox
```

Create sessions from the web UI after the runner appears in the machine list.

## Slurm / HPC Setup

Use this server-mode setup when sessions run on ephemeral compute nodes that your browser cannot reach directly.

Assumption: the login node and allocated Slurm node/container share the same home directory. At minimum, they must share `~/.maglev`. The server writes connection and auth state there, and `maglev hub start --remote` reads it inside the allocation. If your site gives jobs a different home directory, mount or bind the login node's `~/.maglev` into the job/container before starting the hub.

| Where | Run | Purpose |
|-------|-----|---------|
| Client laptop/browser | Open the URL printed by `maglev hub start --remote` | Use the web UI |
| Login, VNC, or jump node | `maglev server service install` | Keep the Maglev server reachable |
| Login, VNC, or jump node | `maglev auth github login` | Authenticate browser access once |
| Slurm node/container | `maglev hub start --name "slurm-${SLURM_JOB_ID:-manual}" --remote` | Start the hub and runner inside the allocation |

The default Linux setup is to run the server as a user service on the stable login/VNC/jump node:

```bash
maglev server service install
maglev auth github login
```

Then, inside the Slurm allocation:

```bash
srun --pty bash
maglev hub start --name "slurm-${SLURM_JOB_ID:-manual}" --remote
```

Open the URL printed by `maglev hub start --remote`.

If the browser cannot reach the server hostname, start the server with the public URL you actually use:

```bash
maglev server --public-url https://your-reachable-server.example
```

If Linux user services are not available on the login/VNC/jump node, keep `maglev server` running in a terminal or under your site's preferred process manager.

## Daily Commands

```bash
maglev hub status
maglev hub logs --follow
maglev hub stop

maglev runner status
maglev runner logs
maglev runner stop

maglev server hubs
```

## Services

For long-running Linux hosts, install services instead of keeping foreground terminals open:

```bash
maglev server service install
maglev hub service install
```

For named hubs:

```bash
maglev hub start --name devbox-a --remote
maglev hub status --name devbox-a
maglev hub logs --name devbox-a --follow
```

## Mental Model

- `maglev hub` stores session state and serves the web UI.
- `maglev hub start` starts the matching runner automatically.
- `maglev runner` lets the web UI create sessions on that machine; direct runner commands are mostly for status, logs, and troubleshooting.
- `maglev server` is the remote access entrypoint for machines your browser cannot reach directly.

## More Docs

- [Quick Start](docs/guide/quick-start.md)
- [Installation](docs/guide/installation.md)
- [How it Works](docs/guide/how-it-works.md)
- [App](docs/guide/pwa.md)
- [Why Maglev](docs/guide/why-maglev.md)
- [FAQ](docs/guide/faq.md)
