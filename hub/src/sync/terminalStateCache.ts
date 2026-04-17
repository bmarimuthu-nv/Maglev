type TerminalSnapshot = {
    outputBuffer: string
    status: 'ready' | 'exited'
    updatedAt: number
    exitInfo: { code: number | null; signal: string | null } | null
}

type TerminalCacheEntry = TerminalSnapshot

const OUTPUT_BUFFER_CHARS = 200_000
const EXITED_TTL_MS = 5 * 60 * 1000 // Evict exited terminals after 5 minutes

function getKey(sessionId: string, terminalId: string): string {
    return `${sessionId}:${terminalId}`
}

export class TerminalStateCache {
    private readonly entries = new Map<string, TerminalCacheEntry>()

    noteReady(sessionId: string, terminalId: string): void {
        const key = getKey(sessionId, terminalId)
        const existing = this.entries.get(key)
        this.entries.set(key, {
            outputBuffer: existing?.outputBuffer ?? '',
            status: 'ready',
            updatedAt: Date.now(),
            exitInfo: null
        })
    }

    noteOutput(sessionId: string, terminalId: string, chunk: string): void {
        if (!chunk) {
            return
        }

        const key = getKey(sessionId, terminalId)
        const existing = this.entries.get(key)
        const nextOutput = `${existing?.outputBuffer ?? ''}${chunk}`
        this.entries.set(key, {
            outputBuffer: nextOutput.length > OUTPUT_BUFFER_CHARS
                ? nextOutput.slice(nextOutput.length - OUTPUT_BUFFER_CHARS)
                : nextOutput,
            status: 'ready',
            updatedAt: Date.now(),
            exitInfo: existing?.exitInfo ?? null
        })
    }

    noteExit(sessionId: string, terminalId: string, code: number | null, signal: string | null): void {
        const key = getKey(sessionId, terminalId)
        const existing = this.entries.get(key)
        this.entries.set(key, {
            outputBuffer: existing?.outputBuffer ?? '',
            status: 'exited',
            updatedAt: Date.now(),
            exitInfo: { code, signal }
        })
    }

    getSnapshot(sessionId: string, terminalId: string): TerminalSnapshot | null {
        return this.entries.get(getKey(sessionId, terminalId)) ?? null
    }

    removeSession(sessionId: string): void {
        for (const key of this.entries.keys()) {
            if (key.startsWith(`${sessionId}:`)) {
                this.entries.delete(key)
            }
        }
    }

    evictStale(): void {
        const now = Date.now()
        for (const [key, entry] of this.entries) {
            if (entry.status === 'exited' && now - entry.updatedAt > EXITED_TTL_MS) {
                this.entries.delete(key)
            }
        }
    }

    get size(): number {
        return this.entries.size
    }
}
