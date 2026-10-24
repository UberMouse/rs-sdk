// Saves built byte for byte as the engine writes them (Player.save, server/engine/src/engine/entity/Player.ts)
// read back through decodeSave and verifySave.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { decodeSave, LIBRARY_DIR, unstackableStacks, verifySave } from '../../lib/saves';

/** Packet.getcrc (server/engine/src/io/Packet.ts): CRC-32, as a signed int. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function getcrc(src: Uint8Array, length: number): number {
    let crc = 0xffffffff;
    for (let i = 0; i < length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ src[i]!) & 0xff]!;
    return ~crc;
}

class Writer {
    private readonly bytes = new Uint8Array(4096);
    private readonly view = new DataView(this.bytes.buffer);
    pos = 0;
    p1(v: number) {
        this.view.setUint8(this.pos++, v);
    }
    p2(v: number) {
        this.view.setUint16(this.pos, v);
        this.pos += 2;
    }
    p4(v: number) {
        this.view.setInt32(this.pos, v);
        this.pos += 4;
    }
    p8(v: bigint) {
        this.view.setBigInt64(this.pos, v);
        this.pos += 8;
    }
    /** Packet.pVarInt. */
    pVarInt(v: number) {
        if ((v & 0xffffff80) !== 0) {
            if ((v & 0xffffc000) !== 0) {
                if ((v & 0xffe00000) !== 0) {
                    if ((v & 0xf0000000) !== 0) this.p1((v >>> 28) | 0x80);
                    this.p1(((v >>> 21) & 0xff) | 0x80);
                }
                this.p1(((v >>> 14) & 0xff) | 0x80);
            }
            this.p1(((v >>> 7) & 0xff) | 0x80);
        }
        this.p1(v & 0x7f);
    }
    /** The CRC over everything written, then the finished bytes. */
    finish(): Uint8Array {
        this.p4(getcrc(this.bytes, this.pos));
        return this.bytes.slice(0, this.pos);
    }
}

type Inv = { type: number; capacity: number; items: { slot: number; id: number; count: number }[] };

/** Player.save's field order. Version 9 adds 21 level-playtime ints before the CRC. */
function engineSave(version: number, opts: { stats: number[]; varps: [number, number][]; invs: Inv[] }) {
    const w = new Writer();
    w.p2(0x2004);
    w.p2(version);
    w.p2(3222); // x
    w.p2(3218); // z
    w.p1(0); // level
    for (let i = 0; i < 7; i++) w.p1(i);
    for (let i = 0; i < 5; i++) w.p1(0);
    w.p1(0); // gender
    w.p2(10000); // run energy
    w.p4(123456); // playtime
    for (let i = 0; i < 21; i++) {
        w.p4(opts.stats[i] ?? 0);
        w.p1(1); // current level
    }
    w.p2(opts.varps.length);
    for (const [id, value] of opts.varps) {
        w.p2(id);
        w.pVarInt(value);
    }
    w.p1(opts.invs.length);
    for (const inv of opts.invs) {
        w.p2(inv.type);
        w.p2(inv.capacity);
        for (let slot = 0; slot < inv.capacity; slot++) {
            const obj = inv.items.find(o => o.slot === slot);
            if (!obj) {
                w.p2(0);
                continue;
            }
            w.p2(obj.id + 1);
            if (obj.count >= 255) {
                w.p1(255);
                w.p4(obj.count);
            } else w.p1(obj.count);
        }
    }
    w.p1(2); // afk zones
    w.p4(111);
    w.p4(222);
    w.p2(0); // last afk zone
    w.p1((1 << 4) | (2 << 2) | 0); // chat modes
    w.p8(1_700_000_000_000n); // last login
    w.p2(1); // recovery items
    w.p2(995);
    w.p4(50);
    if (version >= 9) for (let i = 0; i < 21; i++) w.p4(1000 + i); // level playtimes
    return w.finish();
}

const stats = Array.from({ length: 21 }, () => 0);
stats[3] = 9800; // Hitpoints: getExpByLevel(10), in tenths
stats[8] = 73450; // Woodcutting: getExpByLevel(30)
const content = {
    stats,
    varps: [
        [281, 1000],
        [400, 1 << 20],
    ] as [number, number][],
    invs: [
        {
            type: 93,
            capacity: 28,
            items: [
                { slot: 0, id: 1351, count: 1 },
                { slot: 5, id: 995, count: 1000 },
            ],
        },
        { type: 94, capacity: 14, items: [{ slot: 3, id: 1351, count: 1 }] },
        { type: 95, capacity: 4, items: [{ slot: 1, id: 995, count: 254 }] },
    ],
};

describe('saves in the engine format', () => {
    for (const version of [8, 9]) {
        test(`a version ${version} save verifies and decodes`, () => {
            const bytes = engineSave(version, content);
            expect(verifySave(bytes)).toBe(version);
            const summary = decodeSave(bytes);
            expect(summary.saveVersion).toBe(version);
            expect(summary.position).toEqual({ x: 3222, z: 3218, level: 0 });
            expect(summary.levels).toEqual({ Hitpoints: 10, Woodcutting: 30 });
            expect(summary.varps).toEqual({ 281: 1000, 400: 1 << 20 });
            expect(summary.inventory.map(i => [i.id, i.count])).toEqual([
                [1351, 1],
                [995, 1000],
            ]);
            expect(summary.worn.map(i => [i.id, i.count])).toEqual([[1351, 1]]);
            expect(summary.bank.map(i => [i.id, i.count])).toEqual([[995, 254]]);
        });
    }

    test('the CRC covers the level playtimes of a version 9 save', () => {
        const bytes = engineSave(9, content);
        bytes[bytes.length - 5]! ^= 1; // last byte of the last playtime
        expect(() => verifySave(bytes)).toThrow('save CRC mismatch');
    });

    test('a version 10 save is refused', () => {
        const bytes = engineSave(10, content);
        expect(() => verifySave(bytes)).toThrow('save version 10 is newer than the engine');
        expect(() => decodeSave(bytes)).toThrow('save version 10 is newer than the engine');
    });
});

describe('a save written by the real engine', () => {
    test('decodes to the summary recorded beside it in the library', () => {
        const name = 'rune-mysteries-done';
        const bytes = new Uint8Array(readFileSync(join(LIBRARY_DIR, `${name}.sav`)));
        const { summary } = JSON.parse(readFileSync(join(LIBRARY_DIR, `${name}.json`), 'utf8'));
        const { saveVersion, ...decoded } = decodeSave(bytes);
        expect(saveVersion).toBe(8);
        expect(decoded).toEqual(summary);
        verifySave(bytes);
    });
});

describe('unstackableStacks', () => {
    test('flags several of a non-stackable obj in one slot, not one copy, a stackable obj or none', () => {
        expect(unstackableStacks([{ id: 373, count: 20 }])).toEqual(['swordfish (id 373) x20']);
        expect(
            unstackableStacks([
                { id: 373, count: 1 },
                { id: 373, count: 1 },
            ]),
        ).toEqual([]);
        expect(unstackableStacks([{ id: 995, count: 3000 }])).toEqual([]);
        expect(unstackableStacks(undefined)).toEqual([]);
    });

    test('treats a noted item as stackable', () => {
        expect(unstackableStacks([{ id: 374, count: 20 }])).toEqual([]);
    });

    test('no library save holds several of a non-stackable obj in one slot', () => {
        const names = readdirSync(LIBRARY_DIR).filter(f => f.endsWith('.sav'));
        expect(names.length).toBeGreaterThan(0);
        for (const file of names) {
            const { inventory } = decodeSave(new Uint8Array(readFileSync(join(LIBRARY_DIR, file))));
            expect({ file, stacked: unstackableStacks(inventory) }).toEqual({ file, stacked: [] });
        }
    });
});
