// Spinning at a spinning wheel from its menu (oploc2 Spin -> ~skill_multi2_header -> a Make button):
// skill_crafting/scripts/spinning/spinning.rs2, on the input's spinning struct (configs/spinning/spinning.struct,
// `oc_param(<obj>, crafting_spinning_struct)`). A process step with no fail roll. Rellekka's wheel needs The Fremennik
// Trials (spinning.rs2:2-6, :37-42): its site's reach carries it (gates.ts USE_GATES).
import { ModelError, type ActionModel } from '../family';
import { param, paramNum, paramStr, queueTicks, requireLevel, stringParams, type FamilyFactory } from './common';

/** `obj`: the obj spun (`flax`, `wool`). */
export interface SpinningParams {
    obj?: string;
}

/** The levelrequire param's default (skill_combat/configs/combat.param:81-83). */
const LEVEL_DEFAULT = 0;

/**
 * The most a Make button spins: ~skill_multi2_header returns 1, 5 or 10, or Make X's count
 * (interface_chat/scripts/chat.rs2:785-798). A larger load takes Make X.
 */
const MAKE_MAX = 10;

export const spinning: FamilyFactory = data => ({
    id: 'spinning',
    skills: ['crafting'],
    kinds: ['spinning-wheel'],
    model(site, params, profile): ActionModel {
        const p = stringParams(params, 'spinning', ['obj']);
        if (site.kind !== 'spinning-wheel')
            throw new ModelError(`site ${site.id} is a ${site.kind} site, not a spinning wheel`);
        if (!p.obj) throw new ModelError('spinning needs an obj param (the obj spun)');
        const name = param(data.objs.get(p.obj), 'crafting_spinning_struct');
        const struct = name === undefined ? undefined : data.structs.get(name);
        if (!struct) throw new ModelError(`${p.obj} has no spinning struct`);
        const what = `spinning struct ${name}`;
        const str = (key: string): string => paramStr(struct, key, what);
        const num = (key: string): number => paramNum(struct, key, what);
        // The level check after the menu (spinning.rs2:60-64); a struct with no levelrequire (wool) has the param's
        // default.
        const level = param(struct, 'levelrequire') === undefined ? LEVEL_DEFAULT : num('levelrequire');
        requireLevel(profile, 'crafting', level, `spinning ${p.obj}`);
        return {
            // After a string, @process_spin queues the next with weakqueue 2 from inside the queue (spinning.rs2:98,
            // 110): 3 ticks a string.
            ticksPerAttempt: queueTicks(2, true),
            // The wheel's op opens the menu on the arrival tick; the button the tick after queues the first string
            // with weakqueue 3 from a dialog (:87): 1 + 3 ticks from the arrival, one more than the cadence.
            start: 1 + queueTicks(3, false) - queueTicks(2, true),
            // A load over MAKE_MAX takes Make X: its p_countdialog (chat.rs2:787) holds the menu until the count
            // comes back, read the tick after the button (ResumePCountDialogHandler.ts:16-17), one tick more a trip.
            restart: { upTo: MAKE_MAX, ticks: 1 },
            success: 1,
            // The struct's ingredient for its product, and its productexp (:102-105).
            xpTenths: { crafting: num('productexp') },
            products: [{ obj: str('product'), count: 1 }],
            consumes: [{ obj: str('ingredient'), count: 1 }],
        };
    },
});
