import chalk from 'chalk'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { hostname } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { configuration } from '@/configuration'
import { spawnMaglevCli } from '@/utils/spawnMaglevCli'
import { isProcessAlive, killProcess } from '@/utils/process'
import type { CommandDefinition, CommandContext } from './types'

const HUB_SERVICE_NAME = 'maglev-hub.service'
const HUB_DAEMON_DIR = join(configuration.maglevHomeDir, 'hub-daemons')

type ParsedHubArgs = { host?: string; port?: string; brokerUrl?: string; brokerToken?: string; name?: string; configPath?: string; debug?: boolean }
type HubDaemonState = {
    name: string
    pid: number
    logPath: string
    args: string[]
    machineId?: string
    startedAt: string
}

function parseHubArgs(args: string[]): ParsedHubArgs {
    const result: ParsedHubArgs = {}

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--host' && i + 1 < args.length) {
            result.host = args[++i]
        } else if (arg === '--port' && i + 1 < args.length) {
            result.port = args[++i]
        } else if (arg === '--broker-url' && i + 1 < args.length) {
            result.brokerUrl = args[++i]
        } else if (arg === '--broker-token' && i + 1 < args.length) {
            result.brokerToken = args[++i]
        } else if (arg === '--name' && i + 1 < args.length) {
            result.name = args[++i]
        } else if (arg === '--config' && i + 1 < args.length) {
            result.configPath = args[++i]
        } else if (arg === '--debug') {
            result.debug = true
        } else if (arg.startsWith('--host=')) {
            result.host = arg.slice('--host='.length)
        } else if (arg.startsWith('--port=')) {
            result.port = arg.slice('--port='.length)
        } else if (arg.startsWith('--broker-url=')) {
            result.brokerUrl = arg.slice('--broker-url='.length)
        } else if (arg.startsWith('--broker-token=')) {
            result.brokerToken = arg.slice('--broker-token='.length)
        } else if (arg.startsWith('--name=')) {
            result.name = arg.slice('--name='.length)
        } else if (arg.startsWith('--config=')) {
            result.configPath = arg.slice('--config='.length)
        }
    }

    return result
}

function printHubHelp(): void {
    console.log(`
${chalk.bold('maglev hub')}

Start the bundled hub directly, or manage named hub daemons.

${chalk.bold('Usage:')}
  maglev hub --debug --name <name> [options]
  maglev hub <start|stop|restart|status|logs|list> [options]
  maglev hub service <install|start|stop|restart|status|logs|uninstall>

${chalk.bold('Options:')}
  --host <host>           Bind host
  --port <port>           Listen port
  --broker-url <url>      Broker URL for remote mode
  --broker-token <token>  Optional broker registration token
  --name <name>           Stable hub name (default: hostname)
  --config <path>         Optional hub config YAML
  --debug                 Run hub in the foreground for debugging

${chalk.bold('Examples:')}
  maglev hub start --name devbox-a --remote
  maglev hub start --name devbox-a --remote --config ~/.maglev/devbox-a.yaml
  maglev hub restart --name devbox-a --config ~/.maglev/devbox-a-next.yaml
  maglev hub --debug --name devbox-a --remote
  maglev hub logs --name devbox-a --follow
  maglev hub list
`)
}

function parseDaemonActionAndArgs(args: string[]): { action: string | null; passthroughArgs: string[] } {
    if (args.length === 0) {
        return { action: null, passthroughArgs: [] }
    }

    const first = args[0]
    if (first === 'help' || first === '-h' || first === '--help') {
        return { action: 'help', passthroughArgs: [] }
    }

    return { action: first, passthroughArgs: args.slice(1) }
}

async function findFreePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const server = createServer()
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to determine an available hub port')))
                return
            }
            const { port } = address
            server.close((error) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve(port)
            })
        })
        server.on('error', reject)
    })
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
        return `${escapeSystemdArg(runtime)} ${escapeSystemdArg(entrypoint)} hub --remote`
    }

    return `${escapeSystemdArg(runtime)} hub --remote`
}

function sanitizeDaemonName(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) {
        throw new Error('Hub name cannot be empty')
    }
    const sanitized = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    if (!sanitized) {
        throw new Error(`Hub name "${name}" does not contain usable characters`)
    }
    return sanitized
}

function getHubNamespace(name: string): string {
    return `hub-${sanitizeDaemonName(name)}`
}

function getDaemonNameFromArgs(args: string[]): string {
    const parsed = parseHubArgs(args)
    if (parsed.name) {
        return sanitizeDaemonName(parsed.name)
    }
    const positionalName = args.find((arg) => !arg.startsWith('-'))
    if (positionalName) {
        return sanitizeDaemonName(positionalName)
    }
    return sanitizeDaemonName(hostname() || 'local')
}

function ensureHubDaemonDir(): void {
    mkdirSync(HUB_DAEMON_DIR, { recursive: true })
}

function getDaemonStatePath(name: string): string {
    return join(HUB_DAEMON_DIR, `${name}.json`)
}

function getDaemonLogPath(name: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logId = randomUUID().slice(0, 8)
    return join(configuration.logsDir, `hub-${name}-${timestamp}-${logId}.log`)
}

function isHubLogFileForName(name: string, filename: string): boolean {
    return filename === `hub-${name}.log`
        || (filename.startsWith(`hub-${name}-`) && filename.endsWith('.log'))
}

function listHubLogPaths(name: string): string[] {
    if (!existsSync(configuration.logsDir)) {
        return []
    }
    return readdirSync(configuration.logsDir)
        .filter((filename) => isHubLogFileForName(name, filename))
        .map((filename) => join(configuration.logsDir, filename))
}

function getLatestHubLogPath(name: string): string | null {
    return listHubLogPaths(name).sort((left, right) => {
        try {
            return statSync(right).mtimeMs - statSync(left).mtimeMs
        } catch {
            return right.localeCompare(left)
        }
    })[0] ?? null
}

function pruneHubLogs(name: string, keep: number = 3): void {
    const logs = listHubLogPaths(name)
        .sort((left, right) => {
            try {
                return statSync(right).mtimeMs - statSync(left).mtimeMs
            } catch {
                return right.localeCompare(left)
            }
        })

    for (const staleLog of logs.slice(keep)) {
        try {
            rmSync(staleLog, { force: true })
        } catch {
            // Best-effort cleanup only.
        }
    }
}

function readDaemonState(name: string): HubDaemonState | null {
    const statePath = getDaemonStatePath(name)
    if (!existsSync(statePath)) {
        return null
    }
    try {
        return JSON.parse(readFileSync(statePath, 'utf8')) as HubDaemonState
    } catch {
        return null
    }
}

function writeDaemonState(state: HubDaemonState): void {
    ensureHubDaemonDir()
    writeFileSync(getDaemonStatePath(state.name), JSON.stringify(state, null, 2), 'utf8')
}

function clearDaemonState(name: string): void {
    const statePath = getDaemonStatePath(name)
    if (existsSync(statePath)) {
        rmSync(statePath)
    }
}

function isDaemonRunning(state: HubDaemonState | null): boolean {
    return Boolean(state && Number.isFinite(state.pid) && isProcessAlive(state.pid))
}

function ensureMachineIdForHub(name: string): string {
    const existingMachineId = readDaemonState(name)?.machineId?.trim()
    if (existingMachineId) {
        return existingMachineId
    }
    return randomUUID()
}

function buildHubRuntimeEnv(args: string[], machineIdOverride?: string): NodeJS.ProcessEnv {
    const env = { ...process.env }
    const { host, port, brokerUrl, brokerToken, name, configPath } = parseHubArgs(args)

    if (host) {
        env.MAGLEV_LISTEN_HOST = host
        env.WEBAPP_HOST = host
    }
    if (port) {
        env.MAGLEV_LISTEN_PORT = port
        env.WEBAPP_PORT = port
    }
    if (brokerUrl) {
        env.MAGLEV_BROKER_URL = brokerUrl
    }
    if (brokerToken) {
        env.MAGLEV_BROKER_TOKEN = brokerToken
    }
    if (configPath) {
        env.MAGLEV_HUB_CONFIG = configPath
    }
    if (name) {
        const sanitizedName = sanitizeDaemonName(name)
        env.MAGLEV_HUB_NAME = sanitizedName
        env.MAGLEV_NAMESPACE = getHubNamespace(sanitizedName)
        env.DB_PATH = join(configuration.maglevHomeDir, `maglev-${sanitizedName}.db`)
        const persistedMachineId = machineIdOverride ?? readDaemonState(sanitizedName)?.machineId
        if (persistedMachineId) {
            env.MAGLEV_MACHINE_ID = persistedMachineId
        }
    }
    return env
}

function getHubApiBaseUrl(args: string[]): string {
    const { host, port } = parseHubArgs(args)
    const normalizedHost = !host || host === '0.0.0.0' || host === '::'
        ? '127.0.0.1'
        : host
    const normalizedPort = port ?? '3006'
    return `http://${normalizedHost}:${normalizedPort}`
}

async function waitForHubReady(baseUrl: string, timeoutMs: number = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastError: string | null = null

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/health`, {
                signal: AbortSignal.timeout(1_500)
            })
            if (response.ok) {
                return
            }
            lastError = `HTTP ${response.status}`
        } catch (error) {
            lastError = error instanceof Error ? error.message : 'unknown error'
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }

    throw new Error(`Hub did not become ready at ${baseUrl} (${lastError ?? 'timed out'})`)
}

async function runCliCommandAndWait(args: string[], env: NodeJS.ProcessEnv, outputFd?: number): Promise<void> {
    const child = spawnMaglevCli(args, {
        env,
        stdio: outputFd === undefined ? 'ignore' : ['ignore', outputFd, outputFd]
    })

    await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => {
            if (code === 0) {
                resolve()
                return
            }
            reject(new Error(`\`maglev ${args.join(' ')}\` exited with status ${code ?? 'unknown'}`))
        })
    })
}

async function ensureRunnerForHub(commandArgs: string[], logFd: number): Promise<void> {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const env = buildHubRuntimeEnv(['--name', daemonName, ...filterDaemonStartArgs(commandArgs)])
    const apiUrl = getHubApiBaseUrl(commandArgs)
    env.MAGLEV_API_URL = apiUrl
    await waitForHubReady(apiUrl)
    await runCliCommandAndWait(['runner', 'start'], env, logFd)
}

async function stopRunnerForHub(commandArgs: string[], logFd?: number): Promise<void> {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const env = buildHubRuntimeEnv(['--name', daemonName, ...filterDaemonStartArgs(commandArgs)])
    const apiUrl = getHubApiBaseUrl(commandArgs)
    env.MAGLEV_API_URL = apiUrl
    try {
        await runCliCommandAndWait(['runner', 'stop'], env, logFd)
    } catch {
    }
}

function filterDaemonStartArgs(args: string[]): string[] {
    const flagsWithValue = new Set(['--host', '--port', '--broker-url', '--broker-token', '--name', '--config'])
    const filtered: string[] = []
    let skippedPositionalName = false
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--follow' || arg === '-f') {
            continue
        }
        if (flagsWithValue.has(arg)) {
            if (arg === '--name') {
                i += 1
                continue
            }
            filtered.push(arg)
            if (i + 1 < args.length) {
                filtered.push(args[++i])
            }
            continue
        }
        if (arg.startsWith('--name=')) {
            continue
        }
        if (!arg.startsWith('-') && !skippedPositionalName) {
            skippedPositionalName = true
            continue
        }
        filtered.push(arg)
    }
    return filtered
}

function mergeDaemonArgs(storedArgs: string[] | undefined, overrideArgs: string[]): string[] {
    if (!storedArgs || storedArgs.length === 0) {
        return overrideArgs
    }

    const merged: string[] = []
    const overrideMap = new Map<string, string[]>()
    const passthroughFlags = new Set<string>()
    const valueFlags = new Set(['--host', '--port', '--broker-url', '--broker-token', '--config'])

    for (let i = 0; i < overrideArgs.length; i++) {
        const arg = overrideArgs[i]
        const eqMatch = arg.match(/^(--[a-z-]+)=(.*)$/)
        if (eqMatch && valueFlags.has(eqMatch[1])) {
            overrideMap.set(eqMatch[1], [eqMatch[1], eqMatch[2]])
            continue
        }
        if (valueFlags.has(arg)) {
            const next = overrideArgs[i + 1]
            if (next !== undefined) {
                overrideMap.set(arg, [arg, next])
                i += 1
                continue
            }
        }
        passthroughFlags.add(arg)
    }

    for (let i = 0; i < storedArgs.length; i++) {
        const arg = storedArgs[i]
        const eqMatch = arg.match(/^(--[a-z-]+)=(.*)$/)
        if (eqMatch && valueFlags.has(eqMatch[1])) {
            const replacement = overrideMap.get(eqMatch[1])
            if (replacement) {
                merged.push(...replacement)
                overrideMap.delete(eqMatch[1])
            } else {
                merged.push(arg)
            }
            continue
        }
        if (valueFlags.has(arg)) {
            const replacement = overrideMap.get(arg)
            const next = storedArgs[i + 1]
            if (replacement) {
                merged.push(...replacement)
                overrideMap.delete(arg)
            } else {
                merged.push(arg)
                if (next !== undefined) {
                    merged.push(next)
                }
            }
            i += 1
            continue
        }
        merged.push(arg)
        passthroughFlags.delete(arg)
    }

    for (const [flag, pair] of overrideMap.entries()) {
        merged.push(...pair)
        overrideMap.delete(flag)
    }

    for (const flag of passthroughFlags) {
        if (!merged.includes(flag)) {
            merged.push(flag)
        }
    }

    return merged
}

export const __test__ = {
    parseHubArgs,
    filterDaemonStartArgs,
    mergeDaemonArgs
}

async function resolveHubStartupArgs(args: string[]): Promise<string[]> {
    const parsed = parseHubArgs(args)
    if (parsed.port) {
        return args
    }

    const port = await findFreePort()
    return [...args, '--port', String(port)]
}

async function startHubDaemon(commandArgs: string[]): Promise<void> {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const existing = readDaemonState(daemonName)
    if (isDaemonRunning(existing)) {
        const pid = existing?.pid ?? 'unknown'
        console.log(`Hub daemon "${daemonName}" is already running (PID ${pid})`)
        return
    }

    const passthroughArgs = await resolveHubStartupArgs(filterDaemonStartArgs(commandArgs))
    const machineId = ensureMachineIdForHub(daemonName)
    const daemonArgs = ['hub', 'daemon-run', '--name', daemonName, ...passthroughArgs]
    const logPath = getDaemonLogPath(daemonName)
    const fd = openSync(logPath, 'a')
    try {
        // Always clear the namespaced runner first so a stale runner cannot shadow this hub start.
        await stopRunnerForHub(['--name', daemonName, ...passthroughArgs], fd)

        const child = spawnMaglevCli(daemonArgs, {
            detached: true,
            stdio: ['ignore', fd, fd],
            env: buildHubRuntimeEnv(['--name', daemonName, ...passthroughArgs], machineId)
        })
        child.unref()

        if (!child.pid) {
            throw new Error('Failed to start hub daemon process')
        }

        writeDaemonState({
            name: daemonName,
            pid: child.pid,
            logPath,
            args: passthroughArgs,
            machineId,
            startedAt: new Date().toISOString()
        })
        pruneHubLogs(daemonName, 3)

        try {
            await ensureRunnerForHub(['--name', daemonName, ...passthroughArgs], fd)
        } catch (error) {
            await killProcess(child.pid, true)
            clearDaemonState(daemonName)
            throw error
        }
    } finally {
        closeSync(fd)
    }

    console.log(chalk.green(`Started hub daemon "${daemonName}"`))
    console.log(chalk.gray(`Logs: ${logPath}`))
}

async function stopHubDaemon(commandArgs: string[]): Promise<void> {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const state = readDaemonState(daemonName)
    if (!state) {
        console.log(`Hub daemon "${daemonName}" is not installed`)
        return
    }
    if (!isDaemonRunning(state)) {
        clearDaemonState(daemonName)
        console.log(`Hub daemon "${daemonName}" is not running`)
        return
    }

    await stopRunnerForHub(['--name', daemonName, ...(state.args ?? [])])
    await killProcess(state.pid, false)
    clearDaemonState(daemonName)
    console.log(chalk.green(`Stopped hub daemon "${daemonName}"`))
}

async function restartHubDaemon(commandArgs: string[]): Promise<void> {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const existing = readDaemonState(daemonName)
    const passthroughArgs = mergeDaemonArgs(existing?.args, filterDaemonStartArgs(commandArgs))
    await stopHubDaemon(['--name', daemonName])
    await startHubDaemon(['--name', daemonName, ...passthroughArgs])
}

function statusHubDaemon(commandArgs: string[]): void {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const state = readDaemonState(daemonName)
    if (!state) {
        console.log(`Hub daemon "${daemonName}": not installed`)
        return
    }
    if (!isDaemonRunning(state)) {
        console.log(`Hub daemon "${daemonName}": stopped`)
        console.log(`  log: ${state.logPath}`)
        return
    }
    console.log(`Hub daemon "${daemonName}": running`)
    console.log(`  pid: ${state.pid}`)
    console.log(`  log: ${state.logPath}`)
    console.log(`  started: ${state.startedAt}`)
}

function logsHubDaemon(commandArgs: string[]): void {
    const daemonName = getDaemonNameFromArgs(commandArgs)
    const state = readDaemonState(daemonName)
    const logPath = state?.logPath ?? getLatestHubLogPath(daemonName)
    if (!logPath || !existsSync(logPath)) {
        throw new Error(`No log file found for hub daemon "${daemonName}"`)
    }
    const follow = commandArgs.includes('--follow') || commandArgs.includes('-f')
    const result = spawnSync('tail', follow ? ['-f', logPath] : ['-n', '100', logPath], {
        stdio: 'inherit',
        env: process.env
    })
    if (result.error) {
        throw new Error(`Failed to run tail: ${result.error.message}`)
    }
    if (result.status !== 0) {
        throw new Error(`tail exited with status ${result.status}`)
    }
}

function listHubDaemons(): void {
    ensureHubDaemonDir()
    const entries = readdirSync(HUB_DAEMON_DIR).filter((name) => name.endsWith('.json')).sort()
    if (entries.length === 0) {
        console.log('No hub daemons configured')
        return
    }
    for (const entry of entries) {
        const state = readDaemonState(entry.slice(0, -'.json'.length))
        if (!state) {
            continue
        }
        const status = isDaemonRunning(state) ? `running (PID ${state.pid})` : 'stopped'
        console.log(`${state.name}: ${status}`)
    }
}

async function runHubDaemonCommand(commandArgs: string[]): Promise<void> {
    const { action, passthroughArgs } = parseDaemonActionAndArgs(commandArgs)
    switch (action) {
        case 'start':
            await startHubDaemon(passthroughArgs)
            return
        case 'stop':
            await stopHubDaemon(passthroughArgs)
            return
        case 'restart':
            await restartHubDaemon(passthroughArgs)
            return
        case 'status':
            statusHubDaemon(passthroughArgs)
            return
        case 'logs':
            logsHubDaemon(passthroughArgs)
            return
        case 'list':
            if (passthroughArgs.length > 0) {
                throw new Error(`Unexpected arguments for hub daemon list: ${passthroughArgs.join(' ')}`)
            }
            listHubDaemons()
            return
        case 'help':
            printHubHelp()
            return
        default:
            throw new Error('Unexpected or missing hub action. Use `maglev hub help`.')
    }
}

function ensureLinuxSystemdUser(action: string): void {
    if (process.platform !== 'linux') {
        throw new Error(`\`maglev hub service ${action}\` currently supports Linux user-level systemd only`)
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

function installHubUserService(commandArgs: string[]): void {
    ensureLinuxSystemdUser('install')

    const extraArgs = commandArgs.filter((arg) => arg !== 'service' && arg !== 'install')
    if (extraArgs.length > 0) {
        throw new Error(`Unsupported arguments for service install: ${extraArgs.join(' ')}`)
    }

    const home = process.env.HOME?.trim()
    if (!home) {
        throw new Error('HOME is not set')
    }

    const serviceDir = resolve(home, '.config/systemd/user')
    const servicePath = resolve(serviceDir, HUB_SERVICE_NAME)
    const execStart = buildExecStart()
    const service = `[Unit]
Description=maglev hub
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
    const wasActive = existsSync(servicePath) && isSystemdUserServiceActive(HUB_SERVICE_NAME)
    writeFileSync(servicePath, service, 'utf8')

    runSystemctl(['daemon-reload'])
    runSystemctl(['enable', HUB_SERVICE_NAME])
    runSystemctl([wasActive ? 'restart' : 'start', HUB_SERVICE_NAME])

    console.log(chalk.green(`Installed and ${wasActive ? 'restarted' : 'started'} user service: ${HUB_SERVICE_NAME}`))
    console.log(chalk.gray(`Service file: ${servicePath}`))
    console.log(chalk.gray('Manage it with:'))
    console.log(chalk.gray('  maglev hub service status'))
    console.log(chalk.gray('  maglev hub service logs'))
    console.log(chalk.gray('  maglev hub service restart'))
    console.log(chalk.gray('Optional: keep it running after logout with `loginctl enable-linger $USER`'))
}

function requireHome(): string {
    const home = process.env.HOME?.trim()
    if (!home) {
        throw new Error('HOME is not set')
    }
    return home
}

function getServicePath(): string {
    return resolve(requireHome(), '.config/systemd/user', HUB_SERVICE_NAME)
}

function ensureServiceExists(): void {
    if (!existsSync(getServicePath())) {
        throw new Error(`Service is not installed. Run \`maglev hub service install\` first`)
    }
}

function startHubUserService(): void {
    ensureLinuxSystemdUser('start')
    ensureServiceExists()
    runSystemctl(['start', HUB_SERVICE_NAME])
}

function stopHubUserService(): void {
    ensureLinuxSystemdUser('stop')
    ensureServiceExists()
    runSystemctl(['stop', HUB_SERVICE_NAME])
}

function restartHubUserService(): void {
    ensureLinuxSystemdUser('restart')
    ensureServiceExists()
    runSystemctl(['restart', HUB_SERVICE_NAME])
}

function statusHubUserService(): void {
    ensureLinuxSystemdUser('status')
    ensureServiceExists()
    runSystemctl(['status', HUB_SERVICE_NAME])
}

function logsHubUserService(commandArgs: string[]): void {
    ensureLinuxSystemdUser('logs')
    ensureServiceExists()

    const follow = commandArgs.includes('--follow') || commandArgs.includes('-f')
    const result = spawnSync('journalctl', ['--user', '-u', HUB_SERVICE_NAME, ...(follow ? ['-f'] : ['-n', '100'])], {
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

function uninstallHubUserService(): void {
    ensureLinuxSystemdUser('uninstall')
    const servicePath = getServicePath()
    if (!existsSync(servicePath)) {
        throw new Error('Service is not installed')
    }

    runSystemctl(['disable', '--now', HUB_SERVICE_NAME])
    rmSync(servicePath)
    runSystemctl(['daemon-reload'])
    console.log(chalk.green(`Removed user service: ${HUB_SERVICE_NAME}`))
}

function runHubServiceCommand(commandArgs: string[]): void {
    const action = commandArgs[1]

    switch (action) {
        case 'install':
            installHubUserService(commandArgs)
            return
        case 'start':
            startHubUserService()
            return
        case 'stop':
            stopHubUserService()
            return
        case 'restart':
            restartHubUserService()
            return
        case 'status':
            statusHubUserService()
            return
        case 'logs':
            logsHubUserService(commandArgs)
            return
        case 'uninstall':
            uninstallHubUserService()
            return
        default:
            console.log(`
${chalk.bold('maglev hub service')} - Manage the user-level hub daemon

${chalk.bold('Usage:')}
  maglev hub service install
  maglev hub service start
  maglev hub service stop
  maglev hub service restart
  maglev hub service status
  maglev hub service logs [-f|--follow]
  maglev hub service uninstall
`)
    }
}

export const hubCommand: CommandDefinition = {
    name: 'hub',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        try {
            if (context.commandArgs[0] === 'help' || context.commandArgs[0] === '-h' || context.commandArgs[0] === '--help') {
                printHubHelp()
                return
            }

            if (context.commandArgs[0] === 'daemon-run') {
                const passthroughArgs = context.commandArgs.slice(1)
                const { host, port, brokerUrl, brokerToken, name: parsedName, configPath } = parseHubArgs(passthroughArgs)
                const name = parsedName || sanitizeDaemonName(hostname() || 'local')
                if (host) {
                    process.env.MAGLEV_LISTEN_HOST = host
                    process.env.WEBAPP_HOST = host
                }
                if (port) {
                    process.env.MAGLEV_LISTEN_PORT = port
                    process.env.WEBAPP_PORT = port
                }
                if (brokerUrl) {
                    process.env.MAGLEV_BROKER_URL = brokerUrl
                }
                if (brokerToken) {
                    process.env.MAGLEV_BROKER_TOKEN = brokerToken
                }
                if (configPath) {
                    process.env.MAGLEV_HUB_CONFIG = configPath
                }
                if (name) {
                    process.env.MAGLEV_HUB_NAME = name
                    process.env.MAGLEV_NAMESPACE = getHubNamespace(name)
                }
                await import('../../../hub/src/index')
                return
            }

            const hubLifecycleCommands = new Set(['start', 'stop', 'restart', 'status', 'logs', 'list'])
            if (context.commandArgs[0] === 'daemon') {
                await runHubDaemonCommand(context.commandArgs.slice(1))
                return
            }
            if (context.commandArgs[0] && hubLifecycleCommands.has(context.commandArgs[0])) {
                await runHubDaemonCommand(context.commandArgs)
                return
            }

            if (context.commandArgs[0] === 'service') {
                runHubServiceCommand(context.commandArgs)
                return
            }

            const { host, port, brokerUrl, brokerToken, name: parsedName, configPath, debug } = parseHubArgs(context.commandArgs)
            const name = parsedName || sanitizeDaemonName(hostname() || 'local')
            const allowedPrefixes = ['--host', '--port', '--broker-url', '--broker-token', '--name', '--config', '--remote', '--debug']
            const unexpectedArgs = context.commandArgs.filter((arg) => {
                if (!arg.startsWith('-')) {
                    return true
                }
                return !allowedPrefixes.some((prefix) => arg === prefix || arg.startsWith(`${prefix}=`))
            })
            if (unexpectedArgs.length > 0) {
                throw new Error(`Unexpected arguments for hub: ${unexpectedArgs.join(' ')}. Use \`maglev hub help\`.`)
            }
            if (!debug) {
                throw new Error('Foreground hub runs are debug-only. Use `maglev hub start`, or add `--debug` for a direct foreground run.')
            }
            const resolvedArgs = await resolveHubStartupArgs(context.commandArgs)
            const resolved = parseHubArgs(resolvedArgs)
            const machineId = resolved.name ? ensureMachineIdForHub(resolved.name) : null

            if (resolved.host) {
                process.env.MAGLEV_LISTEN_HOST = resolved.host
                process.env.WEBAPP_HOST = resolved.host
            }
            if (resolved.port) {
                process.env.MAGLEV_LISTEN_PORT = resolved.port
                process.env.WEBAPP_PORT = resolved.port
            }
            if (resolved.brokerUrl) {
                process.env.MAGLEV_BROKER_URL = resolved.brokerUrl
            }
            if (resolved.brokerToken) {
                process.env.MAGLEV_BROKER_TOKEN = resolved.brokerToken
            }
            if (resolved.configPath) {
                process.env.MAGLEV_HUB_CONFIG = resolved.configPath
            }
            if (resolved.name) {
                process.env.MAGLEV_HUB_NAME = resolved.name
                process.env.MAGLEV_NAMESPACE = getHubNamespace(resolved.name)
            }
            if (machineId) {
                process.env.MAGLEV_MACHINE_ID = machineId
            }
            await import('../../../hub/src/index')
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (context.commandArgs[0] === 'daemon' || ['start', 'stop', 'restart', 'status', 'logs', 'list'].includes(context.commandArgs[0] ?? '')) {
                console.error(chalk.gray('Expected workflow: `maglev hub <start|stop|restart|status|logs|list>`'))
            }
            if (context.commandArgs[0] === 'service') {
                console.error(chalk.gray('Expected workflow: `maglev hub service <install|start|stop|restart|status|logs|uninstall>`'))
            }
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
