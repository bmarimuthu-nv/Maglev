import type { FileSearchItem } from '@/types/api'

export function fuzzyScore(query: string, value: string): number {
    const q = query.trim().toLowerCase()
    const target = value.toLowerCase()
    if (!q) return 0

    let score = 0
    let queryIndex = 0
    let streak = 0

    for (let i = 0; i < target.length && queryIndex < q.length; i += 1) {
        if (target[i] === q[queryIndex]) {
            streak += 1
            score += 5 + streak * 2
            queryIndex += 1
        } else {
            streak = 0
        }
    }

    if (queryIndex !== q.length) {
        return -1
    }

    if (target.includes(q)) {
        score += 25
    }
    if (target.startsWith(q)) {
        score += 15
    }
    score -= Math.max(0, target.length - q.length)
    return score
}

export function rankFiles(files: FileSearchItem[], query: string): FileSearchItem[] {
    return files
        .map((file) => ({
            file,
            score: Math.max(
                fuzzyScore(query, file.fileName),
                fuzzyScore(query, file.fullPath)
            )
        }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score || left.file.fullPath.localeCompare(right.file.fullPath))
        .map((entry) => entry.file)
}
