/** Backfill a creator's archive (cost-capped). With the local queue, processes jobs and waits. */
import { createContainer } from '../container';
import { parseArgs, requireCreator } from './args';

const { flags } = parseArgs(process.argv.slice(2));
const c = createContainer();
const creatorId = requireCreator(flags);

console.log(`Backfilling creator ${creatorId} (queue=${c.config.queueDriver})…`);
const res = await c.backfill(creatorId);
await c.drain(); // local driver: wait for index jobs to finish
console.log(`Done. enqueued=${res.enqueued} deferredVideos=${res.deferredVideos}`);
process.exit(0);
