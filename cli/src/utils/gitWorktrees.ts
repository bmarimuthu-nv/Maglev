import { execFile } from 'node:child_process'
import { dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type DetectedWorktree = {
    repoRoot: string
    path: string
    branch?: string
    isCurrent: boolean
}

async function runGit(args: string[], cwd: string): Promise<string> {
    const result = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8'
    })
    return result.stdout.trim()
}

function normalizeGitPath(rawPath: string, cwd: string): string {
    return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
}

export function parseGitWorktreeListPorcelain(output: string, repoRoot: string): DetectedWorktree[] {
    const entries: DetectedWorktree[] = []
    const normalizedRepoRoot = resolve(repoRoot)
    const lines = output.split(/\r?\n/)
    let currentPath: string | null = null
    let currentBranch: string | undefined

    const commit = () => {
        if (!currentPath) {
            return
        }
        entries.push({
            repoRoot: normalizedRepoRoot,
            path: currentPath,
            branch: currentBranch,
            isCurrent: currentPath === normalizedRepoRoot
        })
    }

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
            commit()
            currentPath = null
            currentBranch = undefined
            continue
        }
        if (line.startsWith('worktree ')) {
            commit()
            currentPath = resolve(line.slice('worktree '.length).trim())
            currentBranch = undefined
            continue
        }
        if (!currentPath) {
            continue
        }
        if (line.startsWith('branch ')) {
            const ref = line.slice('branch '.length).trim()
            currentBranch = ref.replace(/^refs\/heads\//, '') || ref
            continue
        }
        if (line === 'detached') {
            currentBranch = '(detached)'
        }
    }

    commit()
    return entries
}

export async function listGitWorktreesForPaths(paths: string[]): Promise<DetectedWorktree[]> {
    const repoRoots = new Map<string, string>()
    const worktrees = new Map<string, DetectedWorktree>()

    for (const rawPath of paths) {
        const candidatePath = rawPath.trim()
        if (!candidatePath) {
            continue
        }

        try {
            const commonDir = normalizeGitPath(await runGit(['rev-parse', '--git-common-dir'], candidatePath), candidatePath)
            const repoRoot = resolve(dirname(commonDir))
            repoRoots.set(repoRoot, repoRoot)
        } catch {
            continue
        }
    }

    for (const repoRoot of repoRoots.values()) {
        try {
            const output = await runGit(['worktree', 'list', '--porcelain'], repoRoot)
            for (const entry of parseGitWorktreeListPorcelain(output, repoRoot)) {
                worktrees.set(entry.path, entry)
            }
        } catch {
            continue
        }
    }

    return Array.from(worktrees.values()).sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
            return left.isCurrent ? -1 : 1
        }
        if (left.repoRoot !== right.repoRoot) {
            return left.repoRoot.localeCompare(right.repoRoot)
        }
        return left.path.localeCompare(right.path)
    })
}
