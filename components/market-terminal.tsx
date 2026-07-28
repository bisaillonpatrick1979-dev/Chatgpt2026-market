"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
import type { CloudContext } from "@/lib/cloud";
import {
  INTERVALS,
  SYMBOLS,
  formatCad,
  formatPrice,
  positionPnl,
  type MarketDataResponse,
  type OrderSide,
  type Position,
  type TradeLog,
  type TradingMode,
} from "@/lib/market";

type DurationPreset = "10m" | "1h" | "4h" | "unlimited";
type DataMode = "live" | "mock" | "historical";
type MarketDefinition = { name: string; zone: string; open: number; close: number; weekdaysOnly?: boolean };
type Props = { cloud?: CloudContext; onSignOut?: () => void | Promise<void> };

const MARKETS: MarketDefinition[] = [
  { name: "États-Unis", zone: "America/New_York", open: 9.5, close: 16, weekdaysOnly: true },
  { name: "Canada", zone: "America/Toronto", open: 9.5, close: 16, weekdaysOnly: true },
  { name: "Londres", zone: "Europe/London", open: 8, close: 16.5, weekdaysOnly: true },
  { name: "Europe", zone: "Europe/Paris", open: 9, close: 17.5, weekdaysOnly: true },
  { name: "Japon", zone: "Asia/Tokyo", open: 9, close: 15.5, weekdaysOnly: true },
  { name: "Australie", zone: "Australia/Sydney", open: 10, close: 16, weekdaysOnly: true },
];

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

function marketStatus(market: MarketDefinition, now: Date) {
  const parts = zoneParts(now, market.zone);
  const hour = parts.hour + parts.minute / 60;
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  return (!market.weekdaysOnly || !weekend) && hour >= market.open && hour < market.close;
}

function durationSeconds(duration: DurationPreset) {
  if (duration === "10m") return 600;
  if (duration === "1h") return 3600;
  if (duration === "4h") return 14400;
  return null;
}

function durationLabel(duration: DurationPreset) {
  return { "10m": "10 minutes", "1h": "1 heure", "4h": "4 heures", unlimited: "Illimité" }[duration];
}

function formatCountdown(seconds: number | null) {
  if (seconds === null) return "ILLIMITÉ";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

const MODE_INFO: Record<TradingMode, { label: string; description: string }> = {
  manual: { label: "Manuel", description: "Tu places et fermes chaque lot." },
  assisted: { label: "Assisté", description: "Les agents proposent; tu approuves." },
  autonomous: { label: "Autonome", description: "Les agents gèrent le portefeuille paper." },
  replay: { label: "Replay", description: "Entraînement accéléré sur données historiques." },
};

export function MarketTerminal({ cloud, onSignOut }: Props) {
  const [mode, setMode] = useState<TradingMode>(cloud?.mode ?? "manual");
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalValue] = useState<(typeof INTERVALS)[number]>("5min");
  const [dataMode, setDataMode] = useState<DataMode>("mock");
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [priceBySymbol, setPriceBySymbol] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [capital, setCapital] = useState(cloud?.capital ?? 100000);
  const [agentAllocation, setAgentAllocation] = useState(cloud?.agentAllocation ?? 10000);
  const [cash, setCash] = useState(cloud?.cash ?? 100000);
  const [positions, setPositions] = useState<Position[]>(cloud?.positions ?? []);
  const [logs, setLogs] = useState<TradeLog[]>(cloud?.logs ?? []);
  const [duration, setDuration] = useState<DurationPreset>("1h");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(3600);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [orderSide, setOrderSide] = useState<OrderSide>("BUY");
  const [quantity, setQuantity] = useState(5);
  const [stopLoss, setStopLoss] = useState(0);
  const [takeProfit, setTakeProfit] = useState(0);
  const [now, setNow] = useState(new Date());
  const [syncState, setSyncState] = useState<"saved" | "saving" | "error">("saved");
  const agentTick = useRef(0);

  useEffect(() => {
    if (!cloud) return;
    setCapital(cloud.capital);
    setCash(cloud.cash);
    setAgentAllocation(cloud.agentAllocation);
    setMode(cloud.mode);
    setPositions(cloud.positions);
    setLogs(cloud.logs);
  }, [cloud]);

  const latestPrice = marketData?.candles.at(-1)?.close ?? 0;
  const markedPrice = (position: Position) => priceBySymbol[position.symbol] ?? position.entryPrice;
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position, markedPrice(position)), 0);
  const equity = cash + positions.reduce((sum, position) => {
    const marketValue = markedPrice(position) * position.quantity;
    return sum + (position.side === "BUY" ? marketValue : -marketValue);
  }, 0);
  const allocatedExposure = positions.filter((position) => position.origin === "agent").reduce((sum, position) => sum + position.entryPrice * position.quantity, 0);

  const runCloud = useCallback(async (operation: () => PromiseLike<{ error?: { message?: string } | null }> | Promise<void>) => {
    if (!cloud) return;
    setSyncState("saving");
    try {
      const result = await operation();
      if (result && "error" in result && result.error) throw new Error(result.error.message || "Erreur Supabase");
      setSyncState("saved");
    } catch (error) {
      console.error(error);
      setSyncState("error");
    }
  }, [cloud]);

  const persistWallet = useCallback((patch: Record<string, unknown>) => {
    if (!cloud) return;
    void runCloud(() => cloud.client.from("paper_wallets").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", cloud.walletId));
  }, [cloud, runCloud]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=180&mode=${dataMode}`);
      const payload = (await response.json()) as MarketDataResponse;
      setMarketData(payload);
      const newest = payload.candles.at(-1)?.close;
      if (newest) setPriceBySymbol((current) => ({ ...current, [payload.symbol]: newest }));
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, dataMode]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const addLog = useCallback((log: Omit<TradeLog, "id" | "time">, links?: { positionId?: string; orderId?: string }) => {
    const item: TradeLog = { id: crypto.randomUUID(), time: new Date().toISOString(), ...log };
    setLogs((current) => [item, ...current].slice(0, 50));
    if (cloud) {
      void runCloud(() => cloud.client.from("trade_logs").insert({
        id: item.id,
        user_id: cloud.userId,
        wallet_id: cloud.walletId,
        session_id: currentSessionId,
        position_id: links?.positionId,
        order_id: links?.orderId,
        agent_name: item.agent,
        action: item.action,
        reason: item.reason,
        result: item.result,
        created_at: item.time,
      }));
    }
    return item;
  }, [cloud, currentSessionId, runCloud]);

  const completeSession = useCallback((status: "stopped" | "completed") => {
    if (!cloud || !currentSessionId) return;
    void runCloud(() => cloud.client.from("agent_sessions").update({ status, stopped_at: new Date().toISOString(), ending_equity: equity }).eq("id", currentSessionId));
  }, [cloud, currentSessionId, equity, runCloud]);

  useEffect(() => {
    if (!sessionActive || sessionPaused || remaining === null) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value === null) return null;
        if (value <= 1) {
          setSessionActive(false);
          setMode("manual");
          completeSession("completed");
          addLog({ agent: "Contrôleur de session", action: "Session terminée", reason: "La durée autorisée est écoulée. Les nouvelles entrées sont bloquées." });
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [addLog, completeSession, remaining, sessionActive, sessionPaused]);

  const placeOrder = useCallback((origin: "manual" | "agent" | "assisted", forcedSide?: OrderSide, forcedQuantity?: number) => {
    if (!latestPrice) return false;
    const side = forcedSide ?? orderSide;
    const qty = Math.max(0.0001, forcedQuantity ?? quantity);
    const requiredCash = latestPrice * qty;
    const isAgent = origin === "agent";

    if (side === "BUY" && requiredCash > cash) {
      addLog({ agent: "Moteur de risque", action: "Ordre refusé", reason: "Encaisse paper insuffisante." });
      return false;
    }
    if (isAgent && allocatedExposure + requiredCash > agentAllocation) {
      addLog({ agent: "Moteur de risque", action: "Ordre refusé", reason: "Allocation maximale des agents atteinte." });
      return false;
    }

    const orderId = crypto.randomUUID();
    const position: Position = {
      id: crypto.randomUUID(), symbol, side, quantity: qty, entryPrice: latestPrice,
      stopLoss: stopLoss > 0 ? stopLoss : side === "BUY" ? latestPrice * 0.992 : latestPrice * 1.008,
      takeProfit: takeProfit > 0 ? takeProfit : side === "BUY" ? latestPrice * 1.016 : latestPrice * 0.984,
      openedAt: new Date().toISOString(), origin,
    };
    const nextCash = side === "BUY" ? cash - requiredCash : cash + requiredCash;
    setPositions((current) => [position, ...current]);
    setCash(nextCash);
    persistWallet({ cash_balance: nextCash });

    if (cloud) {
      void runCloud(async () => {
        const orderResult = await cloud.client.from("orders").insert({
          id: orderId, user_id: cloud.userId, wallet_id: cloud.walletId, session_id: currentSessionId,
          symbol, side, order_type: "market", quantity: qty, average_fill_price: latestPrice,
          status: "filled", origin, filled_at: position.openedAt,
        });
        if (orderResult.error) return orderResult;
        return cloud.client.from("positions").insert({
          id: position.id, user_id: cloud.userId, wallet_id: cloud.walletId, session_id: currentSessionId,
          opening_order_id: orderId, symbol, side, quantity: qty, entry_price: latestPrice,
          stop_loss: position.stopLoss, take_profit: position.takeProfit, origin, status: "open", opened_at: position.openedAt,
        });
      });
    }

    addLog({
      agent: origin === "agent" ? "Agent exécution" : "Utilisateur",
      action: `${side === "BUY" ? "Achat" : "Vente"} ${qty} ${symbol}`,
      reason: origin === "agent" ? "Signal approuvé par le moteur de risque." : origin === "assisted" ? "Proposition assistée approuvée." : "Ordre manuel paper.",
    }, { positionId: position.id, orderId });
    return true;
  }, [addLog, agentAllocation, allocatedExposure, cash, cloud, currentSessionId, latestPrice, orderSide, persistWallet, quantity, runCloud, stopLoss, symbol, takeProfit]);

  const closePosition = useCallback((position: Position, reason = "Fermeture manuelle") => {
    const exitPrice = priceBySymbol[position.symbol] ?? position.entryPrice;
    const pnl = positionPnl(position, exitPrice);
    const cashFlow = exitPrice * position.quantity;
    const nextCash = position.side === "BUY" ? cash + cashFlow : cash - cashFlow;
    setCash(nextCash);
    setPositions((current) => current.filter((item) => item.id !== position.id));
    persistWallet({ cash_balance: nextCash });
    if (cloud) {
      void runCloud(() => cloud.client.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), exit_price: exitPrice, realized_pnl: pnl }).eq("id", position.id));
    }
    addLog({ agent: position.origin === "agent" ? "Agent exécution" : "Utilisateur", action: `Fermeture ${position.symbol}`, reason, result: pnl }, { positionId: position.id });
  }, [addLog, cash, cloud, persistWallet, priceBySymbol, runCloud]);

  useEffect(() => {
    if (!sessionActive || sessionPaused || mode !== "autonomous" || !marketData || !latestPrice) return;
    const timer = window.setInterval(() => {
      agentTick.current += 1;
      const recent = marketData.candles.slice(-12);
      if (recent.length < 4) return;
      const shortAverage = recent.slice(-4).reduce((sum, candle) => sum + candle.close, 0) / 4;
      const longAverage = recent.reduce((sum, candle) => sum + candle.close, 0) / recent.length;
      const currentAgentPosition = positions.find((position) => position.origin === "agent" && position.symbol === symbol);
      if (currentAgentPosition) {
        const hitsStop = currentAgentPosition.side === "BUY" ? latestPrice <= (currentAgentPosition.stopLoss ?? -Infinity) : latestPrice >= (currentAgentPosition.stopLoss ?? Infinity);
        const hitsTarget = currentAgentPosition.side === "BUY" ? latestPrice >= (currentAgentPosition.takeProfit ?? Infinity) : latestPrice <= (currentAgentPosition.takeProfit ?? -Infinity);
        if (hitsStop || hitsTarget || agentTick.current % 5 === 0) closePosition(currentAgentPosition, hitsStop ? "Stop-loss paper atteint." : hitsTarget ? "Objectif paper atteint." : "Réévaluation périodique du signal.");
        return;
      }
      const riskBudget = Math.min(agentAllocation * 0.0025, 25);
      const stopDistance = Math.max(latestPrice * 0.008, 0.0001);
      const qtyByRisk = Math.max(0.0001, Math.min(riskBudget / stopDistance, agentAllocation / latestPrice / 4));
      placeOrder("agent", shortAverage >= longAverage ? "BUY" : "SELL", Number(qtyByRisk.toFixed(4)));
    }, dataMode === "historical" ? 1800 : 6000);
    return () => window.clearInterval(timer);
  }, [agentAllocation, closePosition, dataMode, latestPrice, marketData, mode, placeOrder, positions, sessionActive, sessionPaused, symbol]);

  useEffect(() => {
    for (const position of positions) {
      const currentPrice = priceBySymbol[position.symbol];
      if (!currentPrice) continue;
      const hitsStop = position.stopLoss !== null && (position.side === "BUY" ? currentPrice <= position.stopLoss : currentPrice >= position.stopLoss);
      const hitsTarget = position.takeProfit !== null && (position.side === "BUY" ? currentPrice >= position.takeProfit : currentPrice <= position.takeProfit);
      if (hitsStop || hitsTarget) closePosition(position, hitsStop ? "Stop-loss paper atteint." : "Take-profit paper atteint.");
    }
  }, [closePosition, positions, priceBySymbol]);

  const selectMode = (nextMode: TradingMode) => {
    setMode(nextMode);
    if (nextMode === "replay") setDataMode("historical");
    if (nextMode !== "autonomous") setSessionActive(false);
    persistWallet({ trading_mode: nextMode });
  };

  const startAutonomousSession = () => {
    const sessionId = crypto.randomUUID();
    const seconds = durationSeconds(duration);
    setCurrentSessionId(sessionId);
    setMode("autonomous");
    setRemaining(seconds);
    setSessionPaused(false);
    setSessionActive(true);
    persistWallet({ trading_mode: "autonomous", agent_allocation: agentAllocation });
    if (cloud) {
      void runCloud(() => cloud.client.from("agent_sessions").insert({
        id: sessionId, user_id: cloud.userId, wallet_id: cloud.walletId, trading_mode: "autonomous", data_mode: dataMode,
        duration_seconds: seconds, status: "running", started_at: new Date().toISOString(),
        ends_at: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null,
        starting_equity: equity, max_loss_limit: agentAllocation * 0.02,
        settings: { symbol, interval, risk_per_trade_pct: 0.25 },
      }));
    }
    addLog({ agent: "Chef de portefeuille", action: `Ferme activée — ${durationLabel(duration)}`, reason: `Capital maximal autorisé : ${formatCad(agentAllocation)}. Environnement paper seulement.` });
  };

  const togglePause = () => {
    const nextPaused = !sessionPaused;
    setSessionPaused(nextPaused);
    if (cloud && currentSessionId) void runCloud(() => cloud.client.from("agent_sessions").update({ status: nextPaused ? "paused" : "running", paused_at: nextPaused ? new Date().toISOString() : null }).eq("id", currentSessionId));
  };

  const stopSession = () => {
    setSessionActive(false);
    setMode("manual");
    completeSession("stopped");
    persistWallet({ trading_mode: "manual" });
    addLog({ agent: "Utilisateur", action: "Ferme arrêtée", reason: "Arrêt manuel; aucune nouvelle position ne sera ouverte." });
  };

  const resetWallet = () => {
    setCash(capital);
    setPositions([]);
    setSessionActive(false);
    setMode("manual");
    persistWallet({ initial_capital: capital, cash_balance: capital, agent_allocation: agentAllocation, trading_mode: "manual" });
    if (cloud) void runCloud(() => cloud.client.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), metadata: { reset: true } }).eq("user_id", cloud.userId).eq("status", "open"));
    addLog({ agent: "Utilisateur", action: "Portefeuille réinitialisé", reason: `Nouveau capital paper : ${formatCad(capital)}.` });
  };

  const marketRows = useMemo(() => MARKETS.map((market) => ({ name: market.name, open: marketStatus(market, now) })), [now]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">FERME DE TRADERS IA · PAPER SEULEMENT</p><h1>QuantFarm AI</h1><p className="subtitle">Terminal manuel, assisté, autonome et entraînement historique.</p></div>
        <div className="header-actions">
          {cloud && <div className="cloud-badge"><span>{syncState === "saving" ? "Sauvegarde…" : syncState === "error" ? "Erreur de sauvegarde" : "Supabase synchronisé"}</span><strong>{cloud.email}</strong></div>}
          {onSignOut && <button className="secondary-button" onClick={() => void onSignOut()}>Déconnexion</button>}
          <div className="clock-card"><span>Heure de l’Alberta</span><strong>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now)}</strong><small>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", dateStyle: "full" }).format(now)}</small></div>
        </div>
      </header>

      <section className="mode-strip" aria-label="Modes de trading">{(Object.keys(MODE_INFO) as TradingMode[]).map((key) => <button key={key} className={mode === key ? "mode-button active" : "mode-button"} onClick={() => selectMode(key)}><strong>{MODE_INFO[key].label}</strong><span>{MODE_INFO[key].description}</span></button>)}</section>

      <section className="stats-grid">
        <article className="stat-card"><span>Capital paper</span><strong>{formatCad(capital)}</strong><small>Modifiable dans les paramètres</small></article>
        <article className="stat-card"><span>Encaisse disponible</span><strong>{formatCad(cash)}</strong><small>Positions exclues</small></article>
        <article className="stat-card"><span>Valeur du portefeuille</span><strong>{formatCad(equity)}</strong><small className={unrealizedPnl >= 0 ? "positive" : "negative"}>{unrealizedPnl >= 0 ? "+" : ""}{formatCad(unrealizedPnl)} non réalisé</small></article>
        <article className="stat-card accent"><span>Allocation agents</span><strong>{formatCad(agentAllocation)}</strong><small>{formatCad(allocatedExposure)} actuellement utilisé</small></article>
      </section>

      <section className="workspace-grid">
        <div className="main-column">
          <article className="panel chart-panel">
            <div className="panel-header chart-header"><div><div className="symbol-line"><select value={symbol} onChange={(event) => setSymbol(event.target.value)} aria-label="Instrument">{SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.label}</option>)}</select><strong>{latestPrice ? formatPrice(latestPrice) : "—"}</strong></div><p>{marketData?.source === "twelve-data" ? "Données Twelve Data" : dataMode === "historical" ? "Replay historique simulé" : "Données simulées cohérentes"}</p></div><div className="chart-tools"><select value={interval} onChange={(event) => setIntervalValue(event.target.value as (typeof INTERVALS)[number])} aria-label="Intervalle">{INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={dataMode} onChange={(event) => setDataMode(event.target.value as DataMode)} aria-label="Source de données"><option value="live">Réel / Twelve Data</option><option value="mock">Fictif</option><option value="historical">Historique</option></select><button className="secondary-button" onClick={() => void loadData()}>Actualiser</button></div></div>
            {marketData?.error && <div className="warning-banner">Twelve Data indisponible : affichage automatique des données fictives. {marketData.error}</div>}
            <div className="chart-wrap">{loading || !marketData ? <div className="chart-loading">Chargement des chandelles…</div> : <CandlestickChart candles={marketData.candles} />}</div>
          </article>

          <article className="panel"><div className="panel-header"><div><p className="eyebrow">PORTEFEUILLE PAPER</p><h2>Positions ouvertes</h2></div><button className="danger-outline" onClick={() => positions.forEach((position) => closePosition(position, "Fermeture totale demandée."))} disabled={!positions.length}>Fermer tout</button></div><div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Origine</th><th>Lot</th><th>Entrée</th><th>Prix</th><th>Profit/perte</th><th></th></tr></thead><tbody>{positions.length === 0 ? <tr><td colSpan={7} className="empty-cell">Aucune position ouverte.</td></tr> : positions.map((position) => { const positionPrice = markedPrice(position); const pnl = positionPnl(position, positionPrice); return <tr key={position.id}><td><strong>{position.symbol}</strong><br/><small>{position.side}</small></td><td>{position.origin === "agent" ? "Agent IA" : position.origin === "assisted" ? "Assisté" : "Manuel"}</td><td>{position.quantity}</td><td>{formatPrice(position.entryPrice)}</td><td>{formatPrice(positionPrice)}</td><td className={pnl >= 0 ? "positive" : "negative"}>{formatCad(pnl)}</td><td><button className="table-button" onClick={() => closePosition(position)}>Fermer</button></td></tr>; })}</tbody></table></div></article>
        </div>

        <aside className="side-column">
          <article className="panel control-panel"><p className="eyebrow">ORDRE PAPER</p><h2>{mode === "assisted" ? "Proposition à approuver" : "Placement manuel"}</h2><div className="segmented"><button className={orderSide === "BUY" ? "buy active" : "buy"} onClick={() => setOrderSide("BUY")}>ACHETER</button><button className={orderSide === "SELL" ? "sell active" : "sell"} onClick={() => setOrderSide("SELL")}>VENDRE</button></div><label>Quantité / lots<input type="number" min="0.0001" step="0.1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><div className="two-fields"><label>Stop-loss<input type="number" step="0.0001" value={stopLoss || ""} placeholder="Automatique" onChange={(event) => setStopLoss(Number(event.target.value))} /></label><label>Take-profit<input type="number" step="0.0001" value={takeProfit || ""} placeholder="Automatique" onChange={(event) => setTakeProfit(Number(event.target.value))} /></label></div><div className="order-summary"><span>Valeur estimée</span><strong>{formatCad(latestPrice * quantity)}</strong></div><button className="primary-button" onClick={() => placeOrder(mode === "assisted" ? "assisted" : "manual")} disabled={!latestPrice}>{mode === "assisted" ? "Approuver la proposition" : "Exécuter l’ordre paper"}</button></article>

          <article className="panel agent-panel"><p className="eyebrow">SESSION AUTONOME</p><h2>Ferme d’agents</h2><div className="duration-grid">{(["10m", "1h", "4h", "unlimited"] as DurationPreset[]).map((value) => <button key={value} className={duration === value ? "duration active" : "duration"} onClick={() => setDuration(value)}>{durationLabel(value)}</button>)}</div><label>Capital autorisé aux agents<div className="money-input"><span>$ CA</span><input type="number" min="100" max={capital} step="100" value={agentAllocation} onChange={(event) => { const value = Math.min(capital, Number(event.target.value)); setAgentAllocation(value); persistWallet({ agent_allocation: value }); }} /></div></label><div className={sessionActive ? "session-display live" : "session-display"}><span>{sessionActive ? sessionPaused ? "SESSION EN PAUSE" : "AGENTS ACTIFS" : "AGENTS ARRÊTÉS"}</span><strong>{formatCountdown(remaining)}</strong></div>{!sessionActive ? <button className="primary-button autonomous" onClick={startAutonomousSession}>Activer la ferme IA</button> : <div className="button-row"><button className="secondary-button" onClick={togglePause}>{sessionPaused ? "Reprendre" : "Pause"}</button><button className="danger-button" onClick={stopSession}>Arrêter</button></div>}<small className="safety-note">Limite initiale : 0,25 % de risque par transaction, allocation maximale verrouillée, aucun ordre réel.</small></article>

          <article className="panel markets-panel"><div className="panel-header"><div><p className="eyebrow">HEURE DE L’ALBERTA</p><h2>Marchés mondiaux</h2></div></div><div className="market-list">{marketRows.map((market) => <div key={market.name}><span className={market.open ? "status-dot open" : "status-dot"}></span><strong>{market.name}</strong><span className={market.open ? "positive" : "muted"}>{market.open ? "OUVERT" : "FERMÉ"}</span></div>)}<div><span className="status-dot open"></span><strong>Crypto</strong><span className="positive">24/7</span></div></div><small>Le calendrier complet des jours fériés et fermetures anticipées sera branché dans la prochaine phase.</small></article>
        </aside>
      </section>

      <section className="bottom-grid">
        <article className="panel log-panel"><div className="panel-header"><div><p className="eyebrow">JOURNAL SUPABASE</p><h2>Décisions et exécutions</h2></div></div><div className="log-list">{logs.length === 0 ? <p className="empty-message">Les décisions des agents et les ordres apparaîtront ici.</p> : logs.map((log) => <div className="log-item" key={log.id}><time>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(log.time))}</time><div><strong>{log.action}</strong><span>{log.agent} — {log.reason}</span></div>{log.result !== undefined && <b className={log.result >= 0 ? "positive" : "negative"}>{formatCad(log.result)}</b>}</div>)}</div></article>
        <article className="panel settings-panel"><p className="eyebrow">PARAMÈTRES PAPER</p><h2>Portefeuille d’essai</h2><label>Capital total<input type="number" min="1000" step="1000" value={capital} onChange={(event) => setCapital(Number(event.target.value))} /></label><button className="secondary-button full" onClick={resetWallet}>Réinitialiser à {formatCad(capital)}</button><div className="security-box"><strong>{cloud ? "Sauvegarde cloud active" : "Protection locale active"}</strong><span>{cloud ? "Portefeuille, positions, sessions et journal sont protégés par RLS dans Supabase." : "La clé Twelve Data reste côté serveur. Aucun courtier réel n’est connecté."}</span></div></article>
      </section>
    </main>
  );
}
