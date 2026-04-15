function trimTrailingSlashes(pathname: string): string {
    return pathname.replace(/\/+$/, '')
}

export function getBrokerBasepath(pathname: string): string {
    const normalizedPath = trimTrailingSlashes(pathname)
    const match = normalizedPath.match(/^\/h\/[^/]+/)
    return match ? match[0] : ''
}

export function normalizeUrlToBrokerBase(url: URL, brokerBasepath: string): string {
    const trimmedBrokerBasepath = trimTrailingSlashes(brokerBasepath)
    const pathname = trimmedBrokerBasepath || trimTrailingSlashes(url.pathname)
    return `${url.origin}${pathname}${url.search}${url.hash}`
}

export function getCurrentHubLabel(baseUrl: string): string {
    try {
        const url = new URL(baseUrl)
        const match = url.pathname.match(/^\/h\/([^/]+)/)
        if (match?.[1]) {
            return decodeURIComponent(match[1])
        }
        return url.hostname
    } catch {
        return baseUrl
    }
}
