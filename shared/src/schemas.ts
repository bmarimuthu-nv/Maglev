import { z } from 'zod'

const MetadataSummarySchema = z.object({
    text: z.string(),
    updatedAt: z.number()
})

export const TerminalSupervisionRoleSchema = z.enum(['worker', 'orchestrator'])
export type TerminalSupervisionRole = z.infer<typeof TerminalSupervisionRoleSchema>

export const TerminalSupervisionStateSchema = z.enum(['active', 'paused'])
export type TerminalSupervisionState = z.infer<typeof TerminalSupervisionStateSchema>

export const TerminalSupervisionEventSchema = z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.enum([
        'attached',
        'detached',
        'paused',
        'resumed',
        'write_accepted',
        'write_blocked'
    ]),
    actor: z.enum(['human', 'orchestrator', 'system']),
    message: z.string()
})

export type TerminalSupervisionEvent = z.infer<typeof TerminalSupervisionEventSchema>

export const TerminalSupervisionSchema = z.object({
    role: TerminalSupervisionRoleSchema,
    peerSessionId: z.string(),
    state: TerminalSupervisionStateSchema,
    events: z.array(TerminalSupervisionEventSchema).optional()
})

export type TerminalSupervision = z.infer<typeof TerminalSupervisionSchema>

export const TerminalPairStateSchema = z.enum(['active', 'recovering', 'degraded', 'paused'])
export type TerminalPairState = z.infer<typeof TerminalPairStateSchema>

export const TerminalPairRoleSchema = z.enum(['worker', 'supervisor'])
export type TerminalPairRole = z.infer<typeof TerminalPairRoleSchema>

export const TerminalPairSideRecipeSchema = z.object({
    role: TerminalPairRoleSchema,
    workingDirectory: z.string(),
    sessionName: z.string(),
    startupCommand: z.string().optional()
})
export type TerminalPairSideRecipe = z.infer<typeof TerminalPairSideRecipeSchema>

export const TerminalPairSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    state: TerminalPairStateSchema,
    workerSessionId: z.string().nullable(),
    supervisorSessionId: z.string().nullable(),
    worker: TerminalPairSideRecipeSchema,
    supervisor: TerminalPairSideRecipeSchema
})
export type TerminalPair = z.infer<typeof TerminalPairSchema>

export const TerminalPairLinkSchema = z.object({
    pairId: z.string(),
    pairName: z.string(),
    role: TerminalPairRoleSchema,
    state: TerminalPairStateSchema
})
export type TerminalPairLink = z.infer<typeof TerminalPairLinkSchema>

export const WorktreeMetadataSchema = z.object({
    basePath: z.string(),
    branch: z.string(),
    name: z.string(),
    worktreePath: z.string().optional(),
    createdAt: z.number().optional()
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    homeDir: z.string().optional(),
    maglevHomeDir: z.string().optional(),
    maglevLibDir: z.string().optional(),
    maglevToolsDir: z.string().optional(),
    startedFromRunner: z.boolean().optional(),
    hostPid: z.number().optional(),
    startedBy: z.enum(['runner', 'terminal']).optional(),
    lifecycleState: z.string().optional(),
    lifecycleStateSince: z.number().optional(),
    archivedBy: z.string().optional(),
    archiveReason: z.string().optional(),
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional(),
    notesPath: z.string().optional(),
    pinned: z.boolean().optional(),
    autoRespawn: z.boolean().optional(),
    startupCommand: z.string().optional(),
    shellTerminalId: z.string().optional(),
    shellTerminalState: z.enum(['ready', 'stale']).optional(),
    terminalSupervision: TerminalSupervisionSchema.optional(),
    terminalPair: TerminalPairLinkSchema.optional()
})

export type Metadata = z.infer<typeof MetadataSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish()
})

export type AgentStateRequest = z.infer<typeof AgentStateRequestSchema>

export const AgentStateCompletedRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    completedAt: z.number().nullish(),
    status: z.enum(['canceled', 'denied', 'approved']),
    reason: z.string().optional(),
    mode: z.string().optional(),
    decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    allowTools: z.array(z.string()).optional(),
    // Flat format: Record<string, string[]> (AskUserQuestion)
    // Nested format: Record<string, { answers: string[] }> (request_user_input)
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
})

export type AgentStateCompletedRequest = z.infer<typeof AgentStateCompletedRequestSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), AgentStateRequestSchema).nullish(),
    completedRequests: z.record(z.string(), AgentStateCompletedRequestSchema).nullish()
})

export type AgentState = z.infer<typeof AgentStateSchema>

export const AttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional()
})

export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>

export const SessionSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MetadataSchema.nullable(),
    metadataVersion: z.number(),
    agentState: AgentStateSchema.nullable(),
    agentStateVersion: z.number(),
    thinking: z.boolean(),
    thinkingAt: z.number(),
    model: z.string().nullable(),
})

export type Session = z.infer<typeof SessionSchema>

const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string()
})

const MachineChangedSchema = SessionEventBaseSchema.extend({
    machineId: z.string()
})

export const SyncEventSchema = z.discriminatedUnion('type', [
    SessionChangedSchema.extend({
        type: z.literal('session-added'),
        data: z.unknown().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('session-removed'),
        sessionId: z.string()
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('toast'),
        data: z.object({
            title: z.string(),
            body: z.string(),
            sessionId: z.string(),
            url: z.string()
        })
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('heartbeat'),
        data: z.object({
            timestamp: z.number()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('connection-changed'),
        data: z.object({
            status: z.string(),
            subscriptionId: z.string().optional()
        }).optional()
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
