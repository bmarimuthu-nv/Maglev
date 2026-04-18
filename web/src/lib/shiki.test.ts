import { describe, expect, it } from 'vitest'
import { resolveLanguageFromPath } from './shiki'

describe('resolveLanguageFromPath', () => {
    it('resolves common extensions via alias', () => {
        expect(resolveLanguageFromPath('src/index.ts')).toBe('typescript')
        expect(resolveLanguageFromPath('src/app.js')).toBe('javascript')
        expect(resolveLanguageFromPath('lib/utils.py')).toBe('python')
        expect(resolveLanguageFromPath('main.rs')).toBe('rust')
        expect(resolveLanguageFromPath('config.yml')).toBe('yaml')
        expect(resolveLanguageFromPath('README.md')).toBe('markdown')
    })

    it('passes through known Shiki language names', () => {
        expect(resolveLanguageFromPath('style.css')).toBe('css')
        expect(resolveLanguageFromPath('index.html')).toBe('html')
        expect(resolveLanguageFromPath('main.go')).toBe('go')
        expect(resolveLanguageFromPath('App.tsx')).toBe('tsx')
        expect(resolveLanguageFromPath('App.jsx')).toBe('jsx')
    })

    it('handles special filenames', () => {
        expect(resolveLanguageFromPath('Makefile')).toBe('make')
        expect(resolveLanguageFromPath('src/Makefile')).toBe('make')
        expect(resolveLanguageFromPath('Dockerfile')).toBe('dockerfile')
        expect(resolveLanguageFromPath('Dockerfile.prod')).toBe('dockerfile')
    })

    it('returns text for files without extensions', () => {
        expect(resolveLanguageFromPath('LICENSE')).toBe('text')
        expect(resolveLanguageFromPath('src/somefile')).toBe('text')
    })

    it('returns the extension as-is for unknown types', () => {
        expect(resolveLanguageFromPath('data.parquet')).toBe('parquet')
        expect(resolveLanguageFromPath('file.xyz')).toBe('xyz')
    })

    it('is case-insensitive', () => {
        expect(resolveLanguageFromPath('File.TS')).toBe('typescript')
        expect(resolveLanguageFromPath('DOCKERFILE')).toBe('dockerfile')
        expect(resolveLanguageFromPath('MAKEFILE')).toBe('make')
    })
})
