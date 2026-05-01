import { describe, expect, it } from 'bun:test'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { createHubHealthSnapshot, createHubNamespaceMetricsSnapshot } from './observability'
import type { SyncEngine } from '../sync/syncEngine'

function createSyncEngineStub(): SyncEngine {
    return {
        getSessionCount: () => 6,
        getActiveSessionCount: () => 2,
        getMachineCount: () => 4,
        getOnlineMachineCount: () => 1,
        getSessionCountByNamespace: (namespace: string) => namespace === 'alpha' ? 3 : 0,
        getActiveSessionCountByNamespace: (namespace: string) => namespace === 'alpha' ? 1 : 0,
        getMachineCountByNamespace: (namespace: string) => namespace === 'alpha' ? 2 : 0,
        getOnlineMachineCountByNamespace: (namespace: string) => namespace === 'alpha' ? 1 : 0
    } as unknown as SyncEngine
}

describe('observability snapshots', () => {
    it('builds global health stats from sync and sse accessors', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        manager.subscribe({
            id: 'visible-alpha',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: () => {},
            sendHeartbeat: () => {}
        })
        manager.subscribe({
            id: 'hidden-beta',
            namespace: 'beta',
            all: true,
            visibility: 'hidden',
            send: () => {},
            sendHeartbeat: () => {}
        })

        const snapshot = createHubHealthSnapshot({
            syncEngine: createSyncEngineStub(),
            sseManager: manager,
            remoteMode: true,
            startedAtMs: 1_000,
            now: 2_500
        })

        expect(snapshot.status).toBe('ok')
        expect(snapshot.uptimeMs).toBe(1_500)
        expect(snapshot.remoteMode).toBe(true)
        expect(snapshot.sync).toEqual({
            connected: true,
            sessions: {
                total: 6,
                active: 2
            },
            machines: {
                total: 4,
                online: 1
            }
        })
        expect(snapshot.sse.connections).toEqual({
            total: 2,
            visible: 1
        })
    })

    it('builds namespace metrics with namespace-scoped counts', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        manager.subscribe({
            id: 'visible-alpha',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: () => {},
            sendHeartbeat: () => {}
        })
        manager.subscribe({
            id: 'hidden-alpha',
            namespace: 'alpha',
            all: true,
            visibility: 'hidden',
            send: () => {},
            sendHeartbeat: () => {}
        })
        manager.subscribe({
            id: 'visible-beta',
            namespace: 'beta',
            all: true,
            visibility: 'visible',
            send: () => {},
            sendHeartbeat: () => {}
        })

        const snapshot = createHubNamespaceMetricsSnapshot({
            namespace: 'alpha',
            syncEngine: createSyncEngineStub(),
            sseManager: manager,
            startedAtMs: 500,
            now: 2_000
        })

        expect(snapshot.namespace).toBe('alpha')
        expect(snapshot.uptimeMs).toBe(1_500)
        expect(snapshot.sessions).toEqual({
            total: 3,
            active: 1
        })
        expect(snapshot.machines).toEqual({
            total: 2,
            online: 1
        })
        expect(snapshot.sse.connections).toEqual({
            total: 2,
            visible: 1
        })
    })
})
