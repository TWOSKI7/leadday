#!/usr/bin/env python3
"""ChainPulse — Robinhood Chain winner discovery API (HoodScan, free, no key)."""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
HOOD_MCP = "https://hoodscan.co/mcp"
HOOD_REST = "https://hoodscan.co"
PORT = int(os.environ.get("PORT", "8787"))

# In-memory label store (also mirrored to data/labels.json)
LABELS_PATH = ROOT / "data" / "labels.json"
_labels_lock = threading.Lock()
_mcp_lock = threading.Lock()


def _ensure_data():
    LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not LABELS_PATH.exists():
        LABELS_PATH.write_text("{}", encoding="utf-8")


def load_labels() -> dict:
    _ensure_data()
    with _labels_lock:
        try:
            return json.loads(LABELS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}


def save_labels(data: dict) -> None:
    _ensure_data()
    with _labels_lock:
        LABELS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


class HoodMCP:
    def __init__(self) -> None:
        self.sid: str | None = None
        self._ready = False
        self._last_init = 0.0

    def _headers(self) -> dict:
        h = {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
            "User-Agent": "ChainPulse/0.1",
        }
        if self.sid:
            h["mcp-session-id"] = self.sid
        return h

    def _post(self, body: dict, timeout: int = 90) -> dict:
        req = urllib.request.Request(
            HOOD_MCP,
            data=json.dumps(body).encode(),
            headers=self._headers(),
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            sid = r.headers.get("mcp-session-id")
            if sid:
                self.sid = sid
            raw = r.read().decode()
        if not raw:
            return {}
        if raw.lstrip().startswith("{"):
            return json.loads(raw)
        datas = [
            ln[5:].strip()
            for ln in raw.splitlines()
            if ln.startswith("data:") and ln[5:].strip().startswith("{")
        ]
        return json.loads(datas[-1]) if datas else {"raw": raw[:500]}

    def ensure(self) -> None:
        now = time.time()
        if self._ready and now - self._last_init < 300:
            return
        with _mcp_lock:
            if self._ready and time.time() - self._last_init < 300:
                return
            self.sid = None
            self._post(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "chainpulse", "version": "0.1"},
                    },
                },
                timeout=45,
            )
            try:
                self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=20)
            except Exception:
                pass
            self._ready = True
            self._last_init = time.time()

    def call(self, name: str, arguments: dict | None = None) -> dict:
        self.ensure()
        try:
            d = self._post(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments or {}},
                },
                timeout=120,
            )
        except urllib.error.HTTPError as e:
            # session died — retry once
            self._ready = False
            self.ensure()
            d = self._post(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments or {}},
                },
                timeout=120,
            )
        if "error" in d:
            raise RuntimeError(d["error"])
        res = d.get("result") or {}
        if isinstance(res.get("structuredContent"), dict):
            return res["structuredContent"]
        for c in res.get("content") or []:
            if c.get("type") == "text":
                t = c.get("text") or ""
                try:
                    return json.loads(t)
                except Exception:
                    return {"text": t}
        return res


mcp = HoodMCP()


def rest_get(path: str, timeout: int = 45) -> dict:
    url = HOOD_REST + path
    req = urllib.request.Request(url, headers={"User-Agent": "ChainPulse/0.1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def scenario_args(scenario: str) -> dict:
    """Map winning scenarios to HoodScan discover_traders filters — not one mold."""
    base = {
        "result": "winning",
        "includeBots": False,
        "sort": "realizedPnl",
        "dir": "desc",
        "limit": 40,
    }
    # Default hard filters aligned with planning: no bots, no absurd pace
    if scenario == "conviction":
        # Fewer trades, multi-token, prefer longer holds (holder band is sparse on RH Chain)
        return {
            **base,
            "pace": "-25",
            "tokens": "2-",
            "minClosed": 1,
            "minWinRate": 40,
            "sort": "avgHoldSeconds",
        }
    if scenario == "swing":
        return {
            **base,
            "style": "swing",
            "pace": "-80",
            "tokens": "2-",
            "minWinRate": 40,
            "minClosed": 2,
        }
    if scenario == "consistent":
        return {
            **base,
            "tokens": "3-",
            "pace": "-60",
            "minWinRate": 45,
            "minClosed": 3,
            "sort": "winRate",
        }
    if scenario == "sized":
        # Larger volume / whale-ish sizing, still not bot spam
        return {
            **base,
            "minVolume": 25000,
            "pace": "-100",
            "tokens": "1-",
            "sort": "volumeUsd",
        }
    if scenario == "early":
        # Multi-token winners that still trade — entry hunters often look swing
        return {
            **base,
            "style": "swing",
            "tokens": "2-",
            "pace": "-50",
            "minClosed": 2,
            "sort": "score",
        }
    # "all_winners" — broad winning set, bots still off, pace capped
    return {**base, "pace": "-120", "tokens": "1-"}


def post_filter(items: list, scenario: str) -> list:
    """Extra local filters HoodScan may not express (hold > 5m, dust bots)."""
    out = []
    for it in items:
        if it.get("bot") is True:
            continue
        tpd = it.get("tradesPerDay")
        if tpd is not None and tpd > 200:
            continue
        hold = it.get("avgHoldSeconds")
        if hold is not None and hold < 300:
            # allow null holds through; drop measured sub-5m scalpers
            if scenario in ("conviction", "swing", "consistent", "early"):
                continue
        # dust-like: tiny volume with insane trade count
        vol = float(it.get("volumeUsd") or 0)
        trades = int(it.get("trades") or 0)
        if trades > 50 and vol > 0 and (vol / trades) < 1.0:
            continue
        out.append(it)
    return out


def cluster_wallets(items: list) -> list:
    """Group wallets sharing the same top token recently — multi-wallet actors."""
    buckets: dict[str, list] = {}
    for it in items:
        tok = (it.get("topToken") or {}).get("address") or ""
        if not tok:
            continue
        buckets.setdefault(tok.lower(), []).append(it)
    clusters = []
    for tok, members in buckets.items():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda x: float(x.get("realizedPnl") or 0), reverse=True)
        clusters.append(
            {
                "token": members[0].get("topToken"),
                "size": len(members),
                "wallets": [
                    {
                        "trader": m.get("trader"),
                        "nickname": m.get("nickname"),
                        "realizedPnl": m.get("realizedPnl"),
                        "url": m.get("url"),
                    }
                    for m in members[:8]
                ],
            }
        )
    clusters.sort(key=lambda c: c["size"], reverse=True)
    return clusters[:20]


class Handler(BaseHTTPRequestHandler):
    server_version = "ChainPulse/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        def q(name: str, default: str | None = None) -> str | None:
            v = qs.get(name)
            return v[0] if v else default

        try:
            if path in ("/", "/index.html"):
                return self._file(ROOT / "index.html", "text/html; charset=utf-8")
            if path == "/styles.css":
                return self._file(ROOT / "styles.css", "text/css; charset=utf-8")
            if path == "/app.js":
                return self._file(ROOT / "app.js", "application/javascript; charset=utf-8")
            if path == "/manifest.json":
                return self._file(ROOT / "manifest.json", "application/manifest+json")
            if path == "/sw.js":
                return self._file(ROOT / "sw.js", "application/javascript; charset=utf-8")
            if path.startswith("/icon-"):
                return self._file(ROOT / path.lstrip("/"), "image/png")

            if path == "/api/health":
                return self._json(200, {"ok": True, "chain": "robinhood", "chainId": 4663})

            if path == "/api/scenarios":
                return self._json(
                    200,
                    {
                        "scenarios": [
                            {"id": "all_winners", "label": "All winners", "blurb": "Winning wallets, bots off, pace capped"},
                            {"id": "conviction", "label": "Conviction holders", "blurb": "Longer holds, multi-token, low pace"},
                            {"id": "swing", "label": "Swing winners", "blurb": "Hours-to-day holds, not spray"},
                            {"id": "consistent", "label": "Consistent multi-coin", "blurb": "3+ tokens, win rate floor"},
                            {"id": "sized", "label": "Sized flow", "blurb": "Higher volume winners"},
                            {"id": "early", "label": "Early / selective", "blurb": "Swing style + score sort"},
                            {"id": "fresh", "label": "Fresh positions", "blurb": "New opens still in profit (stories)"},
                        ]
                    },
                )

            if path == "/api/winners":
                scenario = q("scenario", "all_winners") or "all_winners"
                if scenario == "fresh":
                    data = mcp.call("list_stories", {"kind": "fresh", "limit": 40})
                    items = data.get("items") or []
                    return self._json(
                        200,
                        {
                            "scenario": scenario,
                            "source": "hoodscan.list_stories",
                            "generatedAt": data.get("asOf"),
                            "items": items,
                            "clusters": [],
                            "labels": load_labels(),
                        },
                    )

                args = scenario_args(scenario)
                # allow query overrides
                for key in (
                    "minVolume",
                    "minWinRate",
                    "minClosed",
                    "tokens",
                    "pace",
                    "style",
                    "sort",
                    "dir",
                    "limit",
                    "q",
                    "offset",
                ):
                    if q(key) is not None:
                        raw = q(key)
                        if key in ("minVolume",):
                            args[key] = float(raw)
                        elif key in ("minWinRate", "minClosed", "limit", "offset"):
                            args[key] = int(raw)
                        else:
                            args[key] = raw
                data = mcp.call("discover_traders", args)
                items = post_filter(data.get("items") or [], scenario)
                clusters = cluster_wallets(items)
                return self._json(
                    200,
                    {
                        "scenario": scenario,
                        "source": "hoodscan.discover_traders",
                        "lookbackHours": data.get("lookbackHours"),
                        "generatedAt": data.get("generatedAt"),
                        "query": args,
                        "items": items,
                        "clusters": clusters,
                        "labels": load_labels(),
                    },
                )

            if path == "/api/top":
                limit = int(q("limit", "20") or 20)
                data = mcp.call("top_wallets", {"limit": min(max(limit, 1), 50)})
                items = post_filter(data.get("items") or [], "all_winners")
                return self._json(200, {**data, "items": items, "labels": load_labels()})

            if path.startswith("/api/trader/"):
                addr = path.split("/api/trader/", 1)[1].strip().lower()
                if not addr.startswith("0x") or len(addr) != 42:
                    return self._json(400, {"error": "bad address"})
                data = mcp.call(
                    "get_trader",
                    {"address": addr, "positions_limit": 30, "recent_limit": 30},
                )
                labels = load_labels()
                data["labels"] = labels.get(addr, [])
                return self._json(200, data)

            if path == "/api/discover-tokens":
                window = int(q("window", "60") or 60)
                data = rest_get(f"/swaps-api/discover/trending?window={window}")
                items = data.get("items") or []
                # prefer tokens with smart buyers and not purely suspicious spam
                items = [
                    i
                    for i in items
                    if not i.get("suspicious")
                    and int(i.get("smartBuyers") or 0) >= 1
                ][:50]
                return self._json(200, {"windowMinutes": window, "items": items})

            if path == "/api/labels":
                return self._json(200, load_labels())

            return self._json(404, {"error": "not found"})
        except Exception as e:
            return self._json(502, {"error": str(e)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except Exception:
            return self._json(400, {"error": "invalid json"})

        if parsed.path == "/api/labels":
            addr = (body.get("address") or "").lower().strip()
            labels = body.get("labels")
            if not addr.startswith("0x") or len(addr) != 42:
                return self._json(400, {"error": "bad address"})
            if not isinstance(labels, list):
                return self._json(400, {"error": "labels must be a list"})
            # free-form scenario tags — Jev-style codebook later
            clean = [str(x).strip()[:64] for x in labels if str(x).strip()][:12]
            store = load_labels()
            if clean:
                store[addr] = clean
            else:
                store.pop(addr, None)
            save_labels(store)
            return self._json(200, {"ok": True, "address": addr, "labels": clean})

        return self._json(404, {"error": "not found"})


def main() -> None:
    _ensure_data()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"ChainPulse on http://127.0.0.1:{PORT}  (Robinhood Chain via HoodScan)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
