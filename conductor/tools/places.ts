// The names a plan may pass to place(): one line per place, from the world index (no bot, no network).
//
//   bun conductor/tools/places.ts [kind] [text]
//
// kind is one of the place kinds (bank, furnace, anvil, ...); text keeps the places whose name (the id or the display name) contains it, ignoring
// case. A name several sites share (an anvil, a range) shows the `near` text a plan pastes to pick that site.
import { PLACE_KINDS, type Place, places } from '../lib/places';
import { fail } from '../lib/util';

/** One line per place: `id`, the `near` hint when the id names several sites, stand `(x,z,level)`, display name. */
export function formatPlaces(all: readonly Place[], kind?: string, text?: string): string[] {
    const sites = new Map<string, number>();
    for (const p of all) sites.set(p.id, (sites.get(p.id) ?? 0) + 1);
    const needle = text?.toLowerCase();
    return all
        .filter(
            p =>
                (kind === undefined || p.kind === kind) &&
                (needle === undefined || p.id.includes(needle) || p.name.toLowerCase().includes(needle)),
        )
        .map(p => {
            const { x, z, level } = p.stand;
            const near = (sites.get(p.id) ?? 0) > 1 ? `  near { x: ${x}, z: ${z} }` : '';
            return `${p.id}${near}  (${x},${z},${level})  ${p.name}`;
        });
}

if (import.meta.main) {
    const usage = `usage: bun conductor/tools/places.ts [kind] [text]; kind is one of ${PLACE_KINDS.join(', ')}`;
    const args = process.argv.slice(2);
    if (args.length > 2) fail(usage, 2);
    const [kind, text] = args;
    if (kind !== undefined && !(PLACE_KINDS as readonly string[]).includes(kind)) fail(usage, 2);
    const lines = formatPlaces(places(), kind, text);
    if (!lines.length) fail('no place matches', 1);
    console.log(lines.join('\n'));
}
