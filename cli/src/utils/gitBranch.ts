import { execFileSync } from 'node:child_process'

function runGit(args: string[], cwd: string): string | null {
    try {
        const output = execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        return output.length > 0 ? output : null
    } catch {
        return null
    }
}

export function readBranchFromGit(cwd: string): string | null {
    const branch = runGit(['symbolic-ref', '--short', 'HEAD'], cwd)
    if (branch) {
        return branch
    }

    const detachedRef = runGit(['rev-parse', '--short', 'HEAD'], cwd)
    if (detachedRef) {
        return `(detached ${detachedRef})`
    }

    return null
}
