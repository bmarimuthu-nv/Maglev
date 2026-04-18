# maglev

Run shell sessions locally and control them remotely through the web app, PWA, or Telegram Mini App.

> **Why maglev?** maglev is a local-first alternative to Happy. See [Why Not Happy?](docs/guide/why-maglev.md) for the architectural differences.

## Features

- **Terminal-first** - Every session is a shell session.
- **Remote terminal access** - Reconnect from your browser or phone without losing the running shell.
- **Files and review** - Browse files, inspect diffs, and review changes remotely.
- **Runner support** - Spawn shell sessions remotely on connected machines.
- **Self-hosted remote access** - Broker + hub flow; no hosted relay app required.

## Getting Started

Install:

```bash
git clone https://github.com/bmarimuthu-nv/Maglev.git maglev
cd maglev
./install.sh
```

Set up remote access once:

```bash
maglev server
maglev auth github login
```

Start the hub:

```bash
maglev hub --remote
```

Start a shell session:

```bash
maglev shell
```

For Linux user services:

```bash
maglev server service install
maglev hub service install
```

For named hub daemons in containers or non-systemd environments:

```bash
maglev hub start --name devbox-a --remote
maglev hub status --name devbox-a
maglev hub logs --name devbox-a --follow
maglev hub list
```

For HPC/Slurm:

- run `maglev server` on the stable login node
- run `maglev auth github login` once as the same user
- run `maglev hub --remote` inside the job
- broker state and auth live under `~/.maglev/`

Requirements:

- `git`
- `bun`
- access to the GitLab repo
- `ripgrep` (`rg`) on `PATH`, or set `MAGLEV_RIPGREP_PATH`
- `difftastic` (`difft`) on `PATH`, or set `MAGLEV_DIFFTASTIC_PATH`

## Docs

- [Quick Start](docs/guide/quick-start.md)
- [Installation](docs/guide/installation.md)
- [How it Works](docs/guide/how-it-works.md)
- [App](docs/guide/pwa.md)
- [Why Maglev](docs/guide/why-maglev.md)
- [FAQ](docs/guide/faq.md)

## Build from Source

```bash
bun install
bun run build:standalone
```

Build and install in one step:

```bash
./build_and_install.sh
```

Both install scripts default to `$HOME/.local/bin`. Override with `MAGLEV_INSTALL_DIR` to install elsewhere.

## Credits

Maglev takes its name from "哈皮", a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
