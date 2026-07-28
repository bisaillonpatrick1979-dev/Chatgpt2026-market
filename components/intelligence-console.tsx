"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { INTERVALS, SYMBOLS, formatPrice, type Candle, type MarketDataResponse } from "@/lib/market";
import styles from "./intelligence-console.module.css";

type Horizon = "intraday" | "swing" | "position" | "macro";
type ResearchMode = "quick" | "deep";
type DataMode = "live" | "mock" | "historical";
type ConnectionStatus = "not_tested" | "connected" | "error" | "disabled";

type IntegrationConnection = {
  id: string;
  provider: string;
  environment: string;
  label: string | null;
  account_reference: string | null;
  status: ConnectionStatus;
  last_tested_at: string | null;
  last_error: string | null;
};

type IntelligenceSettings = {
  enabled: boolean;
  model: string;
  search_context_size: "low" | "medium" | "high";
  auto_refresh_minutes: number;
  max_research_age_minutes: number;
  minimum_sources: number;
  minimum_confidence: number;
  require_official_source: boolean;
  allowed_domains: string[];
  enabled_agents: string[];
};

type AgentVote = {
  agent: string;
  stance: "bullish" | "bearish" | "neutral";
  confidence: number;
  rationale: string;
};

type PaperTradePlan = {
  enabled: boolean;
  side: "BUY" | "SELL" | "HOLD";
  entryCondition: string;
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPct: number;
  invalidation: string;
};

type IntelligenceResult = {
  symbol: string;
  generatedAt: string;
  marketRegime: string;
  overallSentiment: number;
  confidence: number;
  horizon: Horizon;
  stance: "bullish" | "bearish" | "neutral";
  signal: "BUY" | "SELL" | "HOLD";
  summary: string;
  keyDrivers: string[];
  catalysts: string[];
  risks: string[];
  agentVotes: AgentVote[];
  paperTradePlan: PaperTradePlan;
  qualityGate?: {
    passed: boolean;
    sourceCount: number;
    officialSourceCount: number;
    minimumSources: number;
    minimumConfidence: number;
  };
};

type ResearchSource = {
  url: string;
  title: string | null;
  domain: string;
  sourceClass: string;
  credibility: number;
  relevance: number;
};

type ResearchResponse = {
  ok: boolean;
  runId: string;
  result: IntelligenceResult;
  sources: ResearchSource[];
  expiresAt: string;
  model: string;
};

type ResearchRunRow = {
  id: string;
  symbol: string;
  horizon: Horizon;
  mode: ResearchMode;
  model: string;
  status: "running" | "completed" | "failed" | "cancelled";
  signal: "BUY" | "SELL" | "HOLD" | null;
  confidence: number | null;
  source_count: number;
  official_source_count: number;
  result: IntelligenceResult | Record<string, never>;
  generated_at: string | null;
  expires_at: string | null;
  error: string | null;
  created_at: string;
};

const DEFAULT_SETTINGS: IntelligenceSettings = {
  enabled: true,
  model: "gpt-5.1",
  search_context_size: "high",
  auto_refresh_minutes: 30,
  max_research_age_minutes: 45,
  minimum_sources: 4,
  minimum_confidence: 0.6,
  require_official_source: true,
  allowed_domains: [
    "reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com",
    "sec.gov", "federalreserve.gov", "bankofcanada.ca", "bls.gov", "bea.gov",
    "ecb.europa.eu", "bankofengland.co.uk", "boj.or.jp", "rba.gov.au",
    "nyse.com", "nasdaq.com", "tsx.com", "asx.com.au", "oecd.org", "imf.org", "worldbank.org",
  ],
  enabled_agents: [
    "Macro et banques centrales",
    "Nouvelles et événements",
    "Sentiment et consensus",
    "Fondamentaux et dépôts officiels",
    "Régime technique",
    "Contradicteur et risques",
    "Chef de portefeuille",
  ],
};

const HORIZONS: Array<{ value: Horizon; label: string }> = [
  { value: "intraday", label: "Intrajournalier" },
  { value: "swing", label: "Swing" },
  { value: "position", label: "Position" },
  { value: "macro", label: "Macro" },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(candles: Candle[]) {
  if (!candles.length) return 0;
  return candles.reduce((total, candle) => total + candle.close, 0) / candles.length;
}

function technicalContext(data: MarketDataResponse | null, dynamicAgeSeconds: number) {
  const candles = data?.candles || [];
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const five = candles.slice(-5);
  const twenty = candles.slice(-20);
  const fourteen = candles.slice(-14);
  const sma5 = average(five);
  const sma20 = average(twenty);
  const atr14 = fourteen.length
    ? fourteen.reduce((total, candle) => total + Math.max(candle.high - candle.low, 0.000001), 0) / fourteen.length
    : 0;
  const high20 = twenty.length ? Math.max(...twenty.map((candle) => candle.high)) : 0;
  const low20 = twenty.length ? Math.min(...twenty.map((candle) => candle.low)) : 0;
  const changePct = latest && previous ? ((latest.close - previous.close) / previous.close) * 100 : 0;
  return {
    lastPrice: latest?.close || 0,
    changePct,
    sma5,
    sma20,
    atr14,
    high20,
    low20,
    trend: sma5 > sma20 ? "up" : sma5 < sma20 ? "down" : "flat",
    candleCount: candles.length,
    dataSource: data?.source || "unknown",
    delayed: Boolean(data?.delayed),
    latestCandleAt: data?.latestCandleAt || (latest ? new Date(latest.time * 1000).toISOString() : null),
    dataAgeSeconds: dynamicAgeSeconds,
    staleAfterSeconds: data?.staleAfterSeconds || 120,
    stale: Boolean(data?.stale) || dynamicAgeSeconds > (data?.staleAfterSeconds || 120),
  };
}

function sourceLabel(sourceClass: string) {
  const labels: Record<string, string> = {
    official: "Institution officielle",
    regulator: "Régulateur",
    central_bank: "Banque centrale",
    exchange: "Bourse",
    major_media: "Grand média",
    company: "Entreprise",
    research: "Recherche",
    other: "Autre source",
  };
  return labels[sourceClass] || "Source";
}

function signalClass(signal: string) {
  if (signal === "BUY") return styles.buy;
  if (signal === "SELL") return styles.sell;
  return styles.hold;
}

function stanceLabel(stance: string) {
  if (stance === "bullish") return "Haussier";
  if (stance === "bearish") return "Baissier";
  return "Neutre";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IntelligenceConsole() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalValue] = useState<(typeof INTERVALS)[number]>("5min");
  const [horizon, setHorizon] = useState<Horizon>("intraday");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [dataMode, setDataMode] = useState<DataMode>("live");
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [now, setNow] = useState(new Date());
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [settings, setSettings] = useState<IntelligenceSettings>(DEFAULT_SETTINGS);
  const [domainsText, setDomainsText] = useState(DEFAULT_SETTINGS.allowed_domains.join(", "));
  const [apiKey, setApiKey] = useState("");
  const [apiModel, setApiModel] = useState("gpt-5.1");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [currentResearch, setCurrentResearch] = useState<ResearchResponse | null>(null);
  const [history, setHistory] = useState<ResearchRunRow[]>([]);

  const openAiConnection = connections.find((connection) => connection.provider === "openai" && connection.environment === "ai");
  const twelveConnection = connections.find((connection) => connection.provider === "twelve_data" && connection.environment === "data");

  const dynamicAgeSeconds = useMemo(() => {
    const latest = marketData?.latestCandleAt || marketData?.candles.at(-1)?.time;
    if (!latest) return 0;
    const time = typeof latest === "number" ? latest * 1000 : new Date(latest).getTime();
    return Math.max(0, Math.floor((now.getTime() - time) / 1000));
  }, [marketData, now]);

  const technical = useMemo(() => technicalContext(marketData, dynamicAgeSeconds), [marketData, dynamicAgeSeconds]);
  const isStale = Boolean(technical.stale);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!session) return;
    const userId = session.user.id;
    const [connectionsResult, settingsResult, historyResult] = await Promise.all([
      client
        .from("integration_connections")
        .select("id,provider,environment,label,account_reference,status,last_tested_at,last_error")
        .eq("user_id", userId)
        .in("provider", ["openai", "twelve_data"]),
      client.from("intelligence_settings").select("*").eq("user_id", userId).maybeSingle(),
      client
        .from("market_research_runs")
        .select("id,symbol,horizon,mode,model,status,signal,confidence,source_count,official_source_count,result,generated_at,expires_at,error,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    if (connectionsResult.error) setWorkspaceMessage(connectionsResult.error.message);
    else setConnections((connectionsResult.data || []) as IntegrationConnection[]);

    if (settingsResult.error) {
      setWorkspaceMessage(settingsResult.error.message);
    } else if (!settingsResult.data) {
      const { data, error } = await client
        .from("intelligence_settings")
        .insert({ user_id: userId })
        .select("*")
        .single();
      if (error) setWorkspaceMessage(error.message);
      else if (data) {
        const next = { ...DEFAULT_SETTINGS, ...data } as IntelligenceSettings;
        setSettings(next);
        setDomainsText(next.allowed_domains.join(", "));
        setApiModel(next.model);
      }
    } else {
      const next = { ...DEFAULT_SETTINGS, ...settingsResult.data } as IntelligenceSettings;
      setSettings(next);
      setDomainsText(next.allowed_domains.join(", "));
      setApiModel(next.model);
    }

    if (historyResult.error) setWorkspaceMessage(historyResult.error.message);
    else setHistory((historyResult.data || []) as ResearchRunRow[]);
  }, [client, session]);

  useEffect(() => {
    if (session) void loadWorkspace();
  }, [loadWorkspace, session]);

  const loadMarketData = useCallback(async () => {
    if (!session) return;
    setMarketLoading(true);
    setWorkspaceMessage("");
    try {
      let payload: MarketDataResponse;
      if (dataMode === "live" && twelveConnection) {
        const { data, error } = await client.functions.invoke("integration-manager", {
          body: {
            action: "market_data",
            provider: "twelve_data",
            environment: "data",
            symbol,
            interval,
            outputsize: 240,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Source réelle indisponible.");
        const candles = Array.isArray(data?.candles) ? data.candles as Candle[] : [];
        const latest = candles.at(-1);
        const receivedAt = data?.receivedAt || new Date().toISOString();
        const latestCandleAt = latest ? new Date(latest.time * 1000).toISOString() : receivedAt;
        const ageSeconds = latest ? Math.max(0, Math.floor((Date.now() - latest.time * 1000) / 1000)) : 0;
        const intervalMap: Record<string, number> = { "1min": 60, "5min": 300, "15min": 900, "30min": 1800, "1h": 3600, "4h": 14400, "1day": 86400 };
        const staleAfterSeconds = Math.max(120, Math.round((intervalMap[interval] || 300) * 2.5));
        payload = {
          symbol: String(data?.symbol || symbol),
          interval: String(data?.interval || interval),
          source: "twelve-data",
          delayed: false,
          candles,
          receivedAt,
          latestCandleAt,
          ageSeconds,
          staleAfterSeconds,
          stale: ageSeconds > staleAfterSeconds,
        };
      } else {
        const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=240&mode=${dataMode}`, { cache: "no-store" });
        payload = await response.json() as MarketDataResponse;
      }
      setMarketData(payload);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Erreur de données inconnue.");
    } finally {
      setMarketLoading(false);
    }
  }, [client.functions, dataMode, interval, session, symbol, twelveConnection]);

  useEffect(() => {
    if (session) void loadMarketData();
  }, [loadMarketData, session]);

  useEffect(() => {
    if (!session || dataMode !== "live") return;
    const timer = window.setInterval(() => void loadMarketData(), 30_000);
    return () => window.clearInterval(timer);
  }, [dataMode, loadMarketData, session]);

  const connectionAction = async (action: "save" | "test" | "delete") => {
    if (!session) return;
    setConnectionBusy(true);
    setConnectionMessage("");
    try {
      if (action === "save" && !apiKey.trim()) throw new Error("Entre une clé OpenAI avant de sauvegarder.");
      const { data, error } = await client.functions.invoke("integration-manager", {
        body: {
          action,
          provider: "openai",
          environment: "ai",
          label: "OpenAI Market Intelligence",
          accountReference: apiModel,
          credentials: action === "save" ? { apiKey: apiKey.trim(), model: apiModel.trim() || "gpt-5.1" } : undefined,
        },
      });
      if (error || data?.error || data?.ok === false) throw new Error(data?.error || data?.message || error?.message || "Connexion impossible.");
      setConnectionMessage(action === "save" ? "Clé chiffrée dans Supabase Vault." : action === "delete" ? "Connexion OpenAI supprimée." : data?.message || "Connexion validée.");
      if (action === "save") setApiKey("");
      await loadWorkspace();
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Erreur de connexion inconnue.");
    } finally {
      setConnectionBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!session) return;
    const allowedDomains = [...new Set(domainsText.split(/[\s,;]+/).map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")).filter(Boolean))].slice(0, 40);
    if (allowedDomains.length < 3) {
      setWorkspaceMessage("Conserve au moins trois domaines crédibles.");
      return;
    }
    const normalized: IntelligenceSettings = {
      ...settings,
      model: settings.model.trim() || "gpt-5.1",
      auto_refresh_minutes: clamp(Math.round(Number(settings.auto_refresh_minutes) || 30), 5, 1440),
      max_research_age_minutes: clamp(Math.round(Number(settings.max_research_age_minutes) || 45), 5, 1440),
      minimum_sources: clamp(Math.round(Number(settings.minimum_sources) || 4), 1, 25),
      minimum_confidence: clamp(Number(settings.minimum_confidence) || 0.6, 0, 1),
      allowed_domains: allowedDomains,
    };
    const { error } = await client.from("intelligence_settings").upsert({
      user_id: session.user.id,
      ...normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) setWorkspaceMessage(error.message);
    else {
      setSettings(normalized);
      setDomainsText(normalized.allowed_domains.join(", "));
      setApiModel(normalized.model);
      setWorkspaceMessage("Paramètres de recherche sauvegardés.");
    }
  };

  const runResearch = async () => {
    if (!session) return;
    if (dataMode === "historical") {
      setWorkspaceMessage("La recherche Web actuelle est désactivée en replay historique pour éviter les informations futures.");
      return;
    }
    if (!openAiConnection) {
      setWorkspaceMessage("Configure d’abord la connexion OpenAI dans cette page.");
      return;
    }
    if (!marketData?.candles.length) {
      setWorkspaceMessage("Charge les chandelles avant de lancer la recherche.");
      return;
    }
    setResearchLoading(true);
    setWorkspaceMessage("");
    try {
      const symbolInfo = SYMBOLS.find((item) => item.symbol === symbol);
      const assetType = symbol.includes("BTC") ? "crypto" : symbol.includes("/") ? "forex" : "equity";
      const { data, error } = await client.functions.invoke("market-intelligence", {
        body: {
          symbol,
          assetType,
          interval,
          horizon,
          mode: researchMode,
          dataMode,
          technicalContext: {
            ...technical,
            market: symbolInfo?.market || "Unknown",
            currency: symbolInfo?.currency || "USD",
          },
        },
      });
      if (error || data?.error || data?.ok === false) throw new Error(data?.error || error?.message || "Recherche IA impossible.");
      setCurrentResearch(data as ResearchResponse);
      await loadWorkspace();
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Erreur de recherche inconnue.");
    } finally {
      setResearchLoading(false);
    }
  };

  const loadHistoricalRun = async (run: ResearchRunRow) => {
    if (run.status !== "completed" || !run.result || !("summary" in run.result)) return;
    const { data, error } = await client
      .from("market_research_sources")
      .select("url,title,domain,source_class,credibility_score,relevance_score")
      .eq("run_id", run.id)
      .order("credibility_score", { ascending: false });
    if (error) {
      setWorkspaceMessage(error.message);
      return;
    }
    setSymbol(run.symbol);
    setHorizon(run.horizon);
    setCurrentResearch({
      ok: true,
      runId: run.id,
      result: run.result as IntelligenceResult,
      sources: (data || []).map((source) => ({
        url: String(source.url),
        title: source.title ? String(source.title) : null,
        domain: String(source.domain),
        sourceClass: String(source.source_class),
        credibility: Number(source.credibility_score),
        relevance: Number(source.relevance_score),
      })),
      expiresAt: run.expires_at || run.generated_at || run.created_at,
      model: run.model,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (sessionLoading) {
    return <main className={styles.shell}><section className={styles.centerCard}><h1>Chargement de l’intelligence IA…</h1></section></main>;
  }

  if (!session) {
    return (
      <main className={styles.shell}>
        <section className={styles.centerCard}>
          <p className={styles.eyebrow}>AUTHENTIFICATION REQUISE</p>
          <h1>Connecte-toi au terminal</h1>
          <p>La recherche et les sources sont privées et reliées à ton portefeuille paper.</p>
          <Link className={styles.primaryLink} href="/">Aller au terminal</Link>
        </section>
      </main>
    );
  }

  const result = currentResearch?.result;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>RECHERCHE WEB · SENTIMENT · SOURCES AUDITABLES</p>
          <h1>Intelligence de marché IA</h1>
          <p>Les agents effectuent de vraies recherches, confrontent leurs conclusions et produisent uniquement des scénarios de paper trading.</p>
        </div>
        <div className={styles.headerBadges}>
          <span className={styles.paperBadge}>PAPER SEULEMENT</span>
          <span className={openAiConnection?.status === "connected" ? styles.connectedBadge : styles.pendingBadge}>
            {openAiConnection?.status === "connected" ? "OPENAI CONNECTÉ" : openAiConnection ? "OPENAI ENREGISTRÉ" : "OPENAI NON CONFIGURÉ"}
          </span>
        </div>
      </header>

      {workspaceMessage && <div className={styles.message}>{workspaceMessage}<button onClick={() => setWorkspaceMessage("")}>×</button></div>}

      <section className={styles.topGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.eyebrow}>INSTRUMENT ET CONTEXTE</p><h2>Préparer l’analyse</h2></div>
            <span className={isStale ? styles.staleBadge : styles.freshBadge}>{isStale ? "DONNÉES PÉRIMÉES" : "DONNÉES FRAÎCHES"}</span>
          </div>
          <div className={styles.formGrid}>
            <label>Instrument
              <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.label}</option>)}
              </select>
            </label>
            <label>Intervalle
              <select value={interval} onChange={(event) => setIntervalValue(event.target.value as (typeof INTERVALS)[number])}>
                {INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>Horizon
              <select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}>
                {HORIZONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Profondeur
              <select value={researchMode} onChange={(event) => setResearchMode(event.target.value as ResearchMode)}>
                <option value="quick">Rapide — moins coûteux</option>
                <option value="deep">Approfondi — plus de recherches</option>
              </select>
            </label>
            <label>Source des chandelles
              <select value={dataMode} onChange={(event) => setDataMode(event.target.value as DataMode)}>
                <option value="live">Réelle si configurée</option>
                <option value="mock">Fictive</option>
                <option value="historical">Replay historique sans nouvelles actuelles</option>
              </select>
            </label>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={() => void loadMarketData()} disabled={marketLoading}>{marketLoading ? "Chargement…" : "Actualiser les prix"}</button>
            <button className={styles.primaryButton} onClick={() => void runResearch()} disabled={researchLoading || dataMode === "historical"}>{researchLoading ? "Agents en recherche…" : "Lancer les agents IA"}</button>
          </div>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>SANTÉ DES DONNÉES</p>
          <h2>Fraîcheur et contexte technique</h2>
          <div className={styles.metricsGrid}>
            <div><span>Dernier prix</span><strong>{technical.lastPrice ? formatPrice(Number(technical.lastPrice)) : "—"}</strong></div>
            <div><span>Âge des données</span><strong>{dynamicAgeSeconds}s</strong></div>
            <div><span>Source</span><strong>{marketData?.source || "—"}</strong></div>
            <div><span>Tendance 5/20</span><strong>{technical.trend === "up" ? "Haussière" : technical.trend === "down" ? "Baissière" : "Neutre"}</strong></div>
            <div><span>SMA 5</span><strong>{technical.sma5 ? formatPrice(Number(technical.sma5)) : "—"}</strong></div>
            <div><span>SMA 20</span><strong>{technical.sma20 ? formatPrice(Number(technical.sma20)) : "—"}</strong></div>
          </div>
          {marketData?.error && <div className={styles.warning}>{marketData.error}</div>}
          <p className={styles.smallText}>Le moteur transmet la fraîcheur, la tendance, l’ATR et la plage récente aux agents. Une donnée périmée demeure clairement signalée et ne doit pas être traitée comme temps réel.</p>
        </article>
      </section>

      {result && <section className={styles.resultGrid}>
        <article className={`${styles.panel} ${styles.summaryPanel}`}>
          <div className={styles.resultHeader}>
            <div>
              <p className={styles.eyebrow}>SYNTHÈSE DU CHEF DE PORTEFEUILLE</p>
              <h2>{result.symbol} · {stanceLabel(result.stance)}</h2>
            </div>
            <div className={`${styles.signal} ${signalClass(result.signal)}`}>{result.signal}</div>
          </div>
          <div className={styles.sentimentRow}>
            <div><span>Sentiment</span><strong>{Math.round(result.overallSentiment * 100)}</strong></div>
            <div><span>Confiance</span><strong>{Math.round(result.confidence * 100)} %</strong></div>
            <div><span>Régime</span><strong>{result.marketRegime.replaceAll("_", " ")}</strong></div>
            <div><span>Modèle</span><strong>{currentResearch?.model}</strong></div>
          </div>
          <div className={styles.sentimentTrack}><span style={{ width: `${clamp((result.overallSentiment + 1) * 50, 0, 100)}%` }} /></div>
          <p className={styles.summary}>{result.summary}</p>
          {result.qualityGate && <div className={result.qualityGate.passed ? styles.qualityPass : styles.qualityHold}>
            <strong>{result.qualityGate.passed ? "Garde-fou de qualité satisfait" : "Garde-fou prudent : HOLD"}</strong>
            <span>{result.qualityGate.sourceCount} sources, dont {result.qualityGate.officialSourceCount} officielles · confiance minimale {Math.round(result.qualityGate.minimumConfidence * 100)} %</span>
          </div>}
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>PLAN D’EXPÉRIENCE</p><h2>Paper trade proposé</h2>
          <div className={styles.paperPlan}>
            <div><span>Autorisé</span><strong>{result.paperTradePlan.enabled ? "Oui, en paper" : "Non"}</strong></div>
            <div><span>Côté</span><strong>{result.paperTradePlan.side}</strong></div>
            <div><span>Stop</span><strong>{result.paperTradePlan.stopLossPct.toFixed(2)} %</strong></div>
            <div><span>Cible</span><strong>{result.paperTradePlan.takeProfitPct.toFixed(2)} %</strong></div>
            <div><span>Risque maximal</span><strong>{result.paperTradePlan.maxRiskPct.toFixed(2)} %</strong></div>
          </div>
          <h3>Condition d’entrée</h3><p>{result.paperTradePlan.entryCondition}</p>
          <h3>Invalidation</h3><p>{result.paperTradePlan.invalidation}</p>
          <div className={styles.paperOnlyNote}>Ce plan n’est transmis à aucun courtier. Il sert à l’expérimentation et au journal paper.</div>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>FACTEURS</p><h2>Moteurs et catalyseurs</h2>
          <div className={styles.listColumns}>
            <div><h3>Moteurs</h3><ul>{result.keyDrivers.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>
            <div><h3>Catalyseurs</h3><ul>{result.catalysts.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>
          </div>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>CONTRADICTEUR</p><h2>Risques et raisons de refuser</h2>
          <ul className={styles.riskList}>{result.risks.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </article>

        <article className={`${styles.panel} ${styles.widePanel}`}>
          <p className={styles.eyebrow}>VOTE MULTI-AGENTS</p><h2>Opinions indépendantes</h2>
          <div className={styles.agentGrid}>{result.agentVotes.map((vote) => <div className={styles.agentCard} key={vote.agent}>
            <div><strong>{vote.agent}</strong><span className={vote.stance === "bullish" ? styles.voteBull : vote.stance === "bearish" ? styles.voteBear : styles.voteNeutral}>{stanceLabel(vote.stance)}</span></div>
            <b>{Math.round(vote.confidence * 100)} %</b>
            <p>{vote.rationale}</p>
          </div>)}</div>
        </article>

        <article className={`${styles.panel} ${styles.widePanel}`}>
          <div className={styles.panelHeader}><div><p className={styles.eyebrow}>SOURCES UTILISÉES</p><h2>Traçabilité de la recherche</h2></div><span className={styles.sourceCount}>{currentResearch?.sources.length || 0} sources</span></div>
          <div className={styles.sourcesGrid}>{currentResearch?.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" className={styles.sourceCard} key={source.url}>
            <div><strong>{source.title || source.domain}</strong><span>{source.domain}</span></div>
            <div><b>{sourceLabel(source.sourceClass)}</b><small>Crédibilité {Math.round(source.credibility * 100)} %</small></div>
          </a>)}</div>
          {!currentResearch?.sources.length && <p className={styles.smallText}>Aucune source n’a été retournée; le garde-fou doit conserver le signal HOLD.</p>}
        </article>
      </section>}

      <section className={styles.settingsGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><p className={styles.eyebrow}>CONNEXION IA</p><h2>OpenAI sécurisé</h2></div><span className={openAiConnection?.status === "connected" ? styles.connectedBadge : styles.pendingBadge}>{openAiConnection?.status || "non configuré"}</span></div>
          <p className={styles.smallText}>La clé est envoyée à une fonction authentifiée, chiffrée dans Supabase Vault et n’est jamais relue par le navigateur.</p>
          <label>Clé API OpenAI<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={openAiConnection ? "Entrer une nouvelle clé pour remplacer" : "sk-proj…"} /></label>
          <label>Modèle<input value={apiModel} onChange={(event) => setApiModel(event.target.value)} /></label>
          <div className={styles.actionsThree}>
            <button className={styles.primaryButton} disabled={connectionBusy} onClick={() => void connectionAction("save")}>Enregistrer</button>
            <button className={styles.secondaryButton} disabled={connectionBusy || !openAiConnection} onClick={() => void connectionAction("test")}>Tester</button>
            <button className={styles.dangerButton} disabled={connectionBusy || !openAiConnection} onClick={() => void connectionAction("delete")}>Supprimer</button>
          </div>
          {connectionMessage && <div className={styles.connectionMessage}>{connectionMessage}</div>}
          {openAiConnection?.last_tested_at && <p className={styles.smallText}>Dernier test : {formatDate(openAiConnection.last_tested_at)}</p>}
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>GARDE-FOUS DE RECHERCHE</p><h2>Qualité minimale</h2>
          <div className={styles.formGrid}>
            <label>Modèle par défaut<input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} /></label>
            <label>Contexte de recherche<select value={settings.search_context_size} onChange={(event) => setSettings((current) => ({ ...current, search_context_size: event.target.value as IntelligenceSettings["search_context_size"] }))}><option value="low">Faible</option><option value="medium">Moyen</option><option value="high">Élevé</option></select></label>
            <label>Sources minimales<input inputMode="numeric" value={settings.minimum_sources} onChange={(event) => setSettings((current) => ({ ...current, minimum_sources: Number(event.target.value) }))} /></label>
            <label>Confiance minimale (%)<input inputMode="decimal" value={Math.round(settings.minimum_confidence * 100)} onChange={(event) => setSettings((current) => ({ ...current, minimum_confidence: Number(event.target.value) / 100 }))} /></label>
            <label>Validité de la recherche (minutes)<input inputMode="numeric" value={settings.max_research_age_minutes} onChange={(event) => setSettings((current) => ({ ...current, max_research_age_minutes: Number(event.target.value) }))} /></label>
            <label>Cadence recommandée (minutes)<input inputMode="numeric" value={settings.auto_refresh_minutes} onChange={(event) => setSettings((current) => ({ ...current, auto_refresh_minutes: Number(event.target.value) }))} /></label>
          </div>
          <label className={styles.checkbox}><input type="checkbox" checked={settings.require_official_source} onChange={(event) => setSettings((current) => ({ ...current, require_official_source: event.target.checked }))} />Exiger au moins une source officielle, réglementaire, banque centrale ou bourse</label>
          <label>Domaines autorisés<textarea rows={6} value={domainsText} onChange={(event) => setDomainsText(event.target.value)} /></label>
          <button className={styles.primaryButton} onClick={() => void saveSettings()}>Sauvegarder les garde-fous</button>
        </article>
      </section>

      <section className={`${styles.panel} ${styles.historyPanel}`}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>HISTORIQUE PRIVÉ</p><h2>Recherches précédentes</h2></div><span className={styles.sourceCount}>{history.length} affichées</span></div>
        <div className={styles.historyList}>{history.length === 0 ? <p className={styles.smallText}>Aucune recherche enregistrée.</p> : history.map((run) => <button key={run.id} className={styles.historyRow} onClick={() => void loadHistoricalRun(run)} disabled={run.status !== "completed"}>
          <div><strong>{run.symbol}</strong><span>{run.mode === "deep" ? "Approfondie" : "Rapide"} · {run.horizon}</span></div>
          <b className={signalClass(run.signal || "HOLD")}>{run.signal || run.status}</b>
          <div><strong>{run.confidence === null ? "—" : `${Math.round(run.confidence * 100)} %`}</strong><span>{run.source_count} sources · {run.official_source_count} officielles</span></div>
          <time>{formatDate(run.generated_at || run.created_at)}</time>
        </button>)}</div>
      </section>
    </main>
  );
}
