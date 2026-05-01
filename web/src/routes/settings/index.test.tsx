import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nContext, I18nProvider } from '@/lib/i18n-context'
import { en } from '@/lib/locales'
import { PROTOCOL_VERSION } from '@maglev/protocol'
import SettingsPage from './index'

// Mock the router hooks
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
    useLocation: () => '/settings',
}))

// Mock useFontScale hook
vi.mock('@/hooks/useFontScale', () => ({
    useFontScale: () => ({ fontScale: 1, setFontScale: vi.fn() }),
    getFontScaleOptions: () => [
        { value: 0.875, label: '87.5%' },
        { value: 1, label: '100%' },
        { value: 1.125, label: '112.5%' },
    ],
}))

// Mock useTheme hook
vi.mock('@/hooks/useTheme', () => ({
    useAppearance: () => ({ appearance: 'system', setAppearance: vi.fn() }),
    getAppearanceOptions: () => [
        { value: 'system', labelKey: 'settings.display.appearance.system' },
        { value: 'dark', labelKey: 'settings.display.appearance.dark' },
        { value: 'light', labelKey: 'settings.display.appearance.light' },
    ],
}))

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

function renderWithSpyT(ui: React.ReactElement) {
    const translations = en as Record<string, string>
    const spyT = vi.fn((key: string) => translations[key] ?? key)
    render(
        <I18nContext.Provider value={{ t: spyT, locale: 'en', setLocale: vi.fn() }}>
            {ui}
        </I18nContext.Provider>
    )
    return spyT
}

describe('SettingsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanup()
    })

    it('renders the About section', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getByText('About')).toBeInTheDocument()
    })

    it('displays the App Version with correct value', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByText('App Version').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(__APP_VERSION__).length).toBeGreaterThanOrEqual(1)
    })

    it('displays the Protocol Version with correct value', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByText('Protocol Version').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(String(PROTOCOL_VERSION)).length).toBeGreaterThanOrEqual(1)
    })

    it('displays the website link with correct URL and security attributes', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByText('Website').length).toBeGreaterThanOrEqual(1)
        const links = screen.getAllByRole('link', { name: 'github.com/bmarimuthu-nv/Maglev' })
        expect(links.length).toBeGreaterThanOrEqual(1)
        const link = links[0]
        expect(link).toHaveAttribute('href', 'https://github.com/bmarimuthu-nv/Maglev')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('uses correct i18n keys for About section', () => {
        const spyT = renderWithSpyT(<SettingsPage />)
        const calledKeys = spyT.mock.calls.map((call) => call[0])
        expect(calledKeys).toContain('settings.about.title')
        expect(calledKeys).toContain('settings.about.website')
        expect(calledKeys).toContain('settings.about.appVersion')
        expect(calledKeys).toContain('settings.about.protocolVersion')
    })

    it('renders the Appearance setting', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByText('Appearance').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Follow System').length).toBeGreaterThanOrEqual(1)
    })

    it('uses correct i18n keys for Appearance setting', () => {
        const spyT = renderWithSpyT(<SettingsPage />)
        const calledKeys = spyT.mock.calls.map((call) => call[0])
        expect(calledKeys).toContain('settings.display.appearance')
        expect(calledKeys).toContain('settings.display.appearance.system')
    })

    it('renders Review appearance as a dropdown', () => {
        localStorage.removeItem('maglev-review-appearance')
        renderWithProviders(<SettingsPage />)

        const reviewAppearanceButton = screen.getByRole('button', { name: /Review appearance App default/ })
        expect(reviewAppearanceButton).toHaveAttribute('aria-haspopup', 'listbox')

        fireEvent.click(reviewAppearanceButton)

        expect(screen.getByRole('listbox', { name: 'Review appearance' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Dark' })).toBeInTheDocument()
    })
})

describe('SettingsPage auto-scroll toggle', () => {
    beforeEach(() => {
        cleanup()
    })

    afterEach(() => {
        localStorage.removeItem('maglev-auto-scroll')
        cleanup()
    })

    it('renders the auto-scroll toggle', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getByText('Auto-scroll')).toBeInTheDocument()
        expect(screen.getAllByRole('switch')[0]).toBeInTheDocument()
    })

    it('toggle defaults to checked (enabled)', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked', 'true')
    })

    it('clicking the toggle disables auto-scroll', () => {
        renderWithProviders(<SettingsPage />)
        const toggle = screen.getAllByRole('switch')[0]
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-checked', 'false')
        expect(localStorage.getItem('maglev-auto-scroll')).toBe('false')
    })
})

describe('SettingsPage copy-on-selection toggle', () => {
    beforeEach(() => {
        cleanup()
    })

    afterEach(() => {
        localStorage.removeItem('maglev-terminal-copy-on-select')
        cleanup()
    })

    it('renders the copy-on-selection toggle', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getByText('Copy on selection')).toBeInTheDocument()
        expect(screen.getAllByRole('switch').length).toBeGreaterThanOrEqual(2)
    })

    it('clicking the toggle enables copy-on-selection', () => {
        renderWithProviders(<SettingsPage />)
        const toggle = screen.getAllByRole('switch')[1]
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-checked', 'true')
        expect(localStorage.getItem('maglev-terminal-copy-on-select')).toBe('true')
    })
})
