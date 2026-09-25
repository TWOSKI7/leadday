# ChainPulse

Robinhood Chain **winner discovery** — open on your phone, no localhost, no login.

**Live:** https://twoski7.github.io/leadday/

## What it does

- Winning wallets from [HoodScan](https://hoodscan.co) public APIs (free, CORS open)
- Scenario presets (conviction / swing / multi-coin / sized / fresh…)
- Bot / pace / short-hold filters
- Clusters + hot tokens
- Tags saved on your device (`localStorage`)

## Run locally (optional)

Just open `index.html` via any static server, or:

```bash
python3 -m http.server 8080
```

`server.py` is optional (older proxy). The shipped app talks to HoodScan directly from the browser.
