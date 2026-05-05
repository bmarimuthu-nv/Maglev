import type {
    Session,
    SessionSummary,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@maglev/protocol/types'

export type {
    AgentState,
    AttachmentMetadata,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    WorktreeMetadata
} from '@maglev/protocol/types'

export type SessionMetadataSummary = {
    path: string
    host: string
    branch?: string
    childRole?: 'review-terminal' | 'split-terminal'
    lifecycleState?: string
    lifecycleStateSince?: number
    archivedBy?: string
    archiveReason?: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
    notesPath?: string
    parentSessionId?: string
    pinned?: boolean
    autoRespawn?: boolean
    startupCommand?: string
    respawnedFromSessionId?: string
    respawnedFromSessionIds?: string[]
}

export type AgentType = 'shell'

export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    acceptingNewSessions?: boolean
    activeSpawnCount?: number
    restartRequestedAt?: number
    restartReason?: string
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        maglevCliVersion: string
        displayName?: string
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    hubIdentity?: HubIdentityResponse
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type AuthMethodsResponse = {
    methods: Array<'telegram' | 'accessToken' | 'githubDevice' | 'brokerSession'>
}

export type GitHubDeviceStartResponse = {
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete?: string
    expiresIn: number
    interval: number
}

export type GitHubDevicePollResponse =
    | { status: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' }
    | ({ status: 'authorized'; githubUser: { id: number; login: string; name?: string } } & AuthResponse)

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type TerminalSupervisionTargetResponse = {
    worker: SessionSummary
    supervisor: SessionSummary
    bridge?: {
        workspaceRoot: string
        bridgeDir: string
        transcriptFilePath: string
        helperScriptPath: string
        stateFilePath: string
        readmePath: string
        storageScope: 'git-excluded' | 'workspace'
    } | null
    snapshot: {
        outputBuffer: string
        status: 'ready' | 'exited'
        updatedAt: number
        exitInfo: { code: number | null; signal: string | null } | null
    } | null
    events: Array<{
        id: string
        createdAt: number
        type: 'attached' | 'detached' | 'paused' | 'resumed' | 'write_accepted' | 'write_blocked'
        actor: 'human' | 'supervisor' | 'system'
        message: string
    }>
}

export type SpawnTerminalPairResponse =
    | {
        type: 'success'
        pair: import('@maglev/protocol/types').TerminalPair
    }
    | {
        type: 'error'
        message: string
    }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }
export type HubIdentityResponse = {
    name: string | null
    namespace: string
    machineId: string | null
    identityKey: string
}
export type DetectedWorktree = {
    repoRoot: string
    path: string
    branch?: string
    isCurrent: boolean
}
export type HubLaunchFolder = {
    label: string
    path: string
    branch?: string
    source: 'path' | 'wt'
}
export type HubWorktreesResponse = {
    worktrees: DetectedWorktree[]
    error?: string
}
export type HubConfigResponse = {
    name: string | null
    namespace: string
    machineId: string | null
    identityKey: string
    machine: Machine | null
    folders: HubLaunchFolder[]
    error?: string
}

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type ReviewMode = 'branch' | 'working'
export type ReviewBaseMode = 'origin' | 'upstream' | 'fork-point'

export type ReviewSummaryFile = {
    filePath: string
    added: number | null
    removed: number | null
    binary?: boolean
    oldPath?: string
}

export type ReviewSummaryResponse = {
    success: boolean
    mode?: ReviewMode
    baseMode?: ReviewBaseMode
    currentBranch?: string | null
    defaultBranch?: string | null
    mergeBase?: string | null
    files?: ReviewSummaryFile[]
    error?: string
}

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    hash?: string
    error?: string
}

export type FileReviewComment = {
    id: string
    author: string
    createdAt: number
    body: string
}

export type FileReviewThread = {
    id: string
    filePath: string
    absolutePath: string
    createdAt: number
    updatedAt: number
    status: 'open' | 'resolved'
    anchor: {
        line: number
        preview: string
        contextBefore: string[]
        contextAfter: string[]
    }
    comments: FileReviewComment[]
    resolvedLine: number | null
    orphaned: boolean
}

export type FileReviewThreadsResponse = {
    success: boolean
    storePath?: string
    storageScope?: 'git' | 'workspace'
    threads?: FileReviewThread[]
    error?: string
}

export type WriteFileConflict = {
    type: 'hash_mismatch' | 'missing_file' | 'already_exists'
    expectedHash: string | null
    currentHash: string | null
    currentContent: string | null
}

export type WriteFileResponse = {
    success: boolean
    hash?: string
    error?: string
    conflict?: WriteFileConflict
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent
