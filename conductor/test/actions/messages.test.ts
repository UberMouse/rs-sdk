import { describe, expect, test } from 'bun:test';
import { dialogPageSince, dialogSince, messageCursor } from '../../actions/messages';
import { world } from '../world';

describe('dialog pages since a cursor', () => {
    const start = world().tick(1);
    const cursor = messageCursor(start.build());

    test('dialogPageSince returns the first page after the cursor, joined', () => {
        const s = start.tick(2).recentDialog(['Line one', 'line two']).build();
        expect(dialogPageSince(s, cursor)).toBe('Line one line two');
    });

    test('a page from before the cursor is not returned', () => {
        const old = start.recentDialog(['Old page']);
        expect(dialogPageSince(old.build(), messageCursor(old.build()))).toBeNull();
    });

    test('level-up pages are skipped, also behind colour tags; the next page is found', () => {
        const s = start
            .tick(2)
            .recentDialog(['@dbl@Congratulations, you just advanced a Woodcutting level.'])
            .recentDialog(['A message box'])
            .build();
        expect(dialogPageSince(s, cursor)).toBe('A message box');
        const only = start.tick(2).recentDialog(['Congratulations, you just advanced a Mining level.']).build();
        expect(dialogPageSince(only, cursor)).toBeNull();
    });

    test('a quest page that merely starts with Congratulations! is kept', () => {
        const s = start.tick(2).recentDialog(['Congratulations! You can now construct darts.']).build();
        expect(dialogPageSince(s, cursor)).toContain('construct darts');
    });

    test('dialogSince with no pattern takes any page, with one only a matching line', () => {
        const s = start.tick(2).recentDialog(['Hello there']).build();
        expect(dialogSince(s, cursor)).toBe('Hello there');
        expect(dialogSince(s, cursor, /hello/i)).toBe('Hello there');
        expect(dialogSince(s, cursor, /bye/i)).toBeNull();
    });
});
