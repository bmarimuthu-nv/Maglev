import type { Database } from 'bun:sqlite'
import { durableWrite } from './durableWrite'
import type { StoredTerminalPair } from './types'
import {
    createTerminalPair,
    getTerminalPairById,
    getTerminalPairByName,
    getTerminalPairsByNamespace,
    updateTerminalPair
} from './terminalPairs'

export class TerminalPairStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getByNamespace(namespace: string): StoredTerminalPair[] {
        return getTerminalPairsByNamespace(this.db, namespace)
    }

    getById(id: string, namespace: string): StoredTerminalPair | null {
        return getTerminalPairById(this.db, id, namespace)
    }

    getByName(name: string, namespace: string): StoredTerminalPair | null {
        return getTerminalPairByName(this.db, name, namespace)
    }

    create(pair: StoredTerminalPair): StoredTerminalPair {
        return durableWrite(this.db, () => createTerminalPair(this.db, pair))
    }

    update(pair: StoredTerminalPair): StoredTerminalPair | null {
        return durableWrite(this.db, () => updateTerminalPair(this.db, pair))
    }
}
