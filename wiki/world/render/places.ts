// wiki/places/<area-id>.md: one page per curated area. It lists only the sites whose deepest area is
// this one, a table per kind; the sites of its child areas are summed per kind beside a link to each
// child, so a region's page stays a map of its towns rather than every tree in it.
import type { Area, Connector, FeatureKind, Site, World } from '../types';
import { cmp, push } from '../util';
import {
    byKind,
    bySiteId,
    coord,
    GENERATED,
    isResourceKind,
    kindTitle,
    labeller,
    link,
    parts,
    placePath,
    reachLabel,
    resourcePath,
    SERVICE_KINDS,
    servicePath,
    table,
    wilderness,
    yesNo,
    type Page,
    type PageData,
    type Part,
} from './common';

/** `bank 1, tree 12`: sites per kind, in page order. */
const summary = (perKind: ReadonlyMap<FeatureKind, number> | undefined): string =>
    perKind?.size
        ? [...perKind]
              .sort(([a], [b]) => byKind(a, b))
              .map(([k, n]) => `${k} ${n}`)
              .join(', ')
        : '-';

/**
 * Where a connector site's locs lead: each direction and landing once, by the ops that take it there (`Open,
 * then Climb-down` for an op that swaps the loc first, Connector.thenOp), in the order of the site's
 * features, then each feature's connectors in World.connectors order (by op, landing); `-` when the
 * scripts give none.
 */
const leadsTo = (site: Site, byFeature: ReadonlyMap<number, Connector[]>): string => {
    const out = new Map<string, Set<string>>();
    for (const i of site.features)
        for (const c of byFeature.get(i) ?? []) {
            const where = `${c.direction === 'other' ? 'to' : c.direction} ${coord(c.landing)}`;
            const ops = out.get(where) ?? new Set<string>();
            ops.add(c.thenOp ? `${c.opName}, then ${c.thenOp.opName}` : c.opName);
            out.set(where, ops);
        }
    return out.size ? [...out].map(([where, ops]) => `${where} by ${[...ops].join(' or ')}`).join('; ') : '-';
};

/** One page per area, as its repo-relative path and text. */
export function renderPlaces(world: World, data: PageData): Page[] {
    const byId = new Map(world.areas.map(a => [a.id, a]));
    const requires = reachLabel(world, data);
    const byFeature = new Map<number, Connector[]>();
    for (const c of world.connectors) push(byFeature, c.feature, c);
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

    const out: Page[] = [];
    for (const area of world.areas) {
        const path = placePath(area.id);
        const to = (id: string): string => link(path, placePath(id));
        const lines = [GENERATED, `# ${area.name}`, ''];
        const up = ancestors(area);
        if (up.length) lines.push([...up.map(a => `[${a.name}](${to(a.id)})`), area.name].join(' › '), '');
        if (area.notes) lines.push(area.notes, '');
        if (area.requires?.length) lines.push(`Requires: ${area.requires.join(', ')}.`, '');

        const sites = leafSites.get(area.id) ?? [];
        // Each site beside its parts, computed once: the labeller needs every part on the page.
        const held = sites.map(site => ({ site, parts: parts(site, world, data) }));
        const label = labeller(held.flatMap(({ site, parts: ps }) => ps.map(p => [site.kind, p] as const)));
        const kinds = [...new Set(sites.map(s => s.kind))].sort(byKind);
        if (!kinds.length) lines.push('No site lies in this area outside its child areas.', '');
        for (const kind of kinds) {
            // A service kind's heading links its page; a resource kind's subtypes link theirs.
            const heading = SERVICE_KINDS.includes(kind)
                ? `[${kindTitle(kind)}](${link(path, servicePath(kind))})`
                : kindTitle(kind);
            const counts = (ps: readonly Part[]): string =>
                ps
                    .map(p =>
                        isResourceKind(kind)
                            ? `[${label(kind, p)}](${link(path, resourcePath(kind, p.key))}) ${p.n}`
                            : `${label(kind, p)} ${p.n}`,
                    )
                    .join(', ');
            // A connector's row also says where it leads (World.connectors).
            const connector = kind === 'connector';
            lines.push(
                `## ${heading}`,
                '',
                ...table(
                    [
                        'Site',
                        'Centre',
                        'Counts',
                        ...(connector ? ['Leads to'] : []),
                        'F2P',
                        'Multiway',
                        'Wilderness',
                        'Requires',
                    ],
                    held
                        .filter(({ site }) => site.kind === kind)
                        .sort((a, b) => bySiteId(a.site.id, b.site.id))
                        .map(({ site: s, parts: ps }) => [
                            `\`${s.id}\``,
                            coord(s.centre),
                            counts(ps),
                            ...(connector ? [leadsTo(s, byFeature)] : []),
                            yesNo(s.f2p),
                            yesNo(s.multiway),
                            wilderness(s.wildernessLevel),
                            requires(s.reach),
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
        out.push([path, lines.join('\n')]);
    }
    return out;
}
