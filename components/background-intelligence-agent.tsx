"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { SYMBOLS, type Candle } from "@/lib/market";

const LOCK_KEY = "quantfarm:background-intelligence-lock";
const CURSOR_KEY = "quantfarm:background-intelligence-cursor";
const DEFAULT_INTERVAL = "5min";

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function technicalContext(candles: Candle[], source: string, freshness: Record<string, unknown>) {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const five = candles.slice(-5);
  const twenty = candles.slice(-20);
  const fourteen = candles.slice(-14);
  const sma5 = mean(five.map((candle) => candle.close));
  const sma20 = mean(twenty.map((candle) => candle.close));
  const atr14 = fourteen.length
    ? fourteen.reduce((sum, candle) => sum + Math.max(candle.high - candle.low, 0.000001), 0) / fourteen.length
    : 0;
  return {
    lastPrice: latest?.close || 0,
    changePct: latest && previous ? ((latest.close - previous.close) / previous.close) * 100 : 0,
    sma5,
    sma20,
    atr14,
    high20: twenty.length ? Math.max(...twenty.map((candle) => candle.high)) : 0,
    low20: twenty.length ? Math.min(...twenty.map((candle) => candle.low)) : 0,
    trend: sma5 > sma20 ? "up" : sma5 < sma20 ? "down" : "flat",
    candleCount: candles.length,
    dataSource: source,
    ...freshness,
  };
}

function acquireLock(owner: string) {
  try {
    const now = Date.now();
    const current = JSON.parse(localStorage.getItem(LOCK_KEY) || "null") as { owner?: string; expiresAt?: number } | null;
    if (current?.owner !== owner && Number(current?.expiresAt) > now) return false;
    localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt: now + 120_000 }));
    return true;
  } catch {
    return true;
  }
}

function releaseLock(owner: string) {
  try {
    const current = JSON.parse(localStorage.getItem(LOCK_KEY) || "null") as { owner?: string } | null;
    if (current?.owner === owner) localStorage.removeItem(LOCK_KEY);
  } catch {
    // A failed local lock must never interrupt the paper terminal.
  }
}

export function BackgroundIntelligenceAgent() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const owner = useRef(crypto.randomUUID());
  const cycleRunning = useRef(false);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, [client]);

  const runCycle = useCallback(async () => {
    if (!session || cycleRunning.current || document.visibilityState === "hidden") return;
    if (!acquireLock(owner.current)) return;
    cycleRunning.current = true;

    try {
      const userId = session.user.id;
      const { data: activeSession, error: activeError } = await client
        .from("agent_sessions")
        .select("id,data_mode,status,started_at")
        .eq("user_id", userId)
        .eq("trading_mode", "autonomous")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeError || !activeSession || activeSession.data_mode !== "live") return;

      const [settingsResult, connectionsResult, watchlistResult, positionsResult] = await Promise.all([
        client
          .from("intelligence_settings")
          .select("enabled,auto_refresh_minutes,max_research_age_minutes")
          .eq("user_id", userId)
          .maybeSingle(),
        client
          .from("integration_connections")
          .select("provider,environment,status")
          .eq("user_id", userId)
          .in("provider", ["openai", "twelve_data"]),
        client
          .from("watchlist_items")
          .select("symbol,label,exchange,asset_type")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
        client
          .from("positions")
          .select("symbol,asset_type")
          .eq("user_id", userId)
          .eq("status", "open"),
      ]);

      if (settingsResult.error || settingsResult.data?.enabled === false) return;
      const connections = connectionsResult.data || [];
      const hasOpenAi = connections.some((item) => item.provider === "openai" && item.environment === "ai");
      const hasTwelveData = connections.some((item) => item.provider === "twelve_data" && item.environment === "data");
      if (!hasOpenAi || !hasTwelveData) return;

      let watchlist = watchlistResult.data || [];
      if (!watchlist.length) {
        const defaults = SYMBOLS.map((item) => ({
          user_id: userId,
          symbol: item.symbol,
          label: item.label,
          exchange: item.market,
          asset_type: item.symbol.includes("BTC") ? "crypto" : item.symbol.includes("/") ? "forex" : "equity",
        }));
        const { data } = await client
          .from("watchlist_items")
          .upsert(defaults, { onConflict: "user_id,symbol", ignoreDuplicates: true })
          .select("symbol,label,exchange,asset_type");
        watchlist = data || defaults;
      }

      const prioritySymbols = [...new Set([
        ...(positionsResult.data || []).map((position) => position.symbol),
        ...watchlist.map((item) => item.symbol),
      ])].slice(0, 20);
      if (!prioritySymbols.length) return;

      const { data: recentRuns } = await client
        .from("market_research_runs")
        .select("symbol,status,expires_at,created_at")
        .eq("user_id", userId)
        .in("symbol", prioritySymbols)
        .eq("status", "completed")
        .order("created_at", { ascending: false });

      const validSymbols = new Set<string>();
      for (const run of recentRuns || []) {
        if (run.expires_at && new Date(run.expires_at).getTime() > Date.now()) validSymbols.add(run.symbol);
      }
      const expired = prioritySymbols.filter((symbol) => !validSymbols.has(symbol));
      if (!expired.length) return;

      let cursor = 0;
      try { cursor = Number(localStorage.getItem(CURSOR_KEY)) || 0; } catch { cursor = 0; }
      const targetSymbol = expired[cursor % expired.length];
      try { localStorage.setItem(CURSOR_KEY, String(cursor + 1)); } catch { /* optional */ }

      const symbolInfo = SYMBOLS.find((item) => item.symbol === targetSymbol);
      const assetType = targetSymbol.includes("BTC") ? "crypto" : targetSymbol.includes("/") ? "forex" : "equity";
      const { data: market, error: marketError } = await client.functions.invoke("integration-manager", {
        body: {
          action: "market_data",
          provider: "twelve_data",
          environment: "data",
          symbol: targetSymbol,
          interval: DEFAULT_INTERVAL,
          outputsize: 180,
        },
      });
      if (marketError || market?.error || !Array.isArray(market?.candles)) return;

      const candles = market.candles as Candle[];
      if (candles.length < 30 || market.stale) return;
      const context = technicalContext(candles, String(market.source || "twelve-data"), {
        receivedAt: market.receivedAt,
        latestCandleAt: market.latestCandleAt,
        dataAgeSeconds: market.ageSeconds,
        staleAfterSeconds: market.staleAfterSeconds,
        stale: market.stale,
        market: symbolInfo?.market || "Unknown",
        currency: symbolInfo?.currency || "USD",
        automaticCycle: true,
        activeSessionId: activeSession.id,
      });

      await client.functions.invoke("market-intelligence", {
        body: {
          symbol: targetSymbol,
          assetType,
          interval: DEFAULT_INTERVAL,
          horizon: "intraday",
          mode: "quick",
          dataMode: "live",
          technicalContext: context,
        },
      });
    } finally {
      cycleRunning.current = false;
      releaseLock(owner.current);
    }
  }, [client, session]);

  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => void runCycle(), 3_000);
    const timer = window.setInterval(() => void runCycle(), 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void runCycle(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runCycle, session]);

  return null;
}
