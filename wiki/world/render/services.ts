// wiki/services/<kind>.md: every site of a service kind (banks, furnaces, anvils, ...) across the world.
import type { World } from '../types';
import {
    areaCell,
    areasOf,
    byAreaThenId,
    coord,
    count,
    GENERATED,
    kindTitle,
    labeller,
    parts,
    reachLabel,
    reachSummary,
    SERVICE_KINDS,
    servicePath,
    table,
    yesNo,
    type Page,
    type PageData,
} from './common';

/** One page per service kind, as its repo-relative path and text. */
export function renderServices(world: World, data: PageData): Page[] {
    const areas = areasOf(world);
    const requires = reachLabel(world, data);
    const out: Page[] = [];
    for (const kind of SERVICE_KINDS) {
        const path = servicePath(kind);
        const sites = world.sites.filter(s => s.kind === kind).sort(byAreaThenId);
        const held = sites.map(s => parts(s, world, data));
        const label = labeller(held.flat().map(p => [kind, p] as const));
        const f2p = sites.filter(s => s.f2p).length;
        out.push([
            path,
            [
                GENERATED,
                `# ${kindTitle(kind)}`,
                '',
                `${count(sites.length, 'site')}, ${f2p} of them in F2P; ${reachSummary(sites)}.`,
                '',
                ...table(
                    ['Area', 'Site', 'Centre', 'Stand', 'Counts', 'F2P', 'Requires'],
                    sites.map((s, i) => [
                        areaCell(path, areas, s.areaPath),
                        `\`${s.id}\``,
                        coord(s.centre),
                        s.stand ? coord(s.stand) : '-',
                        held[i]!.map(p => `${label(kind, p)} ${p.n}`).join(', '),
                        yesNo(s.f2p),
                        requires(s.reach),
                    ]),
                ),
                '',
            ].join('\n'),
        ]);
    }
    return out;
}
