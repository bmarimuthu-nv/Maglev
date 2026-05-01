import fs from 'fs/promises';
import os from 'os';

import { ApiClient } from '@/api/api';
import { TrackedSession } from './types';
import { RunnerState, Metadata } from '@/api/types';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/rpcTypes';
import { logger } from '@/ui/logger';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import packageJson from '../../package.json';
import { getEnvironmentInfo } from '@/ui/doctor';
import { spawnMaglevCli } from '@/utils/spawnMaglevCli';
import { writeRunnerState, RunnerLocallyPersistedState, readRunnerState, acquireRunnerLock, releaseRunnerLock } from '@/persistence';
import { isProcessAlive, isWindows, killProcess, killProcessByChildProcess } from '@/utils/process';
import { withRetry } from '@/utils/time';
import { isRetryableConnectionError } from '@/utils/errorUtils';

import { cleanupRunnerState, getInstalledCliMtimeMs, isRunnerRunningCurrentCliVersion, stopRunner } from './controlClient';
import { startRunnerControlServer } from './controlServer';
import { RunnerRestartCoordinator } from './restartCoordinator';
import { createWorktree, removeWorktree, type WorktreeInfo } from './worktree';
import { join } from 'path';
import { buildMachineMetadata } from '@/agent/sessionFactory';

export async function startRunner(): Promise<void> {
  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  // In case the setup malfunctions - our signal handlers will not properly
  // shut down. We will force exit the process with code 1.
  let requestShutdown: (source: 'maglev-app' | 'maglev-cli' | 'os-signal' | 'exception', errorMessage?: string) => void;
  let resolvesWhenShutdownRequested = new Promise<({ source: 'maglev-app' | 'maglev-cli' | 'os-signal' | 'exception', errorMessage?: string })>((resolve) => {
    requestShutdown = (source, errorMessage) => {
      logger.debug(`[RUNNER RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`);

      // Fallback - in case startup malfunctions - we will force exit the process with code 1
      setTimeout(async () => {
        logger.debug('[RUNNER RUN] Startup malfunctioned, forcing exit with code 1');

        // Give time for logs to be flushed
        await new Promise(resolve => setTimeout(resolve, 100))

        process.exit(1);
      }, 1_000);

      // Start graceful shutdown
      resolve({ source, errorMessage });
    };
  });

  // Setup signal handlers
  process.on('SIGINT', () => {
    logger.debug('[RUNNER RUN] Received SIGINT');
    requestShutdown('os-signal');
  });

  process.on('SIGTERM', () => {
    logger.debug('[RUNNER RUN] Received SIGTERM');
    requestShutdown('os-signal');
  });

  if (isWindows()) {
    process.on('SIGBREAK', () => {
      logger.debug('[RUNNER RUN] Received SIGBREAK');
      requestShutdown('os-signal');
    });
  }

  process.on('uncaughtException', (error) => {
    logger.debug('[RUNNER RUN] FATAL: Uncaught exception', error);
    logger.debug(`[RUNNER RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.debug('[RUNNER RUN] FATAL: Unhandled promise rejection', reason);
    logger.debug(`[RUNNER RUN] Rejected promise:`, promise);
    const error = reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${reason}`);
    logger.debug(`[RUNNER RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('exit', (code) => {
    logger.debug(`[RUNNER RUN] Process exiting with code: ${code}`);
  });

  process.on('beforeExit', (code) => {
    logger.debug(`[RUNNER RUN] Process about to exit with code: ${code}`);
  });

  logger.debug('[RUNNER RUN] Starting runner process...');
  logger.debugLargeJson('[RUNNER RUN] Environment', getEnvironmentInfo());

  // Check if already running
  // Check if running runner version matches current CLI version
  const runningRunnerVersionMatches = await isRunnerRunningCurrentCliVersion();
  if (!runningRunnerVersionMatches) {
    logger.debug('[RUNNER RUN] Runner version mismatch detected, restarting runner with current CLI version');
    await stopRunner();
  } else {
    logger.debug('[RUNNER RUN] Runner version matches, keeping existing runner');
    console.log('Runner already running with matching version');
    process.exit(0);
  }

  // Acquire exclusive lock (proves runner is running)
  const runnerLockHandle = await acquireRunnerLock(5, 200);
  if (!runnerLockHandle) {
    logger.debug('[RUNNER RUN] Runner lock file already held, another runner is running');
    process.exit(0);
  }

  // At this point we should be safe to startup the runner:
  // 1. Not have a stale runner state
  // 2. Should not have another runner process running

  try {
    // Ensure auth and machine registration BEFORE anything else
    const { machineId } = await authAndSetupMachineIfNeeded();
    logger.debug('[RUNNER RUN] Auth and machine setup complete');
    const runnerLifecycle = new RunnerRestartCoordinator();
    const runnerStartedAt = Date.now();

    // Setup state - key by PID
    const pidToTrackedSession = new Map<number, TrackedSession>();

    // Session spawning awaiter system
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();
    const pidToErrorAwaiter = new Map<number, (errorMessage: string) => void>();
    type SpawnFailureDetails = {
      message: string
      pid?: number
      exitCode?: number | null
      signal?: NodeJS.Signals | null
    };
    let reportSpawnOutcomeToHub: ((outcome: { type: 'success' } | { type: 'error'; details: SpawnFailureDetails }) => void) | null = null;
    const formatSpawnError = (error: unknown): string => {
      if (error instanceof Error) {
        return error.message;
      }
      return String(error);
    };
    let controlPort = 0;
    let startedWithCliMtimeMs: number | undefined;
    let apiMachine: Awaited<ReturnType<typeof api.machineSyncClient>> | null = null;

    const buildRunnerState = (previousState: RunnerState | null): RunnerState => {
      const lifecycleState = runnerLifecycle.snapshot();
      return {
        ...(previousState ?? {}),
        ...lifecycleState,
        pid: process.pid,
        httpPort: controlPort,
        startedAt: previousState?.startedAt ?? runnerStartedAt
      };
    };

    const writeLocalRunnerStateSnapshot = (lastHeartbeat?: string) => {
      const lifecycleState = runnerLifecycle.snapshot();
      const fileState: RunnerLocallyPersistedState = {
        pid: process.pid,
        httpPort: controlPort,
        startTime: new Date(runnerStartedAt).toISOString(),
        startedWithCliVersion: packageJson.version,
        startedWithCliMtimeMs,
        status: lifecycleState.status,
        acceptingNewSessions: lifecycleState.acceptingNewSessions,
        activeSpawnCount: lifecycleState.activeSpawnCount,
        restartRequestedAt: lifecycleState.restartRequestedAt,
        restartReason: lifecycleState.restartReason,
        lastHeartbeat,
        runnerLogPath: logger.logFilePath
      };
      writeRunnerState(fileState);
      return fileState;
    };

    const syncRunnerState = async () => {
      if (!apiMachine) {
        return;
      }

      await apiMachine.updateRunnerState((state: RunnerState | null) => buildRunnerState(state));
    };

    // Helper functions
    const getCurrentChildren = () => Array.from(pidToTrackedSession.values());

    // Handle webhook from Maglev session reporting itself
    const onSessionStartedWebhook = (sessionId: string, sessionMetadata: Metadata) => {
      logger.debugLargeJson(`[RUNNER RUN] Session reported`, sessionMetadata);

      const pid = sessionMetadata.hostPid;
      if (!pid) {
        logger.debug(`[RUNNER RUN] Session webhook missing hostPid for sessionId: ${sessionId}`);
        return;
      }

      logger.debug(`[RUNNER RUN] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || 'unknown'}`);
      logger.debug(`[RUNNER RUN] Current tracked sessions before webhook: ${Array.from(pidToTrackedSession.keys()).join(', ')}`);

      // Check if we already have this PID (runner-spawned)
      const existingSession = pidToTrackedSession.get(pid);

      if (existingSession && existingSession.startedBy === 'runner') {
        // Update runner-spawned session with reported data
        existingSession.sessionId = sessionId;
        existingSession.sessionMetadataFromLocalWebhook = sessionMetadata;
        logger.debug(`[RUNNER RUN] Updated runner-spawned session ${sessionId} with metadata`);

        // Resolve any awaiter for this PID
        const awaiter = pidToAwaiter.get(pid);
        if (awaiter) {
          pidToAwaiter.delete(pid);
          pidToErrorAwaiter.delete(pid);
          awaiter(existingSession);
          logger.debug(`[RUNNER RUN] Resolved session awaiter for PID ${pid}`);
        }
      } else if (!existingSession) {
        // New session started externally
        const trackedSession: TrackedSession = {
          startedBy: 'maglev directly - likely by user from terminal',
          sessionId: sessionId,
          sessionMetadataFromLocalWebhook: sessionMetadata,
          pid
        };
        pidToTrackedSession.set(pid, trackedSession);
        logger.debug(`[RUNNER RUN] Registered externally-started session ${sessionId}`);
      }
    };

    // Spawn a new session (sessionId reserved for future --resume functionality)
    const spawnSession = async (options: SpawnSessionOptions): Promise<SpawnSessionResult> => {
      logger.debugLargeJson('[RUNNER RUN] Spawning session', options);
      const spawnLease = runnerLifecycle.beginSpawn();
      if (!spawnLease.ok) {
        logger.debug(`[RUNNER RUN] Rejecting spawn while runner lifecycle is ${runnerLifecycle.snapshot().status}`);
        return {
          type: 'error',
          errorMessage: spawnLease.errorMessage
        };
      }

      await syncRunnerState().catch((error) => {
        logger.debug('[RUNNER RUN] Failed to publish active spawn count before spawn', error);
      });
      writeLocalRunnerStateSnapshot();

      try {
        const { directory, sessionId, machineId, approvedNewDirectoryCreation = true } = options;
        const sessionType = options.sessionType ?? 'simple';
        const worktreeName = options.worktreeName;
        const pinned = options.pinned === true;
        const startupCommand = options.startupCommand?.trim() || undefined;
        let directoryCreated = false;
        let spawnDirectory = directory;
        let worktreeInfo: WorktreeInfo | null = null;
        let maglevProcess: ReturnType<typeof spawnMaglevCli> | null = null;

        if (sessionType === 'simple') {
          try {
            await fs.access(directory);
            logger.debug(`[RUNNER RUN] Directory exists: ${directory}`);
          } catch (error) {
            logger.debug(`[RUNNER RUN] Directory doesn't exist, creating: ${directory}`);

            // Check if directory creation is approved
            if (!approvedNewDirectoryCreation) {
              logger.debug(`[RUNNER RUN] Directory creation not approved for: ${directory}`);
              return {
                type: 'requestToApproveDirectoryCreation',
                directory
              };
            }

            try {
              await fs.mkdir(directory, { recursive: true });
              logger.debug(`[RUNNER RUN] Successfully created directory: ${directory}`);
              directoryCreated = true;
            } catch (mkdirError: any) {
              let errorMessage = `Unable to create directory at '${directory}'. `;

              // Provide more helpful error messages based on the error code
              if (mkdirError.code === 'EACCES') {
                errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
              } else if (mkdirError.code === 'ENOTDIR') {
                errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
              } else if (mkdirError.code === 'ENOSPC') {
                errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
              } else if (mkdirError.code === 'EROFS') {
                errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
              } else {
                errorMessage += `System error: ${mkdirError.message || mkdirError}. Please verify the path is valid and you have the necessary permissions.`;
              }

              logger.debug(`[RUNNER RUN] Directory creation failed: ${errorMessage}`);
              return {
                type: 'error',
                errorMessage
              };
            }
          }
        } else {
          try {
            await fs.access(directory);
            logger.debug(`[RUNNER RUN] Worktree base directory exists: ${directory}`);
          } catch (error) {
            logger.debug(`[RUNNER RUN] Worktree base directory missing: ${directory}`);
            return {
              type: 'error',
              errorMessage: `Worktree sessions require an existing Git repository. Directory not found: ${directory}`
            };
          }
        }

        if (sessionType === 'worktree') {
          const worktreeResult = await createWorktree({
            basePath: directory,
            nameHint: worktreeName
          });
          if (!worktreeResult.ok) {
            logger.debug(`[RUNNER RUN] Worktree creation failed: ${worktreeResult.error}`);
            return {
              type: 'error',
              errorMessage: worktreeResult.error
            };
          }
          worktreeInfo = worktreeResult.info;
          spawnDirectory = worktreeInfo.worktreePath;
          logger.debug(`[RUNNER RUN] Created worktree ${worktreeInfo.worktreePath} (branch ${worktreeInfo.branch})`);
        }

        const cleanupWorktree = async () => {
          if (!worktreeInfo) {
            return;
          }
          const result = await removeWorktree({
            repoRoot: worktreeInfo.basePath,
            worktreePath: worktreeInfo.worktreePath
          });
          if (!result.ok) {
            logger.debug(`[RUNNER RUN] Failed to remove worktree ${worktreeInfo.worktreePath}: ${result.error}`);
          }
        };
        const maybeCleanupWorktree = async (reason: string) => {
          if (!worktreeInfo) {
            return;
          }
          const pid = maglevProcess?.pid;
          if (pid && isProcessAlive(pid)) {
            logger.debug(`[RUNNER RUN] Skipping worktree cleanup after ${reason}; child still running`, {
              pid,
              worktreePath: worktreeInfo.worktreePath
            });
            return;
          }
          await cleanupWorktree();
        };

        try {

          let extraEnv: Record<string, string> = {};

          if (worktreeInfo) {
            extraEnv = {
              ...extraEnv,
              MAGLEV_WORKTREE_BASE_PATH: worktreeInfo.basePath,
              MAGLEV_WORKTREE_BRANCH: worktreeInfo.branch,
              MAGLEV_WORKTREE_NAME: worktreeInfo.name,
              MAGLEV_WORKTREE_PATH: worktreeInfo.worktreePath,
              MAGLEV_WORKTREE_CREATED_AT: String(worktreeInfo.createdAt)
            };
          }

          extraEnv = {
            ...extraEnv,
            MAGLEV_SHELL_PINNED: pinned ? 'true' : 'false'
          };
          if (startupCommand) {
            extraEnv.MAGLEV_SHELL_STARTUP_COMMAND = startupCommand;
          }

          const args = ['shell', '--started-by', 'runner'];

          // sessionId reserved for future use
          const MAX_TAIL_CHARS = 4000;
          let stderrTail = '';
          const appendTail = (current: string, chunk: Buffer | string): string => {
            const text = chunk.toString();
            if (!text) {
              return current;
            }
            const combined = current + text;
            return combined.length > MAX_TAIL_CHARS ? combined.slice(-MAX_TAIL_CHARS) : combined;
          };
          const logStderrTail = () => {
            const trimmed = stderrTail.trim();
            if (!trimmed) {
              return;
            }
            logger.debug('[RUNNER RUN] Child stderr tail', trimmed);
          };

          maglevProcess = spawnMaglevCli(args, {
            cwd: spawnDirectory,
            detached: true,  // Sessions stay alive when runner stops
            stdio: ['ignore', 'pipe', 'pipe'],  // Capture stdout/stderr for debugging
            env: {
              ...process.env,
              ...extraEnv
            }
          });

          maglevProcess.stderr?.on('data', (data) => {
            stderrTail = appendTail(stderrTail, data);
          });

          let spawnErrorBeforePidCheck: Error | null = null;
          const captureSpawnErrorBeforePidCheck = (error: Error) => {
            spawnErrorBeforePidCheck = error;
          };
          maglevProcess.once('error', captureSpawnErrorBeforePidCheck);

          if (!maglevProcess.pid) {
            // Allow the async 'error' event to fire before we read it
            await new Promise((resolve) => setImmediate(resolve));
            const details = [`cwd=${spawnDirectory}`];
            if (spawnErrorBeforePidCheck) {
              details.push(formatSpawnError(spawnErrorBeforePidCheck));
            }
            const errorMessage = `Failed to spawn Maglev process - no PID returned (${details.join('; ')})`;
            logger.debug('[RUNNER RUN] Failed to spawn process - no PID returned', spawnErrorBeforePidCheck ?? null);
            reportSpawnOutcomeToHub?.({
              type: 'error',
              details: {
                message: errorMessage
              }
            });
            await maybeCleanupWorktree('no-pid');
            return {
              type: 'error',
              errorMessage
            };
          }
          maglevProcess.removeListener('error', captureSpawnErrorBeforePidCheck);

          const pid = maglevProcess.pid;
          logger.debug(`[RUNNER RUN] Spawned process with PID ${pid}`);
          let observedExitCode: number | null = null;
          let observedExitSignal: NodeJS.Signals | null = null;
          const buildWebhookFailureMessage = (reason: 'timeout' | 'exit-before-webhook' | 'process-error-before-webhook'): string => {
            let message = '';
            if (reason === 'exit-before-webhook') {
              message = `Session process exited before webhook for PID ${pid}`;
            } else if (reason === 'process-error-before-webhook') {
              message = `Session process error before webhook for PID ${pid}`;
            } else {
              message = `Session webhook timeout for PID ${pid}`;
            }

            if (observedExitCode !== null || observedExitSignal) {
              if (observedExitCode !== null) {
                message += ` (exit code ${observedExitCode})`;
              } else {
                message += ` (signal ${observedExitSignal})`;
              }
            }

            const trimmedTail = stderrTail.trim();
            if (trimmedTail) {
              const compactTail = trimmedTail.replace(/\s+/g, ' ');
              const tailForMessage = compactTail.length > 800 ? compactTail.slice(-800) : compactTail;
              message += `. stderr: ${tailForMessage}`;
            }

            return message;
          };

          const trackedSession: TrackedSession = {
            startedBy: 'runner',
            pid,
            childProcess: maglevProcess,
            directoryCreated,
            message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined
          };

          pidToTrackedSession.set(pid, trackedSession);

          maglevProcess.on('exit', (code, signal) => {
            observedExitCode = typeof code === 'number' ? code : null;
            observedExitSignal = signal ?? null;
            logger.debug(`[RUNNER RUN] Child PID ${pid} exited with code ${code}, signal ${signal}`);
            if (code !== 0 || signal) {
              logStderrTail();
            }
            const errorAwaiter = pidToErrorAwaiter.get(pid);
            if (errorAwaiter) {
              pidToErrorAwaiter.delete(pid);
              pidToAwaiter.delete(pid);
              errorAwaiter(buildWebhookFailureMessage('exit-before-webhook'));
            }
            onChildExited(pid);
          });

          maglevProcess.on('error', (error) => {
            logger.debug(`[RUNNER RUN] Child process error:`, error);
            const errorAwaiter = pidToErrorAwaiter.get(pid);
            if (errorAwaiter) {
              pidToErrorAwaiter.delete(pid);
              pidToAwaiter.delete(pid);
              errorAwaiter(buildWebhookFailureMessage('process-error-before-webhook'));
            }
            onChildExited(pid);
          });

          // Wait for webhook to populate session with sessionId
          logger.debug(`[RUNNER RUN] Waiting for session webhook for PID ${pid}`);

          const spawnResult = await new Promise<SpawnSessionResult>((resolve) => {
            // Set timeout for webhook
            const timeout = setTimeout(() => {
              pidToAwaiter.delete(pid);
              pidToErrorAwaiter.delete(pid);
              logger.debug(`[RUNNER RUN] Session webhook timeout for PID ${pid}`);
              logStderrTail();
              resolve({
                type: 'error',
                errorMessage: buildWebhookFailureMessage('timeout')
              });
              // 15 second timeout - I have seen timeouts on 10 seconds
              // even though session was still created successfully in ~2 more seconds
            }, 15_000);

            // Register awaiter
            pidToAwaiter.set(pid, (completedSession) => {
              clearTimeout(timeout);
              pidToErrorAwaiter.delete(pid);
              logger.debug(`[RUNNER RUN] Session ${completedSession.sessionId} fully spawned with webhook`);
              resolve({
                type: 'success',
                sessionId: completedSession.sessionId!
              });
            });
            pidToErrorAwaiter.set(pid, (errorMessage) => {
              clearTimeout(timeout);
              resolve({
                type: 'error',
                errorMessage
              });
            });
          });
          if (spawnResult.type === 'error') {
            reportSpawnOutcomeToHub?.({
              type: 'error',
              details: {
                message: spawnResult.errorMessage,
                pid,
                exitCode: observedExitCode,
                signal: observedExitSignal
              }
            });
            await maybeCleanupWorktree('spawn-error');
          } else {
            reportSpawnOutcomeToHub?.({ type: 'success' });
          }
          return spawnResult;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.debug('[RUNNER RUN] Failed to spawn session:', error);
          await maybeCleanupWorktree('exception');
          reportSpawnOutcomeToHub?.({
            type: 'error',
            details: {
              message: `Failed to spawn session: ${errorMessage}`
            }
          });
          return {
            type: 'error',
            errorMessage: `Failed to spawn session: ${errorMessage}`
          };
        }
      } finally {
        spawnLease.finish();
        await syncRunnerState().catch((error) => {
          logger.debug('[RUNNER RUN] Failed to publish active spawn count after spawn', error);
        });
        writeLocalRunnerStateSnapshot();
      }
    };

    // Stop a session by sessionId or PID fallback
    const stopSession = (sessionId: string): boolean => {
      logger.debug(`[RUNNER RUN] Attempting to stop session ${sessionId}`);

      // Try to find by sessionId first
      for (const [pid, session] of pidToTrackedSession.entries()) {
        if (session.sessionId === sessionId ||
          (sessionId.startsWith('PID-') && pid === parseInt(sessionId.replace('PID-', '')))) {

          if (session.startedBy === 'runner' && session.childProcess) {
            try {
              void killProcessByChildProcess(session.childProcess);
              logger.debug(`[RUNNER RUN] Requested termination for runner-spawned session ${sessionId}`);
            } catch (error) {
              logger.debug(`[RUNNER RUN] Failed to kill session ${sessionId}:`, error);
            }
          } else {
            // For externally started sessions, try to kill by PID
            try {
              void killProcess(pid);
              logger.debug(`[RUNNER RUN] Requested termination for external session PID ${pid}`);
            } catch (error) {
              logger.debug(`[RUNNER RUN] Failed to kill external session PID ${pid}:`, error);
            }
          }

          pidToTrackedSession.delete(pid);
          logger.debug(`[RUNNER RUN] Removed session ${sessionId} from tracking`);
          return true;
        }
      }

      logger.debug(`[RUNNER RUN] Session ${sessionId} not found`);
      return false;
    };

    // Handle child process exit
    const onChildExited = (pid: number) => {
      logger.debug(`[RUNNER RUN] Removing exited process PID ${pid} from tracking`);
      pidToTrackedSession.delete(pid);
      pidToAwaiter.delete(pid);
      pidToErrorAwaiter.delete(pid);
    };

    // Start control server
    const { port, stop: stopControlServer } = await startRunnerControlServer({
      getChildren: getCurrentChildren,
      stopSession,
      spawnSession,
      requestShutdown: () => requestShutdown('maglev-cli'),
      onSessionStartedWebhook
    });
    controlPort = port;

    startedWithCliMtimeMs = getInstalledCliMtimeMs();
    writeLocalRunnerStateSnapshot();
    logger.debug('[RUNNER RUN] Runner state written');

    // Prepare initial runner state
    const initialRunnerState: RunnerState = buildRunnerState(null);

    // Create API client
    const api = await ApiClient.create();

    // Get or create machine (with retry for transient connection errors)
    const machine = await withRetry(
      () => api.getOrCreateMachine({
        machineId,
        metadata: buildMachineMetadata(),
        runnerState: initialRunnerState
      }),
      {
        maxAttempts: 60,
        minDelay: 1000,
        maxDelay: 30000,
        shouldRetry: isRetryableConnectionError,
        onRetry: (error, attempt, nextDelayMs) => {
          const errorMsg = error instanceof Error ? error.message : String(error)
          logger.debug(`[RUNNER RUN] Failed to register machine (attempt ${attempt}), retrying in ${nextDelayMs}ms: ${errorMsg}`)
        }
      }
    );
    logger.debug(`[RUNNER RUN] Machine registered: ${machine.id}`);

    // Create realtime machine session
    apiMachine = api.machineSyncClient(machine);

    // Set RPC handlers
    apiMachine.setRPCHandlers({
      spawnSession,
      stopSession,
      requestShutdown: () => requestShutdown('maglev-app')
    });

    // Connect to server
    apiMachine.connect();

    reportSpawnOutcomeToHub = (outcome) => {
      if (!apiMachine) {
        return;
      }

      void apiMachine.updateRunnerState((state: RunnerState | null) => {
        const baseState = buildRunnerState(state);
        if (outcome.type === 'success') {
          return {
            ...baseState,
            lastSpawnError: null
          };
        }

        return {
          ...baseState,
          lastSpawnError: {
            message: outcome.details.message,
            pid: outcome.details.pid,
            exitCode: outcome.details.exitCode ?? null,
            signal: outcome.details.signal ?? null,
            at: Date.now()
          }
        };
      }).catch((error) => {
        logger.debug('[RUNNER RUN] Failed to update runner state with spawn outcome', error);
      });
    };

    // Every 60 seconds:
    // 1. Prune stale sessions
    // 2. Check if runner needs update
    // 3. If outdated, restart with latest version
    // 4. Write heartbeat
    const heartbeatIntervalMs = parseInt(process.env.MAGLEV_RUNNER_HEARTBEAT_INTERVAL || '60000');
    let heartbeatRunning = false
    const restartOnStaleVersionAndHeartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        return;
      }
      heartbeatRunning = true;

      try {
        if (process.env.DEBUG) {
          logger.debug(`[RUNNER RUN] Health check started at ${new Date().toLocaleString()}`);
        }

        // Prune stale sessions
        for (const [pid, _] of pidToTrackedSession.entries()) {
          if (!isProcessAlive(pid)) {
            logger.debug(`[RUNNER RUN] Removing stale session with PID ${pid} (process no longer exists)`);
            pidToTrackedSession.delete(pid);
          }
        }

        // Check if runner needs update
        const installedCliMtimeMs = getInstalledCliMtimeMs();
        if (typeof installedCliMtimeMs === 'number' &&
            typeof startedWithCliMtimeMs === 'number' &&
            installedCliMtimeMs !== startedWithCliMtimeMs) {
          logger.debug('[RUNNER RUN] Runner is outdated, triggering graceful self-restart with latest version');

          clearInterval(restartOnStaleVersionAndHeartbeat);
          runnerLifecycle.requestRestart('cli-version-drift');
          await syncRunnerState().catch((error) => {
            logger.debug('[RUNNER RUN] Failed to publish restarting runner state', error);
          });
          writeLocalRunnerStateSnapshot();

          const restartDrainTimeoutMs = parseInt(process.env.MAGLEV_RUNNER_RESTART_DRAIN_TIMEOUT || '15000');
          const drainResult = await runnerLifecycle.waitForActiveSpawnsToDrain(restartDrainTimeoutMs);
          if (!drainResult.drained) {
            logger.debug(`[RUNNER RUN] Proceeding with restart while ${drainResult.pending} spawn(s) are still in flight after ${restartDrainTimeoutMs}ms`);
          } else {
            logger.debug('[RUNNER RUN] In-flight spawns drained before restart handoff');
          }

          // Spawn new runner through the CLI
          // We do not need to clean ourselves up - we will be killed by
          // the CLI start command.
          // 1. It will first check if runner is running (yes in this case)
          // 2. If the version is stale (it will read runner.state.json file and check startedWithCliVersion) & compare it to its own version
          // 3. Next it will start a new runner with the latest version with runner-sync :D
          // Done!
          try {
            spawnMaglevCli(['runner', 'start'], {
              detached: true,
              stdio: 'ignore'
            });
          } catch (error) {
            logger.debug('[RUNNER RUN] Failed to spawn new runner, this is quite likely to happen during integration tests as we are cleaning out dist/ directory', error);
            runnerLifecycle.cancelRestart();
            await syncRunnerState().catch((stateError) => {
              logger.debug('[RUNNER RUN] Failed to restore running runner state after restart spawn failure', stateError);
            });
            writeLocalRunnerStateSnapshot();
            return;
          }

          // So we can just hang forever
          logger.debug('[RUNNER RUN] Replacement runner requested; waiting to be shut down by the new process');
          await new Promise(resolve => setTimeout(resolve, 10_000));
          process.exit(0);
        }

        // Before wrecklessly overriting the runner state file, we should check if we are the ones who own it
        // Race condition is possible, but thats okay for the time being :D
        const runnerState = await readRunnerState();
        if (runnerState && runnerState.pid !== process.pid) {
          logger.debug('[RUNNER RUN] Somehow a different runner was started without killing us. We should kill ourselves.')
          requestShutdown('exception', 'A different runner was started without killing us. We should kill ourselves.')
        }

        // Heartbeat
        try {
          const heartbeatTime = new Date().toISOString();
          writeLocalRunnerStateSnapshot(heartbeatTime);
          if (process.env.DEBUG) {
            logger.debug(`[RUNNER RUN] Health check completed at ${heartbeatTime}`);
          }
        } catch (error) {
          logger.debug('[RUNNER RUN] Failed to write heartbeat', error);
        }
      } finally {
        heartbeatRunning = false;
      }
    }, heartbeatIntervalMs); // Every 60 seconds in production

    // Setup signal handlers
    const cleanupAndShutdown = async (source: 'maglev-app' | 'maglev-cli' | 'os-signal' | 'exception', errorMessage?: string) => {
      logger.debug(`[RUNNER RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

      // Clear health check interval
      if (restartOnStaleVersionAndHeartbeat) {
        clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug('[RUNNER RUN] Health check interval cleared');
      }
      runnerLifecycle.requestShutdown();
      writeLocalRunnerStateSnapshot();

      // Update runner state before shutting down
      if (apiMachine) {
        await apiMachine.updateRunnerState((state: RunnerState | null) => ({
          ...buildRunnerState(state),
          status: 'shutting-down',
          acceptingNewSessions: false,
          activeSpawnCount: runnerLifecycle.snapshot().activeSpawnCount,
          restartRequestedAt: runnerLifecycle.snapshot().restartRequestedAt,
          restartReason: runnerLifecycle.snapshot().restartReason,
          shutdownRequestedAt: Date.now(),
          shutdownSource: source
        }));
      }

      // Give time for metadata update to send
      await new Promise(resolve => setTimeout(resolve, 100));

      apiMachine?.shutdown();
      await stopControlServer();
      await cleanupRunnerState();
      await releaseRunnerLock(runnerLockHandle);

      logger.debug('[RUNNER RUN] Cleanup completed, exiting process');
      process.exit(0);
    };

    logger.debug('[RUNNER RUN] Runner started successfully, waiting for shutdown request');

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(shutdownRequest.source, shutdownRequest.errorMessage);
  } catch (error) {
    logger.debug('[RUNNER RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1', error);
    process.exit(1);
  }
}
