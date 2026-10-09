// Applies server/engine/prisma/singleworld migrations to server/engine/db.sqlite
// without the Prisma CLI. Prisma ships no prebuilt engines for NixOS, so
// `bun run sqlite:migrate` fails there; the migrations are plain SQL, so we run
// them with bun:sqlite and record them in Prisma's own _prisma_migrations table
// (same checksum scheme) so a later `prisma migrate deploy` sees them as applied.
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const engineDir = resolve(import.meta.dir, '../../server/engine');
const migrationsDir = join(engineDir, 'prisma/singleworld/migrations');

const db = new Database(join(engineDir, 'db.sqlite'), { create: true });
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);

const applied = new Set(
    db
        .query<{ migration_name: string }, []>(
            'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
        )
        .all()
        .map(r => r.migration_name),
);

const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

let count = 0;
for (const name of names) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    db.transaction(() => {
        db.exec(sql);
        db.run(
            `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
             VALUES (?, ?, current_timestamp, ?, 1)`,
            [randomUUID(), checksum, name],
        );
    })();
    console.log(`applied ${name}`);
    count++;
}
console.log(count ? `${count} migration(s) applied` : 'database up to date');
