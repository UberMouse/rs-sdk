import { describe, expect, test } from 'bun:test';
import { collectConfigs, parseConfigs } from '../sources/configs';
import { parseDbrows } from '../sources/dbrows';
import { parsePack } from '../sources/packs';

describe('parsePack', () => {
    test('id=name lines both ways', () => {
        const p = parsePack('2213=bankbooth\n2214=loc_2214\n');
        expect(p.name.get(2213)).toBe('bankbooth');
        expect(p.id.get('loc_2214')).toBe(2214);
    });
});

describe('parseConfigs', () => {
    test('repeated keys collect; the block runs to the next header', () => {
        const c = parseConfigs('[bankbooth]\nname=Bank booth\nop1=Use\nop2=Use-quickly\n\n[x]\nname=X\n');
        expect(c.get('bankbooth')).toEqual({ name: ['Bank booth'], op1: ['Use'], op2: ['Use-quickly'] });
        expect(c.get('x')?.name).toEqual(['X']);
    });

    test('// comment lines are skipped', () => {
        const c = parseConfigs('[x]\n// name=Not this\nname=X\n');
        expect(c.get('x')).toEqual({ name: ['X'] });
    });
});

describe('collectConfigs', () => {
    test('gathers configs from all files', () => {
        const c = collectConfigs([
            ['a.npc', '[guard]\nname=Guard\n'],
            ['b.npc', '[extra]\nname=Extra\n'],
        ]);
        expect([...c.keys()]).toEqual(['guard', 'extra']);
    });

    test('throws on a duplicate name, naming both files', () => {
        expect(() =>
            collectConfigs([
                ['a.npc', '[guard]\nname=Guard\n'],
                ['b.npc', '[guard]\nname=Town guard\n'],
            ]),
        ).toThrow('Duplicate config found: guard in a.npc and b.npc');
    });
});

describe('parseDbrows', () => {
    test('quoted values keep their commas and lose the quotes', () => {
        const rows = parseDbrows(
            '[r]\ntable=t\ndata=message,"Congratulations, you just advanced an attack level."\ndata=x,"a",b\n',
        );
        expect(rows[0]!.data).toEqual({
            message: [['Congratulations, you just advanced an attack level.']],
            x: [['a', 'b']],
        });
    });

    test('rows keep their table and each data line', () => {
        const rows = parseDbrows(
            '[yew_tree_table]\ntable=woodcutting_trees\ndata=tree,yewtree\ndata=levelrequired,60\ndata=successchance,bronze_axe,4,12\n',
        );
        expect(rows).toEqual([
            {
                row: 'yew_tree_table',
                table: 'woodcutting_trees',
                data: { tree: [['yewtree']], levelrequired: [['60']], successchance: [['bronze_axe', '4', '12']] },
            },
        ]);
    });
});
