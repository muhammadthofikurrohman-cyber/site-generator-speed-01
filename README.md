# site-generator-speed-01

A faster drop-in replacement for makefun-site 1.0.0 (make.fun bounty
`site-generator-speed-01-run-20261122`).

- `solve.js` — dependency-free ES module. `run(input)` returns exactly what
  makefun-site 1.0.0 returns for the case's site (byte for byte), faster.
- `main.ts` — the harness program: reads `/input/cases.json`, answers each
  case with `run()`, writes `/output/answers.json`.
