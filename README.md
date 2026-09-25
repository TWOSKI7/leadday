# ChainPulse

Robinhood Chain **winner discovery** — find wallets that are actually making money, across multiple winning scenarios (not one “smart money” mold).

## What it does

- Pulls live trader rankings from [HoodScan](https://hoodscan.co) (free MCP / public JSON — **no API key**)
- Scenario presets: conviction holders, swing, multi-coin consistent, sized flow, early/selective, fresh positions
- Drops bots, absurd trade frequency, and measured sub-5‑minute holds where data exists
- Surfaces **wallet clusters** that share the same top token
- Lets you **label** wallets with your own scenario tags (saved under `data/labels.json`) for later Jev-style classification

Chain: Robinhood Chain (`4663`). Not affiliated with Robinhood or HoodScan.

## Run

```bash
python3 server.py
```

Open http://127.0.0.1:8787

Optional: `PORT=9000 python3 server.py`

## Stack

- `server.py` — tiny threaded HTTP server + HoodScan MCP client
- Frontend — vanilla JS (no build step)

## Notes

- HoodScan numbers are from indexed DEX swaps (not transfers/bridges). Treat as recent, not settlement-critical.
- This surfaces candidates. It does not place trades or guarantee profit.
