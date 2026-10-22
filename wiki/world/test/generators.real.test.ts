import { describe, expect, mock, test } from 'bun:test';
import * as fs from 'fs';
import { itemPages } from '../../generate-items';
import { npcPages } from '../../generate-npcs';
import { shopPages } from '../../generate-shops';
import { loadWorld } from '../load';

// readdirSync passes through, or lists in reverse while `reversed` is set: the filesystem lists in no fixed order.
const { readdirSync } = fs;
let reversed = false;
mock.module('fs', () => ({
    ...fs,
    readdirSync: (...args: Parameters<typeof readdirSync>) => {
        const list = readdirSync(...args);
        return reversed ? list.toReversed() : list;
    },
}));

/** The three generators' output, chained as build.ts does, with directories listed in reverse when `reverse`. */
function generate(reverse: boolean) {
    reversed = reverse;
    try {
        const world = loadWorld();
        const npcs = npcPages(world);
        const shops = shopPages(world, npcs.files);
        const items = itemPages(new Map([...npcs.files, ...shops.files]));
        return {
            files: new Map([...npcs.files, ...shops.files, ...items.files]),
            stale: [npcs.stale, shops.stale, items.stale],
        };
    } finally {
        reversed = false;
    }
}

describe('the npc, shop and item generators', () => {
    test('write the same pages whatever order the filesystem lists in', () => {
        const ahead = generate(false);
        const behind = generate(true);
        expect(behind.files.size).toBe(ahead.files.size);
        expect([...behind.files.keys()].filter(p => behind.files.get(p) !== ahead.files.get(p))).toEqual([]);
        expect(behind.stale).toEqual(ahead.stale);
    }, 30_000);
});

describe('itemPages on the real content', () => {
    test('reads drops from the npc pages it is given, not those on disk', () => {
        const npc = '# Zz Test\n\nAlways drops: Bones\n';
        const bones = itemPages(new Map([['wiki/npcs/zz-test.md', npc]])).files.get('wiki/items/bones.md');
        expect(bones?.split('\n').filter(l => l.startsWith('- Dropped by:'))).toEqual([
            '- Dropped by: [Zz Test](../npcs/zz-test.md) (Always)',
        ]);
    });

    test('rewrites the Items section of the README an earlier step left, above its Shops section', () => {
        const readme = '# Wiki\n\n## Shops\n\nshops\n';
        const out = itemPages(new Map([['wiki/README.md', readme]])).files.get('wiki/README.md') ?? '';
        expect(out.startsWith('# Wiki\n\n## Items\n\n| Item | Type |\n')).toBe(true);
        expect(out.endsWith('\n## Shops\n\nshops\n')).toBe(true);
    });
});
