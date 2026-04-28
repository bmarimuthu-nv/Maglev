import { describe, expect, it } from 'vitest';

import { RunnerRestartCoordinator } from './restartCoordinator';

describe('RunnerRestartCoordinator', () => {
  it('allows spawns while running and tracks active count', () => {
    const coordinator = new RunnerRestartCoordinator();

    const spawn = coordinator.beginSpawn();
    expect(spawn.ok).toBe(true);
    expect(coordinator.snapshot()).toMatchObject({
      status: 'running',
      acceptingNewSessions: true,
      activeSpawnCount: 1
    });

    if (!spawn.ok) {
      throw new Error('expected running spawn to be accepted');
    }

    spawn.finish();
    expect(coordinator.snapshot()).toMatchObject({
      status: 'running',
      acceptingNewSessions: true,
      activeSpawnCount: 0
    });
  });

  it('rejects new spawns once restart is requested but keeps in-flight count visible', () => {
    const coordinator = new RunnerRestartCoordinator();
    const spawn = coordinator.beginSpawn();
    if (!spawn.ok) {
      throw new Error('expected running spawn to be accepted');
    }

    expect(coordinator.requestRestart('cli-version-drift', 1234)).toBe(true);
    expect(coordinator.snapshot()).toMatchObject({
      status: 'restarting',
      acceptingNewSessions: false,
      activeSpawnCount: 1,
      restartRequestedAt: 1234,
      restartReason: 'cli-version-drift'
    });

    const secondSpawn = coordinator.beginSpawn();
    expect(secondSpawn).toEqual({
      ok: false,
      errorMessage: 'Runner is restarting to apply an updated Maglev CLI. Retry in a few seconds.'
    });

    spawn.finish();
    expect(coordinator.snapshot()).toMatchObject({
      status: 'restarting',
      acceptingNewSessions: false,
      activeSpawnCount: 0
    });
  });

  it('waits for active spawns to drain before resolving', async () => {
    const coordinator = new RunnerRestartCoordinator();
    const spawn = coordinator.beginSpawn();
    if (!spawn.ok) {
      throw new Error('expected running spawn to be accepted');
    }

    expect(coordinator.requestRestart('cli-version-drift', 99)).toBe(true);
    const drained = coordinator.waitForActiveSpawnsToDrain(1000);

    spawn.finish();

    await expect(drained).resolves.toEqual({
      drained: true,
      pending: 0
    });
  });

  it('times out drain waiting when an in-flight spawn does not finish', async () => {
    const coordinator = new RunnerRestartCoordinator();
    const spawn = coordinator.beginSpawn();
    if (!spawn.ok) {
      throw new Error('expected running spawn to be accepted');
    }

    expect(coordinator.requestRestart('cli-version-drift', 99)).toBe(true);

    await expect(coordinator.waitForActiveSpawnsToDrain(10)).resolves.toEqual({
      drained: false,
      pending: 1
    });

    spawn.finish();
  });
});
