import { join } from 'path'
import { tmpdir } from 'os'

export const MAGLEV_BLOBS_DIR_NAME = 'maglev-blobs'

export function getMaglevBlobsDir(): string {
    return join(tmpdir(), MAGLEV_BLOBS_DIR_NAME)
}
