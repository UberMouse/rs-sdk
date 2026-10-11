import { expect, setSystemTime, test } from 'bun:test';
import { FILE_STAMP_PREFIX, fileStamp, stampTime } from '../../lib/stamp';

test('stampTime reads back the time fileStamp wrote, from a stamped name', () => {
    const at = Date.parse('2026-10-11T00:21:22.727Z');
    setSystemTime(at);
    try {
        const name = `${fileStamp()}-plan-p`;
        expect(FILE_STAMP_PREFIX.test(name)).toBe(true);
        expect(stampTime(name)).toBe(at);
    } finally {
        setSystemTime();
    }
    expect(stampTime('plan-p')).toBeNull();
});
