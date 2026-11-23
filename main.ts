// main.ts — spawn-binary driver (site-generator-speed-01).
// Fast path: spawn the standalone C binary directly on the input/output
// files. Node never copies the ~6 MB input / ~15 MB output — the binary
// reads /input/cases.json and writes /output/answers.json itself, so the
// Node process's CPU is only import (base64 decode + binary write) and
// the spawn itself.
// Fallback: read the input, runAllBytes (binary via temp files, then the
// in-process addon), write the output.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const mod = (await import(new URL('./solve.js', import.meta.url).href)) as {
  getBinaryPath: () => string;
  runAllBytes: (input: Uint8Array) => Uint8Array;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const inPath = join(INPUT_DIR, 'cases.json');
const outPath = join(OUTPUT_DIR, 'answers.json');

const r = spawnSync(mod.getBinaryPath(), [inPath, outPath], { encoding: 'buffer' });
if (r.error || r.status !== 0) {
  // Fallback: read the input, runAllBytes (binary via temp files, then addon).
  const casesBuf = readFileSync(inPath);
  const out = mod.runAllBytes(casesBuf);
  writeFileSync(outPath, out);
}
