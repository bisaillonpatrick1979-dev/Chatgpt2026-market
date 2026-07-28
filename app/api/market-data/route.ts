import { NextRequest, NextResponse } from "next/server";
import type { Candle, MarketDataMode, MarketDataResponse } from "@/lib/market";

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

function parseEndDate(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10);
}

function generateMockCandles(symbol: string, interval: string, count: number, historical: boolean, historicalEndDate: string): Candle[] {
  const step = intervalSeconds(interval);
  const historicalAnchor = Math.floor(new Date(`${historicalEndDate}T23:59:59Z`).getTime() / 1000);
  const anchor = historical ? historicalAnchor : Math.floor(Date.now() / 1000);
  const alignedAnchor = Math.floor(anchor / step) * step;
  const random = seededRandom(hashText(`${symbol}-${interval}-${historical ? historicalEndDate : "live"}`));
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
    candles.push({ time: alignedAnchor - index * step, open, high, low, close });
    lastClose = close;
  }

  return candles;
}

function normalizeSymbol(symbol: string) {
  return symbol.replace(/[^A-Z0-9/._-]/gi, "").slice(0, 24).toUpperCase();
}

function withFreshness(
  response: Omit<MarketDataResponse, "receivedAt" | "latestCandleAt" | "ageSeconds" | "staleAfterSeconds" | "stale" | "candleCount">,
  interval: string,
  freshnessRelevant: boolean,
  forceStale = false,
): MarketDataResponse {
  const receivedAt = new Date();
  const latestCandle = response.candles.at(-1);
  const latestCandleAt = latestCandle ? new Date(latestCandle.time * 1000) : receivedAt;
  const ageSeconds = Math.max(0, Math.floor((receivedAt.getTime() - latestCandleAt.getTime()) / 1000));
  const staleAfterSeconds = staleThreshold(interval);
  return {
    ...response,
    candleCount: response.candles.length,
    receivedAt: receivedAt.toISOString(),
    latestCandleAt: latestCandleAt.toISOString(),
    ageSeconds,
    staleAfterSeconds,
    stale: freshnessRelevant ? forceStale || ageSeconds > staleAfterSeconds : false,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeSymbol(params.get("symbol") || "AAPL");
  const requestedInterval = params.get("interval") || "5min";
  const interval = ALLOWED_INTERVALS.has(requestedInterval) ? requestedInterval : "5min";
  const outputsize = Math.min(500, Math.max(40, Number(params.get("outputsize")) || 180));
  const rawMode = params.get("mode");
  const mode: MarketDataMode = rawMode === "mock" || rawMode === "historical" ? rawMode : "live";
  const historicalEndDate = parseEndDate(params.get("endDate"));
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (mode === "mock") {
    return NextResponse.json(withFreshness({
      symbol,
      interval,
      source: "mock",
      requestedMode: "mock",
      dataKind: "mock",
      providerName: "Simulateur interne QuantFarm",
      apiHost: "Application locale /api/market-data",
      transport: "Route Next.js interne",
      fallback: false,
      delayed: false,
      candles: generateMockCandles(symbol, interval, outputsize, false, historicalEndDate),
    }, interval, false));
  }

  if (!apiKey) {
    const historical = mode === "historical";
    return NextResponse.json(withFreshness({
      symbol,
      interval,
      source: "mock",
      requestedMode: mode,
      dataKind: "fallback",
      providerName: "Simulateur interne QuantFarm",
      apiHost: "Application locale /api/market-data",
      transport: "Route Next.js interne",
      fallback: true,
      delayed: mode === "live",
      historicalEndDate: historical ? historicalEndDate : undefined,
      candles: generateMockCandles(symbol, interval, outputsize, historical, historicalEndDate),
      error: `Twelve Data n’est pas configuré sur cette route serveur; repli fictif pour le mode ${historical ? "historique" : "temps réel"}.`,
    }, interval, mode === "live", mode === "live"));
  }

  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(outputsize));
    url.searchParams.set("order", "ASC");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("apikey", apiKey);
    if (mode === "historical") url.searchParams.set("end_date", `${historicalEndDate}T23:59:59`);

    const twelveResponse = await fetch(url, mode === "live" ? { cache: "no-store" } : { next: { revalidate: 300 } });
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
    })).filter((value: Candle) => Number.isFinite(value.time) && Number.isFinite(value.close));

    return NextResponse.json(withFreshness({
      symbol,
      interval,
      source: "twelve-data",
      requestedMode: mode,
      dataKind: mode === "historical" ? "historical" : "live",
      providerName: "Twelve Data",
      providerSite: "https://twelvedata.com",
      apiHost: "api.twelvedata.com",
      transport: "Route Next.js serveur",
      fallback: false,
      delayed: false,
      historicalEndDate: mode === "historical" ? historicalEndDate : undefined,
      candles,
      providerMeta: payload.meta || {},
    }, interval, mode === "live"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de données inconnue";
    const historical = mode === "historical";
    return NextResponse.json(withFreshness({
      symbol,
      interval,
      source: "mock",
      requestedMode: mode,
      dataKind: "fallback",
      providerName: "Simulateur interne QuantFarm",
      apiHost: "Application locale /api/market-data",
      transport: "Route Next.js interne",
      fallback: true,
      delayed: mode === "live",
      historicalEndDate: historical ? historicalEndDate : undefined,
      error: `Twelve Data indisponible (${message}); repli sur des chandelles fictives clairement identifiées.`,
      candles: generateMockCandles(symbol, interval, outputsize, historical, historicalEndDate),
    }, interval, mode === "live", mode === "live"));
  }
}
