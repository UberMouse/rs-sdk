// rs-sdk: development endpoints on the management port for conductor save states
// (conductor/docs/parallel-bots.md). Served only when SAVE_ENDPOINTS=true, which
// conductor/local/up.sh sets for the local stack.
//
//   GET  /save/:name   the save that is current now: the live player if online (no logout,
//                      nothing touched), else the save in flight to the login thread, else the
//                      Grand Exchange checkpoint the next login would load, else the .sav.
//                      X-Save-Source says which; X-Save-Path is the .sav this engine reads, also
//                      in the body of a 404 (no save yet), so tools write where the engine looks;
//                      X-Engine-Web-Port (webPort in a 404) identifies the engine.
//   POST /kick/:name   log the player out server-side, renewing the request while combat delays
//                      it, and return once the login thread has written its save
//
// These handlers run on the tick thread, between cycles, so they read World directly.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playerSaveStore } from '#/engine/market/MarketStore.js';
import World from '#/engine/World.js';
import Environment from '#/util/Environment.js';
import { fromBase37, toBase37 } from '#/util/JString.js';

/** Combat delays a logout by up to 10s and the engine drops the request, so it is renewed on this period. */
const KICK_RETRY_MS = 5_000;
const KICK_TIMEOUT_MS = 30_000;
const KICK_POLL_MS = 200;
/** What a login name may be: toBase37 reads at most 12 characters and maps spaces to underscores. */
const NAME = /^[a-z0-9_ ]{1,12}$/i;

type SaveSource = 'live' | 'logout' | 'checkpoint' | 'file';

function savePath(name: string): string {
    return path.resolve(`data/players/${Environment.node.profile}/${name}.sav`);
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function exportSave(name: string): Response {
    const file = savePath(name);
    let bytes: Uint8Array | undefined;
    let source: SaveSource;
    const player = World.getPlayerByUsername(name);
    const checkpoint = playerSaveStore()?.saved(name);
    if (player) {
        // No closeModal(): the export must not disturb the bot. Items parked in temp invs behind
        // an open interface (a trade or duel offer) are therefore not in it.
        bytes = player.save(false);
        source = 'live';
    } else if (World.logoutRequests.has(name)) {
        bytes = World.logoutRequests.get(name)!.save;
        source = 'logout';
    } else if (checkpoint) {
        // PlayerLoading.load prefers this over the .sav.
        bytes = checkpoint;
        source = 'checkpoint';
    } else if (fs.existsSync(file)) {
        bytes = fs.readFileSync(file);
        source = 'file';
    } else {
        return json({ error: `no save for ${name}`, path: file, webPort: Environment.WEB_PORT }, 404);
    }
    return new Response(bytes, {
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Save-Source': source,
            'X-Save-Path': file,
            'X-Save-Sha1': createHash('sha1').update(bytes).digest('hex'),
            // Which engine this is, so a tool can check it reached the engine its bot plays on.
            'X-Engine-Web-Port': String(Environment.WEB_PORT),
        },
    });
}

async function kick(name: string): Promise<Response> {
    const deadline = Date.now() + KICK_TIMEOUT_MS;
    let renewAt = 0;
    while (Date.now() < deadline) {
        const player = World.getPlayerByUsername(name);
        if (!player && !World.logoutRequests.has(name)) {
            return json({ name, loggedOut: true });
        }
        if (player && Date.now() >= renewAt) {
            player.requestLogout = true;
            renewAt = Date.now() + KICK_RETRY_MS;
        }
        await Bun.sleep(KICK_POLL_MS);
    }
    return json({ name, loggedOut: false, error: `still logged in after ${KICK_TIMEOUT_MS / 1000}s (in combat?)` }, 409);
}

/** Routes /save/:name and /kick/:name; undefined for any other path. */
export async function handleSaveRequest(req: Request, url: URL): Promise<Response | undefined> {
    const match = url.pathname.match(/^\/(save|kick)\/([^/]+)\/?$/);
    if (!match) return undefined;
    if (process.env.SAVE_ENDPOINTS !== 'true') {
        return json({ error: 'save endpoints are off; start the engine with SAVE_ENDPOINTS=true' }, 403);
    }
    const [, route, raw] = match;
    const decoded = decodeURIComponent(raw);
    if (!NAME.test(decoded)) return json({ error: `bad name: ${decoded}` }, 400);
    const name = fromBase37(toBase37(decoded));
    if (route === 'save') {
        return req.method === 'GET' ? exportSave(name) : json({ error: 'GET only' }, 405);
    }
    return req.method === 'POST' ? kick(name) : json({ error: 'POST only' }, 405);
}
