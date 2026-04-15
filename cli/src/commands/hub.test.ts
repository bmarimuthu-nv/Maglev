import { describe, expect, it } from 'vitest'
import { __test__ } from './hub'

describe('hub command arg filtering', () => {
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
})
