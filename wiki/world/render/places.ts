// wiki/places/<area-id>.md: one page per curated area. It lists only the sites whose deepest area is
// this one, a table per kind; the sites of its child areas are summed per kind beside a link to each
// child, so a region's page stays a map of its towns rather than every tree in it.
import type { Area, FeatureKind, Site, World } from '../types';
import {
    byKind,
    bySiteId,
    cmp,
    coord,
    GENERATED,
    isResourceKind,
    kindTitle,
    labeller,
    link,
    parts,
    placePath,
    resourcePath,
    SERVICE_KINDS,
    servicePath,
    table,
    wilderness,
    yesNo,
    type PageData,
} from './common';

/** `bank 1, tree 12`: sites per kind, in page order. */
const summary = (perKind: ReadonlyMap<FeatureKind, number> | undefined): string =>
    perKind?.size
        ? [...perKind]
              .sort(([a], [b]) => byKind(a, b))
              .map(([k, n]) => `${k} ${n}`)
              .join(', ')
        : '-';

/** Appends `x` to the list at `key`, making the list when it is the first. */
function push<K, V>(lists: Map<K, V[]>, key: K, x: V): void {
    const list = lists.get(key);
    if (list) list.push(x);
    else lists.set(key, [x]);
}

/** One page per area, keyed by repo-relative path. */
export function renderPlaces(world: World, data: PageData): Map<string, string> {
    const byId = new Map(world.areas.map(a => [a.id, a]));
    const leafSites = new Map<string, Site[]>();
    const under = new Map<string, Map<FeatureKind, number>>();
    for (const s of world.sites) {
        const leaf = s.areaPath.at(-1);
        if (leaf === undefined) continue;
        push(leafSites, leaf, s);
        for (const id of s.areaPath) {
            const perKind = under.get(id) ?? new Map<FeatureKind, number>();
            perKind.set(s.kind, (perKind.get(s.kind) ?? 0) + 1);
            under.set(id, perKind);
        }
    }
    const children = new Map<string, Area[]>();
    for (const a of world.areas) if (a.parent !== undefined) push(children, a.parent, a);
    const ancestors = (a: Area): Area[] => {
        const parent = a.parent === undefined ? undefined : byId.get(a.parent);
        return parent ? [...ancestors(parent), parent] : [];
    };

    const out = new Map<string, string>();
    for (const area of world.areas) {
        const path = placePath(area.id);
        const to = (id: string): string => link(path, placePath(id));
        const lines = [GENERATED, `# ${area.name}`, ''];
        const up = ancestors(area);
        if (up.length) lines.push([...up.map(a => `[${a.name}](${to(a.id)})`), area.name].join(' › '), '');
        if (area.notes) lines.push(area.notes, '');
        if (area.requires?.length) lines.push(`Requires: ${area.requires.join(', ')}.`, '');

        const sites = leafSites.get(area.id) ?? [];
        const held = new Map(sites.map(s => [s, parts(s, world, data)]));
        const label = labeller([...held].flatMap(([s, ps]) => ps.map(p => [s.kind, p] as const)));
        const kinds = [...new Set(sites.map(s => s.kind))].sort(byKind);
        if (!kinds.length) lines.push('No site lies in this area outside its child areas.', '');
        for (const kind of kinds) {
            // A service kind's heading links its page; a resource kind's subtypes link theirs.
            const heading = SERVICE_KINDS.includes(kind)
                ? `[${kindTitle(kind)}](${link(path, servicePath(kind))})`
                : kindTitle(kind);
            const counts = (s: Site): string =>
                held
                    .get(s)!
                    .map(p =>
                        isResourceKind(kind)
                            ? `[${label(kind, p)}](${link(path, resourcePath(kind, p.key))}) ${p.n}`
                            : `${label(kind, p)} ${p.n}`,
                    )
                    .join(', ');
            lines.push(
                `## ${heading}`,
                '',
                ...table(
                    ['Site', 'Centre', 'Counts', 'F2P', 'Multiway', 'Wilderness'],
                    sites
                        .filter(s => s.kind === kind)
                        .sort((a, b) => bySiteId(a.id, b.id))
                        .map(s => [
                            `\`${s.id}\``,
                            coord(s.centre),
                            counts(s),
                            yesNo(s.f2p),
                            yesNo(s.multiway),
                            wilderness(s.wildernessLevel),
                        ]),
                ),
                '',
            );
        }

        const inside = [...(children.get(area.id) ?? [])].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
        if (inside.length)
            lines.push(
                '## Areas within',
                '',
                ...table(
                    ['Area', 'Sites in it'],
                    inside.map(c => [`[${c.name}](${to(c.id)})`, summary(under.get(c.id))]),
                ),
                '',
            );
        out.set(path, lines.join('\n'));
    }
    return out;
}
