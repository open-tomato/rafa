/**
 * `bun scripts/serve-static.ts <dir> <port>`: serves a built Storybook
 * until killed. The visual suite's `webServer` starts it.
 */
import { HOST, serveStatic } from './static-server.js';

const [root = 'storybook-static', portArgument = '6016'] = process.argv.slice(2);
const port = Number(portArgument);
if (!Number.isInteger(port) || port <= 0) throw new Error(`serve-static: not a port: ${portArgument}`);

serveStatic(root, port);
console.info(`serving ${root} on http://${HOST}:${port}`);
