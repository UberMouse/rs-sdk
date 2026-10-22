import { describe, expect, test } from 'bun:test';
import { itemPages } from '../../generate-items';

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
