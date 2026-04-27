import { describe, expect, it, vi, afterEach } from 'vitest'

const { execFileSyncMock } = vi.hoisted(() => ({
    execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
    execFileSync: execFileSyncMock
}))

import { readBranchFromGit } from './gitBranch'

describe('readBranchFromGit', () => {
    afterEach(() => {
        execFileSyncMock.mockReset()
    })

    it('returns the symbolic branch when available', () => {
        execFileSyncMock.mockReturnValueOnce('feature/demo\n')

        expect(readBranchFromGit('/repo')).toBe('feature/demo')
        expect(execFileSyncMock).toHaveBeenCalledTimes(1)
    })

    it('falls back to detached sha when HEAD is detached', () => {
        execFileSyncMock
            .mockImplementationOnce(() => {
                throw new Error('detached')
            })
            .mockReturnValueOnce('abc1234\n')

        expect(readBranchFromGit('/repo')).toBe('(detached abc1234)')
        expect(execFileSyncMock).toHaveBeenCalledTimes(2)
    })

    it('returns null when git branch information is unavailable', () => {
        execFileSyncMock
            .mockImplementationOnce(() => {
                throw new Error('no repo')
            })
            .mockImplementationOnce(() => {
                throw new Error('no repo')
            })

        expect(readBranchFromGit('/repo')).toBeNull()
    })
})
