import { useCallback } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'

export function useAppGoBack(): () => void {
    const navigate = useNavigate()
    const router = useRouter()
    const pathname = useLocation({ select: (location) => location.pathname })

    return useCallback(() => {
        if (pathname === '/sessions/new') {
            if (typeof window !== 'undefined' && window.history.length > 1) {
                router.history.back()
                return
            }
            navigate({ to: '/sessions' })
            return
        }

        // Settings page always goes back to sessions
        if (pathname === '/settings') {
            navigate({ to: '/sessions' })
            return
        }

        // For single file view, go back to files list
        if (pathname.match(/^\/sessions\/[^/]+\/file$/)) {
            const filesPath = pathname.replace(/\/file$/, '/files')
            navigate({ to: filesPath })
            return
        }

        // For session routes, navigate to parent path
        if (pathname.startsWith('/sessions/')) {
            const parentPath = pathname.replace(/\/[^/]+$/, '') || '/sessions'
            navigate({ to: parentPath })
            return
        }

        // Fallback to history.back() for other cases
        router.history.back()
    }, [navigate, pathname, router])
}
