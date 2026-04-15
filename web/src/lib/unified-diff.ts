export type ParsedDiffLine =
    | { kind: 'hunk'; text: string; header: string }
    | { kind: 'context'; text: string; oldLine: number; newLine: number }
    | { kind: 'add'; text: string; newLine: number }
    | { kind: 'delete'; text: string; oldLine: number }

export function parseUnifiedDiff(patch: string): ParsedDiffLine[] {
    const lines = patch.split('\n')
    const parsed: ParsedDiffLine[] = []
    let oldLine = 0
    let newLine = 0
    let inHunk = false

    for (const line of lines) {
        if (line.startsWith('@@')) {
            const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line)
            if (!match) {
                continue
            }
            oldLine = Number.parseInt(match[1] ?? '0', 10)
            newLine = Number.parseInt(match[2] ?? '0', 10)
            parsed.push({ kind: 'hunk', text: line, header: line })
            inHunk = true
            continue
        }

        if (!inHunk) {
            continue
        }

        if (line.startsWith('+') && !line.startsWith('+++')) {
            parsed.push({ kind: 'add', text: line.slice(1), newLine })
            newLine += 1
            continue
        }

        if (line.startsWith('-') && !line.startsWith('---')) {
            parsed.push({ kind: 'delete', text: line.slice(1), oldLine })
            oldLine += 1
            continue
        }

        if (line.startsWith(' ')) {
            parsed.push({ kind: 'context', text: line.slice(1), oldLine, newLine })
            oldLine += 1
            newLine += 1
            continue
        }

        if (line === '\\ No newline at end of file') {
            continue
        }
    }

    return parsed
}
