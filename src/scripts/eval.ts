/** Retrieval eval: hit-rate@1 / @3 over distinct mediaIds, from {question, expectedMediaId} cases. */
import { readFileSync } from 'node:fs';
import { createContainer } from '../container';
import { parseArgs } from './args';

interface EvalCase {
  question: string;
  expectedMediaId: string;
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const file = positional[0] ?? flags.file;
if (!file) {
  console.error('Usage: npm run eval -- [--creator <id>] <cases.json>');
  process.exit(1);
}

const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
const cases: EvalCase[] = Array.isArray(raw) ? raw : ((raw as { cases?: EvalCase[] }).cases ?? []);
const creatorId =
  flags.creator ??
  (Array.isArray(raw) ? undefined : (raw as { creatorId?: string }).creatorId) ??
  process.env.SEARCH_CREATOR_ID;
if (!creatorId) {
  console.error('Provide --creator <id>, a top-level "creatorId" in the JSON, or SEARCH_CREATOR_ID.');
  process.exit(1);
}
if (cases.length === 0) {
  console.error('No cases found.');
  process.exit(1);
}

const c = createContainer();
let hit1 = 0;
let hit3 = 0;
const misses: string[] = [];

for (const tc of cases) {
  const { vector } = await c.embedding.embed(tc.question, 'RETRIEVAL_QUERY');
  const top = await c.chunks.findNearest(creatorId, vector, 10);
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const ch of top) {
    if (!seen.has(ch.mediaId)) {
      seen.add(ch.mediaId);
      distinct.push(ch.mediaId);
    }
  }
  if (distinct[0] === tc.expectedMediaId) hit1++;
  if (distinct.slice(0, 3).includes(tc.expectedMediaId)) hit3++;
  else misses.push(tc.question);
}

const n = cases.length;
console.log(`\nCreator: ${creatorId}`);
console.log(`Cases:   ${n}`);
console.log(`hit@1:   ${(hit1 / n).toFixed(3)}  (${hit1}/${n})`);
console.log(`hit@3:   ${(hit3 / n).toFixed(3)}  (${hit3}/${n}) — over DISTINCT media\n`);
if (misses.length) {
  console.log('Misses (@3):');
  for (const m of misses) console.log(`  - ${m}`);
}
process.exit(0);
