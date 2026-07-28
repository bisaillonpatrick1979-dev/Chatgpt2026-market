"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
import type { CloudContext, RiskSettings } from "@/lib/cloud";
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
type AppView = "terminal" | "agents" | "settings";
type DataMode = "live" | "mock" | "historical";
type Provider = "twelve_data" | "alpaca" | "oanda" | "polygon" | "ibkr";
type ConnectionEnvironment = "data" | "paper" | "practice";
type PositionOrigin = "manual" | "assisted" | "agent";

type MarketSession = { open: number; close: number };
type MarketDefinition = {
  id: string;
  name: string;
  zone: string;
  sessions: MarketSession[];
  kind?: "exchange" | "forex" | "crypto";
};

type IntegrationConnection = {
  id: string;
  provider: Provider;
  environment: ConnectionEnvironment;
  label: string | null;
  account_reference: string | null;
  status: "not_tested" | "connected" | "error" | "disabled";
  last_tested_at: string | null;
  last_error: string | null;
};

type TradeProposal = {
  side: OrderSide;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
};

type ProviderDefinition = {
  id: Provider;
  label: string;
  environment: ConnectionEnvironment;
  description: string;
  fields: Array<{ key: string; label: string; type?: "password" | "text" }>;
};

type Props = {
  cloud: CloudContext;
  onSignOut: () => void | Promise<unknown>;
};

const DEFAULT_RISK_SETTINGS: RiskSettings = {
  riskPerTradePct: 0.25,
  maxDailyLossPct: 2,
  maxPositions: 5,
  minAgentConfidence: 0.55,
  closeAgentsAtEnd: true,
  blockClosedMarkets: true,
};

const MARKETS: MarketDefinition[] = [
  { id: "us", name: "États-Unis · NYSE/Nasdaq", zone: "America/New_York", sessions: [{ open: 9.5, close: 16 }] },
  { id: "ca", name: "Canada · TSX", zone: "America/Toronto", sessions: [{ open: 9.5, close: 16 }] },
  { id: "uk", name: "Royaume-Uni · Londres", zone: "Europe/London", sessions: [{ open: 8, close: 16.5 }] },
  { id: "eu", name: "Europe · Euronext", zone: "Europe/Paris", sessions: [{ open: 9, close: 17.5 }] },
  { id: "jp", name: "Japon · Tokyo", zone: "Asia/Tokyo", sessions: [{ open: 9, close: 11.5 }, { open: 12.5, close: 15.5 }] },
  { id: "au", name: "Australie · ASX", zone: "Australia/Sydney", sessions: [{ open: 10, close: 16 }] },
  { id: "fx", name: "Forex mondial", zone: "America/New_York", sessions: [], kind: "forex" },
  { id: "crypto", name: "Crypto", zone: "UTC", sessions: [], kind: "crypto" },
];

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "twelve_data",
    label: "Twelve Data",
    environment: "data",
    description: "Chandelles et prix de marché. La clé enregistrée alimente le graphique réel.",
    fields: [{ key: "apiKey", label: "Clé API", type: "password" }],
  },
  {
    id: "polygon",
    label: "Polygon",
    environment: "data",
    description: "Source de données additionnelle pour actions et agrégats.",
    fields: [{ key: "apiKey", label: "Clé API", type: "password" }],
  },
  {
    id: "alpaca",
    label: "Alpaca Paper",
    environment: "paper",
    description: "Compte de courtage simulé. Les connexions réelles demeurent verrouillées.",
    fields: [
      { key: "apiKey", label: "Paper API Key", type: "password" },
      { key: "secretKey", label: "Paper Secret Key", type: "password" },
    ],
  },
  {
    id: "oanda",
    label: "OANDA Practice",
    environment: "practice",
    description: "Compte Forex d’entraînement seulement.",
    fields: [
      { key: "token", label: "Jeton Practice", type: "password" },
      { key: "accountId", label: "Identifiant du compte", type: "text" },
    ],
  },
  {
    id: "ibkr",
    label: "Interactive Brokers Paper",
    environment: "paper",
    description: "Préparation IBKR. L’exécution exige Client Portal Gateway ou OAuth.",
    fields: [{ key: "accountId", label: "Identifiant du compte paper", type: "text" }],
  },
];

const AGENTS = [
  ["Chef de portefeuille", "Arbitre les signaux et l’allocation globale."],
  ["Régime de marché", "Classe tendance, range et volatilité."],
  ["Agent tendance", "Compare les moyennes et la force du mouvement."],
  ["Retour à la moyenne", "Détecte les écarts excessifs; aucun ordre sans validation."],
  ["Moteur de risque", "Peut refuser tout ordre et appliquer le kill switch."],
  ["Agent exécution", "Crée uniquement des ordres paper après validation."],
] as const;

const MODE_INFO: Record<TradingMode, { label: string; description: string }> = {
  manual: { label: "Manuel", description: "Tu places et fermes chaque lot." },
  assisted: { label: "Assisté", description: "Les agents proposent; tu approuves." },
  autonomous: { label: "Autonome", description: "Les agents gèrent le portefeuille paper." },
  replay: { label: "Replay", description: "Entraînement accéléré sur données historiques." },
};

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

function timeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function localWallTimeToDate(year: number, month: number, day: number, decimalHour: number, zone: string) {
  const hour = Math.floor(decimalHour);
  const minute = Math.round((decimalHour - hour) * 60);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const actual = timeParts(new Date(guess), zone);
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0);
    guess += desired - actualWall;
  }
  return new Date(guess);
}

function formatDecimalHour(value: number) {
  const hour = Math.floor(value);
  const minute = Math.round((value - hour) * 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isForexOpen(now: Date) {
  const ny = timeParts(now, "America/New_York");
  const decimal = ny.hour + ny.minute / 60;
  if (ny.weekday === "Sat") return false;
  if (ny.weekday === "Sun") return decimal >= 17;
  if (ny.weekday === "Fri") return decimal < 17;
  return true;
}

function marketStatus(market: MarketDefinition, now: Date) {
  if (market.kind === "crypto") return true;
  if (market.kind === "forex") return isForexOpen(now);
  const local = timeParts(now, market.zone);
  if (local.weekday === "Sat" || local.weekday === "Sun") return false;
  const decimal = local.hour + local.minute / 60;
  return market.sessions.some((session) => decimal >= session.open && decimal < session.close);
}

function marketSchedule(market: MarketDefinition, now: Date) {
  if (market.kind === "crypto") return { local: "24/7", alberta: "24/7" };
  if (market.kind === "forex") return { local: "Dim. 17:00 → ven. 17:00 New York", alberta: "Ouvert 24 h sur 5" };
  const local = timeParts(now, market.zone);
  const localText = market.sessions.map((session) => `${formatDecimalHour(session.open)}–${formatDecimalHour(session.close)}`).join(" / ");
  const albertaText = market.sessions.map((session) => {
    const start = localWallTimeToDate(local.year, local.month, local.day, session.open, market.zone);
    const end = localWallTimeToDate(local.year, local.month, local.day, session.close, market.zone);
    const formatter = new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return `${formatter.format(start)}–${formatter.format(end)}`;
  }).join(" / ");
  return { local: `${localText} local`, alberta: `${albertaText} Alberta` };
}

function analyzeCandles(data: MarketDataResponse | null, allocation: number, riskPct: number): TradeProposal | null {
  if (!data || data.candles.length < 20) return null;
  const candles = data.candles;
  const latest = candles.at(-1)?.close || 0;
  if (!latest) return null;
  const recent5 = candles.slice(-5);
  const recent20 = candles.slice(-20);
  const shortAverage = recent5.reduce((sum, candle) => sum + candle.close, 0) / recent5.length;
  const longAverage = recent20.reduce((sum, candle) => sum + candle.close, 0) / recent20.length;
  const atr = recent20.slice(-14).reduce((sum, candle) => sum + Math.max(candle.high - candle.low, 0.0001), 0) / 14;
  const normalizedSpread = Math.abs(shortAverage - longAverage) / Math.max(atr, latest * 0.001);
  const confidence = Math.min(0.99, 0.45 + normalizedSpread * 0.18);
  const side: OrderSide = shortAverage >= longAverage ? "BUY" : "SELL";
  const stopDistance = Math.max(atr * 1.5, latest * 0.006, 0.0001);
  const riskBudget = Math.max(1, allocation * (riskPct / 100));
  const quantity = Math.max(0.0001, Math.min(riskBudget / stopDistance, allocation / latest / 4));
  const stopLoss = side === "BUY" ? latest - stopDistance : latest + stopDistance;
  const takeProfit = side === "BUY" ? latest + stopDistance * 2 : latest - stopDistance * 2;
  return {
    side,
    quantity: Number(quantity.toFixed(4)),
    stopLoss,
    takeProfit,
    confidence,
    reason: `Moyenne 5 périodes ${side === "BUY" ? "au-dessus" : "sous"} la moyenne 20; ATR ${formatPrice(atr)}; confiance ${(confidence * 100).toFixed(0)} %.`,
  };
}

function providerConnectionKey(provider: Provider, environment: ConnectionEnvironment) {
  return `${provider}:${environment}`;
}

export function MarketTerminal({ cloud, onSignOut }: Props) {
  const [view, setView] = useState<AppView>("terminal");
  const [mode, setModeState] = useState<TradingMode>(cloud.mode);
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalValue] = useState<(typeof INTERVALS)[number]>("5min");
  const [dataMode, setDataMode] = useState<DataMode>("mock");
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [priceBySymbol, setPriceBySymbol] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [capital, setCapital] = useState(cloud.capital);
  const [agentAllocation, setAgentAllocation] = useState(cloud.agentAllocation);
  const [cash, setCash] = useState(cloud.cash);
  const [positions, setPositions] = useState<Position[]>(cloud.positions);
  const [logs, setLogs] = useState<TradeLog[]>(cloud.logs);
  const [duration, setDuration] = useState<DurationPreset>("1h");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(3600);
  const [orderSide, setOrderSide] = useState<OrderSide>("BUY");
  const [quantityText, setQuantityText] = useState("5");
  const [stopLossText, setStopLossText] = useState("");
  const [takeProfitText, setTakeProfitText] = useState("");
  const [now, setNow] = useState(new Date());
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [killSwitch, setKillSwitch] = useState(Boolean(cloud.killSwitch));
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({ ...DEFAULT_RISK_SETTINGS, ...cloud.riskSettings });
  const [sessionRealizedPnl, setSessionRealizedPnl] = useState(0);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connectionForms, setConnectionForms] = useState<Record<string, Record<string, string>>>({});
  const [connectionMessage, setConnectionMessage] = useState<Record<string, string>>({});
  const [busyConnection, setBusyConnection] = useState<string | null>(null);
  const [appMessage, setAppMessage] = useState("");
  const agentTick = useRef(0);
  const sessionId = useRef<string | null>(null);
  const closingIds = useRef(new Set<string>());
  const cashRef = useRef(cloud.cash);

  const quantity = Math.max(0, Number(quantityText) || 0);
  const stopLoss = Number(stopLossText) || 0;
  const takeProfit = Number(takeProfitText) || 0;
  const latestPrice = marketData?.candles.at(-1)?.close ?? 0;
  const markedPrice = useCallback((position: Position) => priceBySymbol[position.symbol] ?? position.entryPrice, [priceBySymbol]);
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position, markedPrice(position)), 0);
  const equity = cash + positions.reduce((sum, position) => {
    const marketValue = markedPrice(position) * position.quantity;
    return sum + (position.side === "BUY" ? marketValue : -marketValue);
  }, 0);
  const drawdownPct = capital > 0 ? Math.max(0, ((capital - equity) / capital) * 100) : 0;
  const allocatedExposure = positions
    .filter((position) => position.origin === "agent")
    .reduce((sum, position) => sum + Math.abs(position.entryPrice * position.quantity), 0);

  const connectionMap = useMemo(() => new Map(connections.map((connection) => [providerConnectionKey(connection.provider, connection.environment), connection])), [connections]);

  const marketRows = useMemo(() => MARKETS.map((market) => {
    const schedule = marketSchedule(market, now);
    return {
      ...market,
      open: marketStatus(market, now),
      localTime: new Intl.DateTimeFormat("fr-CA", { timeZone: market.zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now),
      schedule,
    };
  }), [now]);

  const currentInstrumentMarketOpen = useMemo(() => {
    if (symbol.includes("BTC")) return true;
    if (symbol.includes("/")) return isForexOpen(now);
    const target = symbol === "SHOP" ? MARKETS[1] : MARKETS[0];
    return marketStatus(target, now);
  }, [now, symbol]);

  const persistWallet = useCallback(async (patch: Record<string, unknown>) => {
    const { error } = await cloud.client
      .from("paper_wallets")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", cloud.walletId)
      .eq("user_id", cloud.userId);
    if (error) setAppMessage(`Sauvegarde du portefeuille impossible : ${error.message}`);
  }, [cloud.client, cloud.userId, cloud.walletId]);

  const addLog = useCallback(async (entry: Omit<TradeLog, "id" | "time"> & { payload?: Record<string, unknown> }) => {
    const localLog: TradeLog = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      agent: entry.agent,
      action: entry.action,
      reason: entry.reason,
      result: entry.result,
    };
    setLogs((current) => [localLog, ...current].slice(0, 100));
    const { error } = await cloud.client.from("trade_logs").insert({
      id: localLog.id,
      user_id: cloud.userId,
      wallet_id: cloud.walletId,
      session_id: sessionId.current,
      agent_name: entry.agent,
      action: entry.action,
      reason: entry.reason,
      result: entry.result ?? null,
      payload: entry.payload || {},
      created_at: localLog.time,
    });
    if (error) setAppMessage(`Journal non sauvegardé : ${error.message}`);
    return localLog;
  }, [cloud.client, cloud.userId, cloud.walletId]);

  const setMode = useCallback((nextMode: TradingMode) => {
    setModeState(nextMode);
    if (nextMode === "replay") setDataMode("historical");
    void persistWallet({ trading_mode: nextMode });
  }, [persistWallet]);

  const refreshConnections = useCallback(async () => {
    const { data, error } = await cloud.client
      .from("integration_connections")
      .select("id,provider,environment,label,account_reference,status,last_tested_at,last_error")
      .eq("user_id", cloud.userId)
      .order("provider");
    if (error) {
      setAppMessage(`Connexions impossibles à charger : ${error.message}`);
      return;
    }
    setConnections((data || []) as IntegrationConnection[]);
  }, [cloud.client, cloud.userId]);

  useEffect(() => { void refreshConnections(); }, [refreshConnections]);
  useEffect(() => { cashRef.current = cash; }, [cash]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setAppMessage("");
    try {
      let payload: MarketDataResponse;
      const twelveConnection = connectionMap.get(providerConnectionKey("twelve_data", "data"));
      if (dataMode === "live" && twelveConnection) {
        const { data, error } = await cloud.client.functions.invoke("integration-manager", {
          body: { action: "market_data", provider: "twelve_data", environment: "data", symbol, interval, outputsize: 180 },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Source sécurisée indisponible.");
        payload = data as MarketDataResponse;
      } else {
        const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=180&mode=${dataMode}`);
        payload = await response.json() as MarketDataResponse;
      }
      setMarketData(payload);
      const newest = payload.candles.at(-1)?.close;
      if (newest) setPriceBySymbol((current) => ({ ...current, [payload.symbol]: newest }));
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : "Erreur de données inconnue.");
      const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=180&mode=mock`);
      const fallback = await response.json() as MarketDataResponse;
      setMarketData({ ...fallback, error: "La source réelle est indisponible; repli sur les données fictives." });
    } finally {
      setLoading(false);
    }
  }, [cloud.client.functions, connectionMap, dataMode, interval, symbol]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionActive || sessionPaused || remaining === null) return;
    const timer = window.setInterval(() => setRemaining((value) => value === null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [remaining, sessionActive, sessionPaused]);

  const closePosition = useCallback(async (position: Position, reason = "Fermeture manuelle") => {
    if (closingIds.current.has(position.id)) return;
    closingIds.current.add(position.id);
    try {
      const exitPrice = markedPrice(position);
      const pnl = positionPnl(position, exitPrice);
      const cashFlow = exitPrice * position.quantity;
      const nextCash = position.side === "BUY" ? cashRef.current + cashFlow : cashRef.current - cashFlow;
      const { error } = await cloud.client
        .from("positions")
        .update({ status: "closed", closed_at: new Date().toISOString(), exit_price: exitPrice, realized_pnl: pnl })
        .eq("id", position.id)
        .eq("user_id", cloud.userId);
      if (error) throw error;
      cashRef.current = nextCash;
      setCash(nextCash);
      setPositions((current) => current.filter((item) => item.id !== position.id));
      setSessionRealizedPnl((value) => value + pnl);
      void persistWallet({ cash_balance: nextCash });
      await addLog({
        agent: position.origin === "agent" ? "Agent exécution" : "Utilisateur",
        action: `Fermeture ${position.symbol}`,
        reason,
        result: pnl,
        payload: { positionId: position.id, exitPrice, origin: position.origin },
      });
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : "Fermeture impossible.");
    } finally {
      closingIds.current.delete(position.id);
    }
  }, [addLog, cloud.client, cloud.userId, markedPrice, persistWallet]);

  const riskRefusal = useCallback(async (reason: string, payload?: Record<string, unknown>) => {
    await addLog({ agent: "Moteur de risque", action: "Ordre refusé", reason, payload });
    setAppMessage(reason);
    return false;
  }, [addLog]);

  const placeOrder = useCallback(async (
    origin: PositionOrigin,
    forcedSide?: OrderSide,
    forcedQuantity?: number,
    forcedStop?: number,
    forcedTarget?: number,
  ) => {
    if (!latestPrice) return riskRefusal("Aucun prix valide n’est disponible.");
    const side = forcedSide ?? orderSide;
    const qty = forcedQuantity ?? quantity;
    if (!Number.isFinite(qty) || qty <= 0) return riskRefusal("La quantité doit être supérieure à zéro.");
    if (killSwitch) return riskRefusal("Le kill switch est actif; seules les fermetures sont permises.");
    if (positions.length >= riskSettings.maxPositions) return riskRefusal(`Maximum de ${riskSettings.maxPositions} positions ouvertes atteint.`);
    if (riskSettings.blockClosedMarkets && dataMode === "live" && !currentInstrumentMarketOpen) return riskRefusal("Le marché régulier de cet instrument est fermé en ce moment.");
    if (drawdownPct >= riskSettings.maxDailyLossPct) return riskRefusal(`Perte maximale de ${riskSettings.maxDailyLossPct.toFixed(2)} % atteinte.`);

    const finalStop = forcedStop && forcedStop > 0 ? forcedStop : stopLoss > 0 ? stopLoss : side === "BUY" ? latestPrice * 0.992 : latestPrice * 1.008;
    const finalTarget = forcedTarget && forcedTarget > 0 ? forcedTarget : takeProfit > 0 ? takeProfit : side === "BUY" ? latestPrice * 1.016 : latestPrice * 0.984;
    const stopOnCorrectSide = side === "BUY" ? finalStop < latestPrice : finalStop > latestPrice;
    const targetOnCorrectSide = side === "BUY" ? finalTarget > latestPrice : finalTarget < latestPrice;
    if (!stopOnCorrectSide || !targetOnCorrectSide) return riskRefusal("Stop-loss ou take-profit placé du mauvais côté du prix.");

    const requiredCash = latestPrice * qty;
    const riskAmount = Math.abs(latestPrice - finalStop) * qty;
    const riskBase = origin === "agent" ? agentAllocation : Math.max(equity, 1);
    const maxRisk = riskBase * (riskSettings.riskPerTradePct / 100);
    if (riskAmount > maxRisk + 0.01) return riskRefusal(`Risque estimé ${formatCad(riskAmount)} supérieur à la limite ${formatCad(maxRisk)}.`);
    if (side === "BUY" && requiredCash > cashRef.current) return riskRefusal("Encaisse paper insuffisante.");
    if (origin === "agent" && allocatedExposure + requiredCash > agentAllocation) return riskRefusal("Allocation maximale des agents atteinte.");

    const orderId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const openedAt = new Date().toISOString();
    const nextCash = side === "BUY" ? cashRef.current - requiredCash : cashRef.current + requiredCash;
    const position: Position = {
      id: positionId,
      symbol,
      side,
      quantity: qty,
      entryPrice: latestPrice,
      stopLoss: finalStop,
      takeProfit: finalTarget,
      openedAt,
      origin,
    };

    const symbolInfo = SYMBOLS.find((item) => item.symbol === symbol);
    const { error: orderError } = await cloud.client.from("orders").insert({
      id: orderId,
      user_id: cloud.userId,
      wallet_id: cloud.walletId,
      session_id: sessionId.current,
      symbol,
      exchange: symbolInfo?.market || null,
      asset_type: symbol.includes("BTC") ? "crypto" : symbol.includes("/") ? "forex" : "equity",
      side,
      order_type: "market",
      quantity: qty,
      stop_price: finalStop,
      average_fill_price: latestPrice,
      status: "filled",
      origin,
      filled_at: openedAt,
      metadata: { dataMode, riskAmount, maxRisk },
    });
    if (orderError) return riskRefusal(`Ordre non sauvegardé : ${orderError.message}`);

    const { error: positionError } = await cloud.client.from("positions").insert({
      id: positionId,
      user_id: cloud.userId,
      wallet_id: cloud.walletId,
      session_id: sessionId.current,
      opening_order_id: orderId,
      symbol,
      exchange: symbolInfo?.market || null,
      asset_type: symbol.includes("BTC") ? "crypto" : symbol.includes("/") ? "forex" : "equity",
      side,
      quantity: qty,
      entry_price: latestPrice,
      stop_loss: finalStop,
      take_profit: finalTarget,
      origin,
      status: "open",
      opened_at: openedAt,
      metadata: { dataMode, riskAmount },
    });
    if (positionError) return riskRefusal(`Position non sauvegardée : ${positionError.message}`);

    setPositions((current) => [position, ...current]);
    cashRef.current = nextCash;
    setCash(nextCash);
    void persistWallet({ cash_balance: nextCash });
    await addLog({
      agent: origin === "agent" ? "Agent exécution" : origin === "assisted" ? "Utilisateur · mode assisté" : "Utilisateur",
      action: `${side === "BUY" ? "Achat" : "Vente"} ${qty} ${symbol}`,
      reason: origin === "agent" ? "Signal validé par le régime de marché et le moteur de risque." : origin === "assisted" ? "Proposition IA approuvée manuellement." : "Ordre manuel paper.",
      payload: { orderId, positionId, side, quantity: qty, entryPrice: latestPrice, stopLoss: finalStop, takeProfit: finalTarget, origin },
    });
    setAppMessage("");
    return true;
  }, [addLog, agentAllocation, allocatedExposure, cloud.client, cloud.userId, cloud.walletId, currentInstrumentMarketOpen, dataMode, drawdownPct, equity, killSwitch, latestPrice, orderSide, persistWallet, positions.length, quantity, riskRefusal, riskSettings, stopLoss, symbol, takeProfit]);

  useEffect(() => {
    if (!positions.length) return;
    for (const position of positions) {
      const currentPrice = priceBySymbol[position.symbol];
      if (!currentPrice) continue;
      const stop = position.stopLoss;
      const target = position.takeProfit;
      const hitsStop = stop !== null && (position.side === "BUY" ? currentPrice <= stop : currentPrice >= stop);
      const hitsTarget = target !== null && (position.side === "BUY" ? currentPrice >= target : currentPrice <= target);
      if (hitsStop || hitsTarget) void closePosition(position, hitsStop ? "Stop-loss paper atteint." : "Take-profit paper atteint.");
    }
  }, [closePosition, positions, priceBySymbol]);

  const finishSession = useCallback(async (status: "completed" | "stopped" = "stopped") => {
    if (!sessionActive && !sessionId.current) return;
    const id = sessionId.current;
    setSessionActive(false);
    setSessionPaused(false);
    setModeState("manual");
    if (id) {
      await cloud.client.from("agent_sessions").update({
        status,
        stopped_at: new Date().toISOString(),
        ending_equity: equity,
      }).eq("id", id).eq("user_id", cloud.userId);
    }
    if (riskSettings.closeAgentsAtEnd) {
      const agentPositions = positions.filter((position) => position.origin === "agent");
      for (const position of agentPositions) await closePosition(position, "Fin de session autonome; fermeture de sécurité.");
    }
    await addLog({
      agent: "Contrôleur de session",
      action: status === "completed" ? "Session terminée" : "Ferme arrêtée",
      reason: status === "completed" ? "La durée autorisée est écoulée; aucune nouvelle entrée n’est permise." : "Arrêt demandé; les nouvelles entrées sont bloquées.",
      payload: { sessionId: id, endingEquity: equity },
    });
    sessionId.current = null;
    void persistWallet({ trading_mode: "manual" });
  }, [addLog, closePosition, cloud.client, cloud.userId, equity, persistWallet, positions, riskSettings.closeAgentsAtEnd, sessionActive]);

  useEffect(() => {
    if (sessionActive && remaining === 0) void finishSession("completed");
  }, [finishSession, remaining, sessionActive]);

  const startAutonomousSession = useCallback(async () => {
    if (killSwitch) {
      setAppMessage("Désactive le kill switch avant de démarrer les agents.");
      return;
    }
    if (drawdownPct >= riskSettings.maxDailyLossPct) {
      setAppMessage("La limite de perte est déjà atteinte.");
      return;
    }
    const seconds = durationSeconds(duration);
    const startedAt = new Date();
    const id = crypto.randomUUID();
    const { error } = await cloud.client.from("agent_sessions").insert({
      id,
      user_id: cloud.userId,
      wallet_id: cloud.walletId,
      trading_mode: "autonomous",
      data_mode: dataMode,
      duration_seconds: seconds,
      status: "running",
      started_at: startedAt.toISOString(),
      ends_at: seconds === null ? null : new Date(startedAt.getTime() + seconds * 1000).toISOString(),
      starting_equity: equity,
      max_loss_limit: riskSettings.maxDailyLossPct,
      settings: riskSettings,
    });
    if (error) {
      setAppMessage(`Session impossible à créer : ${error.message}`);
      return;
    }
    sessionId.current = id;
    setModeState("autonomous");
    setRemaining(seconds);
    setSessionPaused(false);
    setSessionActive(true);
    setSessionRealizedPnl(0);
    void persistWallet({ trading_mode: "autonomous" });
    await addLog({
      agent: "Chef de portefeuille",
      action: `Ferme activée — ${durationLabel(duration)}`,
      reason: `Capital maximal ${formatCad(agentAllocation)}; risque ${riskSettings.riskPerTradePct.toFixed(2)} % par transaction; paper seulement.`,
      payload: { sessionId: id, duration: seconds, riskSettings },
    });
  }, [addLog, agentAllocation, cloud.client, cloud.userId, cloud.walletId, dataMode, drawdownPct, duration, equity, killSwitch, persistWallet, riskSettings]);

  const togglePause = useCallback(async () => {
    const nextPaused = !sessionPaused;
    setSessionPaused(nextPaused);
    if (sessionId.current) {
      await cloud.client.from("agent_sessions").update({
        status: nextPaused ? "paused" : "running",
        paused_at: nextPaused ? new Date().toISOString() : null,
      }).eq("id", sessionId.current).eq("user_id", cloud.userId);
    }
    await addLog({
      agent: "Contrôleur de session",
      action: nextPaused ? "Session en pause" : "Session reprise",
      reason: nextPaused ? "Aucune nouvelle décision ne sera exécutée." : "Les agents peuvent recommencer à analyser.",
    });
  }, [addLog, cloud.client, cloud.userId, sessionPaused]);

  useEffect(() => {
    if (!sessionActive || sessionPaused || mode !== "autonomous" || !marketData || !latestPrice || killSwitch) return;
    const timer = window.setInterval(() => {
      agentTick.current += 1;
      const candidate = analyzeCandles(marketData, agentAllocation, riskSettings.riskPerTradePct);
      if (!candidate) return;
      const currentPosition = positions.find((position) => position.origin === "agent" && position.symbol === symbol);
      if (currentPosition) {
        const reversed = currentPosition.side !== candidate.side && candidate.confidence >= riskSettings.minAgentConfidence;
        if (reversed) void closePosition(currentPosition, "Renversement du signal confirmé par l’agent de régime.");
        return;
      }
      if (candidate.confidence < riskSettings.minAgentConfidence) {
        if (agentTick.current % 5 === 0) void addLog({
          agent: "Régime de marché",
          action: "Aucune transaction",
          reason: `Confiance ${(candidate.confidence * 100).toFixed(0)} % sous le seuil ${(riskSettings.minAgentConfidence * 100).toFixed(0)} %.`,
        });
        return;
      }
      void placeOrder("agent", candidate.side, candidate.quantity, candidate.stopLoss, candidate.takeProfit);
    }, dataMode === "historical" ? 1800 : 7000);
    return () => window.clearInterval(timer);
  }, [addLog, agentAllocation, closePosition, dataMode, killSwitch, latestPrice, marketData, mode, placeOrder, positions, riskSettings.minAgentConfidence, riskSettings.riskPerTradePct, sessionActive, sessionPaused, symbol]);

  const generateProposal = useCallback(async () => {
    const candidate = analyzeCandles(marketData, Math.min(agentAllocation, Math.max(equity, 1)), riskSettings.riskPerTradePct);
    if (!candidate) {
      setAppMessage("Pas assez de chandelles pour produire une proposition.");
      return;
    }
    setProposal(candidate);
    await addLog({ agent: "Chef de portefeuille", action: `Proposition ${candidate.side} ${symbol}`, reason: candidate.reason, payload: candidate });
  }, [addLog, agentAllocation, equity, marketData, riskSettings.riskPerTradePct, symbol]);

  const activateKillSwitch = useCallback(async () => {
    const next = !killSwitch;
    setKillSwitch(next);
    await persistWallet({ kill_switch: next });
    await addLog({
      agent: "Utilisateur",
      action: next ? "KILL SWITCH ACTIVÉ" : "Kill switch désactivé",
      reason: next ? "Toutes les nouvelles entrées sont bloquées immédiatement." : "Les nouvelles entrées redeviennent possibles sous les limites de risque.",
    });
    if (next && sessionActive) await finishSession("stopped");
  }, [addLog, finishSession, killSwitch, persistWallet, sessionActive]);

  const saveRiskSettings = useCallback(async () => {
    const normalized: RiskSettings = {
      riskPerTradePct: Math.min(2, Math.max(0.01, Number(riskSettings.riskPerTradePct) || 0.25)),
      maxDailyLossPct: Math.min(20, Math.max(0.1, Number(riskSettings.maxDailyLossPct) || 2)),
      maxPositions: Math.min(50, Math.max(1, Math.round(Number(riskSettings.maxPositions) || 5))),
      minAgentConfidence: Math.min(0.99, Math.max(0.5, Number(riskSettings.minAgentConfidence) || 0.55)),
      closeAgentsAtEnd: Boolean(riskSettings.closeAgentsAtEnd),
      blockClosedMarkets: Boolean(riskSettings.blockClosedMarkets),
    };
    setRiskSettings(normalized);
    await persistWallet({ risk_settings: normalized });
    await addLog({ agent: "Utilisateur", action: "Limites de risque mises à jour", reason: `Risque ${normalized.riskPerTradePct.toFixed(2)} %, perte max ${normalized.maxDailyLossPct.toFixed(2)} %, ${normalized.maxPositions} positions.` });
    setAppMessage("Paramètres de risque sauvegardés.");
  }, [addLog, persistWallet, riskSettings]);

  const resetWallet = useCallback(async () => {
    if (positions.length) {
      setAppMessage("Ferme les positions avant de réinitialiser le portefeuille.");
      return;
    }
    cashRef.current = capital;
    setCash(capital);
    setSessionRealizedPnl(0);
    await persistWallet({ initial_capital: capital, cash_balance: capital, trading_mode: "manual" });
    await addLog({ agent: "Utilisateur", action: "Portefeuille paper réinitialisé", reason: `Nouvelle encaisse ${formatCad(capital)}. Le journal historique est conservé.` });
    setModeState("manual");
  }, [addLog, capital, persistWallet, positions.length]);

  const updateConnectionForm = (provider: Provider, environment: ConnectionEnvironment, key: string, value: string) => {
    const connectionKey = providerConnectionKey(provider, environment);
    setConnectionForms((current) => ({ ...current, [connectionKey]: { ...(current[connectionKey] || {}), [key]: value } }));
  };

  const invokeConnectionAction = useCallback(async (definition: ProviderDefinition, action: "save" | "test" | "delete") => {
    const key = providerConnectionKey(definition.id, definition.environment);
    setBusyConnection(key);
    setConnectionMessage((current) => ({ ...current, [key]: "" }));
    try {
      const form = connectionForms[key] || {};
      const credentials = Object.fromEntries(definition.fields.map((field) => [field.key, form[field.key] || ""]));
      if (action === "save" && definition.fields.some((field) => !String(credentials[field.key]).trim())) throw new Error("Remplis tous les champs requis.");
      const { data, error } = await cloud.client.functions.invoke("integration-manager", {
        body: {
          action,
          provider: definition.id,
          environment: definition.environment,
          label: definition.label,
          accountReference: form.accountReference || "",
          credentials: action === "save" ? credentials : undefined,
        },
      });
      if (error || data?.error || data?.ok === false) throw new Error(data?.error || data?.message || error?.message || "Opération impossible.");
      const message = action === "save" ? "Clés chiffrées et sauvegardées." : action === "delete" ? "Connexion supprimée." : data?.message || "Connexion validée.";
      setConnectionMessage((current) => ({ ...current, [key]: message }));
      if (action === "save") setConnectionForms((current) => ({ ...current, [key]: {} }));
      await refreshConnections();
    } catch (error) {
      setConnectionMessage((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Erreur inconnue." }));
    } finally {
      setBusyConnection(null);
    }
  }, [cloud.client.functions, connectionForms, refreshConnections]);

  const renderJournal = () => (
    <article className="panel log-panel journal-under-positions">
      <div className="panel-header">
        <div><p className="eyebrow">JOURNAL IMMUTABLE</p><h2>Décisions et exécutions</h2></div>
        <span className="immutable-badge">SHA-256 · APPEND-ONLY</span>
      </div>
      <div className="log-list">
        {logs.length === 0 ? <p className="empty-message">Les décisions des agents et les ordres apparaîtront ici.</p> : logs.map((log) => (
          <div className="log-item" key={log.id}>
            <time>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(log.time))}</time>
            <div><strong>{log.action}</strong><span>{log.agent} — {log.reason}</span></div>
            {log.result !== undefined && <b className={log.result >= 0 ? "positive" : "negative"}>{formatCad(log.result)}</b>}
          </div>
        ))}
      </div>
    </article>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FERME DE TRADERS IA · PAPER SEULEMENT</p>
          <h1>QuantFarm AI</h1>
          <p className="subtitle">Terminal manuel, assisté, autonome et entraînement historique.</p>
        </div>
        <div className="header-actions">
          <button className={killSwitch ? "kill-switch active" : "kill-switch"} onClick={() => void activateKillSwitch()}>{killSwitch ? "KILL SWITCH ACTIF" : "Activer kill switch"}</button>
          <div className="cloud-badge"><span>SUPABASE PRIVÉ</span><strong>{cloud.email}</strong></div>
          <div className="clock-card">
            <span>Heure de l’Alberta</span>
            <strong>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now)}</strong>
            <small>{new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", dateStyle: "full" }).format(now)}</small>
          </div>
          <button className="secondary-button" onClick={() => void onSignOut()}>Déconnexion</button>
        </div>
      </header>

      <nav className="app-tabs" aria-label="Sections">
        <button className={view === "terminal" ? "active" : ""} onClick={() => setView("terminal")}>Terminal</button>
        <button className={view === "agents" ? "active" : ""} onClick={() => setView("agents")}>Agents IA</button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Paramètres & API</button>
      </nav>

      {appMessage && <div className="app-banner">{appMessage}<button onClick={() => setAppMessage("")}>×</button></div>}

      {view === "terminal" && <>
        <section className="mode-strip" aria-label="Modes de trading">
          {(Object.keys(MODE_INFO) as TradingMode[]).map((key) => (
            <button key={key} className={mode === key ? "mode-button active" : "mode-button"} disabled={sessionActive && key !== "autonomous"} onClick={() => setMode(key)}>
              <strong>{MODE_INFO[key].label}</strong><span>{MODE_INFO[key].description}</span>
            </button>
          ))}
        </section>

        <section className="stats-grid">
          <article className="stat-card"><span>Capital paper</span><strong>{formatCad(capital)}</strong><small>Persisté dans Supabase</small></article>
          <article className="stat-card"><span>Encaisse disponible</span><strong>{formatCad(cash)}</strong><small>Positions exclues</small></article>
          <article className="stat-card"><span>Valeur du portefeuille</span><strong>{formatCad(equity)}</strong><small className={unrealizedPnl >= 0 ? "positive" : "negative"}>{unrealizedPnl >= 0 ? "+" : ""}{formatCad(unrealizedPnl)} non réalisé</small></article>
          <article className="stat-card accent"><span>Allocation agents</span><strong>{formatCad(agentAllocation)}</strong><small>{formatCad(allocatedExposure)} utilisé · P/L session {formatCad(sessionRealizedPnl)}</small></article>
        </section>

        <section className="workspace-grid">
          <div className="main-column">
            <article className="panel chart-panel">
              <div className="panel-header chart-header">
                <div>
                  <div className="symbol-line">
                    <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setProposal(null); }} aria-label="Instrument">
                      {SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.label}</option>)}
                    </select>
                    <strong>{latestPrice ? formatPrice(latestPrice) : "—"}</strong>
                    <span className={currentInstrumentMarketOpen ? "market-pill open" : "market-pill"}>{currentInstrumentMarketOpen ? "MARCHÉ OUVERT" : "MARCHÉ FERMÉ"}</span>
                  </div>
                  <p>{marketData?.source === "twelve-data" ? "Données Twelve Data chiffrées côté serveur" : dataMode === "historical" ? "Replay historique simulé" : "Données fictives cohérentes"}</p>
                </div>
                <div className="chart-tools">
                  <select value={interval} onChange={(event) => setIntervalValue(event.target.value as (typeof INTERVALS)[number])} aria-label="Intervalle">
                    {INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <select value={dataMode} onChange={(event) => setDataMode(event.target.value as DataMode)} aria-label="Source de données">
                    <option value="live">Réel / clé enregistrée</option>
                    <option value="mock">Fictif</option>
                    <option value="historical">Historique</option>
                  </select>
                  <button className="secondary-button" onClick={() => void loadData()}>Actualiser</button>
                </div>
              </div>
              {marketData?.error && <div className="warning-banner">{marketData.error}</div>}
              <div className="chart-wrap">{loading || !marketData ? <div className="chart-loading">Chargement des chandelles…</div> : <CandlestickChart candles={marketData.candles} />}</div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div><p className="eyebrow">PORTEFEUILLE PAPER</p><h2>Positions ouvertes</h2></div>
                <button className="danger-outline" onClick={() => positions.forEach((position) => void closePosition(position, "Fermeture totale demandée."))} disabled={!positions.length}>Fermer tout</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Instrument</th><th>Origine</th><th>Lot</th><th>Entrée</th><th>Prix</th><th>Stop / cible</th><th>Profit/perte</th><th></th></tr></thead>
                  <tbody>
                    {positions.length === 0 ? <tr><td colSpan={8} className="empty-cell">Aucune position ouverte.</td></tr> : positions.map((position) => {
                      const positionPrice = markedPrice(position);
                      const pnl = positionPnl(position, positionPrice);
                      return <tr key={position.id}>
                        <td><strong>{position.symbol}</strong><br/><small>{position.side}</small></td>
                        <td>{position.origin === "agent" ? "Agent IA" : position.origin === "assisted" ? "Assisté" : "Manuel"}</td>
                        <td>{position.quantity}</td><td>{formatPrice(position.entryPrice)}</td><td>{formatPrice(positionPrice)}</td>
                        <td><small>{position.stopLoss ? formatPrice(position.stopLoss) : "—"}<br/>{position.takeProfit ? formatPrice(position.takeProfit) : "—"}</small></td>
                        <td className={pnl >= 0 ? "positive" : "negative"}>{formatCad(pnl)}</td>
                        <td><button className="table-button" onClick={() => void closePosition(position)}>Fermer</button></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </article>

            {renderJournal()}
          </div>

          <aside className="side-column">
            <article className="panel control-panel">
              <p className="eyebrow">ORDRE PAPER</p>
              <h2>{mode === "assisted" ? "Proposition à approuver" : "Placement manuel"}</h2>
              <div className="segmented">
                <button className={orderSide === "BUY" ? "buy active" : "buy"} onClick={() => setOrderSide("BUY")}>ACHETER</button>
                <button className={orderSide === "SELL" ? "sell active" : "sell"} onClick={() => setOrderSide("SELL")}>VENDRE</button>
              </div>
              <label>Quantité / lots<input inputMode="decimal" value={quantityText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setQuantityText(event.target.value)} /></label>
              <div className="two-fields">
                <label>Stop-loss<input inputMode="decimal" value={stopLossText} placeholder="Automatique" onChange={(event) => setStopLossText(event.target.value)} /></label>
                <label>Take-profit<input inputMode="decimal" value={takeProfitText} placeholder="Automatique" onChange={(event) => setTakeProfitText(event.target.value)} /></label>
              </div>
              <div className="order-summary"><span>Valeur estimée</span><strong>{formatCad(latestPrice * quantity)}</strong></div>
              {mode === "assisted" ? <>
                <button className="secondary-button full" onClick={() => void generateProposal()}>Générer une proposition IA</button>
                {proposal && <div className="proposal-card"><strong>{proposal.side} {proposal.quantity} {symbol}</strong><span>{proposal.reason}</span><small>Stop {formatPrice(proposal.stopLoss)} · cible {formatPrice(proposal.takeProfit)}</small></div>}
                <button className="primary-button" disabled={!proposal || killSwitch} onClick={async () => { if (!proposal) return; const ok = await placeOrder("assisted", proposal.side, proposal.quantity, proposal.stopLoss, proposal.takeProfit); if (ok) setProposal(null); }}>Approuver et exécuter</button>
              </> : <button className="primary-button" onClick={() => void placeOrder("manual")} disabled={!latestPrice || killSwitch}>Exécuter l’ordre paper</button>}
            </article>

            <article className="panel agent-panel">
              <p className="eyebrow">SESSION AUTONOME</p><h2>Ferme d’agents</h2>
              <div className="duration-grid">{(["10m", "1h", "4h", "unlimited"] as DurationPreset[]).map((value) => <button key={value} className={duration === value ? "duration active" : "duration"} onClick={() => setDuration(value)}>{durationLabel(value)}</button>)}</div>
              <label>Capital autorisé aux agents<div className="money-input"><span>$ CA</span><input inputMode="decimal" value={agentAllocation} onChange={(event) => { const value = Math.max(0, Math.min(capital, Number(event.target.value) || 0)); setAgentAllocation(value); void persistWallet({ agent_allocation: value }); }} /></div></label>
              <div className={sessionActive ? "session-display live" : "session-display"}><span>{sessionActive ? sessionPaused ? "SESSION EN PAUSE" : "AGENTS ACTIFS" : "AGENTS ARRÊTÉS"}</span><strong>{formatCountdown(remaining)}</strong></div>
              {!sessionActive ? <button className="primary-button autonomous" onClick={() => void startAutonomousSession()} disabled={killSwitch}>Activer la ferme IA</button> : <div className="button-row"><button className="secondary-button" onClick={() => void togglePause()}>{sessionPaused ? "Reprendre" : "Pause"}</button><button className="danger-button" onClick={() => void finishSession("stopped")}>Arrêter</button></div>}
              <small className="safety-note">Risque {riskSettings.riskPerTradePct.toFixed(2)} % par transaction · maximum {riskSettings.maxPositions} positions · aucun ordre réel.</small>
            </article>

            <article className="panel markets-panel">
              <div className="panel-header"><div><p className="eyebrow">HEURES LOCALES ET ALBERTA</p><h2>Marchés mondiaux</h2></div></div>
              <div className="market-clock-list">
                {marketRows.map((market) => <div className="market-clock-row" key={market.id}>
                  <span className={market.open ? "status-dot open" : "status-dot"}></span>
                  <div><strong>{market.name}</strong><span>{market.localTime} · {market.schedule.local}</span><small>{market.schedule.alberta}</small></div>
                  <b className={market.open ? "positive" : "muted"}>{market.open ? "OUVERT" : "FERMÉ"}</b>
                </div>)}
              </div>
              <small>Horaire régulier avec changements d’heure automatiques. Les jours fériés et fermetures anticipées doivent être confirmés par la source de marché avant toute future exécution réelle.</small>
            </article>
          </aside>
        </section>
      </>}

      {view === "agents" && <section className="settings-layout">
        <article className="panel wide-panel">
          <div className="panel-header"><div><p className="eyebrow">ARCHITECTURE MULTI-AGENTS</p><h2>Équipe active et responsabilités</h2></div><span className={sessionActive ? "status-chip connected" : "status-chip"}>{sessionActive ? "SESSION ACTIVE" : "EN ATTENTE"}</span></div>
          <div className="agent-roster">{AGENTS.map(([name, role], index) => <div key={name}><span>{index + 1}</span><div><strong>{name}</strong><small>{role}</small></div><b className={killSwitch ? "negative" : "positive"}>{killSwitch ? "BLOQUÉ" : "PRÊT"}</b></div>)}</div>
        </article>
        <article className="panel">
          <p className="eyebrow">GARDE-FOUS</p><h2>État de sécurité</h2>
          <div className="safety-grid">
            <div><span>Kill switch</span><strong className={killSwitch ? "negative" : "positive"}>{killSwitch ? "ACTIF" : "DÉSACTIVÉ"}</strong></div>
            <div><span>Perte / capital</span><strong>{drawdownPct.toFixed(2)} % / {riskSettings.maxDailyLossPct.toFixed(2)} %</strong></div>
            <div><span>Positions</span><strong>{positions.length} / {riskSettings.maxPositions}</strong></div>
            <div><span>Risque transaction</span><strong>{riskSettings.riskPerTradePct.toFixed(2)} %</strong></div>
            <div><span>Confiance minimale</span><strong>{(riskSettings.minAgentConfidence * 100).toFixed(0)} %</strong></div>
            <div><span>Environnement</span><strong>PAPER UNIQUEMENT</strong></div>
          </div>
        </article>
      </section>}

      {view === "settings" && <section className="settings-layout">
        <article className="panel settings-panel">
          <p className="eyebrow">PARAMÈTRES DU PORTEFEUILLE</p><h2>Capital et sécurité</h2>
          <label>Capital total paper<input inputMode="decimal" value={capital} onChange={(event) => setCapital(Math.max(1000, Number(event.target.value) || 1000))} /></label>
          <div className="two-fields">
            <label>Risque par transaction (%)<input inputMode="decimal" value={riskSettings.riskPerTradePct} onChange={(event) => setRiskSettings((current) => ({ ...current, riskPerTradePct: Number(event.target.value) }))} /></label>
            <label>Perte maximale (%)<input inputMode="decimal" value={riskSettings.maxDailyLossPct} onChange={(event) => setRiskSettings((current) => ({ ...current, maxDailyLossPct: Number(event.target.value) }))} /></label>
          </div>
          <div className="two-fields">
            <label>Positions maximum<input inputMode="numeric" value={riskSettings.maxPositions} onChange={(event) => setRiskSettings((current) => ({ ...current, maxPositions: Number(event.target.value) }))} /></label>
            <label>Confiance IA minimale (%)<input inputMode="decimal" value={Math.round(riskSettings.minAgentConfidence * 100)} onChange={(event) => setRiskSettings((current) => ({ ...current, minAgentConfidence: Number(event.target.value) / 100 }))} /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={riskSettings.closeAgentsAtEnd} onChange={(event) => setRiskSettings((current) => ({ ...current, closeAgentsAtEnd: event.target.checked }))} />Fermer les positions des agents à la fin d’une session</label>
          <label className="check-row"><input type="checkbox" checked={riskSettings.blockClosedMarkets} onChange={(event) => setRiskSettings((current) => ({ ...current, blockClosedMarkets: event.target.checked }))} />Bloquer les nouvelles entrées lorsque le marché régulier est fermé</label>
          <button className="primary-button" onClick={() => void saveRiskSettings()}>Sauvegarder les limites</button>
          <button className="secondary-button full" onClick={() => void resetWallet()}>Réinitialiser à {formatCad(capital)}</button>
          <div className="security-box"><strong>Journal conservé</strong><span>Réinitialiser le portefeuille ne supprime jamais le journal immutable.</span></div>
        </article>

        <article className="panel integrations-panel">
          <div className="panel-header"><div><p className="eyebrow">CLÉS API ET COURTIERS</p><h2>Connexions sécurisées</h2></div><span className="immutable-badge">VAULT CHIFFRÉ</span></div>
          <p className="muted integration-intro">Les secrets sont envoyés directement à Supabase, chiffrés dans Vault et ne sont jamais relus par le navigateur. Les environnements réels sont verrouillés.</p>
          <div className="integration-grid">
            {PROVIDERS.map((definition) => {
              const key = providerConnectionKey(definition.id, definition.environment);
              const connection = connectionMap.get(key);
              const form = connectionForms[key] || {};
              const busy = busyConnection === key;
              return <section className="integration-card" key={key}>
                <div className="integration-title"><div><strong>{definition.label}</strong><span>{definition.description}</span></div><b className={`status-chip ${connection?.status === "connected" ? "connected" : connection?.status === "error" ? "error" : ""}`}>{connection?.status === "connected" ? "CONNECTÉ" : connection?.status === "error" ? "ERREUR" : connection ? "ENREGISTRÉ" : "NON CONFIGURÉ"}</b></div>
                {definition.fields.map((field) => <label key={field.key}>{field.label}<input type={field.type || "text"} value={form[field.key] || ""} autoComplete="off" placeholder={connection ? "Entrer une nouvelle valeur pour remplacer" : ""} onChange={(event) => updateConnectionForm(definition.id, definition.environment, field.key, event.target.value)} /></label>)}
                <div className="integration-actions">
                  <button className="primary-button" disabled={busy} onClick={() => void invokeConnectionAction(definition, "save")}>Enregistrer</button>
                  <button className="secondary-button" disabled={busy || !connection} onClick={() => void invokeConnectionAction(definition, "test")}>Tester</button>
                  <button className="danger-outline" disabled={busy || !connection} onClick={() => void invokeConnectionAction(definition, "delete")}>Supprimer</button>
                </div>
                {connection?.last_tested_at && <small>Dernier test : {new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.last_tested_at))}</small>}
                {(connectionMessage[key] || connection?.last_error) && <div className={connection?.status === "error" ? "connection-note error" : "connection-note"}>{connectionMessage[key] || connection?.last_error}</div>}
              </section>;
            })}
          </div>
        </article>
      </section>}
    </main>
  );
}
