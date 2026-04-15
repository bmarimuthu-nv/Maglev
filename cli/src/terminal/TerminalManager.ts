import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { getCurrentNamespace } from '@/utils/namespace'
import type {
    TerminalErrorPayload,
    TerminalExitPayload,
    TerminalOutputPayload,
    TerminalReadyPayload
} from '@maglev/protocol'
import type { TerminalSession } from './types'

type TerminalRuntime = TerminalSession & {
    proc: Bun.Subprocess
    terminal: Bun.Terminal
    idleTimer: ReturnType<typeof setTimeout> | null
    outputBuffer: string
    tmuxSessionName: string
    clientInstanceId: number
}

type TerminalManagerOptions = {
    sessionId: string
    getSessionPath: () => string | null
    getStartupCommand?: () => string | null
    onReady: (payload: TerminalReadyPayload) => void
    onOutput: (payload: TerminalOutputPayload) => void
    onExit: (payload: TerminalExitPayload) => void
    onError: (payload: TerminalErrorPayload) => void
    idleTimeoutMs?: number
    maxTerminals?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 0
const DEFAULT_MAX_TERMINALS = 4
const DEFAULT_OUTPUT_BUFFER_CHARS = 200_000
const SENSITIVE_ENV_KEYS = new Set([
    'MAGLEV_API_TOKEN',
    'MAGLEV_API_URL',
    'MAGLEV_HTTP_MCP_URL',
    'TELEGRAM_BOT_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY'
])
const TMUX_ENV_KEYS = new Set(['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR'])

let tmuxAvailability: boolean | null = null

type TmuxCheckResult =
    | { status: 'exists' }
    | { status: 'missing' }
    | { status: 'error'; message: string }

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveShell(): string {
    if (process.env.SHELL) {
        return process.env.SHELL
    }
    if (process.platform === 'darwin') {
        return '/bin/zsh'
    }
    return '/bin/bash'
}

function buildStartupShellCommand(): string {
    return 'eval "$1"\nexec "$0" -i'
}

function buildFilteredEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (!value) {
            continue
        }
        if (SENSITIVE_ENV_KEYS.has(key)) {
            continue
        }
        if (TMUX_ENV_KEYS.has(key)) {
            continue
        }
        env[key] = value
    }
    return env
}

function getTmuxSessionName(sessionId: string, terminalId: string): string {
    const digest = createHash('sha256').update(`${sessionId}:${terminalId}`).digest('hex').slice(0, 24)
    return `maglev-${digest}`
}

function getTmuxSocketDir(): string {
    const namespace = getCurrentNamespace().replace(/[^a-zA-Z0-9._-]+/g, '-')
    return join(configuration.maglevHomeDir, 'tmux', namespace)
}

export class TerminalManager {
    private readonly sessionId: string
    private readonly getSessionPath: () => string | null
    private readonly getStartupCommand: () => string | null
    private readonly onReady: (payload: TerminalReadyPayload) => void
    private readonly onOutput: (payload: TerminalOutputPayload) => void
    private readonly onExit: (payload: TerminalExitPayload) => void
    private readonly onError: (payload: TerminalErrorPayload) => void
    private readonly idleTimeoutMs: number
    private readonly maxTerminals: number
    private readonly outputBufferChars: number
    private readonly terminals: Map<string, TerminalRuntime> = new Map()
    private readonly filteredEnv: NodeJS.ProcessEnv
    private readonly tmuxSocketPath: string

    constructor(options: TerminalManagerOptions) {
        this.sessionId = options.sessionId
        this.getSessionPath = options.getSessionPath
        this.getStartupCommand = options.getStartupCommand ?? (() => null)
        this.onReady = options.onReady
        this.onOutput = options.onOutput
        this.onExit = options.onExit
        this.onError = options.onError
        this.idleTimeoutMs = options.idleTimeoutMs ?? resolveEnvNumber('MAGLEV_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
        this.maxTerminals = options.maxTerminals ?? resolveEnvNumber('MAGLEV_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS)
        this.outputBufferChars = resolveEnvNumber('MAGLEV_TERMINAL_OUTPUT_BUFFER_CHARS', DEFAULT_OUTPUT_BUFFER_CHARS)
        this.filteredEnv = buildFilteredEnv()
        this.tmuxSocketPath = join(getTmuxSocketDir(), 'default.sock')
    }

    create(terminalId: string, cols: number, rows: number, options?: { createIfMissing?: boolean }): void {
        if (process.platform === 'win32') {
            this.emitError(terminalId, 'Terminal is not supported on Windows.')
            return
        }

        if (typeof Bun === 'undefined' || typeof Bun.spawn !== 'function') {
            this.emitError(terminalId, 'Terminal is unavailable in this runtime.')
            return
        }

        const existing = this.terminals.get(terminalId)
        if (existing) {
            this.reattachClient(existing, cols, rows)
            return
        }

        if (this.terminals.size >= this.maxTerminals) {
            this.emitError(terminalId, `Too many terminals open (max ${this.maxTerminals}).`)
            return
        }

        const sessionPath = this.getSessionPath() ?? process.cwd()
        const tmuxSessionName = getTmuxSessionName(this.sessionId, terminalId)
        if (!this.ensureTmuxSession(
            tmuxSessionName,
            sessionPath,
            terminalId,
            options?.createIfMissing ?? true,
            this.getStartupCommand()?.trim() || null
        )) {
            return
        }

        const runtime = this.spawnTmuxClient(terminalId, tmuxSessionName, cols, rows, 1, '')
        if (!runtime) {
            return
        }

        this.terminals.set(terminalId, runtime)
        this.markActivity(runtime)
        this.onReady({ sessionId: this.sessionId, terminalId })
    }

    write(terminalId: string, data: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            this.emitError(terminalId, 'Terminal not found.')
            return
        }
        runtime.terminal.write(data)
        this.markActivity(runtime)
    }

    resize(terminalId: string, cols: number, rows: number): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        runtime.cols = cols
        runtime.rows = rows
        runtime.terminal.resize(cols, rows)
        this.markActivity(runtime)
    }

    close(terminalId: string): void {
        this.cleanup(terminalId)
    }

    closeAll(options?: { preserveSessions?: boolean }): void {
        for (const terminalId of this.terminals.keys()) {
            this.cleanup(terminalId, options)
        }
    }

    private markActivity(runtime: TerminalRuntime): void {
        this.scheduleIdleTimer(runtime)
    }

    private scheduleIdleTimer(runtime: TerminalRuntime): void {
        if (this.idleTimeoutMs <= 0) {
            return
        }

        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }

        runtime.idleTimer = setTimeout(() => {
            this.emitError(runtime.terminalId, 'Terminal closed due to inactivity.')
            this.cleanup(runtime.terminalId)
        }, this.idleTimeoutMs)
    }

    private cleanup(terminalId: string, options?: { preserveSessions?: boolean }): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }

        this.terminals.delete(terminalId)
        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }
        this.destroyClient(runtime)
        if (options?.preserveSessions !== true) {
            this.killTmuxSession(runtime.tmuxSessionName)
        }
    }

    private emitError(terminalId: string, message: string): void {
        this.onError({ sessionId: this.sessionId, terminalId, message })
    }

    private appendOutput(terminalId: string, chunk: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime || this.outputBufferChars <= 0 || !chunk) {
            return
        }
        runtime.outputBuffer += chunk
        if (runtime.outputBuffer.length > this.outputBufferChars) {
            runtime.outputBuffer = runtime.outputBuffer.slice(runtime.outputBuffer.length - this.outputBufferChars)
        }
    }

    private reattachClient(runtime: TerminalRuntime, cols: number, rows: number): void {
        const nextClientInstanceId = runtime.clientInstanceId + 1
        runtime.clientInstanceId = nextClientInstanceId
        this.destroyClient(runtime)
        const next = this.spawnTmuxClient(
            runtime.terminalId,
            runtime.tmuxSessionName,
            cols,
            rows,
            nextClientInstanceId,
            ''
        )
        if (!next) {
            this.terminals.delete(runtime.terminalId)
            this.emitError(runtime.terminalId, 'Failed to reattach terminal.')
            return
        }
        this.terminals.set(runtime.terminalId, next)
        this.markActivity(next)
        this.onReady({ sessionId: this.sessionId, terminalId: runtime.terminalId })
    }

    private spawnTmuxClient(
        terminalId: string,
        tmuxSessionName: string,
        cols: number,
        rows: number,
        clientInstanceId: number,
        outputBuffer: string
    ): TerminalRuntime | null {
        const decoder = new TextDecoder()

        try {
            const proc = Bun.spawn(['tmux', '-S', this.tmuxSocketPath, 'attach-session', '-t', tmuxSessionName], {
                cwd: this.getSessionPath() ?? process.cwd(),
                env: this.filteredEnv,
                terminal: {
                    cols,
                    rows,
                    data: (terminal, data) => {
                        const text = decoder.decode(data, { stream: true })
                        if (text) {
                            this.appendOutput(terminalId, text)
                            this.onOutput({ sessionId: this.sessionId, terminalId, data: text })
                        }
                        const active = this.terminals.get(terminalId)
                        if (active && active.clientInstanceId === clientInstanceId) {
                            this.markActivity(active)
                        }
                    },
                    exit: (terminal, exitCode) => {
                        if (exitCode === 1) {
                            this.emitError(terminalId, 'Terminal stream closed unexpectedly.')
                        }
                    }
                },
                onExit: (subprocess, exitCode) => {
                    const current = this.terminals.get(terminalId)
                    if (!current || current.clientInstanceId !== clientInstanceId) {
                        return
                    }
                    const signal = subprocess.signalCode ?? null
                    this.onExit({
                        sessionId: this.sessionId,
                        terminalId,
                        code: exitCode ?? null,
                        signal
                    })
                    this.cleanup(terminalId)
                }
            })

            const terminal = proc.terminal
            if (!terminal) {
                try {
                    proc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill process after missing terminal', { error })
                }
                this.emitError(terminalId, 'Failed to attach terminal.')
                return null
            }

            return {
                terminalId,
                cols,
                rows,
                proc,
                terminal,
                idleTimer: null,
                outputBuffer,
                tmuxSessionName,
                clientInstanceId
            }
        } catch (error) {
            logger.debug('[TERMINAL] Failed to spawn tmux client', { error, terminalId, tmuxSessionName })
            this.emitError(terminalId, 'Failed to spawn tmux client.')
            return null
        }
    }

    private ensureTmuxSession(
        tmuxSessionName: string,
        sessionPath: string,
        terminalId: string,
        createIfMissing: boolean,
        startupCommand: string | null
    ): boolean {
        if (!this.isTmuxAvailable()) {
            this.emitError(terminalId, 'tmux is required for terminals but is not installed.')
            return false
        }

        const checkResult = this.checkTmuxSession(tmuxSessionName)
        if (checkResult.status === 'exists') {
            return true
        }
        if (checkResult.status === 'error') {
            this.emitError(terminalId, checkResult.message)
            return false
        }
        if (!createIfMissing) {
            this.emitError(terminalId, 'Shell backend is unavailable. Start a new shell session.')
            return false
        }

        this.ensureTmuxSocketDir()

        const shellPath = resolveShell()
        const tmuxCommandArgs = startupCommand
            ? ['-S', this.tmuxSocketPath, 'new-session', '-d', '-s', tmuxSessionName, '-c', sessionPath, shellPath, '-i', '-c', buildStartupShellCommand(), shellPath, startupCommand]
            : ['-S', this.tmuxSocketPath, 'new-session', '-d', '-s', tmuxSessionName, '-c', sessionPath, shellPath]

        const result = spawnSync('tmux', tmuxCommandArgs, {
            env: this.filteredEnv,
            stdio: 'pipe'
        })
        if (result.status === 0) {
            return true
        }

        const message = result.stderr?.toString().trim()
            || result.stdout?.toString().trim()
            || result.error?.message
            || 'Failed to create tmux session.'
        this.emitError(terminalId, message)
        return false
    }

    checkSessionExists(terminalId: string): TmuxCheckResult {
        const tmuxSessionName = getTmuxSessionName(this.sessionId, terminalId)
        return this.checkTmuxSession(tmuxSessionName)
    }

    private checkTmuxSession(tmuxSessionName: string): TmuxCheckResult {
        this.ensureTmuxSocketDir()
        const result = spawnSync('tmux', ['-S', this.tmuxSocketPath, 'has-session', '-t', tmuxSessionName], {
            env: this.filteredEnv,
            stdio: 'pipe'
        })
        if (result.status === 0) {
            return { status: 'exists' }
        }
        const stderr = result.stderr?.toString().trim() ?? ''
        const stdout = result.stdout?.toString().trim() ?? ''
        const combined = stderr || stdout || result.error?.message || ''
        if (result.status === 1 && !combined.includes('/tmp/tmux-')) {
            return { status: 'missing' }
        }
        logger.debug('[TERMINAL] tmux has-session failed', {
            tmuxSessionName,
            tmuxSocketPath: this.tmuxSocketPath,
            status: result.status,
            stderr,
            stdout,
            error: result.error?.message
        })
        return { status: 'error', message: combined || 'Terminal backend is unavailable.' }
    }

    private isTmuxAvailable(): boolean {
        if (tmuxAvailability !== null) {
            return tmuxAvailability
        }
        const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' })
        tmuxAvailability = result.status === 0
        return tmuxAvailability
    }

    private killTmuxSession(tmuxSessionName: string): void {
        if (!this.isTmuxAvailable()) {
            return
        }
        this.ensureTmuxSocketDir()
        const result = spawnSync('tmux', ['-S', this.tmuxSocketPath, 'kill-session', '-t', tmuxSessionName], {
            env: this.filteredEnv,
            stdio: 'pipe'
        })
        if (result.status === 0 || result.status === 1) {
            return
        }
        logger.debug('[TERMINAL] Failed to kill tmux session', {
            tmuxSessionName,
            error: result.error?.message,
            stderr: result.stderr?.toString()
        })
    }

    private destroyClient(runtime: TerminalRuntime): void {
        if (!runtime.proc.killed && runtime.proc.exitCode === null) {
            try {
                runtime.proc.kill()
            } catch (error) {
                logger.debug('[TERMINAL] Failed to kill process', { error })
            }
        }

        try {
            runtime.terminal.close()
        } catch (error) {
            logger.debug('[TERMINAL] Failed to close terminal', { error })
        }
    }

    private ensureTmuxSocketDir(): void {
        const tmuxSocketDir = getTmuxSocketDir()
        if (!existsSync(tmuxSocketDir)) {
            mkdirSync(tmuxSocketDir, { recursive: true, mode: 0o700 })
        }
    }
}
