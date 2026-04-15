/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { platform } from 'os';
import { existsSync } from 'fs';
import { runtimePath } from '@/projectPath';
import { withBunRuntimeEnv } from '@/utils/bunRuntime';

export interface RipgrepResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface RipgrepOptions {
    cwd?: string
}

function getBinaryName(): string {
    const platformName = platform();
    return platformName === 'win32' ? 'rg.exe' : 'rg';
}

function getBinaryPath(): string {
    const configuredPath = process.env.MAGLEV_RIPGREP_PATH?.trim();
    if (configuredPath) {
        return configuredPath;
    }

    const binaryName = getBinaryName();
    const bundledPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
    return resolve(binaryName) === binaryName ? binaryName : bundledPath;
}

function getSpawnPath(): string {
    const binaryName = getBinaryName();
    const configuredPath = process.env.MAGLEV_RIPGREP_PATH?.trim();
    if (configuredPath) {
        return configuredPath;
    }

    const bundledPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));
    if (bundledPath && requirePathExists(bundledPath)) {
        return bundledPath;
    }

    return binaryName;
}

function requirePathExists(path: string): boolean {
    return existsSync(path);
}

export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
    const binaryPath = getSpawnPath();
    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options?.cwd,
            env: withBunRuntimeEnv()
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
                reject(new Error('ripgrep not found. Install `rg` on PATH or set MAGLEV_RIPGREP_PATH.'));
                return;
            }
            reject(err);
        });
    });
}
