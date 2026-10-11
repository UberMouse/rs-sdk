import { describe, expect, test } from 'bun:test';
import { mergeConfigs, parseConfigs } from '../sources/configs';
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

describe('mergeConfigs', () => {
    test('a hand-written key replaces the dump value; the dump keys it does not set are kept', () => {
        const dump = parseConfigs('[guard]\nname=Guard\nop2=Attack\n');
        const written = parseConfigs('[guard]\nname=Town guard\n[extra]\nname=Extra\n');
        const merged = mergeConfigs([dump, written]);
        expect(merged.get('guard')).toEqual({ name: ['Town guard'], op2: ['Attack'] });
        expect(merged.get('extra')).toEqual({ name: ['Extra'] });
    });

    test('params merge by param name', () => {
        const dump = parseConfigs('[guard]\nparam=a,1\nparam=b,2\n');
        const written = parseConfigs('[guard]\nparam=a,9\nparam=c,3\n');
        expect(mergeConfigs([dump, written]).get('guard')).toEqual({ param: ['a,9', 'b,2', 'c,3'] });
    });
});

describe('parseDbrows', () => {
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
