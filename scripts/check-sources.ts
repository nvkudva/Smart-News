/**
 * The two copies of the source list must be identical.
 *
 * They exist twice because the worker bundle cannot import from outside web/,
 * and nothing enforced it: they drifted to 72 entries against 55, so the
 * pipeline ingested one list while the browser decided blindspots from another.
 * A diff is cheap; noticing this by reading a coverage bar is not.
 */
import { readFileSync } from 'node:fs';

const A = 'src/lib/sources.ts';
const B = 'web/shared/sources.ts';
const a = readFileSync(A, 'utf8');
const b = readFileSync(B, 'utf8');
if (a === b) { console.log(`sources: ${A} and ${B} agree`); process.exit(0); }

const al = a.split('\n'), bl = b.split('\n');
for (let i = 0; i < Math.max(al.length, bl.length); i++) {
  if (al[i] !== bl[i]) {
    console.error(`sources: the two copies differ at line ${i + 1}.`);
    console.error(`  ${A}: ${al[i] ?? '(end of file)'}`);
    console.error(`  ${B}: ${bl[i] ?? '(end of file)'}`);
    break;
  }
}
console.error(`Edit ${A}, then: cp ${A} ${B}`);
process.exit(1);
