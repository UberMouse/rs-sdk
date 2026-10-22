// Fletching in place, one of two actions by its product. Cutting a log with a knife (opheldu -> @fletch_log -> a Make
// button): skill_fletching/scripts/cut_logs.rs2 on the log's fletch_bow_table row (configs/cut_logs/cut_logs.dbrow).
// Stringing an unstrung bow with a bow string (opheldu -> @string_bow): skill_fletching/scripts/bows.rs2 on the bow's
// fletching_table row (configs/stringing/bows.dbrow), the bow string a supply beside the bow. Neither has a fail roll.
import { first } from '../../sources/configs';
import type { DbRow } from '../../sources/dbrows';
import { ModelError, type ActionModel } from '../family';
import type { Profile } from '../profile';
import { USER_EVENTS_PER_TICK } from '../server';
import { dbIndex, int, queueTicks, requireLevel, stringParams, type FamilyFactory } from './common';

/**
 * `product`: what is made. An unstrung bow (`unstrung_willow_longbow`) is cut from its log; `arrow_shaft` is cut from
 * `log` (`logs`); a strung bow (`willow_longbow`) is strung from its unstrung bow.
 */
export interface FletchingParams {
    product?: string;
    log?: string;
}

/** The tool cut_logs.rs2 takes the log with (`[opheldu,_category_22]`, :2-4). */
const KNIFE = 'knife';
/** The product cut_logs.rs2 makes `shafts` of (:29). */
const SHAFT = 'arrow_shaft';
/** The supply bows.rs2 takes with each bow (:37). */
const BOW_STRING = 'bow_string';
/** The category bows.rs2 strings (`[opheldu,bow_string]`, :11). */
const UNSTRUNG = 'unstrung_bow';
/** The most a Make button cuts: ~skill_multi2 and ~skill_multi3 return 1, 5 or 10, or Make X's count. */
const MAKE_MAX = 10;

/** Cutting `log` into `count` of `product` at `level` for `xp` tenths. */
function cut(log: string, product: string, count: number, level: number, xp: number, p: Profile): ActionModel {
    requireLevel(p, 'fletching', level, `cutting ${product}`);
    return {
        // After a log the queue sets %action_delay to the clock + 2 and @process_fletch_logs queues the next log
        // that far on, from inside the queue (cut_logs.rs2:103-104, 83-86): 3 ticks a log. The first: the knife's
        // click opens the menu, the button the tick after sets it to + 2 and queues from a dialog (:83-86): 3
        // ticks from the click too.
        ticksPerAttempt: queueTicks(2, true),
        // A load over MAKE_MAX takes Make X: its p_countdialog (interface_chat/scripts/chat.rs2:742, :838) holds
        // the menu until the count comes back, read the tick after the button (ResumePCountDialogHandler.ts:16-17).
        restart: { upTo: MAKE_MAX, ticks: 1 },
        success: 1,
        xpTenths: { fletching: xp },
        products: [{ obj: product, count }],
        consumes: [{ obj: log, count: 1 }],
        tools: [KNIFE],
    };
}

export const fletching: FamilyFactory = data => {
    const logs = dbIndex(data.dbrows, 'fletch_bow_table', 'log');
    // The bow rows by the unstrung bow each cuts: its log, its row and the column, shortbow or longbow, naming it.
    const cuts = new Map<string, { log: string; row: DbRow; column: 'shortbow' | 'longbow' }>();
    for (const [log, row] of logs)
        for (const column of ['shortbow', 'longbow'] as const) {
            const bow = row.data[column]?.[0]?.[0];
            if (!bow) continue;
            const prior = cuts.get(bow);
            if (prior) throw new ModelError(`fletch_bow_table cuts ${bow} in both ${prior.row.row} and ${row.row}`);
            cuts.set(bow, { log, row, column });
        }
    // The stringing rows by their product, with the unstrung bow each takes: the fletching_table rows whose item is
    // one.
    const strings = new Map<string, { item: string; row: DbRow }>();
    for (const row of data.dbrows.filter(r => r.table === 'fletching_table')) {
        const item = row.data.item?.[0]?.[0];
        const product = row.data.product?.[0]?.[0];
        if (!item || !product || first(data.objs.get(item), 'category') !== UNSTRUNG) continue;
        const prior = strings.get(product);
        if (prior) throw new ModelError(`fletching_table strings ${product} in both ${prior.row.row} and ${row.row}`);
        strings.set(product, { item, row });
    }

    return {
        id: 'fletching',
        skills: ['fletching'],
        kinds: [],
        model(_site, params, profile): ActionModel {
            const p = stringParams(params, 'fletching', ['product', 'log']);
            if (!p.product) throw new ModelError('fletching needs a product param (the obj made)');
            if (p.product === SHAFT) {
                if (!p.log) throw new ModelError(`cutting ${SHAFT} needs a log param (the log cut)`);
                const row = logs.get(p.log);
                if (!row) throw new ModelError(`no fletch_bow_table row cuts ${p.log}`);
                // A row with no shafts offers only its bows (cut_logs.rs2:37-41).
                const shafts = row.data.shafts ? int(row, 'shafts') : 0;
                if (shafts < 1) throw new ModelError(`${p.log} cuts no ${SHAFT}`);
                // Shafts are level 1 and give `shafts` x 5 tenths (:56-59, :68-71).
                return cut(p.log, SHAFT, shafts, 1, shafts * 5, profile);
            }
            const bow = cuts.get(p.product);
            if (bow) {
                if (p.log && p.log !== bow.log)
                    throw new ModelError(`${p.product} is cut from ${bow.log}, not ${p.log}`);
                // The column's product, level and experience (:62-66).
                return cut(bow.log, p.product, 1, int(bow.row, bow.column, 1), int(bow.row, bow.column, 2), profile);
            }
            const strung = strings.get(p.product);
            if (!strung) throw new ModelError(`fletching makes no ${p.product}: not a cut or a strung product`);
            if (p.log) throw new ModelError(`stringing ${p.product} takes no log param`);
            const { item, row } = strung;
            requireLevel(profile, 'fletching', int(row, 'level'), `stringing ${p.product}`);
            return {
                // One bow a use, with no delay (bows.rs2:35-42): the server runs up to USER_EVENTS_PER_TICK OpHeldU
                // packets a tick (OpHeldU.ts:5), so a trip's m bows take ceil(m / USER_EVENTS_PER_TICK) ticks.
                ticksPerAttempt: 1,
                perTick: USER_EVENTS_PER_TICK,
                success: 1,
                xpTenths: { fletching: int(row, 'experience') },
                products: [{ obj: p.product, count: int(row, 'product', 1) }],
                consumes: [
                    { obj: item, count: 1 },
                    { obj: BOW_STRING, count: 1 },
                ],
            };
        },
    };
};
