import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unified-diff'

describe('parseUnifiedDiff', () => {
    const samplePatch = [
        'diff --git a/file.ts b/file.ts',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -1,4 +1,5 @@',
        ' const a = 1',
        '-const b = 2',
        '+const b = 3',
        '+const c = 4',
        ' const d = 5',
    ].join('\n')

    it('parses hunk headers', () => {
        const lines = parseUnifiedDiff(samplePatch)
        const hunk = lines.find((l) => l.kind === 'hunk')
        expect(hunk).toBeDefined()
        expect(hunk!.text).toContain('@@ -1,4 +1,5 @@')
    })

    it('parses context lines with both line numbers', () => {
        const lines = parseUnifiedDiff(samplePatch)
        const context = lines.filter((l) => l.kind === 'context')
        expect(context.length).toBe(2)
        expect(context[0].text).toBe('const a = 1')
        expect(context[0]).toHaveProperty('oldLine', 1)
        expect(context[0]).toHaveProperty('newLine', 1)
    })

    it('parses add lines with new line numbers', () => {
        const lines = parseUnifiedDiff(samplePatch)
        const adds = lines.filter((l) => l.kind === 'add')
        expect(adds.length).toBe(2)
        expect(adds[0].text).toBe('const b = 3')
        expect(adds[0]).toHaveProperty('newLine', 2)
        expect(adds[1].text).toBe('const c = 4')
        expect(adds[1]).toHaveProperty('newLine', 3)
    })

    it('parses delete lines with old line numbers', () => {
        const lines = parseUnifiedDiff(samplePatch)
        const deletes = lines.filter((l) => l.kind === 'delete')
        expect(deletes.length).toBe(1)
        expect(deletes[0].text).toBe('const b = 2')
        expect(deletes[0]).toHaveProperty('oldLine', 2)
    })

    it('strips leading +/- from line text', () => {
        const lines = parseUnifiedDiff(samplePatch)
        for (const line of lines) {
            if (line.kind === 'hunk') continue
            expect(line.text).not.toMatch(/^[+-]/)
        }
    })

    it('ignores content before the first hunk', () => {
        const lines = parseUnifiedDiff(samplePatch)
        // The diff/--- /+++ headers should not appear
        expect(lines.every((l) => !l.text.startsWith('diff --git'))).toBe(true)
        expect(lines.every((l) => !l.text.startsWith('---'))).toBe(true)
    })

    it('handles multiple hunks', () => {
        const multiHunk = [
            '@@ -1,2 +1,2 @@',
            '-old1',
            '+new1',
            ' same',
            '@@ -10,2 +10,2 @@',
            '-old10',
            '+new10',
            ' same10',
        ].join('\n')
        const lines = parseUnifiedDiff(multiHunk)
        const hunks = lines.filter((l) => l.kind === 'hunk')
        expect(hunks.length).toBe(2)
        const adds = lines.filter((l) => l.kind === 'add')
        expect(adds.length).toBe(2)
    })

    it('returns empty array for empty input', () => {
        expect(parseUnifiedDiff('')).toEqual([])
    })

    it('skips "No newline at end of file" markers', () => {
        const patch = [
            '@@ -1,1 +1,1 @@',
            '-old',
            '\\ No newline at end of file',
            '+new',
        ].join('\n')
        const lines = parseUnifiedDiff(patch)
        expect(lines.some((l) => l.text?.includes('No newline'))).toBe(false)
    })
})
