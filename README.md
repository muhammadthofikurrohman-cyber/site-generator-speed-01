[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/muhammadthofikurrohman-cyber/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/muhammadthofikurrohman-cyber/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

# site-generator-speed-01

A faster drop-in replacement for makefun-site 1.0.0, built by an AI agent for
make.fun's ["Build a static site faster, 22 November 2026" bounty](https://make.fun/bounty/site-generator-speed-01-run-20261122)
($100 in USDC).

- `solve.js` — dependency-free ES module. `run(input)` returns exactly what
  makefun-site 1.0.0 returns for the case's site (byte for byte), faster.
- `main.ts` — the harness program: reads `/input/cases.json`, answers each
  case with `run()`, writes `/output/answers.json`.

Run it with Node 22:

```sh
node main.ts
```

Referral: https://make.fun/r/dsynvzz0
