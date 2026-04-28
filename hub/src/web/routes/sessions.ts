import { toSessionSummary } from '@maglev/protocol'
import { Hono } from 'hono'
import { z } from 'zod'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { configuration } from '../../configuration'
import { resolveTerminalSupervisionBridgeLocation } from '../../supervision/bridge'

const updateSessionSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    directory: z.string().trim().min(1).max(4000).optional(),
    parentSessionId: z.string().trim().min(1).max(255).nullable().optional(),
    childRole: z.enum(['review-terminal', 'split-terminal']).nullable().optional()
})

const pinSessionSchema = z.object({
    pinned: z.boolean()
})

const shellSessionOptionsSchema = z.object({
    startupCommand: z.string().max(4000).nullable().optional(),
    autoRespawn: z.boolean().optional(),
    pinned: z.boolean().optional()
})

const notesContentSchema = z.object({
    content: z.string()
})

function getNotesDir(): string {
    return join(configuration.dataDir, 'notes')
}

function getNotesFilePath(sessionId: string): string {
    return join(getNotesDir(), `${sessionId}.txt`)
}

const attachTerminalSupervisionSchema = z.object({
    workerSessionId: z.string().min(1)
})

const setTerminalSupervisionPausedSchema = z.object({
    paused: z.boolean()
})

const writeTerminalSupervisionSchema = z.object({
    data: z.string().min(1)
})

const terminalPairPausedSchema = z.object({
    paused: z.boolean()
})

const terminalPairRebindSchema = z.object({
    replacementSessionId: z.string().min(1)
})

const addTerminalPairSupervisorSchema = z.object({
    name: z.string().min(1).max(255)
})

const uploadSchema = z.object({
    filename: z.string().min(1).max(255),
    content: z.string().min(1),
    mimeType: z.string().min(1).max(255)
})

const uploadDeleteSchema = z.object({
    path: z.string().min(1)
})

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function estimateBase64Bytes(base64: string): number {
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

export function createSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const sessions = engine.getSessionsByNamespace(namespace)
            .sort((a, b) => {
                // Active sessions first
                if (a.active !== b.active) {
                    return a.active ? -1 : 1
                }
                return b.updatedAt - a.updatedAt
            })
            .map(toSessionSummary)

        return c.json({ sessions })
    })

    app.get('/sessions/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        return c.json({ session: sessionResult.session })
    })

    app.post('/sessions/:id/respawn-pinned-shell', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const namespace = c.get('namespace')
        const result = await engine.respawnPinnedShellSession(sessionResult.sessionId, namespace)
        if (result.type === 'error') {
            const status = result.code === 'no_machine_online' ? 503
                : result.code === 'access_denied' ? 403
                    : result.code === 'session_not_found' ? 404
                        : 409
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.get('/sessions/:id/terminal-supervision/target', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const target = engine.getTerminalSupervisionTarget(sessionResult.sessionId, c.get('namespace'))
            const supervisorPath = target.supervisor.metadata?.path?.trim()
            const bridge = supervisorPath
                ? await resolveTerminalSupervisionBridgeLocation(supervisorPath, target.supervisor.id)
                : null
            return c.json({
                worker: toSessionSummary(target.worker),
                supervisor: toSessionSummary(target.supervisor),
                bridge,
                snapshot: target.snapshot,
                events: target.events
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to resolve terminal supervision target' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-supervision/attach', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = attachTerminalSupervisionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.attachTerminalSupervision(sessionResult.sessionId, parsed.data.workerSessionId, c.get('namespace'))
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to attach terminal supervision' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-supervision/pause', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = setTerminalSupervisionPausedSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.setTerminalSupervisionPaused(sessionResult.sessionId, parsed.data.paused, c.get('namespace'))
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to update terminal supervision state' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-supervision/detach', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            await engine.detachTerminalSupervision(sessionResult.sessionId, c.get('namespace'))
            return c.json({ ok: true })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to detach terminal supervision' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-supervision/write', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = writeTerminalSupervisionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.writeTerminalSupervisionInput(sessionResult.sessionId, parsed.data.data, c.get('namespace'))
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to write terminal supervision input' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-pair/restart', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const result = await engine.restartTerminalPairBySession(sessionResult.sessionId, c.get('namespace'))
        if (result.type === 'error') {
            return c.json(result, 409)
        }
        return c.json(result)
    })

    app.post('/sessions/:id/terminal-pair/pause', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = terminalPairPausedSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const pair = await engine.setTerminalPairPausedBySession(sessionResult.sessionId, parsed.data.paused, c.get('namespace'))
            return c.json({ pair })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to update pair state' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-pair/rebind', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = terminalPairRebindSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const pair = await engine.rebindTerminalPairBySession(
                sessionResult.sessionId,
                parsed.data.replacementSessionId,
                c.get('namespace')
            )
            return c.json({ pair })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to rebind terminal pair' }, 409)
        }
    })

    app.post('/sessions/:id/terminal-pair/add-supervisor', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = addTerminalPairSupervisorSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.addSupervisorToWorkerSession(
            sessionResult.sessionId,
            c.get('namespace'),
            parsed.data
        )
        if (result.type === 'error') {
            return c.json(result, 409)
        }
        return c.json(result)
    })

    app.post('/sessions/:id/upload', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const estimatedBytes = estimateBase64Bytes(parsed.data.content)
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
            return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
        }

        try {
            const result = await engine.uploadFile(
                sessionResult.sessionId,
                parsed.data.filename,
                parsed.data.content,
                parsed.data.mimeType
            )
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    app.post('/sessions/:id/upload/delete', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadDeleteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.deleteUploadFile(sessionResult.sessionId, parsed.data.path)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete upload'
            }, 500)
        }
    })

    app.post('/sessions/:id/abort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.abortSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/archive', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.archiveSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/switch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.switchSession(sessionResult.sessionId, 'remote')
        return c.json({ ok: true })
    })

    app.patch('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = updateSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (
            parsed.data.name === undefined
            && parsed.data.directory === undefined
            && parsed.data.parentSessionId === undefined
            && parsed.data.childRole === undefined
        ) {
            return c.json({ error: 'At least one session update is required' }, 400)
        }

        try {
            await engine.updateSessionDetails(sessionResult.sessionId, {
                name: parsed.data.name,
                directory: parsed.data.directory
            })
            if (parsed.data.parentSessionId !== undefined) {
                await engine.setParentSessionId(sessionResult.sessionId, parsed.data.parentSessionId)
            }
            if (parsed.data.childRole !== undefined) {
                await engine.setChildRole(sessionResult.sessionId, parsed.data.childRole)
            }
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update session'
            // Map concurrency/version errors to 409 conflict
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.post('/sessions/:id/close', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            await engine.closeSession(sessionResult.sessionId)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to close session'
            return c.json({ error: message }, 500)
        }
    })

    app.patch('/sessions/:id/pin', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.metadata?.flavor !== 'shell') {
            return c.json({ error: 'Only shell sessions can be pinned' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = pinSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: pinned is required' }, 400)
        }

        try {
            await engine.setShellSessionOptions(sessionResult.sessionId, {
                pinned: parsed.data.pinned
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update session pin state'
            return c.json({ error: message }, 500)
        }
    })

    app.patch('/sessions/:id/shell-options', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.metadata?.flavor !== 'shell') {
            return c.json({ error: 'Only shell sessions support shell options' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = shellSessionOptionsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (parsed.data.pinned === undefined && parsed.data.startupCommand === undefined && parsed.data.autoRespawn === undefined) {
            return c.json({ error: 'No shell options provided' }, 400)
        }

        try {
            await engine.setShellSessionOptions(sessionResult.sessionId, {
                pinned: parsed.data.pinned,
                autoRespawn: parsed.data.autoRespawn,
                startupCommand: parsed.data.startupCommand === undefined
                    ? undefined
                    : parsed.data.startupCommand?.trim() || null
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update shell session options'
            return c.json({ error: message }, 500)
        }
    })

    app.get('/sessions/:id/notes', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const filePath = getNotesFilePath(sessionResult.sessionId)
        if (!existsSync(filePath)) {
            return c.json({ success: true, content: null })
        }

        try {
            const content = readFileSync(filePath, 'utf-8')
            return c.json({ success: true, content })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read notes'
            return c.json({ success: false, error: message })
        }
    })

    app.post('/sessions/:id/notes', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = notesContentSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: content is required' }, 400)
        }

        try {
            const notesDir = getNotesDir()
            if (!existsSync(notesDir)) {
                mkdirSync(notesDir, { recursive: true })
            }
            writeFileSync(getNotesFilePath(sessionResult.sessionId), parsed.data.content, 'utf-8')

            // Ensure session metadata has notesPath set so the UI knows notes exist
            if (!sessionResult.session.metadata?.notesPath) {
                await engine.setSessionNotesPath(sessionResult.sessionId, `~/.maglev/notes/${sessionResult.sessionId}.txt`)
            }

            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save notes'
            return c.json({ error: message }, 500)
        }
    })

    app.delete('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.active) {
            return c.json({ error: 'Cannot delete active session. Archive it first.' }, 409)
        }

        try {
            await engine.deleteSession(sessionResult.sessionId)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete session'
            // Map "active session" error to 409 conflict (race condition: session became active)
            if (message.includes('active')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    return app
}
