import { afterEach, describe, expect, it } from 'vitest'
import { __test__ } from './hub'

describe('hub command arg filtering', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
        Object.defineProperty(globalThis, 'fetch', {
            value: originalFetch,
            configurable: true,
            writable: true
        })
    })

    it('preserves spaced option values for daemon startup', () => {
        const args = __test__.filterDaemonStartArgs([
            '--name', 'cw-devbox-1',
            '--remote',
            '--config', '/tmp/maglev-config-Sbn3W8.yaml',
            '--broker-url', 'http://broker:3010',
            '--host', '127.0.0.1',
            '--port', '15115'
        ])

        expect(args).toEqual([
            '--remote',
            '--config', '/tmp/maglev-config-Sbn3W8.yaml',
            '--broker-url', 'http://broker:3010',
            '--host', '127.0.0.1',
            '--port', '15115'
        ])
        expect(__test__.parseHubArgs(args)).toEqual({
            brokerUrl: 'http://broker:3010',
            configPath: '/tmp/maglev-config-Sbn3W8.yaml',
            host: '127.0.0.1',
            port: '15115'
        })
    })

    it('drops a positional daemon name but keeps other option values', () => {
        const args = __test__.filterDaemonStartArgs([
            'cw-devbox-1',
            '--remote',
            '--config', '/tmp/config.yaml'
        ])

        expect(args).toEqual([
            '--remote',
            '--config', '/tmp/config.yaml'
        ])
    })

    it('merges restart overrides onto stored daemon args', () => {
        const args = __test__.mergeDaemonArgs(
            [
                '--remote',
                '--config', '/tmp/old.yaml',
                '--broker-url', 'http://old-broker:3010',
                '--host', '127.0.0.1',
                '--port', '15115'
            ],
            [
                '--remote',
                '--config', '/tmp/new.yaml',
                '--broker-url', 'http://new-broker:3010'
            ]
        )

        expect(args).toEqual([
            '--remote',
            '--config', '/tmp/new.yaml',
            '--broker-url', 'http://new-broker:3010',
            '--host', '127.0.0.1',
            '--port', '15115'
        ])
    })

    it('keeps stored values when restart does not override them', () => {
        const args = __test__.mergeDaemonArgs(
            [
                '--remote',
                '--config', '/tmp/current.yaml',
                '--broker-url', 'http://broker:3010',
                '--port', '15115'
            ],
            ['--remote']
        )

        expect(args).toEqual([
            '--remote',
            '--config', '/tmp/current.yaml',
            '--broker-url', 'http://broker:3010',
            '--port', '15115'
        ])
    })

    it('accepts equals-form overrides during merge', () => {
        const args = __test__.mergeDaemonArgs(
            [
                '--remote',
                '--config', '/tmp/current.yaml',
                '--port', '15115'
            ],
            [
                '--remote',
                '--config=/tmp/override.yaml',
                '--port=18181'
            ]
        )

        expect(args).toEqual([
            '--remote',
            '--config', '/tmp/override.yaml',
            '--port', '18181'
        ])
    })

    it('probes /health successfully when the hub is ready', async () => {
        Object.defineProperty(globalThis, 'fetch', {
            value: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
            configurable: true,
            writable: true
        })

        const result = await __test__.probeHubHealth('http://127.0.0.1:3006')

        expect(result).toEqual({
            ok: true,
            baseUrl: 'http://127.0.0.1:3006',
            healthUrl: 'http://127.0.0.1:3006/health',
            snapshot: {
                status: 'ok'
            }
        })
    })

    it('formats timeout readiness failures with the health URL', () => {
        const message = __test__.describeHubReadinessFailure({
            ok: false,
            baseUrl: 'http://127.0.0.1:3006',
            healthUrl: 'http://127.0.0.1:3006/health',
            reason: 'timeout',
            detail: 'TimeoutError: timed out'
        })

        expect(message).toContain('timed out waiting for http://127.0.0.1:3006/health')
    })

    it('formats live hub status lines from health stats', () => {
        const lines = __test__.formatHubStatusLines({
            status: 'ok',
            protocolVersion: '1',
            serverTime: '2026-04-28T00:00:00.000Z',
            uptimeMs: 1200,
            remoteMode: true,
            sync: {
                connected: true,
                sessions: {
                    total: 5,
                    active: 2
                },
                machines: {
                    total: 3,
                    online: 1
                }
            },
            sse: {
                connections: {
                    total: 4,
                    visible: 2
                }
            }
        })

        expect(lines).toContain('  uptimeMs: 1200')
        expect(lines).toContain('  remoteMode: true')
        expect(lines).toContain('  sessions: 2 active / 5 total')
        expect(lines).toContain('  machines: 1 online / 3 total')
        expect(lines).toContain('  sse: 2 visible / 4 total')
    })
})
