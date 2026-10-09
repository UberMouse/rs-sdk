// rs-sdk: development endpoints on the management port for conductor save states
// (conductor/docs/parallel-bots.md). Not served when NODE_PRODUCTION is set.
//
//   GET  /save/:name   the save as it is now: the live player if online (no logout, nothing
//                      touched), else the save pending with the login thread, else the .sav
//   POST /kick/:name   log the player out server-side, retrying while combat delays it, and
//                      wait until the login thread has written its save
//
// These handlers run on the tick thread, between cycles, so they read World directly.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import World from '#/engine/World.js';
import Environment from '#/util/Environment.js';
import { fromBase37, toBase37 } from '#/util/JString.js';

/** Combat delays a logout by up to 10s and the request is dropped, so it is renewed on this period. */
const KICK_RETRY_MS = 5_000;
const KICK_TIMEOUT_MS = 30_000;
const KICK_POLL_MS = 200;

function safeName(name: string): string {
    return fromBase37(toBase37(name));
}

function savePath(name: string): string {
    return `data/players/${Environment.node.profile}/${name}.sav`;
}

function isOnline(name: string): boolean {
    return World.getPlayerByUsername(name) !== undefined;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function exportSave(name: string): Response {
    let bytes: Uint8Array | undefined;
    let source: 'live' | 'logout' | 'file';
    const player = World.getPlayerByUsername(name);
    if (player) {
        // No closeModal(): the export must not disturb the bot. Items parked in temp invs behind
        // an open interface (a trade or duel offer) are therefore not in it.
        bytes = player.save(false);
        source = 'live';
    } else if (World.logoutRequests.has(name)) {
        bytes = World.logoutRequests.get(name)!.save;
        source = 'logout';
    } else {
        const path = savePath(name);
        if (!fs.existsSync(path)) return json({ error: `no save for ${name}` }, 404);
        bytes = fs.readFileSync(path);
        source = 'file';
    }
    return new Response(bytes, {
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Save-Source': source,
            'X-Save-Sha1': createHash('sha1').update(bytes).digest('hex'),
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
    return json({ name, loggedOut: false, online: isOnline(name), error: `still logged in after ${KICK_TIMEOUT_MS / 1000}s (in combat?)` }, 409);
}

/** Routes /save/:name and /kick/:name; undefined for any other path. */
export async function handleSaveRequest(req: Request, url: URL): Promise<Response | undefined> {
    const match = url.pathname.match(/^\/(save|kick)\/([^/]+)\/?$/);
    if (!match) return undefined;
    if (Environment.NODE_PRODUCTION) return json({ error: 'save endpoints are disabled in production' }, 403);
    const [, route, raw] = match;
    const name = safeName(decodeURIComponent(raw));
    if (!name) return json({ error: 'bad name' }, 400);
    if (route === 'save') {
        return req.method === 'GET' ? exportSave(name) : json({ error: 'GET only' }, 405);
    }
    return req.method === 'POST' ? kick(name) : json({ error: 'POST only' }, 405);
}
