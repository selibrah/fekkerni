/** Refresh long-lived IG tokens nearing expiry. Schedule daily (Cloud Scheduler → this script/endpoint). */
import { createContainer } from '../container';
import { parseArgs } from './args';

const { flags } = parseArgs(process.argv.slice(2));
const windowDays = flags.window ? Number(flags.window) : 7;
const c = createContainer();
const res = await c.refreshTokens(windowDays);
console.log(`refreshed=${res.refreshed} failed=${res.failed} (window=${windowDays}d)`);
process.exit(0);
