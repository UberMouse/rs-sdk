// Not ported: sdk/actions.ts has no teleport-spell method; closest upstream is castSpell @ 4c2069cc0.
// A standard-spellbook teleport has no target: the client sends IF_BUTTON on the spell's component in the
// magic tab (skill_magic/scripts/spells/teleport.rs2 `[if_button,magic:<name>_teleport]`), so the op is
// a plain `clickComponent` and nothing is walked or targeted. It sends exactly one cast and never repeats it:
// the script takes the runes and pays the XP before the player is moved (p_delay, then p_telejump), so a cast
// that was sent cannot be told from a lost one by anything but the position, and a resend would burn runes.
// Evidence is Magic XP gained AND the bot standing within TELEPORT_TOLERANCE of the spell's destination
// (map_findsquare puts it within 2 tiles of `tele_coord`); the server's refusal messages are read as the
// reason, level and runes included.
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { dialogSince, messageCursor, messageSince } from './messages';

/** Ticks to wait for the jump after the click: the cast animation, p_delay(1) and p_delay(0) take about 3. */
export const TELEPORT_WAIT_TICKS = Math.ceil(4000 / TICK_MS);
/** Tiles from the spell's destination that count as arrived (the script lands within 2). */
export const TELEPORT_TOLERANCE = 3;

export interface TeleportSpell {
    name: string;
    /** Component id of the spell in the magic tab (server/content/pack/interface.pack). */
    component: number;
    /** `levelrequired` of skill_magic/configs/magic_spells.dbrow. */
    level: number;
    /** `runesrequired`: rune item name pattern and count (a worn matching staff stands in for its rune). */
    runes: { name: string; rune: RegExp; count: number }[];
    /** `tele_coord`, resolved to world coordinates. */
    dest: { x: number; z: number; level: number };
}

const rune = (element: string) => ({ name: `${element} rune`, rune: new RegExp(`^${element} rune$`, 'i') });
const air = (count: number) => ({ ...rune('Air'), count });
const law = (count: number) => ({ ...rune('Law'), count });

/**
 * The standard-spellbook teleports. Levels, runes and destinations are the dbrow's (`tele_coord` is
 * plane_mx_mz_lx_lz: x = mx * 64 + lx). Ardougne, Watchtower and Trollheim also need their quests; the
 * server's refusal says which.
 */
export const TELEPORTS = {
    varrock: {
        name: 'Varrock Teleport',
        component: 1164,
        level: 25,
        runes: [{ ...rune('Fire'), count: 1 }, air(3), law(1)],
        dest: { x: 3213, z: 3424, level: 0 },
    },
    lumbridge: {
        name: 'Lumbridge Teleport',
        component: 1167,
        level: 31,
        runes: [{ ...rune('Earth'), count: 1 }, air(3), law(1)],
        dest: { x: 3221, z: 3218, level: 0 },
    },
    falador: {
        name: 'Falador Teleport',
        component: 1170,
        level: 37,
        runes: [{ ...rune('Water'), count: 1 }, air(3), law(1)],
        dest: { x: 2965, z: 3378, level: 0 },
    },
    camelot: {
        name: 'Camelot Teleport',
        component: 1174,
        level: 45,
        runes: [air(5), law(1)],
        dest: { x: 2757, z: 3478, level: 0 },
    },
    ardougne: {
        name: 'Ardougne Teleport',
        component: 1540,
        level: 51,
        runes: [{ ...rune('Water'), count: 2 }, law(2)],
        dest: { x: 2661, z: 3301, level: 0 },
    },
    watchtower: {
        name: 'Watchtower Teleport',
        component: 1541,
        level: 58,
        runes: [{ ...rune('Earth'), count: 2 }, law(2)],
        dest: { x: 2933, z: 4713, level: 2 },
    },
    trollheim: {
        name: 'Trollheim Teleport',
        component: 7455,
        level: 61,
        runes: [{ ...rune('Fire'), count: 2 }, law(2)],
        dest: { x: 2890, z: 3679, level: 0 },
    },
} as const satisfies Record<string, TeleportSpell>;

export type TeleportName = keyof typeof TELEPORTS;
export const TELEPORT_NAMES = Object.keys(TELEPORTS) as [TeleportName, ...TeleportName[]];

/**
 * Staves the server counts for a rune (skill_magic/configs/magic_staff.dbrow); only the worn weapon counts
 * (`staff_runes` reads the right-hand slot).
 */
const STAVES: Record<string, RegExp> = {
    air: /^(staff of air|air battlestaff|mystic air staff)$/i,
    water: /^(staff of water|water battlestaff|mystic water staff)$/i,
    earth: /^(staff of earth|earth battlestaff|mystic earth staff|lava battlestaff|mystic lava staff)$/i,
    fire: /^(staff of fire|fire battlestaff|mystic fire staff|lava battlestaff|mystic lava staff)$/i,
};

/** True when a worn staff supplies `runeName` ("Air rune"). */
export function staffSupplies(state: BotWorldState, runeName: string): boolean {
    const element = runeName.split(' ')[0]!.toLowerCase();
    const staff = STAVES[element];
    return !!staff && state.equipment.some(i => staff.test(i.name));
}

/** What `spell` still lacks in the inventory and worn staff, as "3 Air rune"; empty when it can be cast. */
export function missingRunes(state: BotWorldState, spell: TeleportSpell): string[] {
    const out: string[] = [];
    for (const r of spell.runes) {
        if (staffSupplies(state, r.name)) continue;
        const held = state.inventory.filter(i => r.rune.test(i.name)).reduce((n, i) => n + i.count, 0);
        if (held < r.count) out.push(`${r.count - held} more ${r.name}`);
    }
    return out;
}

/** True when the bot stands within `TELEPORT_TOLERANCE` of the spell's destination, on its plane. */
export function atDestination(state: BotWorldState, spell: TeleportSpell): boolean {
    const p = state.player;
    if (!p || p.level !== spell.dest.level) return false;
    return Math.max(Math.abs(p.worldX - spell.dest.x), Math.abs(p.worldZ - spell.dest.z)) <= TELEPORT_TOLERANCE;
}

const NO_RUNES = /do not have enough|don't have enough/i;
const LOW_LEVEL = /magic level is not high enough/i;
const WILDERNESS = /mysterious force blocks your teleport/i;
/**
 * The other refusals of teleport.rs2 / pre_tele_checks that arrive as game messages (`mes`): the quest gates
 * ("You must have completed Plague City ...", "You need to have completed the Watchtower Quest / the Eadgar's
 * Ruse Quest ..."), "You haven't learnt how to cast this spell yet." and the duel arena's "Coward! You can't
 * teleport from a duel." Anchored to those strings: an unrelated message in the wait must not read as a refusal.
 */
const REFUSED =
    /must have completed Plague City|need to have completed the (Watchtower|Eadgar's Ruse) Quest|haven't learnt how to cast|Coward! You can't teleport/i;
/**
 * The refusals that arrive as a message box or an NPC/player line, so as a dialog page: Tutorial Island, the
 * Fishing Trawler (swimming, too far from shore), the mime and maze random events, Castle Wars, the Ana barrel.
 */
const REFUSED_DIALOG =
    /cannot teleport from Tutorial Island|Water and magic don't mix|too far from shore|finish my performance|center of the maze|can't leave just like that|can't teleport while holding the barrel/i;

export type TeleportResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'level' | 'no-runes' | 'wilderness' | 'refused' | 'send-failed' | 'no-teleport';
          message: string;
      };

const magicXp = (s: BotWorldState) => findSkill(s, 'Magic')?.experience ?? 0;

/**
 * Casts `spell` once and waits until the bot stands at its destination with the Magic XP paid.
 * `level`, `no-runes`, `wilderness` ("A mysterious force blocks your teleport spell!", above Wilderness level 20)
 * and `refused` are the server's messages or dialog pages; `no-teleport` is XP without the jump, or neither, within the wait: the
 * runes may be gone, so the caller must not cast again.
 */
export function* castTeleport(ctx: ActionContext, spell: TeleportSpell): Op<TeleportResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const xp0 = magicXp(before);

    const sent = yield* send({
        type: 'clickComponent',
        componentId: spell.component,
        reason: `cast ${spell.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };

    const refusal = (s: BotWorldState) =>
        messageSince(s, cursor, NO_RUNES) ??
        messageSince(s, cursor, LOW_LEVEL) ??
        messageSince(s, cursor, WILDERNESS) ??
        messageSince(s, cursor, REFUSED) ??
        dialogSince(s, cursor, REFUSED_DIALOG);
    const w = yield* wait(
        `cast ${spell.name}`,
        s => (magicXp(s) > xp0 && atDestination(s, spell)) || !!refusal(s),
        TELEPORT_WAIT_TICKS,
    );
    const gained = magicXp(w.state) - xp0;
    if (gained > 0 && atDestination(w.state, spell)) return { ok: true, xpGained: gained };
    const no = messageSince(w.state, cursor, NO_RUNES);
    if (no) return { ok: false, reason: 'no-runes', message: no };
    const low = messageSince(w.state, cursor, LOW_LEVEL);
    if (low) return { ok: false, reason: 'level', message: low };
    const blocked = messageSince(w.state, cursor, WILDERNESS);
    if (blocked) return { ok: false, reason: 'wilderness', message: blocked };
    const other = messageSince(w.state, cursor, REFUSED) ?? dialogSince(w.state, cursor, REFUSED_DIALOG);
    if (other) return { ok: false, reason: 'refused', message: other };
    return {
        ok: false,
        reason: 'no-teleport',
        message:
            gained > 0
                ? `${spell.name} paid ${gained} Magic xp but the bot is not at its destination`
                : `${spell.name} had no effect within ${TELEPORT_WAIT_TICKS} ticks`,
    };
}
