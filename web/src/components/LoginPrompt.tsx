import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClient } from '@/api/client'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { MaglevMark, MaglevWordmark } from '@/components/MaglevBrand'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'
import type { ServerUrlResult } from '@/hooks/useServerUrl'
import type { AuthMethodsResponse, GitHubDeviceStartResponse } from '@/types/api'

type LoginPromptProps = {
    mode?: 'login' | 'bind'
    onLogin?: (token: string) => void
    onGitHubLogin?: (token: string) => void
    onBind?: (token: string) => Promise<void>
    baseUrl: string
    serverUrl: string | null
    setServerUrl: (input: string) => ServerUrlResult
    clearServerUrl: () => void
    requireServerUrl?: boolean
    error?: string | null
}

export function LoginPrompt(props: LoginPromptProps) {
    const { t } = useTranslation()
    const isBindMode = props.mode === 'bind'
    const [accessToken, setAccessToken] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isServerDialogOpen, setIsServerDialogOpen] = useState(false)
    const [serverInput, setServerInput] = useState(props.serverUrl ?? '')
    const [serverError, setServerError] = useState<string | null>(null)
    const [authMethods, setAuthMethods] = useState<AuthMethodsResponse['methods']>([])
    const [isLoadingMethods, setIsLoadingMethods] = useState(false)
    const [githubDevice, setGitHubDevice] = useState<GitHubDeviceStartResponse | null>(null)
    const [showManualLogin, setShowManualLogin] = useState(isBindMode)

    const supportsGitHubDevice = authMethods.includes('githubDevice')
    const supportsAccessToken = authMethods.includes('accessToken')

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault()

        const trimmedToken = accessToken.trim()
        if (!trimmedToken) {
            setError(t('login.error.enterToken'))
            return
        }

        if (!isBindMode && props.requireServerUrl && !props.serverUrl) {
            setServerError(t('login.server.required'))
            setIsServerDialogOpen(true)
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            if (isBindMode) {
                if (!props.onBind) {
                    setError(t('login.error.bindingUnavailable'))
                    return
                }
                await props.onBind(trimmedToken)
            } else {
                if (!supportsAccessToken) {
                    setError('Manual token login is not available for this hub.')
                    return
                }
                // Validate token by attempting to authenticate
                const client = new ApiClient('', { baseUrl: props.baseUrl })
                await client.authenticate({ accessToken: trimmedToken })
                // If successful, pass token to parent
                if (!props.onLogin) {
                    setError(t('login.error.loginUnavailable'))
                    return
                }
                props.onLogin(trimmedToken)
            }
        } catch (e) {
            const fallbackMessage = isBindMode ? t('login.error.bindFailed') : t('login.error.authFailed')
            setError(e instanceof Error ? e.message : fallbackMessage)
        } finally {
            setIsLoading(false)
        }
    }, [accessToken, props, t, isBindMode, supportsAccessToken])

    const githubAbortRef = useRef<AbortController | null>(null)

    const handleGitHubLogin = useCallback(async () => {
        if (props.requireServerUrl && !props.serverUrl) {
            setServerError(t('login.server.required'))
            setIsServerDialogOpen(true)
            return
        }
        if (!props.onGitHubLogin) {
            setError('GitHub login is unavailable.')
            return
        }

        // Abort any previous polling loop
        githubAbortRef.current?.abort()
        const abortController = new AbortController()
        githubAbortRef.current = abortController

        setIsLoading(true)
        setError(null)

        try {
            const client = new ApiClient('', { baseUrl: props.baseUrl })
            const started = await client.startGitHubDeviceAuth()
            setGitHubDevice(started)

            const verificationUrl = started.verificationUriComplete || started.verificationUri
            if (verificationUrl) {
                window.open(verificationUrl, '_blank', 'noopener,noreferrer')
            }

            const deadline = Date.now() + started.expiresIn * 1000
            let intervalMs = Math.max(started.interval, 1) * 1000

            while (Date.now() < deadline) {
                if (abortController.signal.aborted) return
                await new Promise(resolve => setTimeout(resolve, intervalMs))
                if (abortController.signal.aborted) return
                const polled = await client.pollGitHubDeviceAuth(started.deviceCode)
                if (polled.status === 'authorization_pending') {
                    continue
                }
                if (polled.status === 'slow_down') {
                    intervalMs += 5000
                    continue
                }
                if (polled.status === 'expired_token') {
                    throw new Error('GitHub device code expired. Start sign-in again.')
                }
                if (polled.status === 'access_denied') {
                    throw new Error('GitHub account is not allowed for this hub.')
                }
                if (polled.status === 'authorized') {
                    props.onGitHubLogin(polled.token)
                    setGitHubDevice(null)
                    return
                }
            }

            throw new Error('GitHub sign-in timed out. Start again.')
        } catch (e) {
            if (!abortController.signal.aborted) {
                setError(e instanceof Error ? e.message : 'GitHub sign-in failed')
            }
        } finally {
            if (!abortController.signal.aborted) {
                setIsLoading(false)
            }
        }
    }, [props, t])

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            githubAbortRef.current?.abort()
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (isBindMode) {
                setAuthMethods(['accessToken'])
                return
            }

            setIsLoadingMethods(true)
            try {
                const client = new ApiClient('', { baseUrl: props.baseUrl })
                const response = await client.getAuthMethods()
                if (!cancelled) {
                    setAuthMethods(response.methods)
                }
            } catch {
                if (!cancelled) {
                    setAuthMethods(['accessToken'])
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingMethods(false)
                }
            }
        }

        void run()

        return () => {
            cancelled = true
        }
    }, [isBindMode, props.baseUrl])

    useEffect(() => {
        if (!isServerDialogOpen) {
            return
        }
        setServerInput(props.serverUrl ?? '')
    }, [isServerDialogOpen, props.serverUrl])

    useEffect(() => {
        if (isBindMode) {
            setShowManualLogin(true)
            return
        }
        if (!supportsGitHubDevice && supportsAccessToken) {
            setShowManualLogin(true)
        }
    }, [isBindMode, supportsAccessToken, supportsGitHubDevice])

    const handleSaveServer = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const result = props.setServerUrl(serverInput)
        if (!result.ok) {
            setServerError(result.error)
            return
        }
        setServerError(null)
        setServerInput(result.value)
        setIsServerDialogOpen(false)
    }, [props, serverInput])

    const handleClearServer = useCallback(() => {
        props.clearServerUrl()
        setServerInput('')
        setServerError(null)
        setIsServerDialogOpen(false)
    }, [props])

    const handleServerDialogOpenChange = useCallback((open: boolean) => {
        setIsServerDialogOpen(open)
        if (!open) {
            setServerError(null)
        }
    }, [])

    const displayError = error || props.error
    const serverSummary = props.serverUrl ?? `${props.baseUrl} ${t('login.server.default')}`
    const title = isBindMode ? 'Bind Telegram to Maglev' : 'Continue to Maglev'
    const subtitle = isBindMode
        ? 'Finish linking this Telegram account to your Maglev hub with an access token.'
        : 'Access your local-first coding hub and pick up your sessions where you left them.'
    const submitLabel = isBindMode ? t('login.bind.submit') : t('login.submit')
    const serverModeLabel = props.requireServerUrl ? 'Remote' : props.serverUrl ? 'Custom' : 'Local'

    let serverHost = ''
    try {
        const url = new URL(props.serverUrl || props.baseUrl)
        serverHost = url.hostname
    } catch {
        serverHost = props.serverUrl || props.baseUrl
    }

    return (
        <div className="relative min-h-full overflow-y-auto bg-[var(--app-bg)]">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-[-8rem] top-[-8rem] h-64 w-64 rounded-full bg-[color:rgba(228,115,83,0.18)] blur-3xl" />
                <div className="absolute right-[-8rem] top-[10%] h-72 w-72 rounded-full bg-[color:rgba(144,200,172,0.18)] blur-3xl" />
            </div>

            <div className="absolute right-4 top-4 z-10">
                <LanguageSwitcher />
            </div>

            <div className="relative flex min-h-full items-center justify-center px-4 py-10">
                <div className="w-full max-w-[520px] rounded-[32px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-5 shadow-[var(--app-panel-shadow)] sm:p-7">
                    <div className="space-y-6">
                        <div className="space-y-5">
                            <div className="flex items-center gap-4">
                                <MaglevMark size="lg" />
                                <MaglevWordmark />
                            </div>
                            <div className="space-y-2">
                                <h1 className="text-[2rem] font-extrabold tracking-[-0.04em] text-[var(--app-fg)]">
                                    {title}
                                </h1>
                                <p className="max-w-[36ch] text-sm leading-6 text-[var(--app-hint)] sm:text-[15px]">
                                    {subtitle}
                                </p>
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                                        Connected To
                                    </div>
                                    <div className="truncate font-mono text-sm font-bold text-[var(--app-fg)]">
                                        {serverHost}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--app-hint)]">
                                        {serverModeLabel}
                                    </span>
                                    <Dialog open={isServerDialogOpen} onOpenChange={handleServerDialogOpenChange}>
                                        <DialogTrigger asChild>
                                            <button
                                                type="button"
                                                className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--app-link)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                            >
                                                Change
                                            </button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-md">
                                            <DialogHeader>
                                                <DialogTitle>{t('login.server.title')}</DialogTitle>
                                                <DialogDescription>
                                                    {t('login.server.description')}
                                                </DialogDescription>
                                            </DialogHeader>
                                            <form onSubmit={handleSaveServer} className="space-y-4">
                                                <div className="text-xs text-[var(--app-hint)]">
                                                    {t('login.server.current')} {serverSummary}
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium">{t('login.server.origin')}</label>
                                                    <input
                                                        type="url"
                                                        value={serverInput}
                                                        onChange={(e) => {
                                                            setServerInput(e.target.value)
                                                            setServerError(null)
                                                        }}
                                                        placeholder={t('login.server.placeholder')}
                                                        className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--mg-focus)]"
                                                    />
                                                    <div className="text-[11px] text-[var(--app-hint)]">
                                                        {t('login.server.hint')}
                                                    </div>
                                                </div>

                                                {serverError ? (
                                                    <div className="text-sm text-[var(--app-badge-error-text)]">
                                                        {serverError}
                                                    </div>
                                                ) : null}

                                                <div className="flex items-center justify-end gap-2">
                                                    {props.serverUrl ? (
                                                        <Button type="button" variant="outline" onClick={handleClearServer}>
                                                            {t('login.server.useSameOrigin')}
                                                        </Button>
                                                    ) : null}
                                                    <Button type="submit">
                                                        {t('login.server.save')}
                                                    </Button>
                                                </div>
                                            </form>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 rounded-[28px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-4 sm:p-5">
                            {isLoadingMethods ? (
                                <div className="flex items-center justify-center py-6 text-sm text-[var(--app-hint)]">
                                    <Spinner size="sm" label={null} className="mr-2" />
                                    Loading login methods…
                                </div>
                            ) : (
                                <>
                                    {!isBindMode && supportsGitHubDevice ? (
                                        <div className="space-y-3">
                                            <Button
                                                type="button"
                                                size="lg"
                                                onClick={() => void handleGitHubLogin()}
                                                disabled={isLoading}
                                                className="h-12 w-full rounded-2xl text-base"
                                            >
                                                {isLoading && githubDevice ? (
                                                    <>
                                                        <Spinner size="sm" label={null} className="mr-1 text-[var(--app-button-text)]" />
                                                        Waiting For GitHub…
                                                    </>
                                                ) : (
                                                    'Continue with GitHub'
                                                )}
                                            </Button>
                                            <div className="text-xs font-medium text-[var(--app-hint)]">
                                                Recommended for remote hubs.
                                            </div>
                                        </div>
                                    ) : null}

                                    {githubDevice ? (
                                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-4 text-sm text-[var(--app-hint)]">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                                                GitHub Verification
                                            </div>
                                            <div className="mt-2 text-[var(--app-fg)]">
                                                Enter code <span className="font-mono font-bold">{githubDevice.userCode}</span> in GitHub to finish sign-in.
                                            </div>
                                            <a
                                                href={githubDevice.verificationUriComplete || githubDevice.verificationUri}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-3 inline-flex items-center rounded-full border border-[var(--app-border)] px-3 py-1.5 text-xs font-semibold text-[var(--app-link)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                            >
                                                Open GitHub verification
                                            </a>
                                        </div>
                                    ) : null}

                                    {supportsAccessToken ? (
                                        <div className="space-y-3">
                                            {supportsGitHubDevice && !isBindMode ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowManualLogin((value) => !value)}
                                                    className="flex w-full items-center justify-between rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                                    aria-expanded={showManualLogin}
                                                >
                                                    <div>
                                                        <div className="font-semibold text-[var(--app-fg)]">Use access token instead</div>
                                                        <div className="mt-1 text-xs text-[var(--app-hint)]">
                                                            Manual sign-in for local hubs or advanced setups.
                                                        </div>
                                                    </div>
                                                    <span className="text-xs font-semibold text-[var(--app-link)]">
                                                        {showManualLogin ? 'Hide' : 'Show'}
                                                    </span>
                                                </button>
                                            ) : null}

                                            {(showManualLogin || !supportsGitHubDevice || isBindMode) ? (
                                                <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-4">
                                                    <div>
                                                        <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--app-hint)]">
                                                            {isBindMode ? 'Access Token' : 'Hub Access Token'}
                                                        </label>
                                                        <input
                                                            type="password"
                                                            value={accessToken}
                                                            onChange={(e) => setAccessToken(e.target.value)}
                                                            placeholder={t('login.placeholder')}
                                                            autoComplete="current-password"
                                                            disabled={isLoading}
                                                            className="mt-2 w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--mg-focus)] disabled:opacity-50"
                                                        />
                                                    </div>
                                                    <Button
                                                        type="submit"
                                                        disabled={isLoading || !accessToken.trim()}
                                                        aria-busy={isLoading}
                                                        className="h-11 w-full rounded-2xl"
                                                    >
                                                        {isLoading ? (
                                                            <>
                                                                <Spinner size="sm" label={null} className="mr-1 text-[var(--app-button-text)]" />
                                                                {isBindMode ? t('login.bind.submitting') : t('login.submitting')}
                                                            </>
                                                        ) : (
                                                            submitLabel
                                                        )}
                                                    </Button>
                                                </form>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    {displayError ? (
                                        <div className="rounded-2xl border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-4 text-sm text-[var(--app-badge-error-text)]">
                                            <div className="font-semibold">{isBindMode ? 'Binding failed' : 'Sign-in failed'}</div>
                                            <div className="mt-1 text-xs leading-5">{displayError}</div>
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-1.5 font-semibold text-[var(--app-hint)]">
                                Local-first
                            </span>
                            <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-1.5 font-semibold text-[var(--app-hint)]">
                                Your sessions stay on your machines
                            </span>
                            {!isBindMode ? (
                                <a
                                    href="https://maglev.run/docs"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-auto rounded-full px-3 py-1.5 font-semibold text-[var(--app-link)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    {t('login.help')}
                                </a>
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-[var(--app-hint)]">
                    {t('login.footer.copyright')} {new Date().getFullYear()} maglev
                </div>
            </div>
        </div>
    )
}
