/** Incremental poll for a creator (new media since the high-water mark). */
import { createContainer } from '../container';
import { parseArgs, requireCreator } from './args';

const { flags } = parseArgs(process.argv.slice(2));
const c = createContainer();
const creatorId = requireCreator(flags);

console.log(`Polling creator ${creatorId} (queue=${c.config.queueDriver})…`);
await c.pollCreator(creatorId);
await c.drain();
console.log('Done.');
process.exit(0);
