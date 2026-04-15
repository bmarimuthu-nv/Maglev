import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { LoginPrompt } from './LoginPrompt'

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('LoginPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const localStorageMock = {
            getItem: vi.fn(() => 'en'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock })
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url

            if (url.includes('/api/auth/methods')) {
                return new Response(JSON.stringify({ methods: ['accessToken'] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            }

            if (url.includes('/api/auth') && init?.method === 'POST') {
                return new Response(JSON.stringify({
                    token: 'jwt-token',
                    user: { id: 1, name: 'test-user' }
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            }

            return new Response('not found', { status: 404 })
        }))
    })

    it('does not clear first hub URL edit when hub URL required', async () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                requireServerUrl={true}
                onLogin={vi.fn()}
            />
        )

        fireEvent.change(await screen.findByPlaceholderText('Access token'), { target: { value: 'token' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        const hubInput = await screen.findByPlaceholderText('https://maglev.example.com')
        expect(screen.getByText('Hub URL required. Please set it before signing in.')).toBeInTheDocument()

        fireEvent.change(hubInput, { target: { value: 'https://hub.example.com' } })

        expect(hubInput).toHaveValue('https://hub.example.com')
        expect(screen.queryByText('Hub URL required. Please set it before signing in.')).not.toBeInTheDocument()
    })
})
