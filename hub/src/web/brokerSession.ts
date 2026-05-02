import { jwtVerify, SignJWT } from 'jose'
import { getOrCreateBrokerKey } from '../broker/key'

const BROKER_SESSION_HEADER = 'x-maglev-broker-auth'

export type BrokerSessionPayload = {
    uid: number
    login: string
}

let brokerSecretPromise: Promise<Uint8Array> | null = null

async function getBrokerSecret(): Promise<Uint8Array> {
    if (!brokerSecretPromise) {
        brokerSecretPromise = (async () => {
            const configured = process.env.MAGLEV_SERVER_TOKEN?.trim() || process.env.MAGLEV_BROKER_TOKEN?.trim()
            if (configured) {
                return new TextEncoder().encode(configured)
            }
            const brokerKey = await getOrCreateBrokerKey()
            return new TextEncoder().encode(brokerKey.key)
        })()
    }
    return await brokerSecretPromise
}

export async function verifyBrokerSessionToken(token: string): Promise<BrokerSessionPayload | null> {
    try {
        const secret = await getBrokerSecret()
        const verified = await jwtVerify(token, secret, { algorithms: ['HS256'] })
        const payload = verified.payload
        if (typeof payload.uid !== 'number' || typeof payload.login !== 'string') {
            return null
        }
        return {
            uid: payload.uid,
            login: payload.login
        }
    } catch {
        return null
    }
}

export async function getBrokerSessionFromHeaders(headers: Headers): Promise<BrokerSessionPayload | null> {
    const token = headers.get(BROKER_SESSION_HEADER)?.trim()
    if (!token) {
        return null
    }
    return await verifyBrokerSessionToken(token)
}

export async function signBrokerSessionToken(payload: BrokerSessionPayload, expiresIn: string = '30d'): Promise<string> {
    const secret = await getBrokerSecret()
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secret)
}

export { BROKER_SESSION_HEADER }
