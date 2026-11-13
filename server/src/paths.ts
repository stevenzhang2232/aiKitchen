import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const defaultDataDir = path.join(repoRoot, 'data');
export const defaultWebDist = path.join(repoRoot, 'web', 'dist');
