import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type Toast = {
    id: string
    title: string
    body: string
    sessionId: string
    url: string
}

export type ToastContextValue = {
    toasts: Toast[]
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
}

export type ToastStateValue = {
    toasts: Toast[]
}

export type ToastActionsValue = {
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
}

const ToastStateContext = createContext<ToastStateValue | null>(null)
const ToastActionsContext = createContext<ToastActionsValue | null>(null)
const TOAST_DURATION_MS = 6000

function createToastId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    useEffect(() => {
        return () => {
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer)
            }
            timersRef.current.clear()
        }
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = createToastId()
        setToasts((prev) => [...prev, { id, ...toast }])
        const timer = setTimeout(() => {
            removeToast(id)
        }, TOAST_DURATION_MS)
        timersRef.current.set(id, timer)
    }, [removeToast])

    const state = useMemo<ToastStateValue>(() => ({
        toasts
    }), [toasts])

    const actions = useMemo<ToastActionsValue>(() => ({
        addToast,
        removeToast
    }), [addToast, removeToast])

    return (
        <ToastActionsContext.Provider value={actions}>
            <ToastStateContext.Provider value={state}>
                {children}
            </ToastStateContext.Provider>
        </ToastActionsContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    return {
        ...useToastState(),
        ...useToastActions()
    }
}

export function useToastState(): ToastStateValue {
    const ctx = useContext(ToastStateContext)
    if (!ctx) {
        throw new Error('useToastState must be used within ToastProvider')
    }
    return ctx
}

export function useToastActions(): ToastActionsValue {
    const ctx = useContext(ToastActionsContext)
    if (!ctx) {
        throw new Error('useToastActions must be used within ToastProvider')
    }
    return ctx
}
