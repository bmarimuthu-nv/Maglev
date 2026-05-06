<p align="center">
  <img src="docs/public/logo.svg" alt="maglev" width="200">
</p>

<h1 align="center">maglev</h1>

<p align="center">Bringing terminals, file browsing, and local code review to the browser.</p>

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
curl -fsSL https://github.com/bmarimuthu-nv/Maglev/releases/latest/download/install.sh | MAGLEV_VERSION="v0.16.5" sh
```

If `maglev` is not found after install:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Main Features

- Persistent session list that survives browser disconnects and Maglev backend restarts.
- Auto-connect browser sessions back to running terminals when the page or backend reconnects.
- Auto-respawn terminals when the Maglev backend restarts, with optional per-terminal startup commands.
- Code diff and review views for inspecting changes and leaving comments.
- File browser support for each session, including sessions running inside worktrees.
- Worktree support for creating isolated coding sessions from the web UI.

## User Workflows

Pick the setup that matches where your sessions will run:

| Use case | Best fit | Open the UI from |
|----------|----------|------------------|
| Local laptop or devbox | Hub and sessions on the same machine | The URL printed by `maglev hub start` |
| SSH workstation | Hub on the remote machine, browser through an SSH tunnel | The forwarded URL on your laptop |
| Slurm/HPC node | Server on a reachable login/VNC node, hub inside the allocation | The URL printed by `maglev hub start --remote` |

<details>
<summary><strong>Local</strong></summary>

Use this when your browser and coding sessions run on the same machine.

```bash
maglev hub start --name local
```

Open the printed URL. The port is auto-picked; pin it only if you want a stable URL:

```bash
maglev hub start --name local --port 3006
```

Create sessions from the web UI. `maglev hub start` also starts the matching runner.

</details>

<details>
<summary><strong>SSH Workstation</strong></summary>

Use this when Maglev runs on a remote workstation and your browser reaches it through SSH.

On the remote workstation:

```bash
maglev hub start --name devbox --host 127.0.0.1
```

On your laptop, forward the printed port. Example, if the hub prints `http://127.0.0.1:43891`:

```bash
ssh -L 43891:127.0.0.1:43891 user@devbox
```

Then open `http://localhost:43891`.

For a stable tunnel command, pin the remote hub port:

```bash
maglev hub start --name devbox --host 127.0.0.1 --port 3006
ssh -L 3006:127.0.0.1:3006 user@devbox
```

</details>

<details>
<summary><strong>Slurm / HPC</strong></summary>

Use this when sessions run on allocated nodes that your browser cannot reach directly.

Assumption: the login node and Slurm node/container share the same home directory. At minimum, share `~/.maglev`, because the server writes connection and auth state there.

On the stable login, VNC, or jump node:

```bash
maglev auth github login
maglev server service install --port <some port> --public-url http://<login-or-vnc-host>:<some port>
```

If you later change the server port or public URL:

```bash
maglev server service restart --port <some port> --public-url http://<login-or-vnc-host>:<some port>
```

Inside the Slurm allocation:

```bash
maglev hub start --name "<custom_name>" --remote
```

Open the URL printed by `maglev hub start --remote`. If `~/.maglev/server-url` already contains the right server URL, you can omit `--server-url`.

</details>

## More Docs

- [Quick Start](docs/guide/quick-start.md)
- [Installation](docs/guide/installation.md)
- [How it Works](docs/guide/how-it-works.md)
- [App](docs/guide/pwa.md)
- [Why Maglev](docs/guide/why-maglev.md)
- [FAQ](docs/guide/faq.md)
