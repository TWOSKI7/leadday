# ChainPulse

Robinhood Chain **winner discovery** — open on your phone, no localhost, no login.

**Live:** https://twoski7.github.io/leadday/

## What it does

Answers **“are they still trading?”** before showing past PnL.

- **Active now** — winners with a trade in the last 24h  
- **Just bought** — those whose latest move was a buy  
- **Quiet / done** — past winners idle 24h+ (history, not a live signal)  

Each card shows status, last buy/sell + when, then realized PnL labeled as **past**.  
Data from [HoodScan](https://hoodscan.co) public APIs. Tags stay on your phone.

## Run locally (optional)

Just open `index.html` via any static server, or:

```bash
python3 -m http.server 8080
```

`server.py` is optional (older proxy). The shipped app talks to HoodScan directly from the browser.
