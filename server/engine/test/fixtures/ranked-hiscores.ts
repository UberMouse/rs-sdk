import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { db } from '../../src/db/query.js';
import { loadRankedList } from '../../src/web/pages/RankedHiscores.js';
import { handleHiscoresPlayerPage, getRankedList } from '../../src/web/pages/hiscores.js';

const database = new Database('db.sqlite');
database.exec(`CREATE TABLE account(id INTEGER PRIMARY KEY,username TEXT,staffmodlevel INTEGER);
    CREATE TABLE hiscore(profile TEXT,account_id INTEGER,type INTEGER,level INTEGER,value INTEGER,playtime INTEGER);
    CREATE TABLE hiscore_large(profile TEXT,account_id INTEGER,type INTEGER,level INTEGER,value INTEGER,playtime INTEGER);
    INSERT INTO account VALUES(1,'Alice',0),(2,'Bob',0),(3,'hidden',0),(4,'staff',2);
    INSERT INTO hiscore_large VALUES('main',1,0,100,1,200),('main',2,0,100,1,100),('main',3,0,999,1,1),('main',4,0,999,1,1),('iron',1,0,200,1,1),('iron',2,0,100,1,1);
    INSERT INTO hiscore SELECT profile,account_id,1,level,value,playtime FROM hiscore_large;`);

const rank = async (name: string, profile = 'main') => {
    const response = await handleHiscoresPlayerPage(new URL(`http://localhost/hiscores/player/${name}?profile=${profile}`));
    assert.ok(response);
    const html = await response.text();
    return { status: response.status, rank: html.match(/>Overall<\/a><\/td>\s*<td align="right">(\d+)<\/td>/)?.[1] };
};
try {
    assert.equal((await rank('Alice')).rank, '2');
    assert.equal((await rank('Bob')).rank, '1');
    assert.equal((await rank('Alice', 'iron')).rank, '1');
    assert.equal((await rank('hidden')).status, 404);
    assert.equal((await rank('staff')).status, 404);
    database.exec("UPDATE hiscore_large SET level=300 WHERE account_id=1 AND profile='main'");
    assert.equal((await rank('Alice')).rank, '2', 'Existing cached snapshot remains consistent');
    const now = Date.now;
    const future = now() + 60001;
    try {
        Date.now = () => future;
        assert.equal((await rank('Alice')).rank, '2', 'Serve the old complete snapshot during refresh');
        for (let i = 0; i < 100 && (await rank('Alice')).rank !== '1'; i++) await Bun.sleep(10);
        assert.equal((await rank('Alice')).rank, '1', 'Background refresh builds a fresh rank index');
        assert.equal((await rank('Bob')).rank, '2');
        database.exec('DROP TABLE hiscore_large');
        await assert.rejects(loadRankedList('main', 0));
        Date.now = () => future + 60001;
        assert.equal((await getRankedList('main', 0))[0].username, 'Alice', 'Refresh failure retains the complete snapshot');
        await assert.rejects(loadRankedList('main', 0));
        assert.equal((await getRankedList('main', 0))[1].username, 'Bob');
    } finally {
        Date.now = now;
    }
} finally {
    database.close();
    await db.destroy();
}
