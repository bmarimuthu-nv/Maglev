import chalk from 'chalk'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readBrokerUrl, readRemoteGitHubAuthState } from '../../../hub/src/broker/key'
import { signBrokerSessionToken } from '../../../hub/src/web/brokerSession'
import type { CommandContext, CommandDefinition } from './types'

const SERVER_SERVICE_NAME = 'maglev-server.service'

type ParsedBrokerArgs = {
    host?: string
    port?: string
    publicUrl?: string
    token?: string
    showHelp: boolean
    unexpectedArgs: string[]
}

function parseBrokerArgs(args: string[]): ParsedBrokerArgs {
    const result: ParsedBrokerArgs = { showHelp: false, unexpectedArgs: [] }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === 'help' || arg === '-h' || arg === '--help') {
            result.showHelp = true
        } else if (arg === '--host' && i + 1 < args.length) {
            result.host = args[++i]
        } else if (arg === '--port' && i + 1 < args.length) {
            result.port = args[++i]
        } else if (arg === '--public-url' && i + 1 < args.length) {
            result.publicUrl = args[++i]
        } else if ((arg === '--server-token' || arg === '--broker-token') && i + 1 < args.length) {
            result.token = args[++i]
        } else if (arg.startsWith('--host=')) {
            result.host = arg.slice('--host='.length)
        } else if (arg.startsWith('--port=')) {
            result.port = arg.slice('--port='.length)
        } else if (arg.startsWith('--public-url=')) {
            result.publicUrl = arg.slice('--public-url='.length)
        } else if (arg.startsWith('--server-token=')) {
            result.token = arg.slice('--server-token='.length)
        } else if (arg.startsWith('--broker-token=')) {
            result.token = arg.slice('--broker-token='.length)
        } else {
            result.unexpectedArgs.push(arg)
        }
    }

    return result
}

function escapeSystemdArg(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\s/g, '\\ ')
}

function buildExecStart(): string {
    const runtime = resolve(process.execPath)
    const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null
    const runtimeName = runtime.split('/').pop()?.toLowerCase() ?? ''

    if (runtimeName === 'node' || runtimeName === 'bun') {
        if (!entrypoint) {
            throw new Error('Unable to determine current CLI entrypoint for service installation')
        }
        return `${escapeSystemdArg(runtime)} ${escapeSystemdArg(entrypoint)} server`
    }

    return `${escapeSystemdArg(runtime)} server`
}

function ensureLinuxSystemdUser(action: string): void {
    if (process.platform !== 'linux') {
        throw new Error(`\`maglev server service ${action}\` currently supports Linux user-level systemd only`)
    }
}

function runSystemctl(args: string[]): void {
    const result = spawnSync('systemctl', ['--user', ...args], {
        stdio: 'inherit',
        env: process.env
    })

    if (result.error) {
        throw new Error(`Failed to run systemctl --user ${args.join(' ')}: ${result.error.message}`)
    }
    if (result.status !== 0) {
        throw new Error(`systemctl --user ${args.join(' ')} exited with status ${result.status}`)
    }
}

function isSystemdUserServiceActive(serviceName: string): boolean {
    const result = spawnSync('systemctl', ['--user', 'is-active', '--quiet', serviceName], {
        stdio: 'ignore',
        env: process.env
    })

    if (result.error) {
        throw new Error(`Failed to run systemctl --user is-active ${serviceName}: ${result.error.message}`)
    }

    return result.status === 0
}

function requireHome(): string {
    const home = process.env.HOME?.trim()
    if (!home) {
        throw new Error('HOME is not set')
    }
    return home
}

function getServicePath(): string {
    return resolve(requireHome(), '.config/systemd/user', SERVER_SERVICE_NAME)
}

function ensureServiceExists(): void {
    if (!existsSync(getServicePath())) {
        throw new Error('Service is not installed. Run `maglev server service install` first')
    }
}

function installBrokerUserService(commandArgs: string[]): void {
    ensureLinuxSystemdUser('install')

    const home = requireHome()
    const serviceDir = resolve(home, '.config/systemd/user')
    const servicePath = resolve(serviceDir, SERVER_SERVICE_NAME)
    const passthroughArgs = commandArgs.slice(2)
    const filteredArgs = passthroughArgs.filter((arg) => arg !== '--follow' && arg !== '-f')
    const extraArgs = filteredArgs.length > 0 ? ` ${filteredArgs.map(escapeSystemdArg).join(' ')}` : ''
    const execStart = `${buildExecStart()}${extraArgs}`
    const service = `[Unit]
Description=maglev server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${escapeSystemdArg(home)}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
Environment=HOME=${escapeSystemdArg(home)}
Environment=MAGLEV_HOME=${escapeSystemdArg(resolve(home, '.maglev'))}

[Install]
WantedBy=default.target
`

    mkdirSync(serviceDir, { recursive: true })
    const wasActive = existsSync(servicePath) && isSystemdUserServiceActive(SERVER_SERVICE_NAME)
    writeFileSync(servicePath, service, 'utf8')
    runSystemctl(['daemon-reload'])
    runSystemctl(['enable', SERVER_SERVICE_NAME])
    runSystemctl([wasActive ? 'restart' : 'start', SERVER_SERVICE_NAME])

    console.log(chalk.green(`Installed and ${wasActive ? 'restarted' : 'started'} user service: ${SERVER_SERVICE_NAME}`))
    console.log(chalk.gray(`Service file: ${servicePath}`))
    console.log(chalk.gray('Manage it with:'))
    console.log(chalk.gray('  maglev server service status'))
    console.log(chalk.gray('  maglev server service logs'))
    console.log(chalk.gray('  maglev server service restart'))
    console.log(chalk.gray('Optional: keep it running after logout with `loginctl enable-linger $USER`'))
}

function startBrokerUserService(): void {
    ensureLinuxSystemdUser('start')
    ensureServiceExists()
    runSystemctl(['start', SERVER_SERVICE_NAME])
}

function stopBrokerUserService(): void {
    ensureLinuxSystemdUser('stop')
    ensureServiceExists()
    runSystemctl(['stop', SERVER_SERVICE_NAME])
}

function restartBrokerUserService(): void {
    ensureLinuxSystemdUser('restart')
    ensureServiceExists()
    runSystemctl(['restart', SERVER_SERVICE_NAME])
}

function statusBrokerUserService(): void {
    ensureLinuxSystemdUser('status')
    ensureServiceExists()
    runSystemctl(['status', SERVER_SERVICE_NAME])
}

function logsBrokerUserService(commandArgs: string[]): void {
    ensureLinuxSystemdUser('logs')
    ensureServiceExists()

    const follow = commandArgs.includes('--follow') || commandArgs.includes('-f')
    const result = spawnSync('journalctl', ['--user', '-u', SERVER_SERVICE_NAME, ...(follow ? ['-f'] : ['-n', '100'])], {
        stdio: 'inherit',
        env: process.env
    })

    if (result.error) {
        throw new Error(`Failed to run journalctl: ${result.error.message}`)
    }
    if (result.status !== 0) {
        throw new Error(`journalctl exited with status ${result.status}`)
    }
}

function uninstallBrokerUserService(): void {
    ensureLinuxSystemdUser('uninstall')
    const servicePath = getServicePath()
    if (!existsSync(servicePath)) {
        throw new Error('Service is not installed')
    }

    runSystemctl(['disable', '--now', SERVER_SERVICE_NAME])
    rmSync(servicePath)
    runSystemctl(['daemon-reload'])
    console.log(chalk.green(`Removed user service: ${SERVER_SERVICE_NAME}`))
}

function runBrokerServiceCommand(commandArgs: string[]): void {
    const action = commandArgs[1]

    switch (action) {
        case 'install':
            installBrokerUserService(commandArgs)
            return
        case 'start':
            startBrokerUserService()
            return
        case 'stop':
            stopBrokerUserService()
            return
        case 'restart':
            restartBrokerUserService()
            return
        case 'status':
            statusBrokerUserService()
            return
        case 'logs':
            logsBrokerUserService(commandArgs)
            return
        case 'uninstall':
            uninstallBrokerUserService()
            return
        default:
            console.log(`
${chalk.bold('maglev server service')} - Manage the user-level remote access server

${chalk.bold('Usage:')}
  maglev server service install [server args]
  maglev server service start
  maglev server service stop
  maglev server service restart
  maglev server service status
  maglev server service logs [-f|--follow]
  maglev server service uninstall
`)
    }
}

type BrokerHubRecord = {
    hubId: string
    owner: string
    jobId?: string | null
    jobName?: string | null
    hostname?: string | null
    localUrl: string
    createdAt: number
    lastSeenAt: number
    publicUrl: string
    socket: string | null
    launchFolders?: Array<{
        label: string
        path: string
        branch?: string
        source: 'path' | 'wt'
    }>
    configError?: string | null
}

type BrokerHubsResponse = {
    hubs?: BrokerHubRecord[]
    recentHubs?: BrokerHubRecord[]
    error?: string
}

async function listBrokerHubs(): Promise<void> {
    const brokerUrlState = await readBrokerUrl()
    if (!brokerUrlState?.url) {
        throw new Error('Server URL not found. Start `maglev server` first so it can write ~/.maglev/server-url.')
    }

    const githubAuthState = await readRemoteGitHubAuthState()
    const githubAuth = githubAuthState?.state.githubAuth
    if (!githubAuth) {
        throw new Error('Server auth requires cached GitHub auth. Run `maglev auth github login` first.')
    }

    const brokerSessionToken = await signBrokerSessionToken({
        uid: githubAuth.userId,
        login: githubAuth.login
    })

    const apiUrl = new URL('/api/hubs', brokerUrlState.url)
    const response = await fetch(apiUrl, {
        headers: {
            cookie: `maglev_broker_session=${encodeURIComponent(brokerSessionToken)}`
        }
    })

    const body = await response.json().catch(() => null) as BrokerHubsResponse | null
    if (!response.ok) {
        throw new Error(body?.error || `Server request failed with status ${response.status}`)
    }

    const activeHubs = body?.hubs ?? []
    const recentHubs = body?.recentHubs ?? []

    console.log(chalk.bold(`\nServer Hubs (${brokerUrlState.url})\n`))

    const printFolders = (hub: BrokerHubRecord) => {
        if (hub.configError) {
            console.log(chalk.yellow(`  config error: ${hub.configError}`))
        }
        for (const folder of hub.launchFolders ?? []) {
            const branch = folder.branch ? ` [${folder.branch}]` : ''
            console.log(chalk.gray(`  - ${folder.label}${branch}`))
            console.log(chalk.gray(`    ${folder.path}`))
        }
    }

    if (activeHubs.length === 0) {
        console.log(chalk.gray('No active hubs.'))
    } else {
        console.log(chalk.bold('Active'))
        for (const hub of activeHubs) {
            const details = [
                hub.owner,
                hub.hostname ? `host=${hub.hostname}` : null,
                hub.jobId ? `job=${hub.jobId}` : null,
                hub.jobName ? `name=${hub.jobName}` : null,
                hub.socket ? 'connected' : null
            ].filter(Boolean).join(' | ')
            console.log(`${chalk.cyan(hub.hubId)} ${chalk.gray(`(${details})`)}`)
            console.log(chalk.gray(`  ${hub.publicUrl}`))
            console.log(chalk.gray(`  last seen ${new Date(hub.lastSeenAt).toLocaleString()}`))
            printFolders(hub)
        }
    }

    if (recentHubs.length > 0) {
        console.log('')
        console.log(chalk.bold('Recent'))
        for (const hub of recentHubs) {
            const details = [
                hub.owner,
                hub.hostname ? `host=${hub.hostname}` : null,
                hub.jobId ? `job=${hub.jobId}` : null,
                hub.jobName ? `name=${hub.jobName}` : null
            ].filter(Boolean).join(' | ')
            console.log(`${chalk.yellow(hub.hubId)} ${chalk.gray(`(${details})`)}`)
            console.log(chalk.gray(`  ${hub.publicUrl}`))
            console.log(chalk.gray(`  last seen ${new Date(hub.lastSeenAt).toLocaleString()}`))
            printFolders(hub)
        }
    }
}

export const serverCommand: CommandDefinition = {
    name: 'server',
    description: 'Manage the remote access server (start, stop, status)',
    requiresRuntimeAssets: false,
    run: async (context: CommandContext) => {
        try {
            if (context.commandArgs[0] === 'service') {
                runBrokerServiceCommand(context.commandArgs)
                return
            }
            if (context.commandArgs[0] === 'hubs') {
                await listBrokerHubs()
                return
            }

            const { host, port, publicUrl, token, showHelp, unexpectedArgs } = parseBrokerArgs(context.commandArgs)

            if (showHelp) {
                console.log(`
${chalk.bold('maglev server')}

Start the self-hosted remote access server on a stable machine such as a VNC/login node.

${chalk.bold('Usage:')}
  maglev server [options]
  maglev server hubs
  maglev server service install [options]
  maglev server service status
  maglev server service logs --follow

${chalk.bold('Options:')}
  --host <host>           Bind host (default: 0.0.0.0)
  --port <port>           Optional listen port; defaults to a free auto-picked port
  --public-url <url>      Optional public base URL; defaults to http://<hostname>:<port>
  --server-token <token>  Optional override for hub registration; default: ~/.maglev/server-key

${chalk.bold('Environment:')}
  MAGLEV_SERVER_LISTEN_HOST
  MAGLEV_SERVER_LISTEN_PORT
  MAGLEV_SERVER_PUBLIC_URL
  MAGLEV_SERVER_TOKEN

${chalk.bold('Example:')}
  maglev server
  maglev server hubs
  maglev server --port 3010
  maglev server --public-url https://vnc-server.internal
`)
                process.exit(0)
            }

            if (unexpectedArgs.length > 0) {
                throw new Error(`Unexpected arguments: ${unexpectedArgs.join(' ')}. Use \`maglev server --help\`.`)
            }

            if (host) {
                process.env.MAGLEV_SERVER_LISTEN_HOST = host
            }
            if (port) {
                process.env.MAGLEV_SERVER_LISTEN_PORT = port
            }
            if (publicUrl) {
                process.env.MAGLEV_SERVER_PUBLIC_URL = publicUrl
            }
            if (token) {
                process.env.MAGLEV_SERVER_TOKEN = token
            }

            const { startBroker } = await import('../../../hub/src/broker')
            await startBroker()
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (context.commandArgs[0] === 'service') {
                console.error(chalk.gray('Expected workflow: `maglev server service <install|start|stop|restart|status|logs|uninstall>`'))
            }
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
