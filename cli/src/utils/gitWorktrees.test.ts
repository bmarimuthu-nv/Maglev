import { describe, expect, it } from 'vitest'
import { parseGitWorktreeListPorcelain } from './gitWorktrees'

describe('parseGitWorktreeListPorcelain', () => {
    it('parses worktree paths, branches, and current repo entry', () => {
        const output = [
            'worktree /repo',
            'HEAD abcdef0',
            'branch refs/heads/main',
            '',
            'worktree /repo-worktrees/feature-a',
            'HEAD 1234567',
            'branch refs/heads/maglev-feature-a',
            '',
            'worktree /repo-worktrees/detached',
            'HEAD deadbee',
            'detached',
            ''
        ].join('\n')

        expect(parseGitWorktreeListPorcelain(output, '/repo')).toEqual([
            {
                repoRoot: '/repo',
                path: '/repo',
                branch: 'main',
                isCurrent: true
            },
            {
                repoRoot: '/repo',
                path: '/repo-worktrees/feature-a',
                branch: 'maglev-feature-a',
                isCurrent: false
            },
            {
                repoRoot: '/repo',
                path: '/repo-worktrees/detached',
                branch: '(detached)',
                isCurrent: false
            }
        ])
    })
})
