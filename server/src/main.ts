import { spawn } from 'node:child_process';
import { buildApp } from './app.js';
import { defaultDataDir, defaultWebDist } from './paths.js';

const port = Number(process.env.PORT ?? 5178);
const dataDir = process.env.DATA_DIR ?? defaultDataDir;

const app = await buildApp({ dataDir, webDist: defaultWebDist, logger: false });
await app.listen({ port, host: '127.0.0.1' });
const url = `http://localhost:${port}`;
console.log(`Virtual Fridge is running at ${url}`);
console.log(`Data folder: ${dataDir}`);
console.log('Keep this window open while you use the app. Close it to stop.');

if (process.argv.includes('--open')) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}
