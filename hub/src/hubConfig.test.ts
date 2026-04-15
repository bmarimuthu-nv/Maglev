import { describe, expect, it } from 'bun:test'
import { __test__ } from './hubConfig'

describe('hub launch folder loading', () => {
    it('dedupes repeated folder entries by source, path, and branch', () => {
        const folders = __test__.dedupeLaunchFolders([
            {
                label: '(detached)',
                path: '/repo/main',
                branch: '(detached)',
                source: 'path'
            },
            {
                label: 'feature-a',
                path: '/repo/feature-a',
                branch: 'feature-a',
                source: 'path'
            },
            {
                label: 'feature-a duplicate label',
                path: '/repo/feature-a',
                branch: 'feature-a',
                source: 'path'
            },
            {
                label: 'feature-b',
                path: '/repo/feature-b',
                branch: 'feature-b',
                source: 'path'
            }
        ])

        expect(folders).toEqual([
            {
                label: '(detached)',
                path: '/repo/main',
                branch: '(detached)',
                source: 'path'
            },
            {
                label: 'feature-a',
                path: '/repo/feature-a',
                branch: 'feature-a',
                source: 'path'
            },
            {
                label: 'feature-b',
                path: '/repo/feature-b',
                branch: 'feature-b',
                source: 'path'
            }
        ])
    })
})
