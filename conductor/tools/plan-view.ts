// A web page that follows the plan or task a bot is running, shows its past runs by conductor
// session, and the bot in a live 3D view of the world (rs-world over the engine's world feed).
//
//   bun conductor/tools/plan-view.ts [--port 7790] [--host 127.0.0.1] [--root <checkout>]...
//
// Reads the plan and task logs under conductor/runs/ of this checkout and every worktree of it
// (or only the --root checkouts given), and watches each viewed bot in observe mode, which never
// takes control. Design: conductor/docs/plan-view.md.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fail, parseCli } from '../lib/util';
import { isLoopback, startServer } from './plan-view/server';
import { findRoots } from './plan-view/store';

const usage = 'usage: bun conductor/tools/plan-view.ts [--port 7790] [--host 127.0.0.1] [--root <checkout>]...';
const { values, positionals } = parseCli(
    {
        port: { type: 'string', default: '7790' },
        host: { type: 'string', default: '127.0.0.1' },
        root: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
    },
    usage,
);
if (values.help) {
    console.log(usage);
    process.exit(0);
}
if (positionals.length) fail(usage, 2);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a port number\n${usage}`, 2);

const roots = values.root?.length ? values.root.map(r => resolve(r)) : findRoots();
for (const r of roots) if (!existsSync(join(r, 'conductor/runs'))) fail(`no conductor/runs under ${r}`, 2);
if (!roots.length) fail('no checkout with a conductor/runs directory', 2);

const { url, close } = startServer({ roots, port, hostname: values.host });
if (!isLoopback(values.host))
    console.warn(
        `plan viewer: listening on ${values.host}: anyone who can reach it reads the run logs and live bot state`,
    );
console.log(`plan viewer: ${url}`);
console.log(`reading ${roots.map(r => join(r, 'conductor/runs')).join(', ')}`);

const stop = () => {
    void close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
