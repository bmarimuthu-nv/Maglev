import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { z } from 'zod'

const HubFolderEntrySchema = z.union([
    z.string().min(1),
    z.object({
        label: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        wt: z.string().min(1).optional()
    }).refine((value) => Boolean(value.path || value.wt), {
        message: 'Folder entry requires either path or wt'
    })
])

const HubConfigSchema = z.object({
    folders: z.array(HubFolderEntrySchema).default([])
})

export type HubLaunchFolder = {
    label: string
    path: string
    branch?: string
    source: 'path' | 'wt'
}

function dedupeLaunchFolders(folders: HubLaunchFolder[]): HubLaunchFolder[] {
    const seen = new Set<string>()
    const deduped: HubLaunchFolder[] = []
    for (const folder of folders) {
        const key = `${folder.source}\0${folder.path}\0${folder.branch ?? ''}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        deduped.push(folder)
    }
    return deduped
}

function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function resolveWtShortcut(shortcut: string): string {
    const shell = process.env.SHELL?.trim() || 'bash'
    const result = spawnSync(shell, ['-lc', `wt ${shellEscape(shortcut)}`], {
        encoding: 'utf8',
        env: process.env
    })
    if (result.error) {
        throw new Error(`Failed to run wt ${shortcut}: ${result.error.message}`)
    }
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || `wt ${shortcut} failed`).trim())
    }
    const resolvedPath = result.stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean).pop()
    if (!resolvedPath) {
        throw new Error(`wt ${shortcut} did not return a path`)
    }
    return resolvedPath
}

function normalizeFolder(entry: z.infer<typeof HubFolderEntrySchema>): HubLaunchFolder {
    if (typeof entry === 'string') {
        const path = resolve(entry)
        return {
            label: basename(path) || path,
            path,
            source: 'path'
        }
    }

    if (entry.wt) {
        const path = resolveWtShortcut(entry.wt)
        return {
            label: entry.label?.trim() || entry.branch?.trim() || entry.wt,
            path: resolve(path),
            branch: entry.branch?.trim() || undefined,
            source: 'wt'
        }
    }

    const path = resolve(entry.path!)
    return {
        label: entry.label?.trim() || entry.branch?.trim() || basename(path) || path,
        path,
        branch: entry.branch?.trim() || undefined,
        source: 'path'
    }
}

function parseSimpleHubConfig(content: string): unknown {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.replace(/\t/g, '    '))

    const folders: Array<string | Record<string, string>> = []
    let inFolders = false
    let currentObject: Record<string, string> | null = null

    const commitCurrentObject = () => {
        if (currentObject && Object.keys(currentObject).length > 0) {
            folders.push(currentObject)
        }
        currentObject = null
    }

    for (const rawLine of lines) {
        const withoutComment = rawLine.replace(/\s+#.*$/, '')
        if (!withoutComment.trim()) {
            continue
        }

        if (!inFolders) {
            if (withoutComment.trim() === 'folders:') {
                inFolders = true
            }
            continue
        }

        const line = withoutComment.trimEnd()
        const trimmed = line.trim()
        if (!trimmed.startsWith('-') && !/^[A-Za-z0-9_-]+\s*:/.test(trimmed)) {
            continue
        }

        if (trimmed.startsWith('- ')) {
            commitCurrentObject()
            const value = trimmed.slice(2).trim()
            if (!value) {
                currentObject = {}
                continue
            }

            const inlineMatch = value.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
            if (inlineMatch) {
                currentObject = { [inlineMatch[1]]: inlineMatch[2].trim() }
                continue
            }

            folders.push(value)
            continue
        }

        if (currentObject) {
            const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
            if (match) {
                currentObject[match[1]] = match[2].trim()
            }
        }
    }

    commitCurrentObject()
    return { folders }
}

export async function loadHubLaunchFolders(): Promise<HubLaunchFolder[]> {
    const configPath = process.env.MAGLEV_HUB_CONFIG?.trim()
    if (!configPath) {
        return []
    }

    const resolvedConfigPath = resolve(configPath)
    if (!existsSync(resolvedConfigPath)) {
        throw new Error(`Hub config file not found: ${resolvedConfigPath}`)
    }

    const content = await readFile(resolvedConfigPath, 'utf8')
    const raw = parseSimpleHubConfig(content)
    const parsed = HubConfigSchema.parse(raw)
    return dedupeLaunchFolders(parsed.folders.map(normalizeFolder))
}

export async function loadHubLaunchFoldersSafe(): Promise<{
    folders: HubLaunchFolder[]
    error: string | null
}> {
    try {
        return {
            folders: await loadHubLaunchFolders(),
            error: null
        }
    } catch (error) {
        return {
            folders: [],
            error: error instanceof Error ? error.message : 'Failed to load hub config'
        }
    }
}

export const __test__ = {
    dedupeLaunchFolders
}
