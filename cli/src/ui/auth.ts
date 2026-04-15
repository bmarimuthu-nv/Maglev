import { randomUUID } from 'node:crypto'
import { configuration } from '@/configuration'
import { updateSettings } from '@/persistence'
import { getMachineIdForCurrentNamespace, setMachineIdForCurrentNamespace } from '@/utils/namespace'

export async function authAndSetupMachineIfNeeded(): Promise<{
    token: string
    machineId: string
}> {
    if (!configuration.cliApiToken) {
        throw new Error('MAGLEV_API_TOKEN is required')
    }

    const expectedMachineId = process.env.MAGLEV_MACHINE_ID?.trim() || null
    if (expectedMachineId) {
        return { token: configuration.cliApiToken, machineId: expectedMachineId }
    }

    const settings = await updateSettings((current) => {
        const existingMachineId = getMachineIdForCurrentNamespace(current)
        if (existingMachineId) {
            return current
        }
        return setMachineIdForCurrentNamespace(current, randomUUID())
    })

    const machineId = getMachineIdForCurrentNamespace(settings)
    if (!machineId) {
        throw new Error('Failed to initialize machineId')
    }

    return { token: configuration.cliApiToken, machineId }
}
