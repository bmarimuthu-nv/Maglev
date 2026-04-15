# maglev CLI

Shell-first CLI for starting local shell sessions and exposing them through the hub.

## What It Does

- Starts shell sessions and registers them with the hub.
- Manages auth and machine registration.
- Runs the background runner for remote shell spawning.
- Includes diagnostics plus bundled `hub` and `broker` commands.

## Typical Flow

1. Start the hub with `maglev hub --remote`.
2. Authenticate with `maglev auth github login` if you plan to use broker-based remote access.
3. Start a shell session with `maglev shell`.
4. Reconnect from the web app or phone.

## Commands

### Shell

- `maglev shell` - Start a shell session.
- `maglev shell --started-by runner` - Internal runner launch path.

### Authentication

- `maglev auth status`
- `maglev auth login`
- `maglev auth logout`

### Runner

- `maglev runner start`
- `maglev runner stop`
- `maglev runner status`
- `maglev runner list`
- `maglev runner stop-session <sessionId>`
- `maglev runner logs`

### Hub and Broker

- `maglev hub`
- `maglev hub start|stop|restart|status|logs|list`
- `maglev hub service install|start|stop|restart|status|logs|uninstall`
- `maglev broker`
- `maglev broker hubs`
- `maglev broker service install|start|stop|restart|status|logs|uninstall`

### Diagnostics

- `maglev doctor`
- `maglev doctor clean`

## Configuration

See `src/configuration.ts` for the full set.

### Required

- `MAGLEV_API_TOKEN` - Shared secret; must match the hub. Can be set via env or `~/.maglev/settings.json`.
- `MAGLEV_API_URL` - Hub base URL. Defaults to `http://localhost:3006`.

### Optional

- `MAGLEV_HOME` - Config/data directory. Defaults to `~/.maglev`.
- `MAGLEV_EXPERIMENTAL` - Enable experimental features.
- `MAGLEV_RUNNER_HEARTBEAT_INTERVAL` - Runner heartbeat interval in ms.
- `MAGLEV_RUNNER_HTTP_TIMEOUT` - Runner control timeout in ms.

## Storage

Data is stored in `~/.maglev/` unless `MAGLEV_HOME` overrides it:

- `settings.json` - User settings and token
- `runner.state.json` - Runner state
- `logs/` - CLI and runner logs

## Source Structure

- `src/api/` - Hub communication
- `src/shell/` - Shell session startup
- `src/runner/` - Background runner
- `src/commands/` - CLI command handlers
- `src/ui/` - Auth, doctor, terminal-facing helpers
- `src/modules/` - Tool helpers such as git, ripgrep, difftastic

## Related Docs

- `../hub/README.md`
- `../web/README.md`
