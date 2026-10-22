import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { EventEmitter } from 'node:events';

class TestWorker extends EventEmitter { postMessage() {} }
mock.module('worker_threads', () => ({ Worker: TestWorker }));
await import('../../src/engine/World.js');
const { default: InvType } = await import('../../src/cache/config/InvType.js');
const { default: ObjType } = await import('../../src/cache/config/ObjType.js');
const { default: Player } = await import('../../src/engine/entity/Player.js');
const { updateWealthHiscores } = await import('../../src/server/login/LoginServer.js');
const { db } = await import('../../src/db/query.js');
InvType.load(process.env.BANK_TEST_CACHE!);
ObjType.load(process.env.BANK_TEST_CACHE!);

const database = new Database('db.sqlite');
database.exec('CREATE TABLE hiscore_bank (account_id INTEGER, profile TEXT, value INTEGER, items TEXT, date TEXT)');
const oldItems = JSON.stringify([{ id: 1042, name: 'Blue partyhat', value: 2, count: 2 }]);
database.query('INSERT INTO hiscore_bank VALUES (1, ?, 2, ?, ?)').run('main', oldItems, 'old');
database.query('INSERT INTO hiscore_bank VALUES (1, ?, 2, ?, ?)').run('iron', oldItems, 'old');
const account = { id: 1, staffmodlevel: 0, banned_until: null };
const player = new Player('snapshot', 1n, 1n);
const bank = InvType.getId('bank');
try {
    // A save with no bank inventory must clear an old row, preserving other profiles.
    await updateWealthHiscores(account, player, 'main');
    assert.deepEqual(database.query('SELECT value,items FROM hiscore_bank WHERE profile=?').get('main'), { value: 0, items: '[]' });
    assert.equal((database.query('SELECT items FROM hiscore_bank WHERE profile=?').get('iron') as { items: string }).items, oldItems);
    database.query('UPDATE hiscore_bank SET date=? WHERE profile=?').run('unchanged', 'main');
    await updateWealthHiscores(account, player, 'main');
    assert.equal((database.query('SELECT date FROM hiscore_bank WHERE profile=?').get('main') as { date: string }).date, 'unchanged');

    // Refill, then withdraw the final item: quantity and value must follow the real bank.
    player.invAdd(bank, 1042, 2);
    await updateWealthHiscores(account, player, 'main');
    assert.deepEqual(database.query('SELECT value,items FROM hiscore_bank WHERE profile=?').get('main'), { value: 2, items: oldItems });
    player.invDel(bank, 1042, 2);
    await updateWealthHiscores(account, player, 'main');
    assert.deepEqual(database.query('SELECT value,items FROM hiscore_bank WHERE profile=?').get('main'), { value: 0, items: '[]' });
    await updateWealthHiscores({ ...account, id: 2 }, new Player('newempty', 2n, 2n), 'main');
    assert.equal(database.query('SELECT count(*) AS n FROM hiscore_bank WHERE account_id=2').get()?.n, 0);
    console.log('Bank snapshot update checks passed');
} finally {
    database.close();
    await db.destroy();
}
// World imports initialize recurring timers; this isolated fixture has completed.
process.exit(0);
