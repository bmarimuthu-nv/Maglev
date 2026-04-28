import type { RunnerState } from '@/api/types';

export type RunnerRestartReason = 'cli-version-drift';

type RunnerLifecyclePhase = 'running' | 'restarting' | 'shutting-down';

type DrainWaiter = {
  resolve: (result: { drained: boolean; pending: number }) => void;
  timer: NodeJS.Timeout;
};

export class RunnerRestartCoordinator {
  private phase: RunnerLifecyclePhase = 'running';
  private activeSpawnCount = 0;
  private restartRequestedAt?: number;
  private restartReason?: RunnerRestartReason;
  private drainWaiters = new Set<DrainWaiter>();

  beginSpawn(): { ok: true; finish: () => void } | { ok: false; errorMessage: string } {
    if (this.phase !== 'running') {
      return {
        ok: false,
        errorMessage: this.phase === 'restarting'
          ? 'Runner is restarting to apply an updated Maglev CLI. Retry in a few seconds.'
          : 'Runner is shutting down. Retry in a few seconds.'
      };
    }

    this.activeSpawnCount += 1;
    let finished = false;

    return {
      ok: true,
      finish: () => {
        if (finished) {
          return;
        }
        finished = true;
        this.activeSpawnCount = Math.max(0, this.activeSpawnCount - 1);
        this.flushDrainWaiters();
      }
    };
  }

  requestRestart(reason: RunnerRestartReason, requestedAt: number = Date.now()): boolean {
    if (this.phase !== 'running') {
      return false;
    }

    this.phase = 'restarting';
    this.restartRequestedAt = requestedAt;
    this.restartReason = reason;
    this.flushDrainWaiters();
    return true;
  }

  cancelRestart(): boolean {
    if (this.phase !== 'restarting') {
      return false;
    }

    this.phase = 'running';
    this.restartRequestedAt = undefined;
    this.restartReason = undefined;
    return true;
  }

  requestShutdown(): void {
    this.phase = 'shutting-down';
    this.flushDrainWaiters();
  }

  async waitForActiveSpawnsToDrain(timeoutMs: number): Promise<{ drained: boolean; pending: number }> {
    if (this.activeSpawnCount === 0) {
      return { drained: true, pending: 0 };
    }

    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.drainWaiters.delete(waiter);
        resolve({
          drained: this.activeSpawnCount === 0,
          pending: this.activeSpawnCount
        });
      }, timeoutMs);
      timer.unref?.();

      const waiter: DrainWaiter = {
        resolve,
        timer
      };
      this.drainWaiters.add(waiter);
    });
  }

  snapshot(): Pick<RunnerState, 'status' | 'acceptingNewSessions' | 'activeSpawnCount' | 'restartRequestedAt' | 'restartReason'> {
    return {
      status: this.phase,
      acceptingNewSessions: this.phase === 'running',
      activeSpawnCount: this.activeSpawnCount,
      restartRequestedAt: this.restartRequestedAt,
      restartReason: this.restartReason
    };
  }

  private flushDrainWaiters(): void {
    if (this.activeSpawnCount !== 0) {
      return;
    }

    for (const waiter of this.drainWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ drained: true, pending: 0 });
    }
    this.drainWaiters.clear();
  }
}
