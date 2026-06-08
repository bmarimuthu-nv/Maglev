import { decodeBase64 } from '@/lib/utils'

export function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

export function isAbsoluteFilePathInput(value: string): boolean {
    const path = value.trim()
    if (!path) {
        return false
    }

    return path.startsWith('/')
        || path.startsWith('\\\\')
        || path.startsWith('//')
        || /^[a-zA-Z]:[/\\]/.test(path)
}

export function getPathFileName(path: string): string {
    const normalized = path.replace(/[/\\]+$/, '')
    const parts = normalized.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? path
}

export function getPathParentPath(path: string): string {
    const normalized = path.replace(/[/\\]+$/, '')
    const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : ''
}

export function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

export function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
}
