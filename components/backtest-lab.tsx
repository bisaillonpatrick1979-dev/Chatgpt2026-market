"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { INTERVALS, SYMBOLS, formatCad, formatPrice, type Candle, type MarketDataResponse } from "@/lib/market";
import styles from "./backtest-lab.module.css";

type Strategy = "trend" | "mean_reversion" | "breakout";
type DataChoice = "historical" | "live";
type Side = "BUY" | "SELL";

type Parameters = {
  initialCapital: number;
  riskPerTradePct: number;
  feeBps: number;
  slippageBps: number;
  shortWindow: number;
  longWindow: number;
  stopLossPct: number;
  takeProfitPct: number;
};

type BacktestTrade = {
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  returnPct: number;
  reason: string;
};

type EquityPoint = { time: number; equity: number };

type MonteCarloResult = {
  simulations: number;
  percentile5: number;
  median: number;
  percentile95: number;
  ruinProbability: number;
};

type BacktestResult = {
  initialCapital: number;
  endingCapital: number;
  netProfit: number;
  returnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  sharpe: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  inSampleReturnPct: number;
  outOfSampleReturnPct: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  monteCarlo: MonteCarloResult;
};

type Position = {
  side: Side;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  entryFee: number;
};

type TrainingRun = {
  id: string;
  name: string;
  symbols: string[];
  interval: string;
  status: string;
  starting_capital: number;
  ending_capital: number | null;
  net_profit: number | null;
  max_drawdown: number | null;
  total_trades: number | null;
  winning_trades: number | null;
  losing_trades: number | null;
  metrics: Record<string, unknown>;
  created_at: string;
};

const DEFAULT_PARAMETERS: Parameters = {
  initialCapital: 100000,
  riskPerTradePct: 0.5,
  feeBps: 2,
  slippageBps: 3,
  shortWindow: 8,
  longWindow: 24,
  stopLossPct: 1.2,
  takeProfitPct: 2.4,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function percentile(sorted: number[], value: number) {
  if (!sorted.length) return 0;
  const index = clamp((sorted.length - 1) * value, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function strategySignal(strategy: Strategy, candles: Candle[], index: number, parameters: Parameters) {
  const current = candles[index];
  const shortValues = candles.slice(index - parameters.shortWindow + 1, index + 1).map((candle) => candle.close);
  const longValues = candles.slice(index - parameters.longWindow + 1, index + 1).map((candle) => candle.close);
  const shortAverage = mean(shortValues);
  const longAverage = mean(longValues);

  if (strategy === "trend") {
    if (shortAverage > longAverage * 1.001) return { entry: "BUY" as Side, exitLong: false, exitShort: true };
    if (shortAverage < longAverage * 0.999) return { entry: "SELL" as Side, exitLong: true, exitShort: false };
    return { entry: null, exitLong: false, exitShort: false };
  }

  if (strategy === "mean_reversion") {
    const deviation = standardDeviation(longValues);
    const zScore = deviation ? (current.close - longAverage) / deviation : 0;
    if (zScore <= -1.5) return { entry: "BUY" as Side, exitLong: false, exitShort: true };
    if (zScore >= 1.5) return { entry: "SELL" as Side, exitLong: true, exitShort: false };
    return { entry: null, exitLong: Math.abs(zScore) < 0.25, exitShort: Math.abs(zScore) < 0.25 };
  }

  const previous = candles.slice(index - parameters.longWindow, index);
  const previousHigh = Math.max(...previous.map((candle) => candle.high));
  const previousLow = Math.min(...previous.map((candle) => candle.low));
  if (current.close > previousHigh) return { entry: "BUY" as Side, exitLong: false, exitShort: true };
  if (current.close < previousLow) return { entry: "SELL" as Side, exitLong: true, exitShort: false };
  return { entry: null, exitLong: current.close < shortAverage, exitShort: current.close > shortAverage };
}

function simulateSegment(candles: Candle[], strategy: Strategy, parameters: Parameters, startingCapital: number) {
  let cash = startingCapital;
  let position: Position | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const feeRate = parameters.feeBps / 10000;
  const slippageRate = parameters.slippageBps / 10000;
  const warmup = Math.max(parameters.longWindow + 2, 30);

  const closePosition = (candle: Candle, reason: string, forcedPrice?: number) => {
    if (!position) return;
    const rawPrice = forcedPrice || candle.close;
    const exitPrice = position.side === "BUY" ? rawPrice * (1 - slippageRate) : rawPrice * (1 + slippageRate);
    const grossPnl = position.side === "BUY"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
    const exitFee = Math.abs(exitPrice * position.quantity) * feeRate;
    const pnl = grossPnl - position.entryFee - exitFee;
    cash += pnl;
    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: candle.time,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl,
      returnPct: (pnl / Math.max(1, Math.abs(position.entryPrice * position.quantity))) * 100,
      reason,
    });
    position = null;
  };

  for (let index = warmup; index < candles.length; index += 1) {
    const candle = candles[index];
    const signal = strategySignal(strategy, candles, index, parameters);

    if (position) {
      const stopDistance = position.entryPrice * (parameters.stopLossPct / 100);
      const targetDistance = position.entryPrice * (parameters.takeProfitPct / 100);
      const stopPrice = position.side === "BUY" ? position.entryPrice - stopDistance : position.entryPrice + stopDistance;
      const targetPrice = position.side === "BUY" ? position.entryPrice + targetDistance : position.entryPrice - targetDistance;
      const hitStop = position.side === "BUY" ? candle.low <= stopPrice : candle.high >= stopPrice;
      const hitTarget = position.side === "BUY" ? candle.high >= targetPrice : candle.low <= targetPrice;

      if (hitStop) closePosition(candle, "Stop-loss", stopPrice);
      else if (hitTarget) closePosition(candle, "Take-profit", targetPrice);
      else if ((position.side === "BUY" && signal.exitLong) || (position.side === "SELL" && signal.exitShort)) closePosition(candle, "Signal inverse");
    }

    if (!position && signal.entry) {
      const entryPrice = signal.entry === "BUY" ? candle.close * (1 + slippageRate) : candle.close * (1 - slippageRate);
      const riskBudget = Math.max(1, cash * (parameters.riskPerTradePct / 100));
      const stopDistance = Math.max(entryPrice * (parameters.stopLossPct / 100), 0.000001);
      const riskQuantity = riskBudget / stopDistance;
      const notionalCap = Math.max(1, cash * 0.35);
      const quantity = Math.max(0.0001, Math.min(riskQuantity, notionalCap / entryPrice));
      const entryFee = Math.abs(entryPrice * quantity) * feeRate;
      position = { side: signal.entry, entryTime: candle.time, entryPrice, quantity, entryFee };
    }

    const markedPnl = position
      ? position.side === "BUY"
        ? (candle.close - position.entryPrice) * position.quantity - position.entryFee
        : (position.entryPrice - candle.close) * position.quantity - position.entryFee
      : 0;
    equityCurve.push({ time: candle.time, equity: cash + markedPnl });
  }

  if (position && candles.length) closePosition(candles.at(-1) as Candle, "Fin de période");
  const endingCapital = cash;
  return { endingCapital, trades, equityCurve };
}

function maxDrawdown(equityCurve: EquityPoint[]) {
  let peak = equityCurve[0]?.equity || 0;
  let maximum = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maximum = Math.max(maximum, ((peak - point.equity) / peak) * 100);
  }
  return maximum;
}

function monteCarlo(trades: BacktestTrade[], initialCapital: number, simulations = 500): MonteCarloResult {
  if (!trades.length) return { simulations, percentile5: initialCapital, median: initialCapital, percentile95: initialCapital, ruinProbability: 0 };
  const returns = trades.map((trade) => trade.pnl / Math.max(1, initialCapital));
  const random = seededRandom(trades.length * 7919 + Math.round(initialCapital));
  const endings: number[] = [];
  let ruined = 0;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let equity = initialCapital;
    let minimum = equity;
    for (let index = 0; index < returns.length; index += 1) {
      const sampled = returns[Math.floor(random() * returns.length)];
      equity += sampled * initialCapital;
      minimum = Math.min(minimum, equity);
    }
    endings.push(equity);
    if (minimum <= initialCapital * 0.7) ruined += 1;
  }

  endings.sort((a, b) => a - b);
  return {
    simulations,
    percentile5: percentile(endings, 0.05),
    median: percentile(endings, 0.5),
    percentile95: percentile(endings, 0.95),
    ruinProbability: (ruined / simulations) * 100,
  };
}

function runBacktest(candles: Candle[], strategy: Strategy, rawParameters: Parameters): BacktestResult {
  const parameters: Parameters = {
    initialCapital: clamp(Number(rawParameters.initialCapital) || 100000, 1000, 100000000),
    riskPerTradePct: clamp(Number(rawParameters.riskPerTradePct) || 0.5, 0.05, 5),
    feeBps: clamp(Number(rawParameters.feeBps) || 0, 0, 100),
    slippageBps: clamp(Number(rawParameters.slippageBps) || 0, 0, 200),
    shortWindow: clamp(Math.round(Number(rawParameters.shortWindow) || 8), 2, 100),
    longWindow: clamp(Math.round(Number(rawParameters.longWindow) || 24), 5, 250),
    stopLossPct: clamp(Number(rawParameters.stopLossPct) || 1.2, 0.1, 20),
    takeProfitPct: clamp(Number(rawParameters.takeProfitPct) || 2.4, 0.1, 50),
  };
  if (parameters.longWindow <= parameters.shortWindow) parameters.longWindow = parameters.shortWindow + 5;

  const splitIndex = Math.max(parameters.longWindow + 40, Math.floor(candles.length * 0.7));
  const inSampleCandles = candles.slice(0, splitIndex);
  const outOfSampleCandles = candles.slice(Math.max(0, splitIndex - parameters.longWindow - 5));
  const inSample = simulateSegment(inSampleCandles, strategy, parameters, parameters.initialCapital);
  const outOfSample = simulateSegment(outOfSampleCandles, strategy, parameters, parameters.initialCapital);
  const full = simulateSegment(candles, strategy, parameters, parameters.initialCapital);

  const winners = full.trades.filter((trade) => trade.pnl > 0);
  const losers = full.trades.filter((trade) => trade.pnl < 0);
  const gains = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const losses = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));
  const tradeReturns = full.trades.map((trade) => trade.returnPct / 100);
  const returnMean = mean(tradeReturns);
  const returnDeviation = standardDeviation(tradeReturns);
  const sharpe = returnDeviation ? (returnMean / returnDeviation) * Math.sqrt(Math.max(1, tradeReturns.length)) : 0;
  const netProfit = full.endingCapital - parameters.initialCapital;

  return {
    initialCapital: parameters.initialCapital,
    endingCapital: full.endingCapital,
    netProfit,
    returnPct: (netProfit / parameters.initialCapital) * 100,
    maxDrawdownPct: maxDrawdown(full.equityCurve),
    winRatePct: full.trades.length ? (winners.length / full.trades.length) * 100 : 0,
    profitFactor: losses ? gains / losses : gains > 0 ? 99 : 0,
    sharpe,
    totalTrades: full.trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    inSampleReturnPct: ((inSample.endingCapital - parameters.initialCapital) / parameters.initialCapital) * 100,
    outOfSampleReturnPct: ((outOfSample.endingCapital - parameters.initialCapital) / parameters.initialCapital) * 100,
    trades: full.trades,
    equityCurve: full.equityCurve,
    monteCarlo: monteCarlo(full.trades, parameters.initialCapital),
  };
}

function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return <div className={styles.emptyChart}>Pas assez de données pour tracer la courbe.</div>;
  const width = 900;
  const height = 240;
  const values = points.map((point) => point.equity);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const path = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.equity - minimum) / range) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Courbe de capital du backtest">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div><span>{formatCad(maximum)}</span><span>{formatCad(minimum)}</span></div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function BacktestLab() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalValue] = useState<(typeof INTERVALS)[number]>("1h");
  const [strategy, setStrategy] = useState<Strategy>("trend");
  const [dataChoice, setDataChoice] = useState<DataChoice>("historical");
  const [parameters, setParameters] = useState<Parameters>(DEFAULT_PARAMETERS);
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<TrainingRun[]>([]);
  const [hasTwelveData, setHasTwelveData] = useState(false);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => { setSession(data.session); setSessionLoading(false); });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setSessionLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, [client]);

  const loadHistory = useCallback(async () => {
    if (!session) return;
    const [runs, connections] = await Promise.all([
      client.from("training_runs").select("id,name,symbols,interval,status,starting_capital,ending_capital,net_profit,max_drawdown,total_trades,winning_trades,losing_trades,metrics,created_at").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(12),
      client.from("integration_connections").select("id").eq("user_id", session.user.id).eq("provider", "twelve_data").eq("environment", "data").maybeSingle(),
    ]);
    if (!runs.error) setHistory((runs.data || []) as TrainingRun[]);
    if (!connections.error) setHasTwelveData(Boolean(connections.data));
  }, [client, session]);

  useEffect(() => { if (session) void loadHistory(); }, [loadHistory, session]);

  const loadCandles = useCallback(async () => {
    if (!session) throw new Error("Authentification requise.");
    if (dataChoice === "live" && hasTwelveData) {
      const { data, error } = await client.functions.invoke("integration-manager", {
        body: { action: "market_data", provider: "twelve_data", environment: "data", symbol, interval, outputsize: 500 },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Données Twelve Data indisponibles.");
      return { symbol, interval, source: "twelve-data", delayed: false, candles: data.candles || [] } as MarketDataResponse;
    }
    const mode = dataChoice === "historical" ? "historical" : "live";
    const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=500&mode=${mode}`, { cache: "no-store" });
    return await response.json() as MarketDataResponse;
  }, [client.functions, dataChoice, hasTwelveData, interval, session, symbol]);

  const executeBacktest = async () => {
    if (!session) return;
    setLoading(true);
    setMessage("");
    try {
      const data = await loadCandles();
      if (data.candles.length < Math.max(80, parameters.longWindow + 30)) throw new Error("Pas assez de chandelles pour un test fiable.");
      const computed = runBacktest(data.candles, strategy, parameters);
      setMarketData(data);
      setResult(computed);

      const started = new Date(data.candles[0].time * 1000);
      const ended = new Date((data.candles.at(-1) as Candle).time * 1000);
      const { error } = await client.from("training_runs").insert({
        user_id: session.user.id,
        name: `${strategy} · ${symbol} · ${interval}`,
        symbols: [symbol],
        interval,
        start_date: started.toISOString().slice(0, 10),
        end_date: ended.toISOString().slice(0, 10),
        speed: "max",
        status: "completed",
        starting_capital: computed.initialCapital,
        ending_capital: computed.endingCapital,
        net_profit: computed.netProfit,
        max_drawdown: computed.maxDrawdownPct,
        total_trades: computed.totalTrades,
        winning_trades: computed.winningTrades,
        losing_trades: computed.losingTrades,
        metrics: { strategy, parameters, dataSource: data.source, returnPct: computed.returnPct, winRatePct: computed.winRatePct, profitFactor: computed.profitFactor, sharpe: computed.sharpe, inSampleReturnPct: computed.inSampleReturnPct, outOfSampleReturnPct: computed.outOfSampleReturnPct, monteCarlo: computed.monteCarlo, paperOnly: true },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (error) setMessage(`Résultat calculé, mais sauvegarde impossible : ${error.message}`);
      else await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur de backtest inconnue.");
    } finally {
      setLoading(false);
    }
  };

  if (sessionLoading) return <main className={styles.shell}><section className={styles.centerCard}><h1>Chargement du laboratoire…</h1></section></main>;
  if (!session) return <main className={styles.shell}><section className={styles.centerCard}><h1>Connexion requise</h1><p>Connecte-toi au terminal pour sauvegarder les essais.</p><Link href="/" className={styles.primaryLink}>Aller au terminal</Link></section></main>;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>WALK-FORWARD · FRAIS · GLISSEMENT · MONTE-CARLO</p><h1>Laboratoire de stratégies</h1><p>Teste les agents et les règles sur des données fictives historiques ou des chandelles réelles récentes, sans envoyer aucun ordre à un courtier.</p></div>
        <span className={styles.paperBadge}>100 % PAPER</span>
      </header>
      {message && <div className={styles.message}>{message}<button onClick={() => setMessage("")}>×</button></div>}

      <section className={styles.workspace}>
        <article className={styles.panel}>
          <p className={styles.eyebrow}>CONFIGURATION</p><h2>Scénario d’essai</h2>
          <div className={styles.formGrid}>
            <label>Instrument<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{SYMBOLS.map((item) => <option value={item.symbol} key={item.symbol}>{item.symbol} — {item.label}</option>)}</select></label>
            <label>Intervalle<select value={interval} onChange={(event) => setIntervalValue(event.target.value as (typeof INTERVALS)[number])}>{INTERVALS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label>Stratégie<select value={strategy} onChange={(event) => setStrategy(event.target.value as Strategy)}><option value="trend">Suivi de tendance</option><option value="mean_reversion">Retour à la moyenne</option><option value="breakout">Cassure</option></select></label>
            <label>Données<select value={dataChoice} onChange={(event) => setDataChoice(event.target.value as DataChoice)}><option value="historical">Historique fictif contrôlé</option><option value="live">Réelles récentes si Twelve Data est configuré</option></select></label>
            <label>Capital initial ($ CA)<input inputMode="decimal" value={parameters.initialCapital} onChange={(event) => setParameters((current) => ({ ...current, initialCapital: Number(event.target.value) }))} /></label>
            <label>Risque par transaction (%)<input inputMode="decimal" value={parameters.riskPerTradePct} onChange={(event) => setParameters((current) => ({ ...current, riskPerTradePct: Number(event.target.value) }))} /></label>
            <label>Fenêtre courte<input inputMode="numeric" value={parameters.shortWindow} onChange={(event) => setParameters((current) => ({ ...current, shortWindow: Number(event.target.value) }))} /></label>
            <label>Fenêtre longue<input inputMode="numeric" value={parameters.longWindow} onChange={(event) => setParameters((current) => ({ ...current, longWindow: Number(event.target.value) }))} /></label>
            <label>Stop-loss (%)<input inputMode="decimal" value={parameters.stopLossPct} onChange={(event) => setParameters((current) => ({ ...current, stopLossPct: Number(event.target.value) }))} /></label>
            <label>Take-profit (%)<input inputMode="decimal" value={parameters.takeProfitPct} onChange={(event) => setParameters((current) => ({ ...current, takeProfitPct: Number(event.target.value) }))} /></label>
            <label>Frais (points de base)<input inputMode="decimal" value={parameters.feeBps} onChange={(event) => setParameters((current) => ({ ...current, feeBps: Number(event.target.value) }))} /></label>
            <label>Glissement (points de base)<input inputMode="decimal" value={parameters.slippageBps} onChange={(event) => setParameters((current) => ({ ...current, slippageBps: Number(event.target.value) }))} /></label>
          </div>
          <button className={styles.primaryButton} onClick={() => void executeBacktest()} disabled={loading}>{loading ? "Simulation en cours…" : "Exécuter le backtest"}</button>
          <p className={styles.smallText}>La période est séparée à 70 % / 30 % pour comparer l’échantillon d’ajustement et l’échantillon hors test. Les coûts et le glissement sont appliqués à chaque entrée et sortie.</p>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>SOURCE ET INTÉGRITÉ</p><h2>Données utilisées</h2>
          <div className={styles.sourceStatus}><div><span>Twelve Data</span><strong>{hasTwelveData ? "Configuré" : "Non configuré"}</strong></div><div><span>Dernier jeu</span><strong>{marketData?.source || "—"}</strong></div><div><span>Chandelles</span><strong>{marketData?.candles.length || 0}</strong></div><div><span>Intervalle</span><strong>{marketData?.interval || interval}</strong></div></div>
          <div className={styles.warning}>Les données fictives servent à tester le moteur, pas à prouver une rentabilité. Les données réelles récentes ne remplacent pas un historique institutionnel ajusté pour divisions, dividendes et changements de symbole.</div>
        </article>
      </section>

      {result && <>
        <section className={styles.metrics}>
          <article><span>Capital final</span><strong>{formatCad(result.endingCapital)}</strong><small className={result.netProfit >= 0 ? styles.positive : styles.negative}>{result.netProfit >= 0 ? "+" : ""}{formatCad(result.netProfit)}</small></article>
          <article><span>Rendement</span><strong>{result.returnPct.toFixed(2)} %</strong><small>Hors échantillon {result.outOfSampleReturnPct.toFixed(2)} %</small></article>
          <article><span>Drawdown maximal</span><strong>{result.maxDrawdownPct.toFixed(2)} %</strong><small>Limite de baisse observée</small></article>
          <article><span>Taux gagnant</span><strong>{result.winRatePct.toFixed(1)} %</strong><small>{result.winningTrades} gains / {result.losingTrades} pertes</small></article>
          <article><span>Profit factor</span><strong>{result.profitFactor.toFixed(2)}</strong><small>Sharpe expérimental {result.sharpe.toFixed(2)}</small></article>
          <article><span>Transactions</span><strong>{result.totalTrades}</strong><small>Frais et glissement inclus</small></article>
        </section>

        <section className={styles.resultGrid}>
          <article className={`${styles.panel} ${styles.wide}`}><div className={styles.panelHeader}><div><p className={styles.eyebrow}>COURBE PAPER</p><h2>Évolution du capital</h2></div><span>{marketData?.source}</span></div><EquityChart points={result.equityCurve} /></article>
          <article className={styles.panel}><p className={styles.eyebrow}>VALIDATION</p><h2>Échantillon séparé</h2><div className={styles.validationGrid}><div><span>70 % ajustement</span><strong>{result.inSampleReturnPct.toFixed(2)} %</strong></div><div><span>30 % hors test</span><strong>{result.outOfSampleReturnPct.toFixed(2)} %</strong></div></div><p className={styles.smallText}>Une stratégie qui fonctionne seulement dans la première partie est probablement surajustée.</p></article>
          <article className={styles.panel}><p className={styles.eyebrow}>MONTE-CARLO</p><h2>{result.monteCarlo.simulations} séquences réordonnées</h2><div className={styles.validationGrid}><div><span>5e percentile</span><strong>{formatCad(result.monteCarlo.percentile5)}</strong></div><div><span>Médiane</span><strong>{formatCad(result.monteCarlo.median)}</strong></div><div><span>95e percentile</span><strong>{formatCad(result.monteCarlo.percentile95)}</strong></div><div><span>Probabilité -30 %</span><strong>{result.monteCarlo.ruinProbability.toFixed(1)} %</strong></div></div></article>
          <article className={`${styles.panel} ${styles.wide}`}><p className={styles.eyebrow}>TRANSACTIONS</p><h2>Dernières exécutions simulées</h2><div className={styles.tradeTable}><table><thead><tr><th>Côté</th><th>Entrée</th><th>Sortie</th><th>Quantité</th><th>P/L</th><th>Raison</th></tr></thead><tbody>{result.trades.slice(-20).reverse().map((trade, index) => <tr key={`${trade.entryTime}-${index}`}><td className={trade.side === "BUY" ? styles.positive : styles.negative}>{trade.side}</td><td>{formatPrice(trade.entryPrice)}</td><td>{formatPrice(trade.exitPrice)}</td><td>{trade.quantity.toFixed(4)}</td><td className={trade.pnl >= 0 ? styles.positive : styles.negative}>{formatCad(trade.pnl)}</td><td>{trade.reason}</td></tr>)}</tbody></table></div></article>
        </section>
      </>}

      <section className={styles.panel}><div className={styles.panelHeader}><div><p className={styles.eyebrow}>HISTORIQUE</p><h2>Essais sauvegardés</h2></div><span>{history.length} affichés</span></div><div className={styles.history}>{history.length === 0 ? <p className={styles.smallText}>Aucun backtest enregistré.</p> : history.map((run) => <div key={run.id}><div><strong>{run.name}</strong><span>{run.symbols.join(", ")} · {run.interval}</span></div><b className={(run.net_profit || 0) >= 0 ? styles.positive : styles.negative}>{run.net_profit === null ? "—" : formatCad(run.net_profit)}</b><div><strong>{run.total_trades || 0} transactions</strong><span>Drawdown {Number(run.max_drawdown || 0).toFixed(2)} %</span></div><time>{formatDate(run.created_at)}</time></div>)}</div></section>
    </main>
  );
}
