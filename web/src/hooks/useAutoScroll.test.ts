import { afterEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoScroll } from './useAutoScroll'

const STORAGE_KEY = 'maglev-auto-scroll'

describe('useAutoScroll', () => {
    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY)
    })

    it('defaults to enabled when nothing is stored', () => {
        const { result } = renderHook(() => useAutoScroll())
        expect(result.current.autoScroll).toBe(true)
    })

    it('reads false from localStorage', () => {
        localStorage.setItem(STORAGE_KEY, 'false')
        const { result } = renderHook(() => useAutoScroll())
        expect(result.current.autoScroll).toBe(false)
    })

    it('reads true from localStorage', () => {
        localStorage.setItem(STORAGE_KEY, 'true')
        const { result } = renderHook(() => useAutoScroll())
        expect(result.current.autoScroll).toBe(true)
    })

    it('persists false to localStorage when disabled', () => {
        const { result } = renderHook(() => useAutoScroll())
        act(() => {
            result.current.setAutoScroll(false)
        })
        expect(result.current.autoScroll).toBe(false)
        expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    })

    it('persists true to localStorage when re-enabled', () => {
        localStorage.setItem(STORAGE_KEY, 'false')
        const { result } = renderHook(() => useAutoScroll())
        act(() => {
            result.current.setAutoScroll(true)
        })
        expect(result.current.autoScroll).toBe(true)
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    })
})
