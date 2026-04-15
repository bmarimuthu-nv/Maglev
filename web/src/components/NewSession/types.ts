export type AgentType = 'shell'
export type SessionType = 'simple' | 'worktree'

export const MODEL_OPTIONS: Record<AgentType, { value: string; label: string }[]> = {
    shell: [],
}
