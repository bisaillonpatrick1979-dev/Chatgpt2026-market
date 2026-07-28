"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
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

type MarketDefinition = {
  name: string;
  zone: string;
  open: number;
  close: number;
  weekdaysOnly?: boolean;
};

const MARKETS: MarketDefinition[] = [
  { name: "États-Unis", zone: "America/New_York", open: 9.5, close: 16, weekdaysOnly: true },
  { name: "Canada", zone: "America/Toronto", open: 9.5, close: 16, weekdaysOnly: true },
  { name: "Londres", zone: "Europe/London", open: 8, close: 16.5, weekdaysOnly: true },
  { name: "Europe", zone: "Europe/Paris", open: 9, close: 17.5, weekdaysOnly: true },
  { name: "Japon", zone: "Asia/Tokyo", open: 9, close: 15.5, weekdaysOnly: true },
  { name: "Australie", zone: "Australia/Sydney", open: 10, close: 16, weekdaysOnly: true },
];

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function marketStatus(market: MarketDefinition, now: Date) {
  const parts = zoneParts(now, market.zone);
  const hour = parts.hour + parts.minute / 60;
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  return (!market.weekdaysOnly || !weekend) && hour >= market.open && hour < market.close;
}

function durationSeconds(duration: DurationPreset) {
  if (duration === "10m") return 10 * 60;
  if (duration === "1h") return 60 * 60;
  if (duration === "4h") return 4 * 60 * 60;
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

export function MarketTerminal() {
  const [mode, setMode] = useState<TradingMode>("manual");
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalValue] = useState<(typeof INTERVALS)[number]>("5min");
  const [dataMode, setDataMode] = useState<"live" | "mock" | "historical">("mock");
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [priceBySymbol, setPriceBySymbol] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [capital, setCapital] = useState(100000);
  const [agentAllocation, setAgentAllocation] = useState(10000);
  const [cash, setCash] = useState(100000);
  const [positions, setPositions] = useState<Position[]>([]);
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [duration, setDuration] = useState<DurationPreset>("1h");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(3600);
  const [orderSide, setOrderSide] = useState<OrderSide>("BUY");
  const [quantity, setQuantity] = useState(5);
  const [stopLoss, setStopLoss] = useState(0);
  const [takeProfit, setTakeProfit] = useState(0);
  const [now, setNow] = useState(new Date());
  const agentTick = useRef(0);

  const latestPrice = marketData?.candles.at(-1)?.close ?? 0;
  const markedPrice = (position: Position) => priceBySymbol[position.symbol] ?? position.entryPrice;
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position, markedPrice(position)), 0);
  const equity = cash + positions.reduce((sum, position) => {
    const marketValue = markedPrice(position) * position.quantity;
    return sum + (position.side === "BUY" ? marketValue : -marketValue);
  }, 0);
  const allocatedExposure = positions
    .filter((position) => position.origin === "agent")
    .reduce((sum, position) => sum + position.entryPrice * position.quantity, 0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=180&mode=${dataMode}`,
      );
      const payload = (await response.json()) as MarketDataResponse;
      setMarketData(payload);
      const newest = payload.candles.at(-1)?.close;
      if (newest) setPriceBySymbol((current) => ({ ...current, [payload.symbol]: newest }));
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, dataMode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionActive || sessionPaused || remaining === null) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value === null) return null;
        if (value <= 1) {
          setSessionActive(false);
          setMode("manual");
          setLogs((current) => [
            {
              id: crypto.randomUUID(),
              time: new Date().toISOString(),
              agent: "Contrôleur de session",
              action: "Session terminée",
              reason: "La durée autorisée est écoulée. Les nouvelles entrées sont bloquées.",
            },
            ...current,
          ]);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionActive, sessionPaused, remaining]);

  const addLog = useCallback((log: Omit<TradeLog, "id" | "time">) => {
    setLogs((current) => [
      { id: crypto.randomUUID(), time: new Date().toISOString(), ...log },
      ...current,
    ].slice(0, 50));
  }, []);

  const placeOrder = useCallback((origin: "manual" | "agent", forcedSide?: OrderSide, forcedQuantity?: number) => {
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

    const position: Position = {
      id: crypto.randomUUID(),
      symbol,
      side,
      quantity: qty,
      entryPrice: latestPrice,
      stopLoss: stopLoss > 0 ? stopLoss : side === "BUY" ? latestPrice * 0.992 : latestPrice * 1.008,
      takeProfit: takeProfit > 0 ? takeProfit : side === "BUY" ? latestPrice * 1.016 : latestPrice * 0.984,
      openedAt: new Date().toISOString(),
      origin,
    };
    setPositions((current) => [position, ...current]);
    setCash((value) => side === "BUY" ? value - requiredCash : value + requiredCash);
    addLog({
      agent: origin === "agent" ? "Agent exécution" : "Utilisateur",
      action: `${side === "BUY" ? "Achat" : "Vente"} ${qty} ${symbol}`,
      reason: origin === "agent" ? "Signal approuvé par le moteur de risque." : "Ordre manuel paper.",
    });
    return true;
  }, [addLog, agentAllocation, allocatedExposure, cash, latestPrice, orderSide, quantity, stopLoss, symbol, takeProfit]);

  const closePosition = useCallback((position: Position, reason = "Fermeture manuelle") => {
    const exitPrice = priceBySymbol[position.symbol] ?? position.entryPrice;
    const pnl = positionPnl(position, exitPrice);
    const cashFlow = exitPrice * position.quantity;
    setCash((value) => position.side === "BUY" ? value + cashFlow : value - cashFlow);
    setPositions((current) => current.filter((item) => item.id !== position.id));
    addLog({
      agent: position.origin === "agent" ? "Agent exécution" : "Utilisateur",
      action: `Fermeture ${position.symbol}`,
      reason,
      result: pnl,
    });
  }, [addLog, priceBySymbol]);

  useEffect(() => {
    if (!sessionActive || sessionPaused || mode !== "autonomous" || !marketData || !latestPrice) return;
    const timer = window.setInterval(() => {
      agentTick.current += 1;
      const candles = marketData.candles;
      const recent = candles.slice(-12);
      const shortAverage = recent.slice(-4).reduce((sum, candle) => sum + candle.close, 0) / 4;
      const longAverage = recent.reduce((sum, candle) => sum + candle.close, 0) / recent.length;
      const currentAgentPosition = positions.find((position) => position.origin === "agent" && position.symbol === symbol);

      if (currentAgentPosition) {
        const hitsStop = currentAgentPosition.side === "BUY"
          ? latestPrice <= (currentAgentPosition.stopLoss ?? -Infinity)
          : latestPrice >= (currentAgentPosition.stopLoss ?? Infinity);
        const hitsTarget = currentAgentPosition.side === "BUY"
          ? latestPrice >= (currentAgentPosition.takeProfit ?? Infinity)
          : latestPrice <= (currentAgentPosition.takeProfit ?? -Infinity);
        if (hitsStop || hitsTarget || agentTick.current % 5 === 0) {
          closePosition(currentAgentPosition, hitsStop ? "Stop-loss paper atteint." : hitsTarget ? "Objectif paper atteint." : "Réévaluation périodique du signal.");
        }
        return;
      }

      const riskBudget = Math.min(agentAllocation * 0.0025, 25);
      const stopDistance = Math.max(latestPrice * 0.008, 0.0001);
      const qtyByRisk = Math.max(0.0001, Math.min(riskBudget / stopDistance, agentAllocation / latestPrice / 4));
      const side: OrderSide = shortAverage >= longAverage ? "BUY" : "SELL";
      placeOrder("agent", side, Number(qtyByRisk.toFixed(4)));
    }, dataMode === "historical" ? 1800 : 6000);
    return () => window.clearInterval(timer);
  }, [agentAllocation, closePosition, dataMode, latestPrice, marketData, mode, placeOrder, positions, sessionActive, sessionPaused, symbol]);

  useEffect(() => {
    if (!positions.length) return;
    for (const position of positions) {
      const currentPrice = priceBySymbol[position.symbol];
      if (!currentPrice) continue;
      const stop = position.stopLoss;
      const target = position.takeProfit;
      const hitsStop = stop !== null && (position.side === "BUY" ? currentPrice <= stop : currentPrice >= stop);
      const hitsTarget = target !== null && (position.side === "BUY" ? currentPrice >= target : currentPrice <= target);
      if (hitsStop || hitsTarget) closePosition(position, hitsStop ? "Stop-loss paper atteint." : "Take-profit paper atteint.");
    }
  }, [closePosition, positions, priceBySymbol]);

  const startAutonomousSession = () => {
    setMode("autonomous");
    setRemaining(durationSeconds(duration));
    setSessionPaused(false);
    setSessionActive(true);
    addLog({
      agent: "Chef de portefeuille",
      action: `Ferme activée — ${durationLabel(duration)}`,
      reason: `Capital maximal autorisé : ${formatCad(agentAllocation)}. Environnement paper seulement.`,
    });
  };

  const resetWallet = () => {
    setCash(capital);
    setPositions([]);
    setLogs([]);
    setSessionActive(false);
    setMode("manual");
  };

  const marketRows = useMemo(() => MARKETS.map((market) => ({
    name: market.name,
    open: marketStatus(market, now),
  })), [now]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FERME DE TRADERS IA · PAPER SEULEMENT</p>
          <h1>QuantFarm AI</h1>
          <p className="subtitle">Terminal manuel, assisté, autonome et entraînement historique.</p>
        </div>
        <div className="clock-card">
          <span>Heure de l’Alberta</span>
          <strong>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now)}</strong>
          <small>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", dateStyle: "full" }).format(now)}</small>
        </div>
      </header>

      <section className="mode-strip" aria-label="Modes de trading">
        {(Object.keys(MODE_INFO) as TradingMode[]).map((key) => (
          <button key={key} className={mode === key ? "mode-button active" : "mode-button"} onClick={() => {
            setMode(key);
            if (key === "replay") setDataMode("historical");
            if (key !== "autonomous") setSessionActive(false);
          }}>
            <strong>{MODE_INFO[key].label}</strong>
            <span>{MODE_INFO[key].description}</span>
          </button>
        ))}
      </section>

      <section className="stats-grid">
        <article className="stat-card"><span>Capital paper</span><strong>{formatCad(capital)}</strong><small>Modifiable dans les paramètres</small></article>
        <article className="stat-card"><span>Encaisse disponible</span><strong>{formatCad(cash)}</strong><small>Positions exclues</small></article>
        <article className="stat-card"><span>Valeur du portefeuille</span><strong>{formatCad(equity)}</strong><small className={unrealizedPnl >= 0 ? "positive" : "negative"}>{unrealizedPnl >= 0 ? "+" : ""}{formatCad(unrealizedPnl)} non réalisé</small></article>
        <article className="stat-card accent"><span>Allocation agents</span><strong>{formatCad(agentAllocation)}</strong><small>{formatCad(allocatedExposure)} actuellement utilisé</small></article>
      </section>

      <section className="workspace-grid">
        <div className="main-column">
          <article className="panel chart-panel">
            <div className="panel-header chart-header">
              <div>
                <div className="symbol-line">
                  <select value={symbol} onChange={(event) => setSymbol(event.target.value)} aria-label="Instrument">
                    {SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.label}</option>)}
                  </select>
                  <strong>{latestPrice ? formatPrice(latestPrice) : "—"}</strong>
                </div>
                <p>{marketData?.source === "twelve-data" ? "Données Twelve Data" : dataMode === "historical" ? "Replay historique simulé" : "Données simulées cohérentes"}</p>
              </div>
              <div className="chart-tools">
                <select value={interval} onChange={(event) => setIntervalValue(event.target.value as (typeof INTERVALS)[number])} aria-label="Intervalle">
                  {INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={dataMode} onChange={(event) => setDataMode(event.target.value as "live" | "mock" | "historical")} aria-label="Source de données">
                  <option value="live">Réel / Twelve Data</option>
                  <option value="mock">Fictif</option>
                  <option value="historical">Historique</option>
                </select>
                <button className="secondary-button" onClick={() => void loadData()}>Actualiser</button>
              </div>
            </div>
            {marketData?.error && <div className="warning-banner">Twelve Data indisponible : affichage automatique des données fictives. {marketData.error}</div>}
            <div className="chart-wrap">
              {loading || !marketData ? <div className="chart-loading">Chargement des chandelles…</div> : <CandlestickChart candles={marketData.candles} />}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header"><div><p className="eyebrow">PORTEFEUILLE PAPER</p><h2>Positions ouvertes</h2></div><button className="danger-outline" onClick={() => positions.forEach((position) => closePosition(position, "Fermeture totale demandée."))} disabled={!positions.length}>Fermer tout</button></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Instrument</th><th>Origine</th><th>Lot</th><th>Entrée</th><th>Prix</th><th>Profit/perte</th><th></th></tr></thead>
                <tbody>
                  {positions.length === 0 ? <tr><td colSpan={7} className="empty-cell">Aucune position ouverte.</td></tr> : positions.map((position) => {
                    const positionPrice = markedPrice(position);
                    const pnl = positionPnl(position, positionPrice);
                    return <tr key={position.id}><td><strong>{position.symbol}</strong><br/><small>{position.side}</small></td><td>{position.origin === "agent" ? "Agent IA" : "Manuel"}</td><td>{position.quantity}</td><td>{formatPrice(position.entryPrice)}</td><td>{formatPrice(positionPrice)}</td><td className={pnl >= 0 ? "positive" : "negative"}>{formatCad(pnl)}</td><td><button className="table-button" onClick={() => closePosition(position)}>Fermer</button></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <aside className="side-column">
          <article className="panel control-panel">
            <p className="eyebrow">ORDRE PAPER</p>
            <h2>{mode === "assisted" ? "Proposition à approuver" : "Placement manuel"}</h2>
            <div className="segmented">
              <button className={orderSide === "BUY" ? "buy active" : "buy"} onClick={() => setOrderSide("BUY")}>ACHETER</button>
              <button className={orderSide === "SELL" ? "sell active" : "sell"} onClick={() => setOrderSide("SELL")}>VENDRE</button>
            </div>
            <label>Quantité / lots<input type="number" min="0.0001" step="0.1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            <div className="two-fields">
              <label>Stop-loss<input type="number" step="0.0001" value={stopLoss || ""} placeholder="Automatique" onChange={(event) => setStopLoss(Number(event.target.value))} /></label>
              <label>Take-profit<input type="number" step="0.0001" value={takeProfit || ""} placeholder="Automatique" onChange={(event) => setTakeProfit(Number(event.target.value))} /></label>
            </div>
            <div className="order-summary"><span>Valeur estimée</span><strong>{formatCad(latestPrice * quantity)}</strong></div>
            <button className="primary-button" onClick={() => placeOrder("manual")} disabled={!latestPrice}>{mode === "assisted" ? "Approuver la proposition" : "Exécuter l’ordre paper"}</button>
          </article>

          <article className="panel agent-panel">
            <p className="eyebrow">SESSION AUTONOME</p>
            <h2>Ferme d’agents</h2>
            <div className="duration-grid">
              {(["10m", "1h", "4h", "unlimited"] as DurationPreset[]).map((value) => <button key={value} className={duration === value ? "duration active" : "duration"} onClick={() => setDuration(value)}>{durationLabel(value)}</button>)}
            </div>
            <label>Capital autorisé aux agents
              <div className="money-input"><span>$ CA</span><input type="number" min="100" max={capital} step="100" value={agentAllocation} onChange={(event) => setAgentAllocation(Math.min(capital, Number(event.target.value)))} /></div>
            </label>
            <div className={sessionActive ? "session-display live" : "session-display"}>
              <span>{sessionActive ? sessionPaused ? "SESSION EN PAUSE" : "AGENTS ACTIFS" : "AGENTS ARRÊTÉS"}</span>
              <strong>{formatCountdown(remaining)}</strong>
            </div>
            {!sessionActive ? <button className="primary-button autonomous" onClick={startAutonomousSession}>Activer la ferme IA</button> : <div className="button-row"><button className="secondary-button" onClick={() => setSessionPaused((value) => !value)}>{sessionPaused ? "Reprendre" : "Pause"}</button><button className="danger-button" onClick={() => { setSessionActive(false); setMode("manual"); addLog({ agent: "Utilisateur", action: "Ferme arrêtée", reason: "Arrêt manuel; aucune nouvelle position ne sera ouverte." }); }}>Arrêter</button></div>}
            <small className="safety-note">Limite initiale : 0,25 % de risque par transaction, allocation maximale verrouillée, aucun ordre réel.</small>
          </article>

          <article className="panel markets-panel">
            <div className="panel-header"><div><p className="eyebrow">HEURE DE L’ALBERTA</p><h2>Marchés mondiaux</h2></div></div>
            <div className="market-list">
              {marketRows.map((market) => <div key={market.name}><span className={market.open ? "status-dot open" : "status-dot"}></span><strong>{market.name}</strong><span className={market.open ? "positive" : "muted"}>{market.open ? "OUVERT" : "FERMÉ"}</span></div>)}
              <div><span className="status-dot open"></span><strong>Crypto</strong><span className="positive">24/7</span></div>
            </div>
            <small>Le calendrier complet des jours fériés et fermetures anticipées sera branché dans la prochaine phase.</small>
          </article>
        </aside>
      </section>

      <section className="bottom-grid">
        <article className="panel log-panel">
          <div className="panel-header"><div><p className="eyebrow">JOURNAL IMMUTABLE</p><h2>Décisions et exécutions</h2></div></div>
          <div className="log-list">
            {logs.length === 0 ? <p className="empty-message">Les décisions des agents et les ordres apparaîtront ici.</p> : logs.map((log) => <div className="log-item" key={log.id}><time>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(log.time))}</time><div><strong>{log.action}</strong><span>{log.agent} — {log.reason}</span></div>{log.result !== undefined && <b className={log.result >= 0 ? "positive" : "negative"}>{formatCad(log.result)}</b>}</div>)}
          </div>
        </article>

        <article className="panel settings-panel">
          <p className="eyebrow">PARAMÈTRES PAPER</p>
          <h2>Portefeuille d’essai</h2>
          <label>Capital total<input type="number" min="1000" step="1000" value={capital} onChange={(event) => setCapital(Number(event.target.value))} /></label>
          <button className="secondary-button full" onClick={resetWallet}>Réinitialiser à {formatCad(capital)}</button>
          <div className="security-box"><strong>Protection active</strong><span>La clé Twelve Data reste côté serveur. Ce MVP ne contient aucun connecteur de courtier réel.</span></div>
        </article>
      </section>
    </main>
  );
}
