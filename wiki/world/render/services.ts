// wiki/services/<kind>.md: every site of a service kind (banks, furnaces, anvils, ...) across the world.
import type { World } from '../types';
import {
    areaCell,
    areasOf,
    byAreaThenId,
    contents,
    coord,
    count,
    GENERATED,
    kindTitle,
    SERVICE_KINDS,
    servicePath,
    table,
    yesNo,
} from './common';

/** One page per service kind, keyed by repo-relative path. */
export function renderServices(world: World): Map<string, string> {
    const areas = areasOf(world);
    const out = new Map<string, string>();
    for (const kind of SERVICE_KINDS) {
        const path = servicePath(kind);
        const sites = world.sites.filter(s => s.kind === kind).sort(byAreaThenId);
        const f2p = sites.filter(s => s.f2p).length;
        out.set(
            path,
            [
                GENERATED,
                `# ${kindTitle(kind)}`,
                '',
                `${count(sites.length, 'site')}, ${f2p} of them in F2P.`,
                '',
                ...table(
                    ['Area', 'Site', 'Centre', 'Stand', 'Counts', 'F2P'],
                    sites.map(s => [
                        areaCell(path, areas, s.areaPath),
                        `\`${s.id}\``,
                        coord(s.centre),
                        s.stand ? coord(s.stand) : '-',
                        contents(s, world.features).join(', '),
                        yesNo(s.f2p),
                    ]),
                ),
                '',
            ].join('\n'),
        );
    }
    return out;
}
