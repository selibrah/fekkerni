/** Offline retrieval CLI: embed → findNearest → gate → show top-3 chunks + the reply the bot would send. */
import { createContainer } from '../container';
import { parseArgs, requireCreator } from './args';
import { assembleOutbound } from '../retrieval/reply';
import { defaultCopy } from '../messaging/copy';

const { flags, positional } = parseArgs(process.argv.slice(2));
const query = positional.join(' ').trim();
if (!query) {
  console.error('Usage: npm run search -- [--creator <id>] "your question"');
  process.exit(1);
}

const c = createContainer();
const creatorId = requireCreator(flags);

const { vector } = await c.embedding.embed(query, 'RETRIEVAL_QUERY');
const top = await c.chunks.findNearest(creatorId, vector, 3);

console.log(`\nQuery:   ${query}\nCreator: ${creatorId}\n`);
if (top.length === 0) {
  console.log('(no chunks indexed for this creator)\n');
} else {
  top.forEach((ch, i) => {
    const cue = ch.startSec != null ? ` @${ch.startSec}s` : '';
    console.log(`#${i + 1}  distance=${ch.distance.toFixed(4)}  ${ch.mediaType}${cue}`);
    console.log(`     ${ch.permalink}`);
    console.log(`     ${ch.text.slice(0, 160).replace(/\s+/g, ' ')}\n`);
  });
}

const best = top[0];
const passed = best !== undefined && best.distance <= c.config.cosineDistanceMax;
console.log(`Gate: ${passed ? 'PASS' : 'FALLBACK'}  (COSINE_DISTANCE_MAX=${c.config.cosineDistanceMax})\n`);

const plan = await c.retrieve.retrieve(creatorId, query);
const reply = assembleOutbound({
  plan,
  fallback: defaultCopy.fallback,
  disclosure: null,
  maxBytes: c.config.maxReplyBytes,
});
console.log('Would send:\n--------------------\n' + reply + '\n--------------------');
process.exit(0);
