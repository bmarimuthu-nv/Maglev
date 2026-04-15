# Maglev CLI Runner

The runner is a persistent background process that lets the web app spawn shell sessions on a connected machine.

## Responsibilities

- keeps a local control server alive
- registers spawn and stop RPC handlers with the hub
- launches `maglev shell --started-by runner`
- tracks child shell processes
- prunes dead sessions and refreshes runner state

## Lifecycle

### Start

```bash
maglev runner start
```

The runner:

1. acquires the lock file
2. creates machine auth if needed
3. starts the local control server
4. connects to the hub
5. registers spawn and stop handlers
6. writes `runner.state.json`

### Stop

```bash
maglev runner stop
```

The runner shuts down the control server, disconnects from the hub, and removes its state file.

## Spawn Flow

```text
Web app -> Hub RPC -> Runner -> maglev shell --started-by runner
```

The spawned session then registers itself with the hub and becomes visible in the UI.

## Control Server

The local control server exposes endpoints for:

- session-started webhook
- session listing
- session stop
- session spawn
- graceful runner shutdown

## State Files

Runner state lives under `~/.maglev/`:

- `runner.state.json`
- `runner.state.json.lock`
- `logs/`

## Notes

- the runner is shell-only
- remote spawn supports simple and worktree shell sessions
- pinned sessions and startup commands are handled by the runner path
