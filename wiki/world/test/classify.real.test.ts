import { describe, expect, test } from 'bun:test';
import { classifier } from '../classify';
import { readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';
import { readCallables, readTriggers } from '../sources/triggers';

const locConfigs = readConfigs('loc');
const npcConfigs = readConfigs('npc');
const c = classifier({
    locConfigs,
    npcConfigs,
    dbrows: readDbrows(),
    triggers: readTriggers(),
    callables: readCallables(),
});

describe('classifier on the real game data', () => {
    test('banks: booths, chests and bankers, but not a closed or unscripted booth', () => {
        expect(c('loc', 'bankbooth')).toMatchObject([{ kind: 'bank', subtype: 'booth' }]);
        expect(c('loc', 'bankboothclosed')).toEqual([]);
        expect(c('loc', 'loc_2214')).toEqual([]);
        expect(c('loc', 'thbankchest')).toMatchObject([{ kind: 'bank', subtype: 'chest' }]);
        expect(c('npc', 'banker1')).toMatchObject([{ kind: 'bank', subtype: 'banker' }]);
        expect(c('npc', 'duel_fadli')).toEqual([
            { kind: 'bank', subtype: 'banker', name: 'Fadli' },
            { kind: 'shop', subtype: 'duel_rottenfruitshop', name: 'Fadli' },
        ]);
        expect(c('npc', 'magearena_banker')).toMatchObject([{ kind: 'bank', subtype: 'banker' }]);
    });

    test('resources', () => {
        expect(c('loc', 'yewtree')).toMatchObject([{ kind: 'tree', subtype: 'yew' }]);
        expect(c('loc', 'ironrock1')).toMatchObject([{ kind: 'rock', subtype: 'iron' }]);
    });

    test('stations by category', () => {
        expect(c('loc', 'furnace1')[0]?.kind).toBe('furnace');
        expect(c('loc', 'anvil')[0]?.kind).toBe('anvil');
        expect(c('loc', 'range')).toMatchObject([{ kind: 'range', name: 'Range' }]);
        expect(c('loc', 'air_altar')).toMatchObject([{ kind: 'rc-altar', subtype: 'air' }]);
    });

    test('shops and the tanners', () => {
        expect(c('npc', 'zaff')).toMatchObject([{ kind: 'shop', subtype: 'memberstaffshop' }]);
        expect(c('npc', 'tanner')[0]?.kind).toBe('tanner');
        expect(c('npc', 'werewolftanner')[0]?.kind).toBe('tanner');
    });

    test('uses reached through menus, deep labels and type changes', () => {
        // loc_3193's op1 Open is ~open_chest(duel_chestopen), a loc_change into the open chest whose
        // op2 Bank goes to @openbank (minigames/game_duelarena/scripts/misc_locs.rs2).
        expect(c('loc', 'loc_3193')).toEqual([{ kind: 'bank', subtype: 'chest', name: 'Closed chest' }]);
        // @noobbanker's @multi2 passes tut_open_bank, which goes to @openbank (tutorial/scripts/npcs/tut_banker.rs2).
        expect(c('npc', 'noobbanker')).toEqual([{ kind: 'bank', subtype: 'banker', name: 'Banker' }]);
        // Its @multi2 passes tan_leather_choices (minigames/game_ranging/scripts/leatherworker.rs2).
        expect(c('npc', 'ranging_guild_leatherworker')).toMatchObject([{ kind: 'tanner' }]);
        // Talk-to reaches @razmire_talk's store menu, the general store first
        // (quests/quest_mortton/scripts/razmire_keelgan.rs2).
        expect(c('npc', 'razmire_keelgan_afflicted')).toMatchObject([{ kind: 'shop', subtype: 'razmiregeneralstore' }]);
    });

    test('the Shantay jail fine opens the bank, but makes neither Shantay nor his prison door a bank', () => {
        expect(c('npc', 'shantay')).toEqual([{ kind: 'shop', subtype: 'shantayshop', name: 'Shantay' }]);
        expect(c('loc', 'shantay_prisondoor')).toEqual([]);
    });

    test('every loc and npc config classifies without two rules clashing; only Fadli has two kinds', () => {
        const errors: string[] = [];
        const multi: string[] = [];
        for (const [on, configs] of [
            ['loc', locConfigs],
            ['npc', npcConfigs],
        ] as const) {
            for (const name of configs.keys()) {
                try {
                    if (c(on, name).length > 1) multi.push(`${on}:${name}`);
                } catch (e) {
                    errors.push((e as Error).message);
                }
            }
        }
        expect(errors).toEqual([]);
        expect(multi).toEqual(['npc:duel_fadli']);
    });
});
