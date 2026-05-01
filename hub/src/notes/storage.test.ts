import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { buildWorkspaceNotesLocation } from './storage'

describe('workspace notes storage', () => {
    it('scopes notes files by namespace and workspace path under MAGLEV_HOME', () => {
        const location = buildWorkspaceNotesLocation({
            dataDir: '/tmp/maglev-home',
            workspacePath: '/work/project-a',
            namespace: 'default',
            requestedPath: 'notes.txt',
            userHomeDir: '/tmp'
        })

        expect(location.fsPath).toMatch(
            /^\/tmp\/maglev-home\/notes\/workspaces\/default\/[0-9a-f]{16}\/notes\.txt$/
        )
        expect(location.displayPath).toBe(location.fsPath.replace('/tmp', '~'))
    })

    it('keeps different workspaces separate even with the same notes filename', () => {
        const first = buildWorkspaceNotesLocation({
            dataDir: '/tmp/maglev-home',
            workspacePath: '/work/project-a',
            namespace: 'default',
            requestedPath: 'notes.txt'
        })
        const second = buildWorkspaceNotesLocation({
            dataDir: '/tmp/maglev-home',
            workspacePath: '/work/project-b',
            namespace: 'default',
            requestedPath: 'notes.txt'
        })

        expect(first.fsPath).not.toBe(second.fsPath)
    })

    it('sanitizes requested relative notes paths without writing into the workspace', () => {
        const location = buildWorkspaceNotesLocation({
            dataDir: '/tmp/maglev-home',
            workspacePath: '/work/project-a',
            namespace: 'default',
            requestedPath: '../nested\\team-notes.md'
        })

        expect(location.fsPath).toContain(join('workspaces', 'default'))
        expect(location.fsPath.endsWith(join('nested', 'team-notes.md'))).toBeTrue()
    })
})
