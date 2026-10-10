import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMBAT_SPELLS } from '../../lib/spells';

const DBROW = join(
    import.meta.dir,
    '../../../server/content/scripts/skill_combat/configs/magic/magic_combat_spells.dbrow',
);

/** The engine's rune item name: "airrune" -> "Air rune". */
const runeName = (n: string) => `${n[0]!.toUpperCase()}${n.slice(1, -4)} rune`;

/** name -> { level, runes } for every spell row in the engine's combat spell table. */
function engineSpells() {
    const out = new Map<string, { level: number; runes: Record<string, number>; members: boolean }>();
    for (const row of readFileSync(DBROW, 'utf8').split(/\n(?=\[)/)) {
        const name = /^data=name,(.+)$/m.exec(row)?.[1];
        const level = /^data=levelrequired,(\d+)$/m.exec(row)?.[1];
        const runes = /^data=runesrequired,(.+)$/m.exec(row)?.[1];
        const members = /^data=members,(\w+)$/m.exec(row)?.[1];
        if (!name || !level || !runes) continue;
        const parts = runes.split(',');
        const used: Record<string, number> = {};
        for (let i = 0; i + 1 < parts.length; i += 2)
            if (parts[i] !== 'null') used[runeName(parts[i]!)] = Number(parts[i + 1]);
        out.set(name, { level: Number(level), runes: used, members: members === 'true' });
    }
    return out;
}

describe('COMBAT_SPELLS', () => {
    const engine = engineSpells();

    test('each spell matches the engine content: level, runes and free-to-play', () => {
        for (const [name, spell] of Object.entries(COMBAT_SPELLS)) {
            const row = engine.get(name);
            expect(row, name).toBeDefined();
            expect({ level: spell.level, runes: spell.runes }, name).toEqual({ level: row!.level, runes: row!.runes });
            expect(row!.members, name).toBe(false);
        }
    });

    test('every free-to-play strike, bolt and blast the engine has is listed', () => {
        const free = [...engine].filter(
            ([n, r]) => /^(Wind|Water|Earth|Fire) (Strike|Bolt|Blast)$/.test(n) && !r.members,
        );
        expect(free.map(([n]) => n).sort()).toEqual(Object.keys(COMBAT_SPELLS).sort());
    });
});
