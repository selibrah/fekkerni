/** Two-stage poll fan-out: enqueue a poll_creator job per active creator. Schedule hourly. */
import { createContainer } from '../container';

const c = createContainer();
const n = await c.pollAll();
await c.drain();
console.log(`Enqueued poll for ${n} active creator(s).`);
process.exit(0);
