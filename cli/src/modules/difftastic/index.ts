/**
 * Low-level difftastic wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { platform } from 'os';
import { existsSync } from 'fs';
import { runtimePath } from '@/projectPath';

export interface DifftasticResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface DifftasticOptions {
    cwd?: string
}

/**
 * Get the platform-specific binary path
 */
function getBinaryName(): string {
    const platformName = platform();
    return platformName === 'win32' ? 'difft.exe' : 'difft';
}

function getBinaryPath(): string {
    const configuredPath = process.env.MAGLEV_DIFFTASTIC_PATH?.trim();
    if (configuredPath) {
        return configuredPath;
    }

    const binaryName = getBinaryName();
    const bundledPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
    if (existsSync(bundledPath)) {
        return bundledPath;
    }

    return binaryName;
}

/**
 * Run difftastic with the given arguments
 * @param args - Array of command line arguments to pass to difftastic
 * @param options - Options for difftastic execution
 * @returns Promise with exit code, stdout and stderr
 */
export function run(args: string[], options?: DifftasticOptions): Promise<DifftasticResult> {
    const binaryPath = getBinaryPath();
    
    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options?.cwd,
            env: {
                ...process.env,
                // Force color output when needed
                FORCE_COLOR: '1'
            }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                exitCode: code || 0,
                stdout,
                stderr
            });
        });

        child.on('error', (err) => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(new Error('difftastic not found. Install `difft` on PATH or set MAGLEV_DIFFTASTIC_PATH.'));
                return;
            }
            reject(err);
        });
    });
}
