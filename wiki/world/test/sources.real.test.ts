import { describe, expect, test } from 'bun:test';
import { first, readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';

describe('real configs and dbrows', () => {
    test('readConfigs finds a hand-written loc config', () => {
        expect(first(readConfigs('loc').get('bankbooth'), 'name')).toBe('Bank booth');
    });

    test('readDbrows finds the yew row of the woodcutting table', () => {
        const yew = readDbrows().find(r => r.row === 'yew_tree_table');
        expect(yew?.table).toBe('woodcutting_trees');
        expect(yew?.data.levelrequired).toEqual([['60']]);
    });
});
