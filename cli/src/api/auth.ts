import { configuration } from '@/configuration'
import { getNamespacedAccessToken } from '@/utils/namespace'

export function getAuthToken(): string {
    if (!configuration.cliApiToken) {
        throw new Error('MAGLEV_API_TOKEN is required')
    }
    return getNamespacedAccessToken(configuration.cliApiToken)
}
