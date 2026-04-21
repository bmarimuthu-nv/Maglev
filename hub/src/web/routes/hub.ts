import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import type { HubLaunchFolder } from '../../hubConfig'
import type { SyncEngine } from '../../sync/syncEngine'
import { configuration } from '../../configuration'
import { z } from 'zod'

const spawnBodySchema = z.object({
    directory: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
    notesPath: z.string().min(1).max(1024).optional(),
    createNotesFile: z.boolean().optional(),
    parentSessionId: z.string().optional(),
    pinned: z.boolean().optional(),
    autoRespawn: z.boolean().optional(),
    startupCommand: z.string().max(4000).optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional()
})

const spawnPairBodySchema = z.object({
    directory: z.string().min(1),
    name: z.string().min(1).max(255)
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

const worktreesSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

export function createHubRoutes(
    getSyncEngine: () => SyncEngine | null,
    getLaunchFolders: () => Promise<HubLaunchFolder[]>
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/hub', async (c) => {
        try {
            const folders = await getLaunchFolders()
            const engine = getSyncEngine()
            const namespace = c.get('namespace')
            const machine = engine?.getBoundMachine(namespace) ?? null
            return c.json({
                name: process.env.MAGLEV_HUB_NAME ?? null,
                machineId: configuration.boundMachineId,
                machine,
                folders
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load hub config'
            const engine = getSyncEngine()
            const namespace = c.get('namespace')
            const machine = engine?.getBoundMachine(namespace) ?? null
            return c.json({
                name: process.env.MAGLEV_HUB_NAME ?? null,
                machineId: configuration.boundMachineId,
                machine,
                folders: [],
                error: message
            })
        }
    })

    app.post('/hub/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const result = await engine.spawnSessionForBoundMachine(
            namespace,
            parsed.data.directory,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            undefined,
            parsed.data.startupCommand?.trim() || undefined
        )
        if (result.type === 'success') {
            if (parsed.data.name?.trim()) {
                await engine.renameSession(result.sessionId, parsed.data.name.trim())
            }
            if (parsed.data.notesPath?.trim()) {
                await engine.setSessionNotesPath(result.sessionId, parsed.data.notesPath.trim())
                if (parsed.data.createNotesFile) {
                    await engine.writeSessionFile(
                        result.sessionId,
                        parsed.data.notesPath.trim(),
                        '',
                        null
                    )
                }
            }
            if (parsed.data.parentSessionId) {
                await engine.setParentSessionId(result.sessionId, parsed.data.parentSessionId)
            }
            if (parsed.data.pinned !== undefined || parsed.data.autoRespawn !== undefined || parsed.data.startupCommand !== undefined) {
                await engine.setShellSessionOptions(result.sessionId, {
                    pinned: parsed.data.pinned,
                    autoRespawn: parsed.data.autoRespawn,
                    startupCommand: parsed.data.startupCommand?.trim() || null
                })
            }
        }
        return c.json(result)
    })

    app.post('/hub/spawn-pair', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnPairBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.createTerminalPair(c.get('namespace'), parsed.data)
        if (result.type === 'error') {
            return c.json(result, 409)
        }
        return c.json(result)
    })

    app.post('/hub/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = pathsExistsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }

        try {
            const exists = await engine.checkPathsExistForBoundMachine(c.get('namespace'), uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.post('/hub/worktrees', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = worktreesSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ worktrees: [] })
        }

        try {
            const worktrees = await engine.listWorktreesForBoundMachine(c.get('namespace'), uniquePaths)
            return c.json({ worktrees })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to list worktrees' }, 500)
        }
    })

    return app
}
