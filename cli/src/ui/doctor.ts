/**
 * Doctor command implementation
 * 
 * Provides comprehensive diagnostics and troubleshooting information
 * for maglev CLI including configuration, runner status, logs, and links
 */

import chalk from 'chalk'
import { configuration } from '@/configuration'
import { readSettings } from '@/persistence'
import { checkIfRunnerRunningAndCleanupStaleState } from '@/runner/controlClient'
import { findRunawayMaglevProcesses, findAllMaglevProcesses } from '@/runner/doctor'
import { readRunnerState } from '@/persistence'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isBunCompiled, projectPath, runtimePath } from '@/projectPath'
import packageJson from '../../package.json'

type ChecklistStatus = 'pass' | 'warn' | 'fail'

type ChecklistItem = {
    label: string
    status: ChecklistStatus
    detail: string
    nextStep?: string
}

type DoctorHubHealthResult =
    | {
        ok: true
        apiUrl: string
        healthUrl: string
    }
    | {
        ok: false
        apiUrl: string
        healthUrl: string | null
        reason: 'invalid-url' | 'timeout' | 'connection-refused' | 'http-error' | 'network-error'
        detail: string
        status?: number
    }

/**
 * Get relevant environment information for debugging
 */
export function getEnvironmentInfo(): Record<string, any> {
    return {
        PWD: process.env.PWD,
        MAGLEV_HOME: process.env.MAGLEV_HOME,
        MAGLEV_API_URL: process.env.MAGLEV_API_URL,
        MAGLEV_PROJECT_ROOT: process.env.MAGLEV_PROJECT_ROOT,
        MAGLEV_API_TOKEN_SET: Boolean(process.env.MAGLEV_API_TOKEN),
        DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING,
        NODE_ENV: process.env.NODE_ENV,
        DEBUG: process.env.DEBUG,
        workingDirectory: process.cwd(),
        processArgv: process.argv,
        maglevDir: configuration?.maglevHomeDir,
        apiUrl: configuration?.apiUrl,
        logsDir: configuration?.logsDir,
        processPid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        user: process.env.USER,
        home: process.env.HOME,
        shell: process.env.SHELL,
        terminal: process.env.TERM,
    };
}

function getErrorDetail(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'unknown error'
    }

    const details = [error.name, error.message]
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error) {
        details.push(cause.name, cause.message)
        const code = (cause as Error & { code?: string }).code
        if (code) {
            details.push(code)
        }
    }
    const code = (error as Error & { code?: string }).code
    if (code) {
        details.push(code)
    }

    return details.filter(Boolean).join(': ')
}

function classifyHubHealthError(error: unknown): Pick<Extract<DoctorHubHealthResult, { ok: false }>, 'reason' | 'detail'> {
    const detail = getErrorDetail(error)
    const normalizedDetail = detail.toLowerCase()

    if (normalizedDetail.includes('timeout')) {
        return { reason: 'timeout', detail }
    }
    if (normalizedDetail.includes('econnrefused') || normalizedDetail.includes('connection refused')) {
        return { reason: 'connection-refused', detail }
    }

    return { reason: 'network-error', detail }
}

async function inspectHubHealth(apiUrl: string, timeoutMs: number = 3000): Promise<DoctorHubHealthResult> {
    let healthUrl: string

    try {
        healthUrl = new URL('/health', apiUrl).toString()
    } catch (error) {
        return {
            ok: false,
            apiUrl,
            healthUrl: null,
            reason: 'invalid-url',
            detail: getErrorDetail(error)
        }
    }

    try {
        const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(timeoutMs)
        })
        if (response.ok) {
            return { ok: true, apiUrl, healthUrl }
        }
        return {
            ok: false,
            apiUrl,
            healthUrl,
            reason: 'http-error',
            status: response.status,
            detail: `HTTP ${response.status}`
        }
    } catch (error) {
        return {
            ok: false,
            apiUrl,
            healthUrl,
            ...classifyHubHealthError(error)
        }
    }
}

async function inspectSettingsFile(settingsFile: string): Promise<ChecklistItem> {
    if (!existsSync(settingsFile)) {
        return {
            label: 'settings.json',
            status: 'pass',
            detail: `Not created yet at ${settingsFile}`,
            nextStep: 'This is normal on a fresh install; settings will be created as needed.'
        }
    }

    try {
        const content = await readFile(settingsFile, 'utf8')
        JSON.parse(content)
        return {
            label: 'settings.json',
            status: 'pass',
            detail: `Valid JSON at ${settingsFile}`
        }
    } catch (error) {
        return {
            label: 'settings.json',
            status: 'fail',
            detail: `Invalid JSON at ${settingsFile}`,
            nextStep: `Fix or remove the file, then retry. Parse error: ${getErrorDetail(error)}`
        }
    }
}

function inspectRequiredTool(
    toolName: string,
    envVarName: string,
    env: NodeJS.ProcessEnv = process.env,
    which: (name: string) => string | null = (name) => typeof Bun?.which === 'function' ? Bun.which(name) : null
): ChecklistItem {
    const overridePath = env[envVarName]?.trim()
    if (overridePath) {
        if (existsSync(overridePath)) {
            return {
                label: toolName,
                status: 'pass',
                detail: `${envVarName} -> ${overridePath}`
            }
        }
        return {
            label: toolName,
            status: 'fail',
            detail: `${envVarName} points to a missing path: ${overridePath}`,
            nextStep: `Fix ${envVarName} or install ${toolName} on PATH.`
        }
    }

    const resolved = which(toolName)
    if (resolved) {
        return {
            label: toolName,
            status: 'pass',
            detail: `Found on PATH at ${resolved}`
        }
    }

    return {
        label: toolName,
        status: 'fail',
        detail: `${toolName} is not on PATH`,
        nextStep: `Install ${toolName} or set ${envVarName} to its full path.`
    }
}

async function buildFirstRunChecklist(apiUrl: string = configuration.apiUrl): Promise<ChecklistItem[]> {
    const items: ChecklistItem[] = []
    const hubHealth = await inspectHubHealth(apiUrl)
    if (hubHealth.ok) {
        items.push({
            label: 'hub /health',
            status: 'pass',
            detail: `Reachable at ${hubHealth.healthUrl}`
        })
    } else {
        const nextStepByReason: Record<Extract<DoctorHubHealthResult, { ok: false }>['reason'], string> = {
            'invalid-url': 'Set MAGLEV_API_URL to a valid base URL such as http://localhost:3006.',
            'timeout': 'If the hub is still starting, wait and retry; otherwise inspect `maglev hub logs -f`.',
            'connection-refused': 'Start a hub with `maglev hub start`, or point MAGLEV_API_URL at a running hub.',
            'http-error': 'Check whether MAGLEV_API_URL points at the right service and port.',
            'network-error': 'Check network reachability or correct MAGLEV_API_URL.'
        }
        items.push({
            label: 'hub /health',
            status: 'fail',
            detail: hubHealth.reason === 'http-error'
                ? `Expected 200 OK from ${hubHealth.healthUrl ?? `${hubHealth.apiUrl}/health`}, got HTTP ${hubHealth.status ?? 'unknown'}`
                : `Could not verify hub health at ${hubHealth.healthUrl ?? hubHealth.apiUrl}: ${hubHealth.detail}`,
            nextStep: nextStepByReason[hubHealth.reason]
        })
    }

    items.push(await inspectSettingsFile(configuration.settingsFile))
    items.push(inspectRequiredTool('rg', 'MAGLEV_RIPGREP_PATH'))
    items.push(inspectRequiredTool('difft', 'MAGLEV_DIFFTASTIC_PATH'))

    return items
}

function formatChecklistStatus(status: ChecklistStatus): string {
    switch (status) {
        case 'pass':
            return chalk.green('PASS')
        case 'warn':
            return chalk.yellow('WARN')
        case 'fail':
            return chalk.red('FAIL')
    }
}

export const __test__ = {
    classifyHubHealthError,
    inspectHubHealth,
    inspectSettingsFile,
    inspectRequiredTool,
    buildFirstRunChecklist
}

function getLogFiles(logDir: string): { file: string, path: string, modified: Date }[] {
    if (!existsSync(logDir)) {
        return [];
    }

    try {
        return readdirSync(logDir)
            .filter(file => file.endsWith('.log'))
            .map(file => {
                const path = join(logDir, file);
                const stats = statSync(path);
                return { file, path, modified: stats.mtime };
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());
    } catch {
        return [];
    }
}

/**
 * Run doctor command specifically for runner diagnostics
 */
export async function runDoctorRunner(): Promise<void> {
    return runDoctorCommand('runner');
}

export async function runDoctorCommand(filter?: 'all' | 'runner'): Promise<void> {
    // Default to 'all' if no filter specified
    if (!filter) {
        filter = 'all';
    }
    
    console.log(chalk.bold.cyan('\n🩺 maglev CLI Doctor\n'));

    // For 'all' filter, show everything. For 'runner', only show runner-related info
    if (filter === 'all') {
        // Version and basic info
        console.log(chalk.bold('📋 Basic Information'));
        console.log(`maglev CLI Version: ${chalk.green(packageJson.version)}`);
        console.log(`Platform: ${chalk.green(process.platform)} ${process.arch}`);
        console.log(`Node.js Version: ${chalk.green(process.version)}`);
        console.log('');

        // Runner spawn diagnostics
        console.log(chalk.bold('🔧 Runner Spawn Diagnostics'));
        const projectRoot = projectPath();
        const cliEntrypoint = join(projectRoot, 'src', 'index.ts');

        if (isBunCompiled()) {
            console.log(`Executable: ${chalk.blue(process.execPath)}`);
            console.log(`Runtime Assets: ${chalk.blue(runtimePath())}`);
        } else {
            console.log(`Project Root: ${chalk.blue(projectRoot)}`);
            console.log(`CLI Entrypoint: ${chalk.blue(cliEntrypoint)}`);
            console.log(`CLI Exists: ${existsSync(cliEntrypoint) ? chalk.green('✓ Yes') : chalk.red('❌ No')}`);
        }
        console.log('');

        // Configuration
        console.log(chalk.bold('⚙️  Configuration'));
        console.log(`maglev Home: ${chalk.blue(configuration.maglevHomeDir)}`);
        console.log(`Bot URL: ${chalk.blue(configuration.apiUrl)}`);
        console.log(`Logs Dir: ${chalk.blue(configuration.logsDir)}`);

        // Environment
        console.log(chalk.bold('\n🌍 Environment Variables'));
        const env = getEnvironmentInfo();
        console.log(`MAGLEV_HOME: ${env.MAGLEV_HOME ? chalk.green(env.MAGLEV_HOME) : chalk.gray('not set')}`);
        console.log(`MAGLEV_API_URL: ${env.MAGLEV_API_URL ? chalk.green(env.MAGLEV_API_URL) : chalk.gray('not set')}`);
        console.log(`MAGLEV_API_TOKEN: ${env.MAGLEV_API_TOKEN_SET ? chalk.green('set') : chalk.gray('not set')}`);
        console.log(`DANGEROUSLY_LOG_TO_SERVER: ${env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING ? chalk.yellow('ENABLED') : chalk.gray('not set')}`);
        console.log(`DEBUG: ${env.DEBUG ? chalk.green(env.DEBUG) : chalk.gray('not set')}`);
        console.log(`NODE_ENV: ${env.NODE_ENV ? chalk.green(env.NODE_ENV) : chalk.gray('not set')}`);

        console.log(chalk.bold('\n🚦 First-Run Checklist'));
        const checklist = await buildFirstRunChecklist(configuration.apiUrl)
        for (const item of checklist) {
            console.log(`${formatChecklistStatus(item.status)} ${item.label}: ${item.detail}`)
            if (item.nextStep) {
                console.log(chalk.gray(`  Next: ${item.nextStep}`))
            }
        }

        // Settings
        let settings;
        try {
            settings = await readSettings();
            console.log(chalk.bold('\n📄 Settings (settings.json):'));
            // Hide cliApiToken in output for security
            const displaySettings = { ...settings, cliApiToken: settings.cliApiToken ? '***' : undefined };
            console.log(chalk.gray(JSON.stringify(displaySettings, null, 2)));
        } catch (error) {
            console.log(chalk.bold('\n📄 Settings:'));
            console.log(chalk.red('❌ Failed to read settings'));
            settings = {};
        }

        // Authentication status (direct-connect)
        console.log(chalk.bold('\n🔐 Direct Connect Auth'));
        const envToken = process.env.MAGLEV_API_TOKEN;
        const settingsToken = settings.cliApiToken;
        const hasToken = Boolean(envToken || settingsToken);
        const tokenSource = envToken ? 'environment variable' : (settingsToken ? 'settings file' : 'none');
        if (hasToken) {
            console.log(chalk.green(`✓ MAGLEV_API_TOKEN is set (from ${tokenSource})`));
        } else {
            console.log(chalk.red('❌ MAGLEV_API_TOKEN is not set'));
            console.log(chalk.gray('  Run `maglev auth login` to configure or set MAGLEV_API_TOKEN env var'));
        }

    }

    // Runner status - shown for both 'all' and 'runner' filters
    console.log(chalk.bold('\n🤖 Runner Status'));
    try {
        const isRunning = await checkIfRunnerRunningAndCleanupStaleState();
        const state = await readRunnerState();

        if (isRunning && state) {
            console.log(chalk.green('✓ Runner is running'));
            console.log(`  PID: ${state.pid}`);
            console.log(`  Started: ${new Date(state.startTime).toLocaleString()}`);
            console.log(`  CLI Version: ${state.startedWithCliVersion}`);
            if (state.httpPort) {
                console.log(`  HTTP Port: ${state.httpPort}`);
            }
        } else if (state && !isRunning) {
            console.log(chalk.yellow('⚠️  Runner state exists but process not running (stale)'));
        } else {
            console.log(chalk.red('❌ Runner is not running'));
        }

        // Show runner state file
        if (state) {
            console.log(chalk.bold('\n📄 Runner State:'));
            console.log(chalk.blue(`Location: ${configuration.runnerStateFile}`));
            console.log(chalk.gray(JSON.stringify(state, null, 2)));
        }

        // All maglev processes
        const allProcesses = await findAllMaglevProcesses();
        if (allProcesses.length > 0) {
            console.log(chalk.bold('\n🔍 All maglev CLI Processes'));

            // Group by type
            const grouped = allProcesses.reduce((groups, process) => {
                if (!groups[process.type]) groups[process.type] = [];
                groups[process.type].push(process);
                return groups;
            }, {} as Record<string, typeof allProcesses>);

            // Display each group
            Object.entries(grouped).forEach(([type, processes]) => {
                const typeLabels: Record<string, string> = {
                    'current': '📍 Current Process',
                    'runner': '🤖 Runner',
                    'runner-version-check': '🔍 Runner Version Check (stuck)',
                    'runner-spawned-session': '🔗 Runner-Spawned Sessions',
                    'user-session': '👤 User Sessions',
                    'dev-runner': '🛠️  Dev Runner',
                    'dev-runner-version-check': '🛠️  Dev Runner Version Check (stuck)',
                    'dev-session': '🛠️  Dev Sessions',
                    'dev-doctor': '🛠️  Dev Doctor',
                    'dev-related': '🛠️  Dev Related',
                    'doctor': '🩺 Doctor',
                    'unknown': '❓ Unknown'
                };

                console.log(chalk.blue(`\n${typeLabels[type] || type}:`));
                processes.forEach(({ pid, command }) => {
                    const color = type === 'current' ? chalk.green :
                        type.startsWith('dev') ? chalk.cyan :
                            type.includes('runner') ? chalk.blue : chalk.gray;
                    console.log(`  ${color(`PID ${pid}`)}: ${chalk.gray(command)}`);
                });
            });
        } else {
            console.log(chalk.red('❌ No maglev processes found'));
        }

        if (filter === 'all' && allProcesses.length > 1) { // More than just current process
            console.log(chalk.bold('\n💡 Process Management'));
            console.log(chalk.gray('To clean up runaway processes: maglev doctor clean'));
        }
    } catch (error) {
        console.log(chalk.red('❌ Error checking runner status'));
    }

    // Log files - only show for 'all' filter
    if (filter === 'all') {
        console.log(chalk.bold('\n📝 Log Files'));

        // Get ALL log files
        const allLogs = getLogFiles(configuration.logsDir);
        
        if (allLogs.length > 0) {
            // Separate runner and regular logs
            const runnerLogs = allLogs.filter(({ file }) => file.includes('runner'));
            const regularLogs = allLogs.filter(({ file }) => !file.includes('runner'));

            // Show regular logs (max 10)
            if (regularLogs.length > 0) {
                console.log(chalk.blue('\nRecent Logs:'));
                const logsToShow = regularLogs.slice(0, 10);
                logsToShow.forEach(({ file, path, modified }) => {
                    console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    console.log(chalk.gray(`    ${path}`));
                });
                if (regularLogs.length > 10) {
                    console.log(chalk.gray(`  ... and ${regularLogs.length - 10} more log files`));
                }
            }

            // Show runner logs (max 5)
            if (runnerLogs.length > 0) {
                console.log(chalk.blue('\nRunner Logs:'));
                const runnerLogsToShow = runnerLogs.slice(0, 5);
                runnerLogsToShow.forEach(({ file, path, modified }) => {
                    console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    console.log(chalk.gray(`    ${path}`));
                });
                if (runnerLogs.length > 5) {
                    console.log(chalk.gray(`  ... and ${runnerLogs.length - 5} more runner log files`));
                }
            } else {
                console.log(chalk.yellow('\nNo runner log files found'));
            }
        } else {
            console.log(chalk.yellow('No log files found'));
        }

        // Support and bug reports
        console.log(chalk.bold('\n🐛 Support & Bug Reports'));
        const pkg = packageJson as unknown as { bugs?: string | { url?: string }; homepage?: string }
        const bugsUrl = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url
        if (bugsUrl) {
            console.log(`Report issues: ${chalk.blue(bugsUrl)}`);
        }
        console.log(`Documentation: ${chalk.blue(pkg.homepage ?? 'See project README')}`);
    }

    console.log(chalk.green('\n✅ Doctor diagnosis complete!\n'));
}
