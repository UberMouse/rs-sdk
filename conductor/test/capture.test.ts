import { expect, test } from 'bun:test';
import { trimState } from '../lib/capture';
import { world } from './world';

test('trimState keeps what is within the radius and the last messages', () => {
    let w = world().loc('Tree', 3230, 3218).loc('Tree', 3250, 3218).npc('Man', 3222, 3240).ground('Logs', 3223, 3218);
    for (let i = 0; i < 15; i++) w = w.tick(i).message(`m${i}`);
    const s = trimState(w.build());
    expect(s.nearbyLocs.map(l => l.x)).toEqual([3230]);
    expect(s.nearbyNpcs).toEqual([]);
    expect(s.groundItems.length).toBe(1);
    expect(s.gameMessages.map(m => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i + 5}`));
});

test('trimState drops the transient menu actions', () => {
    const raw = { ...world().build(), menuActions: [{ text: 'Walk here' }] };
    expect('menuActions' in trimState(raw)).toBe(false);
});
