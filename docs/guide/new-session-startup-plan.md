# New Session Startup Plan

## Goal

Make a newly created shell session feel predictably alive.

Today the system has several real phases:

1. session record created
2. terminal backend prepared by CLI
3. shell metadata updated with `shellTerminalId` and `shellTerminalState`
4. web terminal socket attached
5. terminal textarea focused
6. user input routed successfully

The UI mostly treats those as one moment. The plan here is to make those phases explicit and reduce the gap between "session exists" and "session is interactive".

## Current Gap

Current success path:

1. `NewSession` calls `spawnSession(...)`
2. router immediately navigates to `/sessions/:id/terminal`
3. terminal page waits for metadata readiness
4. terminal page waits again for socket readiness
5. focus retries try to land on the terminal

That means the user can arrive on the terminal page before:

- `shellTerminalId` exists
- terminal socket is attached
- the terminal is focusable
- input is guaranteed to work

## Desired User Experience

For a fresh shell session:

1. user clicks `Create`
2. app navigates to the terminal route immediately
3. terminal route shows an explicit startup state
4. startup state advances through clear phases
5. once the terminal is ready, focus is handed off
6. only then does the terminal feel "live"

Target feel:

- no dead-looking terminal
- no hidden attach race
- no ambiguous input state
- no "click again to wake it up" feeling

## Design Model

Treat shell startup as a first-class state machine.

Recommended web-facing phases:

- `creating-session`
- `waiting-for-terminal-metadata`
- `attaching-terminal`
- `focusing-terminal`
- `ready`
- `failed`

These do not all need to be stored server-side initially. The first pass can derive them from existing session + socket state.

## Implementation Plan

### Phase 1: Add a startup state model in the terminal route

Files:

- `web/src/routes/sessions/terminal.tsx`
- `web/src/hooks/useTerminalSocket.ts`

Implement a derived startup state for newly spawned shell sessions.

Inputs:

- `hasPendingTerminalFocus(sessionId)`
- `session?.metadata?.shellTerminalId`
- `session?.metadata?.shellTerminalState`
- `terminalState.status`
- result of `focusTerminalIfAllowed()`

Derived states:

- `creating-session`
  - route loaded but session query still unresolved
- `waiting-for-terminal-metadata`
  - shell session exists, but `shellTerminalId` is still missing
- `attaching-terminal`
  - `shellTerminalId` exists, terminal socket not yet connected
- `focusing-terminal`
  - terminal is connected, pending focus still active
- `ready`
  - terminal connected and focus token cleared
- `failed`
  - terminal error state without takeover success

### Phase 2: Add an explicit startup surface

Files:

- `web/src/routes/sessions/terminal.tsx`
- optionally a new small component:
  - `web/src/components/Terminal/TerminalStartupState.tsx`

Show a lightweight status panel above or instead of the terminal canvas while startup is in progress.

Recommended copy:

- `Starting shell…`
- `Preparing terminal…`
- `Connecting to terminal…`
- `Focusing terminal…`

Recommended behavior:

- keep layout stable
- do not render the main terminal as "dead black space" with no explanation
- keep the status visible until `ready`

### Phase 3: Strengthen pending-focus ownership

Files:

- `web/src/lib/pending-terminal-focus.ts`
- `web/src/routes/sessions/terminal.tsx`
- `web/src/router.tsx`

Current behavior uses a sessionStorage token only.

Improve it by:

- storing a timestamp with the pending focus marker
- considering the marker valid only for a short TTL, e.g. 30 seconds
- clearing it on:
  - successful focus
  - explicit failure
  - session mismatch

This prevents stale focus intent from leaking across later revisits.

### Phase 4: Gate input on true readiness

Files:

- `web/src/routes/sessions/terminal.tsx`
- `web/src/hooks/useTerminalSocket.ts`

Today `write()` silently no-ops if the terminal socket is not connected.

Improve product behavior:

- disable quick input actions until startup state is `ready`
- disable text/paste affordances until `ready`
- optionally show a subtle "Terminal not ready yet" hint instead of silently ignoring writes

Important:

- do not try to queue arbitrary freeform input for later delivery in the first pass
- better to be explicit and safe than surprising

### Phase 5: Make readiness more visible in the session object

Files:

- `shared/src/schemas.ts`
- `shared/src/sessionSummary.ts`
- `cli/src/agent/sessionFactory.ts`
- `cli/src/shell/runShell.ts`

Optional but recommended second pass:

Add a clearer lifecycle marker for shell startup, for example:

- `lifecycleState: 'starting' | 'running' | 'archived'`
- or a shell-specific field:
  - `shellStartupState: 'booting' | 'ready' | 'stale'`

Then update CLI flow:

1. session created with startup state `booting`
2. shell terminal ensured
3. metadata updated to `ready`

This reduces inference in the web app and makes the lifecycle honest.

### Phase 6: Reduce terminal attach ambiguity

Files:

- `web/src/hooks/useTerminalSocket.ts`
- `web/src/routes/sessions/terminal.tsx`

Add a slightly stronger contract around attach:

- when `connect()` starts, reflect `attaching-terminal`
- when `terminal:ready` arrives, move to `connected`
- if `terminal:output` arrives before `terminal:ready`, still treat that as attached
- if `terminal:error` occurs during startup, surface a clear startup failure message

This keeps attach semantics deterministic from the UI perspective.

### Phase 7: Improve initial spawn-to-terminal navigation semantics

Files:

- `web/src/router.tsx`
- `web/src/components/NewSession/index.tsx`
- `web/src/hooks/mutations/useSpawnSession.ts`

Keep immediate navigation, but make it explicit that the destination is a startup route state rather than an already-live terminal.

No need to delay navigation.

The better model is:

- navigate immediately
- show startup progression honestly
- transition into a live terminal when ready

## Acceptance Criteria

- after creating a new shell session, the terminal page never looks dead or ambiguous
- users can tell whether the shell is:
  - being created
  - attaching
  - ready
  - failed
- terminal focus is reliably transferred once ready
- quick-input actions do not silently fail during startup
- stale pending-focus markers do not affect later revisits

## Recommended Order

1. terminal route startup state derivation
2. startup UI surface
3. pending-focus TTL/cleanup
4. input gating until ready
5. optional metadata-level startup field from CLI

## Testing Plan

Add focused tests for:

- `pending-terminal-focus.ts`
  - mark / clear / TTL behavior
- `terminal.tsx`
  - startup state rendering for:
    - waiting for metadata
    - attaching
    - connected but not yet focused
    - ready
    - failed
- `useTerminalSocket.ts`
  - `terminal:ready`
  - `terminal:output` before ready
  - startup error transition

## Notes

Do not overcomplicate the first pass.

The most valuable change is not a deep protocol rewrite. It is simply making the existing multi-step startup lifecycle visible and honest in the terminal page UX.
