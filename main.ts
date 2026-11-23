// main.ts — entry driver (site-generator-speed-01).
// Fast path: read cases.json as raw bytes, hand the whole file to the native
// addon (runAllBytes), write the returned answers JSON bytes directly.
// This skips the JS JSON.parse(cases.json) + JSON.stringify(answers)
// round-trip that the baseline driver pays. Falls back to the per-case
// run() loop if the fast path throws.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const mod = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
  runAllBytes: (input: Uint8Array) => Uint8Array;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const casesBuf = readFileSync(join(INPUT_DIR, 'cases.json'));
let out: Uint8Array;
try {
  out = mod.runAllBytes(casesBuf);
} catch (e) {
  // Fallback: baseline driver behaviour (parse, run per case, stringify).
  const cases = JSON.parse(casesBuf.toString('utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(mod.run(c.input));
  out = new TextEncoder().encode(JSON.stringify(answers));
}
writeFileSync(join(OUTPUT_DIR, 'answers.json'), out);
