import { describe, expect, test } from 'bun:test';
import { first, readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';

describe('real configs and dbrows', () => {
    test('readConfigs finds a hand-written loc config', () => {
        expect(first(readConfigs('loc').get('bankbooth'), 'name')).toBe('Bank booth');
    });

    test('readConfigs loads every kind without a duplicate name', () => {
        for (const ext of ['loc', 'npc', 'obj'] as const) expect(readConfigs(ext).size).toBeGreaterThan(0);
    });

    test('readDbrows keeps a quoted comma in one value', () => {
        const values = readDbrows().flatMap(r => Object.values(r.data).flat(2));
        expect(values).toContain('Congratulations, you just advanced an attack level.');
    });

    test('readDbrows finds the yew row of the woodcutting table', () => {
        const yew = readDbrows().find(r => r.row === 'yew_tree_table');
        expect(yew?.table).toBe('woodcutting_trees');
        expect(yew?.data.levelrequired).toEqual([['60']]);
    });
});
