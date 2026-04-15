export const DEFAULT_NAMESPACE = 'default'

function sanitizeNamespace(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return DEFAULT_NAMESPACE
    }
    return trimmed
}

export function getCurrentNamespace(): string {
    return sanitizeNamespace(process.env.MAGLEV_NAMESPACE ?? DEFAULT_NAMESPACE)
}

export function getNamespacedAccessToken(rawToken: string): string {
    const namespace = getCurrentNamespace()
    if (!rawToken || namespace === DEFAULT_NAMESPACE || rawToken.includes(':')) {
        return rawToken
    }
    return `${rawToken}:${namespace}`
}

type SettingsWithMachineIds = {
    machineId?: string
    machineIds?: Record<string, string>
}

export function getMachineIdForNamespace(settings: SettingsWithMachineIds, namespace: string): string | undefined {
    const normalizedNamespace = sanitizeNamespace(namespace)
    if (normalizedNamespace === DEFAULT_NAMESPACE) {
        return settings.machineIds?.[normalizedNamespace] ?? settings.machineId
    }
    return settings.machineIds?.[normalizedNamespace]
}

export function setMachineIdForNamespace<T extends SettingsWithMachineIds>(settings: T, namespace: string, machineId: string): T {
    const normalizedNamespace = sanitizeNamespace(namespace)
    const machineIds = {
        ...(settings.machineIds ?? {}),
        [normalizedNamespace]: machineId
    }

    if (normalizedNamespace === DEFAULT_NAMESPACE) {
        return {
            ...settings,
            machineId,
            machineIds
        }
    }

    return {
        ...settings,
        machineIds
    }
}

export function getMachineIdForCurrentNamespace(settings: SettingsWithMachineIds): string | undefined {
    return getMachineIdForNamespace(settings, getCurrentNamespace())
}

export function setMachineIdForCurrentNamespace<T extends SettingsWithMachineIds>(settings: T, machineId: string): T {
    return setMachineIdForNamespace(settings, getCurrentNamespace(), machineId)
}
