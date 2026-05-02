import { DEFAULT_NAMESPACE } from './accessToken'

export type HubIdentity = {
    name: string | null
    namespace: string
    machineId: string | null
    identityKey: string
}

export function getCurrentHubNamespace(): string {
    const raw = process.env.MAGLEV_NAMESPACE?.trim()
    return raw || DEFAULT_NAMESPACE
}

export function getCurrentHubName(): string | null {
    const raw = process.env.MAGLEV_HUB_NAME?.trim()
    return raw || null
}

export function getCurrentHubIdentity(): HubIdentity {
    return getHubIdentityForNamespace(getCurrentHubNamespace())
}

export function getHubIdentityForNamespace(namespace: string): HubIdentity {
    const normalizedNamespace = namespace.trim() || DEFAULT_NAMESPACE
    const machineId = process.env.MAGLEV_MACHINE_ID?.trim() || null

    return {
        name: getCurrentHubName(),
        namespace: normalizedNamespace,
        machineId,
        identityKey: machineId
            ? `hub:${normalizedNamespace}:machine:${machineId}`
            : `hub:${normalizedNamespace}`
    }
}
