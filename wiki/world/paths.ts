import { join } from 'path';

export const ROOT = join(import.meta.dir, '..', '..');
export const CONTENT = join(ROOT, 'server', 'content');
export const MAPS = join(CONTENT, 'maps');
export const SCRIPTS = join(CONTENT, 'scripts');
export const PACK = join(CONTENT, 'pack');
export const WIKI = join(ROOT, 'wiki');
export const WORLD_JSON = join(WIKI, 'world.json');
