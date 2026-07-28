import { NextRequest, NextResponse } from "next/server";
import type { Candle, MarketDataResponse } from "@/lib/market";

export const runtime = "nodejs";

const ALLOWED_INTERVALS = new Set(["1min", "5min", "15min", "30min", "1h", "4h", "1day"]);

function hashText(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function intervalSeconds(interval: string) {
  const map: Record<string, number> = {
    "1min": 60,
    "5min": 300,
    "15min": 900,
    "30min": 1800,
    "1h": 3600,
    "4h": 14400,
    "1day": 86400,
  };
  return map[interval] ?? 300;
}

function staleThreshold(interval: string) {
  return Math.max(120, Math.round(intervalSeconds(interval) * 2.5));
}

function basePriceFor(symbol: string) {
  if (symbol.includes("BTC")) return 118000;
  if (symbol.includes("/")) return symbol === "USD/CAD" ? 1.37 : 1.16;
  if (symbol === "SHOP") return 145;
  if (symbol === "MSFT") return 510;
  return 225;
}

function generateMockCandles(symbol: string, interval: string, count: number, historical: boolean): Candle[] {
  const step = intervalSeconds(interval);
  const anchor = historical ? Date.UTC(2020, 2, 2, 14, 30) / 1000 : Math.floor(Date.now() / 1000);
  const alignedAnchor = Math.floor(anchor / step) * step;
  const random = seededRandom(hashText(`${symbol}-${interval}-${historical ? "historical" : "live"}`));
  const base = basePriceFor(symbol);
  const volatility = symbol.includes("BTC") ? 0.008 : symbol.includes("/") ? 0.0012 : 0.004;
  let lastClose = base * (0.94 + random() * 0.12);
  const candles: Candle[] = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const cycle = Math.sin((count - index) / 12) * volatility * 0.45;
    const drift = symbol === "AAPL" || symbol === "MSFT" ? volatility * 0.04 : 0;
    const move = (random() - 0.49) * volatility + cycle + drift;
    const open = lastClose;
    const close = Math.max(0.0001, open * (1 + move));
    const wick = Math.abs(close - open) + open * volatility * (0.2 + random() * 0.5);
    const high = Math.max(open, close) + wick * random();
    const low = Math.max(0.0001, Math.min(open, close) - wick * random());
    candles.push({
      time: alignedAnchor - index * step,
      open,
      high,
      low,
      close,
    });
    lastClose = close;
  }

  return candles;
}

function normalizeSymbol(symbol: string) {
  return symbol.replace(/[^A-Z0-9/._-]/gi, "").slice(0, 24).toUpperCase();
}

function withFreshness(
  response: Omit<MarketDataResponse, "receivedAt" | "latestCandleAt" | "ageSeconds" | "staleAfterSeconds" | "stale">,
  interval: string,
  forceStale = false,
): MarketDataResponse {
  const receivedAt = new Date();
  const latestCandle = response.candles.at(-1);
  const latestCandleAt = latestCandle ? new Date(latestCandle.time * 1000) : receivedAt;
  const ageSeconds = Math.max(0, Math.floor((receivedAt.getTime() - latestCandleAt.getTime()) / 1000));
  const staleAfterSeconds = staleThreshold(interval);
  return {
    ...response,
    receivedAt: receivedAt.toISOString(),
    latestCandleAt: latestCandleAt.toISOString(),
    ageSeconds,
    staleAfterSeconds,
    stale: forceStale || ageSeconds > staleAfterSeconds,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeSymbol(params.get("symbol") || "AAPL");
  const requestedInterval = params.get("interval") || "5min";
  const interval = ALLOWED_INTERVALS.has(requestedInterval) ? requestedInterval : "5min";
  const outputsize = Math.min(500, Math.max(40, Number(params.get("outputsize")) || 180));
  const mode = params.get("mode") || "live";
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey || mode === "mock" || mode === "historical") {
    const historical = mode === "historical";
    const response = withFreshness({
      symbol,
      interval,
      source: "mock",
      delayed: !historical,
      candles: generateMockCandles(symbol, interval, outputsize, historical),
      error: !apiKey && mode === "live" ? "Aucune source réelle serveur n’est configurée; données fictives utilisées." : undefined,
    }, interval, mode === "live");
    return NextResponse.json(response);
  }

  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(outputsize));
    url.searchParams.set("order", "ASC");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("apikey", apiKey);

    const twelveResponse = await fetch(url, { next: { revalidate: 45 } });
    const payload = await twelveResponse.json();

    if (!twelveResponse.ok || payload.status === "error" || !Array.isArray(payload.values)) {
      throw new Error(payload.message || "Twelve Data n’a pas retourné de chandelles.");
    }

    const candles: Candle[] = payload.values.map((value: Record<string, string>) => ({
      time: Math.floor(new Date(`${value.datetime.replace(" ", "T")}Z`).getTime() / 1000),
      open: Number(value.open),
      high: Number(value.high),
      low: Number(value.low),
      close: Number(value.close),
    }));

    const response = withFreshness({
      symbol,
      interval,
      source: "twelve-data",
      delayed: false,
      candles,
    }, interval);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de données inconnue";
    const response = withFreshness({
      symbol,
      interval,
      source: "mock",
      delayed: true,
      error: message,
      candles: generateMockCandles(symbol, interval, outputsize, false),
    }, interval, true);
    return NextResponse.json(response, { status: 200 });
  }
}
