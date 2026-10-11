// The run-artifact timestamp: what `fileStamp()` writes and `stampTime()` reads back. Free of Node
// imports, so browser code (the plan viewer's page) can use it too.

/** Filename-safe UTC timestamp: the ISO string with `:` and `.` replaced by `-`. */
export function fileStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Matches the `fileStamp()` prefix, including its trailing `-`, of a filename. */
/** The stamp's layout, its fields captured: date, hours, minutes, seconds, milliseconds. */
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;

export const FILE_STAMP_PREFIX = new RegExp(`${STAMP.source}-`);

/** The time a `fileStamp()`-prefixed name (a runId, a log file) was stamped, or null when it has none. */
export function stampTime(name: string): number | null {
    const m = STAMP.exec(name);
    if (!m) return null;
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
    return Number.isNaN(t) ? null : t;
}
