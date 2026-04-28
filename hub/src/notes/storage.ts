import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Session } from '@maglev/protocol/types'
import { configuration } from '../configuration'

type WorkspaceNotesLocation = {
    fsPath: string
    displayPath: string
}

function normalizeRequestedNotesPath(requestedPath: string | null | undefined): string {
    const trimmed = requestedPath?.trim() || 'notes.txt'
    const normalized = trimmed.replaceAll('\\', '/').replace(/^\/+/, '')
    const pieces = normalized
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => part !== '.')
        .filter((part) => part !== '..')

    if (pieces.length === 0) {
        return 'notes.txt'
    }

    return pieces.join('/')
}

function toDisplayPath(fsPath: string, dataDir: string, userHomeDir: string = homedir()): string {
    const normalizedFsPath = resolve(fsPath)
    const normalizedDataDir = resolve(dataDir)
    const normalizedHomeDir = resolve(userHomeDir)

    if (normalizedFsPath.startsWith(`${normalizedDataDir}${sep}`) || normalizedFsPath === normalizedDataDir) {
        const fromHome = relative(normalizedHomeDir, normalizedFsPath)
        if (fromHome && !fromHome.startsWith('..')) {
            return `~/${fromHome.replaceAll(sep, '/')}`
        }
    }

    return normalizedFsPath
}

export function buildWorkspaceNotesLocation(options: {
    dataDir: string
    workspacePath: string
    namespace: string
    requestedPath?: string | null
    userHomeDir?: string
}): WorkspaceNotesLocation {
    const normalizedWorkspacePath = resolve(options.workspacePath)
    const requestedRelativePath = normalizeRequestedNotesPath(options.requestedPath)
    const workspaceKey = createHash('sha256')
        .update(options.namespace)
        .update('\0')
        .update(normalizedWorkspacePath)
        .digest('hex')
        .slice(0, 16)

    const fsPath = join(
        options.dataDir,
        'notes',
        'workspaces',
        options.namespace,
        workspaceKey,
        ...requestedRelativePath.split('/')
    )

    return {
        fsPath,
        displayPath: toDisplayPath(fsPath, options.dataDir, options.userHomeDir)
    }
}

export function resolveSessionNotesLocation(session: Session): WorkspaceNotesLocation {
    const configuredNotesPath = session.metadata?.notesPath?.trim() || null
    if (configuredNotesPath) {
        if (configuredNotesPath.startsWith('~/')) {
            const fsPath = join(homedir(), configuredNotesPath.slice(2))
            return { fsPath, displayPath: configuredNotesPath }
        }
        if (isAbsolute(configuredNotesPath)) {
            return { fsPath: configuredNotesPath, displayPath: configuredNotesPath }
        }
    }

    const workspacePath = session.metadata?.path?.trim()
    if (!workspacePath) {
        throw new Error('Session metadata missing workspace path for notes')
    }

    return buildWorkspaceNotesLocation({
        dataDir: configuration.dataDir,
        workspacePath,
        namespace: session.namespace,
        requestedPath: configuredNotesPath
    })
}

export function ensureNotesParentDir(fsPath: string): void {
    mkdirSync(dirname(fsPath), { recursive: true })
}
