// Player saves on the local server: read and write them through the engine, kick, decode, and the
// scenario library. See conductor/docs/parallel-bots.md. Local server only, with the Grand Exchange
// off, so a .sav file is the whole saved state of an offline player.
//
// Writes go to the path the engine itself reports (GET /save on its management port) and are then
// read back through the engine, so a tool running in another worktree, or against an engine whose
// GE checkpoint would win, cannot report a write the engine never sees.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod/v4';
import { type BotEnv, controllerCount, FETCH_TIMEOUT_MS, REPO_ROOT } from './env';
import { configName, objInfo, packFile } from './packs';
import { errMessage, fileStamp } from './util';

/** Newest save format the engine reads (PlayerLoading.SAV_VERSION). */
const SAV_VERSION = 9;
const SAV_MAGIC = 0x2004;
/** Oldest format decodeSave reads: earlier ones omit inventory sizes. */
const MIN_DECODE_VERSION = 5;
/** The engine waits out a combat logout delay for up to 30s before answering a kick. */
const KICK_FETCH_TIMEOUT_MS = 40_000;
const MANAGEMENT_PORT = 8898;
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
const MAX_LEVEL = 99;
/** Bytes between the position and the stats: body (7), colours (5), gender, run energy (2), playtime (4, v2+). */
const APPEARANCE_AND_ENERGY_BYTES = 7 + 5 + 1 + 2 + 4;

export function sha1(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

/** The engine's management origin: the bot's engine host on port 8898, or RS_MANAGEMENT_ORIGIN. */
function managementOrigin(env: BotEnv): string {
    if (process.env.RS_MANAGEMENT_ORIGIN) return process.env.RS_MANAGEMENT_ORIGIN;
    const url = new URL(env.webOrigin);
    url.port = String(MANAGEMENT_PORT);
    return url.origin;
}

/** fetch with a timeout and errors that say what went wrong: down, too slow, or an engine without the endpoints. */
async function managementFetch(env: BotEnv, path: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const url = `${managementOrigin(env)}${path}`;
    let res: Response;
    try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
        if (e instanceof Error && e.name === 'TimeoutError') {
            throw new Error(`${init.method ?? 'GET'} ${url} timed out after ${timeoutMs / 1000}s`, { cause: e });
        }
        throw new Error(`engine management port unreachable at ${url} (${errMessage(e)})`, { cause: e });
    }
    const isJson = res.headers.get('content-type')?.includes('json') === true;
    if (res.status === 404 && !isJson) {
        throw new Error(
            `the engine at ${managementOrigin(env)} has no ${path.split('/')[1]} endpoint: it runs code older than these tools. ${SHARED_RESTART}`,
        );
    }
    if (res.status === 403) {
        const body: unknown = isJson ? await res.json() : await res.text();
        const off = JSON.stringify(body).includes('SAVE_ENDPOINTS');
        throw new Error(`${url}: ${JSON.stringify(body)}${off ? `. ${SHARED_RESTART}` : ''}`);
    }
    return { res, isJson };
}

/** What an engine without (working) save endpoints means: other sessions share it, so don't restart it alone. */
const SHARED_RESTART =
    'The local stack is shared with other sessions: report it to the user rather than restarting the engine yourself (conductor/docs/parallel-bots.md)';

const SAVE_SOURCES = ['live', 'logout', 'checkpoint', 'file'] as const;
export type SaveSource = (typeof SAVE_SOURCES)[number];
/**
 * The player's save, as GET /save reports it. live: the player is online; logout: its logout save
 * is in flight to disk; checkpoint: a Grand Exchange checkpoint that the next login loads instead
 * of the .sav; file: the .sav; none: no save yet. `path` is the .sav file this engine reads.
 */
export type SaveStatus =
    | { source: 'none'; path: string }
    | { source: SaveSource; path: string; bytes: Uint8Array; sha1: string };
export type ExistingSave = Exclude<SaveStatus, { source: 'none' }>;
const isSaveSource = (s: string): s is SaveSource => (SAVE_SOURCES as readonly string[]).includes(s);

/** Throw unless the engine that answered is the one the bot plays on (its web port matches SERVER's). */
function requireSameEngine(env: BotEnv, webPort: unknown): void {
    const url = new URL(env.webOrigin);
    const expected = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (String(webPort) !== expected) {
        throw new Error(
            `the management port at ${managementOrigin(env)} belongs to the engine on web port ${String(webPort)}, but ${env.username} plays on ${env.webOrigin}; set RS_MANAGEMENT_ORIGIN to that engine's management port`,
        );
    }
}

/** The player's current save as the engine sees it, without logging it out (GET /save). */
export async function saveStatus(env: BotEnv): Promise<SaveStatus> {
    const { res, isJson } = await managementFetch(env, `/save/${encodeURIComponent(env.username)}`);
    if (res.status === 404 && isJson) {
        const body = (await res.json()) as { path?: unknown; webPort?: unknown };
        if (typeof body.path !== 'string') throw new Error(`GET /save/${env.username}: 404 without a path`);
        requireSameEngine(env, body.webPort);
        return { source: 'none', path: body.path };
    }
    if (!res.ok) throw new Error(`GET /save/${env.username}: ${res.status} ${await res.text()}`);
    requireSameEngine(env, res.headers.get('x-engine-web-port'));
    const source = res.headers.get('x-save-source') ?? '';
    const path = res.headers.get('x-save-path');
    if (!isSaveSource(source) || !path) {
        throw new Error(`GET /save/${env.username}: unexpected headers (source "${source}", path "${path}")`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    verifySave(bytes);
    const hash = sha1(bytes);
    const sent = res.headers.get('x-save-sha1');
    if (sent && sent !== hash)
        throw new Error(`GET /save/${env.username}: body does not match X-Save-Sha1 (truncated?)`);
    return { source, path, bytes, sha1: hash };
}

/** Is the player in the world (online, or its logout save still in flight)? */
export const inWorld = (status: SaveStatus) => status.source === 'live' || status.source === 'logout';

/** The player's current save; throws when it has none. */
export async function exportSave(env: BotEnv): Promise<ExistingSave> {
    const status = await saveStatus(env);
    if (status.source === 'none') throw new Error(`${env.username} has no save`);
    return status;
}

/**
 * Throw while a script or task controls the bot, and when the gateway can't say. A controller can
 * be attached to an offline bot too, waiting for its client: it would resume on whatever save the
 * bot logs in with, so a write is refused as much as a logout. `doing` names what is refused.
 */
export async function requireNoController(env: BotEnv, doing: string): Promise<void> {
    let controllers: number;
    try {
        controllers = await controllerCount(env);
    } catch (e) {
        throw new Error(`could not check ${env.username} for a running controller (${errMessage(e)}); not ${doing}`, {
            cause: e,
        });
    }
    if (controllers > 0) {
        throw new Error(
            `${env.username} is controlled by ${controllers} connection(s) (a running task or script); not ${doing} under it. Wait for it to finish, or pass --takeover if that run is yours`,
        );
    }
}

/** Why a GE checkpoint blocks `doing`: the engine loads the checkpoint instead of the .sav. */
export const checkpointRefusal = (name: string, doing: string) =>
    `${name} has a Grand Exchange checkpoint that the engine loads instead of its .sav; not ${doing}. Retire data/market.sqlite (conductor/docs/parallel-bots.md)`;

/**
 * Log an in-world bot out server-side. Refuses (throws) while a script or task controls it, since
 * that would pull the bot from under it, unless `takeover`; and when the gateway can't say.
 */
export async function logOut(env: BotEnv, { takeover = false } = {}): Promise<void> {
    if (!takeover) await requireNoController(env, 'logging it out');
    if (!(await kick(env))) throw new Error(`${env.username} did not log out (in combat, or still busy); try again`);
}

/**
 * Clear the way to write a player's save, refusing before anything is touched: a GE checkpoint
 * (it would win over the write), or a controller attached in the world or out of it (unless
 * `takeover`). Then log a bot in the world out. `doing` names the write in the refusals.
 */
export async function prepareForWrite(env: BotEnv, status: SaveStatus, doing: string, takeover = false) {
    if (status.source === 'checkpoint') throw new Error(checkpointRefusal(env.username, doing));
    if (!takeover) await requireNoController(env, doing);
    if (inWorld(status)) await logOut(env, { takeover: true }); // controllers checked above
}

/** `pre-` labels are reserved for writeSave's backups; a user snapshot can't take one. */
export const RESERVED_LABEL_PREFIX = 'pre-';
/** The labels writeSave is called with; its backups are `pre-<label>`. */
const WRITE_LABELS = ['restore', 'load', 'write'] as const;
type WriteLabel = (typeof WRITE_LABELS)[number];
const backupLabel = (label: WriteLabel) => `${RESERVED_LABEL_PREFIX}${label}`;
/** Is this snapshot label one of writeSave's backups? */
export const isBackupLabel = (label: string) => WRITE_LABELS.some(l => backupLabel(l) === label);

/**
 * Log the player out server-side and wait until its save is on disk (POST /kick). Returns false
 * when it is still in the world after the engine's wait (combat); throws on anything else.
 */
export async function kick(env: BotEnv): Promise<boolean> {
    const path = `/kick/${encodeURIComponent(env.username)}`;
    const { res, isJson } = await managementFetch(env, path, { method: 'POST' }, KICK_FETCH_TIMEOUT_MS);
    const body: unknown = isJson ? await res.json() : await res.text();
    if (res.status === 200) return true;
    if (res.status === 409) return false;
    throw new Error(`POST ${path}: ${res.status} ${JSON.stringify(body)}`);
}

/** Write via a tmp file in the destination dir, so a reader never sees a half-written file. */
export function atomicWrite(dest: string, bytes: Uint8Array): void {
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = join(dirname(dest), `.${Date.now()}-${process.pid}.tmp`);
    try {
        writeFileSync(tmp, bytes);
        renameSync(tmp, dest);
    } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
    }
}

/**
 * Make `bytes` the player's save, at the path the engine reads, then check through the engine that
 * it now serves exactly these bytes. Refuses while the player is in the world (kick() first) or when
 * a GE checkpoint would win. The save it replaces is kept first as `<stamp>-pre-<label>.sav` in a
 * `conductor-backups/` directory beside the engine's save (it outlives the worktree that ran the
 * tool) and, with `backupDir`, there too. Returns the path written and the backup, if one was taken.
 */
export async function writeSave(
    env: BotEnv,
    bytes: Uint8Array,
    {
        backupDir,
        label = 'write',
        onWrite,
    }: {
        backupDir?: string;
        label?: WriteLabel;
        /** Called just before the save file is written. */ onWrite?: () => void;
    } = {},
): Promise<{ path: string; backup?: string }> {
    verifySave(bytes);
    const before = await saveStatus(env);
    if (inWorld(before))
        throw new Error(`${env.username} is in the world (${before.source}); kick it before writing its save`);
    if (before.source === 'checkpoint') throw new Error(checkpointRefusal(env.username, 'writing its save'));
    let backup: string | undefined;
    if (before.source !== 'none') {
        const file = `${fileStamp()}-${backupLabel(label)}.sav`;
        backup = join(dirname(before.path), 'conductor-backups', env.username.toLowerCase(), file);
        atomicWrite(backup, before.bytes);
        if (backupDir) {
            backup = join(backupDir, file);
            atomicWrite(backup, before.bytes);
        }
    }
    onWrite?.();
    atomicWrite(before.path, bytes);
    const after = await saveStatus(env);
    if (after.source !== 'file' || after.sha1 !== sha1(bytes)) {
        const served = after.source === 'none' ? 'nothing' : `"${after.source}" (sha1 ${after.sha1.slice(0, 12)})`;
        throw new Error(
            `wrote ${before.path}, but the engine now serves ${env.username}'s save from ${served}: ${inWorld(after) ? 'it logged in during the write, and its logout will overwrite it' : 'the write did not take'}${backup ? `; the previous save is in ${backup}` : ''}`,
        );
    }
    return { path: before.path, backup };
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

// ---- decoding ----

/** Engine XP table in tenths of XP (Player.ts levelExperience). */
const LEVEL_XP = (() => {
    const table: number[] = [];
    let acc = 0;
    for (let level = 1; level <= MAX_LEVEL; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        table.push(Math.floor(acc / 4) * 10);
    }
    return table;
})();

function levelForXp(tenths: number): number {
    for (let i = MAX_LEVEL - 1; i >= 0; i--) if (tenths >= LEVEL_XP[i]!) return Math.min(i + 2, MAX_LEVEL);
    return 1;
}

/**
 * Item id -> config name, from this checkout's content pack (ids are the same in every checkout); `obj_<id>` for an id
 * it does not list, or with no pack in the checkout.
 */
const objName = (id: number): string => (existsSync(packFile('obj')) && configName('obj', id)) || `obj_${id}`;

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

/**
 * Decode the parts of a save worth describing. Mirrors PlayerLoading.load for versions 5-9 up to the
 * inventories; what follows them (AFK zones, chat modes, last login, recovery items, v9's level playtimes)
 * is left unread.
 */
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
    pos += APPEARANCE_AND_ENERGY_BYTES;
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

const ItemSchema = z.object({ id: z.number(), name: z.string(), count: z.number() });
const LibraryEntrySchema = z.object({
    name: z.string(),
    purpose: z.string(),
    source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('snapshot'), bot: z.string() }),
        z.object({ kind: z.literal('generated'), spec: z.unknown() }),
        z.object({ kind: z.literal('file'), path: z.string() }),
    ]),
    sha1: z.string(),
    createdAt: z.iso.datetime(),
    saveVersion: z.number(),
    summary: z.object({
        position: z.object({ x: z.number(), z: z.number(), level: z.number() }),
        levels: z.record(z.string(), z.number()),
        inventory: z.array(ItemSchema),
        worn: z.array(ItemSchema),
        bank: z.array(ItemSchema),
        varps: z.record(z.string(), z.number()),
    }),
});
/** conductor/saves/<name>.json: what a library save is for, where it came from, what it holds. */
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
type LibrarySource = LibraryEntry['source'];

function libraryPaths(name: string): { sav: string; json: string } {
    if (!SAVE_NAME.test(name)) throw new Error(`library save names are letters, digits and dashes: "${name}"`);
    return { sav: join(LIBRARY_DIR, `${name}.sav`), json: join(LIBRARY_DIR, `${name}.json`) };
}

function readEntry(jsonPath: string): LibraryEntry {
    let json: unknown;
    try {
        json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch (e) {
        throw new Error(`${jsonPath} is not valid JSON: ${errMessage(e)}`, { cause: e });
    }
    const parsed = LibraryEntrySchema.safeParse(json);
    if (!parsed.success) throw new Error(`${jsonPath} is not a valid library entry: ${parsed.error.message}`);
    return parsed.data;
}

/** Every library entry, by name, plus any entry files that don't parse (one bad file never hides the rest). */
export function listLibrary(): { entries: LibraryEntry[]; invalid: { file: string; error: string }[] } {
    const entries: LibraryEntry[] = [];
    const invalid: { file: string; error: string }[] = [];
    if (!existsSync(LIBRARY_DIR)) return { entries, invalid };
    for (const file of readdirSync(LIBRARY_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()) {
        try {
            entries.push(readEntry(join(LIBRARY_DIR, file)));
        } catch (e) {
            invalid.push({ file, error: errMessage(e) });
        }
    }
    return { entries, invalid };
}

/**
 * The inventory items of a spec that put more than one of a non-stackable obj in a single inventory slot (`{ id: 373, count: 20 }`
 * is 20 swordfish in one slot). The engine loads such a slot as is, and the first use or eat of one of them
 * removes the whole slot: 20 held swordfish vanished with one eat. List the item once per copy instead.
 */
export function unstackableStacks(items: ReadonlyArray<{ id: number; count: number }> | undefined): string[] {
    const bad: string[] = [];
    for (const { id, count } of items ?? []) {
        const obj = configName('obj', id);
        if (count > 1 && obj && objInfo(obj)?.stackable === false) bad.push(`${obj} (id ${id}) x${count}`);
    }
    return bad;
}

/**
 * Add a library save; its summary is decoded from the bytes, never hand-written. Refuses when an
 * entry of that name exists, even half-written (other agents' tests depend on them), unless
 * `replace`. The .sav and .json are two writes: a reader between them sees a sha1 mismatch, which
 * readLibrarySave reports. The existence check is not a lock: don't let two agents add one name.
 */
export function writeLibrarySave(
    name: string,
    bytes: Uint8Array,
    meta: { purpose: string; source: LibrarySource; replace?: boolean },
): LibraryEntry {
    if (!meta.purpose.trim()) throw new Error('a library save needs a purpose');
    const paths = libraryPaths(name);
    if ((existsSync(paths.json) || existsSync(paths.sav)) && !meta.replace) {
        throw new Error(`library save "${name}" exists; pick another name, or replace it explicitly`);
    }
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
    // A replace keeps the old pair in memory and puts it back if either write fails.
    const old = [paths.sav, paths.json].map(p => (existsSync(p) ? { p, bytes: readFileSync(p) } : { p }));
    try {
        atomicWrite(paths.sav, bytes);
        atomicWrite(paths.json, new TextEncoder().encode(`${JSON.stringify(entry, null, 4)}\n`));
    } catch (e) {
        for (const o of old) {
            if (o.bytes) atomicWrite(o.p, o.bytes);
            else rmSync(o.p, { force: true });
        }
        throw e;
    }
    return entry;
}

/** A library save's bytes, checked against the hash its entry recorded. */
export function readLibrarySave(name: string): { bytes: Uint8Array; entry: LibraryEntry } {
    const paths = libraryPaths(name);
    if (!existsSync(paths.sav) || !existsSync(paths.json)) {
        throw new Error(`no library save "${name}" in ${LIBRARY_DIR}`);
    }
    const bytes = new Uint8Array(readFileSync(paths.sav));
    const entry = readEntry(paths.json);
    if (sha1(bytes) !== entry.sha1) throw new Error(`${paths.sav} does not match the sha1 in ${paths.json}`);
    return { bytes, entry };
}
