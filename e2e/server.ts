// Starts the real app server for end-to-end tests with a throwaway data folder.
// Requires `npm run build` first so web/dist exists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../server/src/app';
import { defaultWebDist } from '../server/src/paths';

const dataDir = process.env.DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-e2e-'));
const port = Number(process.env.PORT ?? 5180);
if (!fs.existsSync(path.join(defaultWebDist, 'index.html'))) {
  console.error('web/dist is missing. Run `npm run build` first.');
  process.exit(1);
}
const app = await buildApp({ dataDir, webDist: defaultWebDist });
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server on ${port}, data in ${dataDir}`);
