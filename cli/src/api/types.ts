import {
    AgentStateSchema,
    AttachmentMetadataSchema,
    MetadataSchema
} from '@maglev/protocol/schemas'
import { z } from 'zod'

export type {
    AgentState,
    AttachmentMetadata,
    Metadata,
    Session
} from '@maglev/protocol/types'
export type SessionModel = string | null

export { AgentStateSchema, AttachmentMetadataSchema, MetadataSchema }

export const MachineMetadataSchema = z.object({
    host: z.string(),
    platform: z.string(),
    maglevCliVersion: z.string(),
    displayName: z.string().optional(),
    homeDir: z.string(),
    maglevHomeDir: z.string(),
    maglevLibDir: z.string()
})

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>

export const RunnerStateSchema = z.object({
    status: z.union([z.enum(['running', 'restarting', 'shutting-down']), z.string()]),
    pid: z.number().optional(),
    httpPort: z.number().optional(),
    startedAt: z.number().optional(),
    acceptingNewSessions: z.boolean().optional(),
    activeSpawnCount: z.number().optional(),
    restartRequestedAt: z.number().optional(),
    restartReason: z.union([z.enum(['cli-version-drift']), z.string()]).optional(),
    shutdownRequestedAt: z.number().optional(),
    shutdownSource: z.union([z.enum(['mobile-app', 'cli', 'os-signal', 'unknown']), z.string()]).optional(),
    lastSpawnError: z.object({
        message: z.string(),
        pid: z.number().optional(),
        exitCode: z.number().nullable().optional(),
        signal: z.string().nullable().optional(),
        at: z.number()
    }).nullable().optional()
})

export type RunnerState = z.infer<typeof RunnerStateSchema>

export type Machine = {
    id: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: MachineMetadata | null
    metadataVersion: number
    runnerState: RunnerState | null
    runnerStateVersion: number
}

export const CreateSessionResponseSchema = z.object({
    session: z.object({
        id: z.string(),
        namespace: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
        active: z.boolean(),
        activeAt: z.number(),
        metadata: z.unknown().nullable(),
        metadataVersion: z.number(),
        agentState: z.unknown().nullable(),
        agentStateVersion: z.number(),
        thinking: z.boolean(),
        thinkingAt: z.number(),
        model: z.string().nullable()
    })
})

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const CreateMachineResponseSchema = z.object({
    machine: z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
        active: z.boolean(),
        activeAt: z.number(),
        metadata: z.unknown().nullable(),
        metadataVersion: z.number(),
        runnerState: z.unknown().nullable(),
        runnerStateVersion: z.number()
    })
})

export type CreateMachineResponse = z.infer<typeof CreateMachineResponseSchema>
