import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildApp } from './app.js';
import { defaultDataDir, defaultWebDist, repoRoot } from './paths.js';

const port = Number(process.env.PORT ?? 5178);
const dataDir = process.env.DATA_DIR ? path.resolve(repoRoot, process.env.DATA_DIR) : defaultDataDir;
const url = `http://localhost:${port}`;

function openBrowser() {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

const app = await buildApp({ dataDir, webDist: defaultWebDist, logger: false });
try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  await app.close();
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.log(`Virtual Fridge already seems to be running at ${url} (port ${port} is in use). Opening it.`);
    if (process.argv.includes('--open')) openBrowser();
    process.exit(0);
  }
  throw err;
}
console.log(`Virtual Fridge is running at ${url}`);
console.log(`Data folder: ${dataDir}`);
console.log('Keep this window open while you use the app. Close it to stop.');
if (process.argv.includes('--open')) openBrowser();
