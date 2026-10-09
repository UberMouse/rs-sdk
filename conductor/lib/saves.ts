// Player saves on the local server: export a live save, kick, write, decode, and the scenario library.
// See conductor/docs/parallel-bots.md. Local server only; the Grand Exchange must be off there, so a
// .sav file on disk is the whole truth for an offline player.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './env';
import { errMessage } from './util';

/** Newest save format the engine reads (PlayerLoading.SAV_VERSION). */
const SAV_VERSION = 8;
const SAV_MAGIC = 0x2004;
/** Oldest format decodeSave reads: earlier ones omit inventory sizes. */
const MIN_DECODE_VERSION = 5;
const FETCH_TIMEOUT_MS = 5_000;
/** A kick waits out a combat logout delay engine-side (up to 30s), so allow for that. */
const KICK_FETCH_TIMEOUT_MS = 40_000;
const ENGINE_ORIGIN = process.env.RS_ENGINE_ORIGIN ?? 'http://localhost:8888';
const MANAGEMENT_ORIGIN = process.env.RS_MANAGEMENT_ORIGIN ?? 'http://localhost:8898';
export const LIBRARY_DIR = join(REPO_ROOT, 'conductor/saves');
/** A library save name, and a snapshot label. */
export const SAVE_NAME = /^[a-z0-9-]+$/i;

/** Inv type ids (server/content/pack/inv.pack). */
const INV = { inv: 93, worn: 94, bank: 95 } as const;
/** Save stat order (PlayerStat); null for the unused slots. */
const STATS = [
    'Attack',
    'Defence',
    'Strength',
    'Hitpoints',
    'Ranged',
    'Prayer',
    'Magic',
    'Cooking',
    'Woodcutting',
    'Fletching',
    'Fishing',
    'Firemaking',
    'Crafting',
    'Smithing',
    'Mining',
    'Herblore',
    'Agility',
    'Thieving',
    null,
    null,
    'Runecraft',
] as const;

/** The server/engine directory the local server runs from (one shared server, many worktrees). */
export function engineDir(): string {
    return process.env.RS_ENGINE_DIR ?? join(REPO_ROOT, 'server/engine');
}

export function savePath(username: string): string {
    return join(engineDir(), 'data/players/main', `${username.toLowerCase()}.sav`);
}

export function sha1(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

/** Server-side truth: is the player in the world? null when the engine is down. */
export async function inWorld(username: string): Promise<boolean | null> {
    try {
        const res = await fetch(`${ENGINE_ORIGIN}/playerpositions`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const players: { name: string }[] = await res.json();
        return players.some(p => p.name.toLowerCase() === username.toLowerCase());
    } catch {
        return null;
    }
}

/** Throw unless the bytes are a save the engine will load: magic, a known version, a matching CRC. */
export function verifySave(bytes: Uint8Array): number {
    if (bytes.length < 8) throw new Error(`not a save: ${bytes.length} bytes`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== SAV_MAGIC) throw new Error('not a save: bad magic');
    const version = view.getUint16(2);
    if (version > SAV_VERSION) throw new Error(`save version ${version} is newer than the engine's ${SAV_VERSION}`);
    const crc = view.getInt32(bytes.length - 4);
    if (crc !== (Bun.hash.crc32(bytes.subarray(0, bytes.length - 4)) | 0)) throw new Error('save CRC mismatch');
    return version;
}

export interface ExportedSave {
    bytes: Uint8Array;
    /** live: the online player now; logout: the save in flight to disk; file: the .sav on disk. */
    source: 'live' | 'logout' | 'file';
    sha1: string;
}

/** The player's save as it is now, without logging it out (GET /save on the engine's management port). */
export async function exportSave(username: string): Promise<ExportedSave> {
    let res: Response;
    try {
        res = await fetch(`${MANAGEMENT_ORIGIN}/save/${encodeURIComponent(username)}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch (e) {
        throw new Error(`engine management port unreachable at ${MANAGEMENT_ORIGIN} (${errMessage(e)})`, { cause: e });
    }
    if (res.status === 404 && res.headers.get('content-type')?.includes('json') !== true) {
        throw new Error(
            `the engine at ${MANAGEMENT_ORIGIN} has no /save endpoint; restart it from a checkout that has it`,
        );
    }
    if (!res.ok) throw new Error(`GET /save/${username}: ${res.status} ${await res.text()}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    verifySave(bytes);
    return { bytes, source: (res.headers.get('x-save-source') ?? 'file') as ExportedSave['source'], sha1: sha1(bytes) };
}

/** Log the player out server-side and wait until its save is on disk. Returns whether it left the world. */
export async function kick(username: string): Promise<boolean> {
    let res: Response;
    try {
        res = await fetch(`${MANAGEMENT_ORIGIN}/kick/${encodeURIComponent(username)}`, {
            method: 'POST',
            signal: AbortSignal.timeout(KICK_FETCH_TIMEOUT_MS),
        });
    } catch (e) {
        throw new Error(`engine management port unreachable at ${MANAGEMENT_ORIGIN} (${errMessage(e)})`, { cause: e });
    }
    if (res.status === 404 && res.headers.get('content-type')?.includes('json') !== true) {
        throw new Error(
            `the engine at ${MANAGEMENT_ORIGIN} has no /kick endpoint; restart it from a checkout that has it`,
        );
    }
    const body: { loggedOut?: boolean } = await res.json();
    return body.loggedOut === true;
}

/** Write via a tmp file in the destination dir, so a reader never sees a half-written file. */
export function atomicWrite(dest: string, bytes: Uint8Array): void {
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = join(dirname(dest), `.${Date.now()}-${process.pid}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
}

/**
 * Make `bytes` the player's save. Refuses while the player is in the world, where the next logout
 * or autosave would overwrite it; kick() first. Fails if the GE save store is still active.
 */
export async function writeSave(username: string, bytes: Uint8Array): Promise<string> {
    verifySave(bytes);
    if (existsSync(join(engineDir(), 'data/market.sqlite'))) {
        throw new Error(
            `${engineDir()}/data/market.sqlite exists: the engine would load its checkpoint instead of the .sav; retire it (see conductor/docs/parallel-bots.md)`,
        );
    }
    const present = await inWorld(username);
    if (present) throw new Error(`${username} is in the world; kick it before writing its save`);
    const dest = savePath(username);
    atomicWrite(dest, bytes);
    // The player may have logged in between the check and the write; its logout would undo the write.
    if (await inWorld(username)) throw new Error(`${username} logged in while its save was being written`);
    return dest;
}

// ---- decoding ----

/** Engine XP table in tenths of XP (Player.ts levelExperience). */
const LEVEL_XP = (() => {
    const table: number[] = [];
    let acc = 0;
    for (let level = 1; level <= 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        table.push(Math.floor(acc / 4) * 10);
    }
    return table;
})();

function levelForXp(tenths: number): number {
    for (let i = 98; i >= 0; i--) if (tenths >= LEVEL_XP[i]!) return Math.min(i + 2, 99);
    return 1;
}

let objNames: Map<number, string> | undefined;
/** Item id -> config name, from the content pack next to the engine. */
function objName(id: number): string {
    if (!objNames) {
        objNames = new Map();
        const pack = join(engineDir(), '../content/pack/obj.pack');
        if (existsSync(pack)) {
            for (const line of readFileSync(pack, 'utf8').split('\n')) {
                const eq = line.indexOf('=');
                if (eq > 0) objNames.set(Number(line.slice(0, eq)), line.slice(eq + 1).trim());
            }
        }
    }
    return objNames.get(id) ?? `obj_${id}`;
}

export interface SaveItem {
    id: number;
    name: string;
    count: number;
}

export interface SaveSummary {
    saveVersion: number;
    position: { x: number; z: number; level: number };
    /** Base levels from XP, for skills above 1. */
    levels: Record<string, number>;
    inventory: SaveItem[];
    worn: SaveItem[];
    bank: SaveItem[];
    /** Non-zero perm varps (quest and tutorial progress among them). */
    varps: Record<number, number>;
}

/** Decode the parts of a save worth describing. Mirrors PlayerLoading.load for versions 5-8. */
export function decodeSave(bytes: Uint8Array): SaveSummary {
    const saveVersion = verifySave(bytes);
    if (saveVersion < MIN_DECODE_VERSION) throw new Error(`save version ${saveVersion} is too old to decode`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 4;
    const g1 = () => view.getUint8(pos++);
    const g2 = () => ((pos += 2), view.getUint16(pos - 2));
    const g4s = () => ((pos += 4), view.getInt32(pos - 4));
    const gVarInt = () => {
        let byte = g1();
        let result = 0;
        while ((byte & 0x80) !== 0) {
            result = (result | (byte & 0x7f)) << 7;
            byte = g1();
        }
        return (result | byte) >>> 0;
    };

    const position = { x: g2(), z: g2(), level: g1() };
    pos += 7 + 5 + 1 + 2 + 4; // body, colours, gender, run energy, playtime (v2+)
    const levels: Record<string, number> = {};
    for (const skill of STATS) {
        const level = levelForXp(g4s());
        g1(); // current (boosted or drained) level
        if (skill && level > 1) levels[skill] = level;
    }
    const varps: Record<number, number> = {};
    const varpCount = g2();
    for (let i = 0; i < varpCount; i++) {
        const id = saveVersion >= 7 ? g2() : i;
        const value = saveVersion >= 7 ? gVarInt() | 0 : g4s(); // signed, as the engine treats them
        if (value !== 0) varps[id] = value;
    }
    const invs = new Map<number, SaveItem[]>();
    const invCount = g1();
    for (let i = 0; i < invCount; i++) {
        const type = g2();
        const size = g2();
        const items: SaveItem[] = [];
        for (let slot = 0; slot < size; slot++) {
            const id = g2() - 1;
            if (id === -1) continue;
            let count = g1();
            if (count === 255) count = g4s();
            items.push({ id, name: objName(id), count });
        }
        invs.set(type, items);
    }
    return {
        saveVersion,
        position,
        levels,
        inventory: invs.get(INV.inv) ?? [],
        worn: invs.get(INV.worn) ?? [],
        bank: invs.get(INV.bank) ?? [],
        varps,
    };
}

// ---- library ----

export type SaveSource =
    | { kind: 'snapshot'; bot: string }
    | { kind: 'generated'; spec: unknown }
    | { kind: 'file'; path: string };

/** conductor/saves/<name>.json: what a library save is for, where it came from, what it holds. */
export interface LibraryEntry {
    name: string;
    purpose: string;
    source: SaveSource;
    sha1: string;
    createdAt: string;
    saveVersion: number;
    summary: Omit<SaveSummary, 'saveVersion'>;
}

export function libraryPaths(name: string): { sav: string; json: string } {
    return { sav: join(LIBRARY_DIR, `${name}.sav`), json: join(LIBRARY_DIR, `${name}.json`) };
}

/** Add (or replace) a library save; its summary is decoded from the bytes, never hand-written. */
export function writeLibrarySave(
    name: string,
    bytes: Uint8Array,
    meta: { purpose: string; source: SaveSource },
): LibraryEntry {
    if (!SAVE_NAME.test(name)) throw new Error(`library save names are letters, digits and dashes: "${name}"`);
    if (!meta.purpose.trim()) throw new Error('a library save needs a purpose');
    const { saveVersion, ...summary } = decodeSave(bytes);
    const entry: LibraryEntry = {
        name,
        purpose: meta.purpose.trim(),
        source: meta.source,
        sha1: sha1(bytes),
        createdAt: new Date().toISOString(),
        saveVersion,
        summary,
    };
    const paths = libraryPaths(name);
    atomicWrite(paths.sav, bytes);
    atomicWrite(paths.json, new TextEncoder().encode(`${JSON.stringify(entry, null, 4)}\n`));
    return entry;
}

/** A library save's bytes, checked against the hash its entry recorded. */
export function readLibrarySave(name: string): { bytes: Uint8Array; entry: LibraryEntry } {
    const paths = libraryPaths(name);
    if (!existsSync(paths.sav) || !existsSync(paths.json))
        throw new Error(`no library save "${name}" in ${LIBRARY_DIR}`);
    const bytes = new Uint8Array(readFileSync(paths.sav));
    const entry: LibraryEntry = JSON.parse(readFileSync(paths.json, 'utf8'));
    if (sha1(bytes) !== entry.sha1) throw new Error(`${paths.sav} does not match the sha1 in ${paths.json}`);
    return { bytes, entry };
}
