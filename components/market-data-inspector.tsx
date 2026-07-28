"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { MarketDataResponse } from "@/lib/market";

type DataMode = "live" | "mock" | "historical";
type ConnectionState = "checking" | "connected" | "missing" | "error";

type InspectorSnapshot = {
  requestedMode: DataMode;
  dataKind: "live" | "historical" | "mock" | "fallback";
  providerName: string;
  providerSite?: string;
  apiHost: string;
  transport: string;
  source: string;
  symbol: string;
  interval: string;
  candleCount: number;
  receivedAt?: string;
  latestCandleAt?: string;
  ageSeconds?: number;
  stale?: boolean;
  fallback: boolean;
  historicalEndDate?: string;
  error?: string;
};

const ALBERTA_TIME = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Edmonton",
  dateStyle: "medium",
  timeStyle: "medium",
});

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : ALBERTA_TIME.format(date);
}

function formatAge(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 60) return `${Math.max(0, Math.round(value))} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
  return `${Math.floor(value / 3600)} h ${Math.floor((value % 3600) / 60)} min`;
}

function normalizePayload(payload: MarketDataResponse, requestedMode: DataMode): InspectorSnapshot {
  const explicitKind = payload.dataKind;
  const fallback = Boolean(payload.fallback || (payload.source === "mock" && requestedMode !== "mock"));
  const dataKind = explicitKind || (fallback ? "fallback" : payload.source === "twelve-data" ? (requestedMode === "historical" ? "historical" : "live") : "mock");
  return {
    requestedMode: payload.requestedMode || requestedMode,
    dataKind,
    providerName: payload.providerName || (payload.source === "twelve-data" ? "Twelve Data" : "Simulateur interne QuantFarm"),
    providerSite: payload.providerSite || (payload.source === "twelve-data" ? "https://twelvedata.com" : undefined),
    apiHost: payload.apiHost || (payload.source === "twelve-data" ? "api.twelvedata.com" : "Application locale /api/market-data"),
    transport: payload.transport || (payload.source === "twelve-data" ? "Fonction Supabase sécurisée" : "Route Next.js interne"),
    source: payload.source,
    symbol: payload.symbol,
    interval: payload.interval,
    candleCount: payload.candleCount ?? payload.candles?.length ?? 0,
    receivedAt: payload.receivedAt,
    latestCandleAt: payload.latestCandleAt,
    ageSeconds: payload.ageSeconds,
    stale: payload.stale,
    fallback,
    historicalEndDate: payload.historicalEndDate,
    error: payload.error,
  };
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function readModeFromUrl(url: URL): DataMode {
  const mode = url.searchParams.get("mode");
  return mode === "historical" || mode === "mock" ? mode : "live";
}

export function MarketDataInspector() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);
  const [historicalEndDate, setHistoricalEndDate] = useState(dateDaysAgo(30));
  const [panelMessage, setPanelMessage] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const autoSelectedLive = useRef(false);
  const historicalEndDateRef = useRef(historicalEndDate);

  useEffect(() => { historicalEndDateRef.current = historicalEndDate; }, [historicalEndDate]);

  const publish = useCallback((payload: MarketDataResponse, requestedMode: DataMode) => {
    const next = normalizePayload(payload, requestedMode);
    setSnapshot(next);
    setPanelMessage(next.fallback ? "La source demandée n’a pas répondu : le graphique affiche présentement des données fictives." : "");
  }, []);

  const locateChart = useCallback(() => {
    const nextTarget = document.querySelector<HTMLElement>(".chart-panel");
    setTarget((current) => current === nextTarget ? current : nextTarget);
    return nextTarget;
  }, []);

  const readChartControls = useCallback(() => {
    const chart = locateChart();
    return {
      chart,
      source: chart?.querySelector<HTMLSelectElement>('select[aria-label="Source de données"]') || null,
      symbol: chart?.querySelector<HTMLSelectElement>('select[aria-label="Instrument"]') || null,
      interval: chart?.querySelector<HTMLSelectElement>('select[aria-label="Intervalle"]') || null,
      refresh: Array.from(chart?.querySelectorAll<HTMLButtonElement>("button") || []).find((button) => button.textContent?.trim() === "Actualiser") || null,
    };
  }, [locateChart]);

  const requestChartRefresh = useCallback((mode?: DataMode) => {
    const controls = readChartControls();
    if (!controls.source || !controls.refresh) {
      setPanelMessage("Le terminal n’est pas encore prêt. Ouvre l’onglet Terminal puis réessaie.");
      return;
    }
    if (mode && controls.source.value !== mode) setNativeSelectValue(controls.source, mode);
    window.setTimeout(() => controls.refresh?.click(), 50);
  }, [readChartControls]);

  useEffect(() => {
    const observer = new MutationObserver(() => locateChart());
    locateChart();
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [locateChart]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    let active = true;

    const inspectConnection = async () => {
      const { data: sessionData } = await client.auth.getSession();
      if (!active || !sessionData.session) {
        if (active) setConnectionState("missing");
        return;
      }
      const { data, error } = await client
        .from("integration_connections")
        .select("status,last_tested_at,last_error")
        .eq("user_id", sessionData.session.user.id)
        .eq("provider", "twelve_data")
        .eq("environment", "data")
        .maybeSingle();
      if (!active) return;
      if (error) {
        setConnectionState("error");
        setPanelMessage(`Vérification Twelve Data impossible : ${error.message}`);
        return;
      }
      const connected = data?.status === "connected";
      setConnectionState(connected ? "connected" : "missing");
      if (connected && !autoSelectedLive.current) {
        autoSelectedLive.current = true;
        window.setTimeout(() => {
          const controls = readChartControls();
          if (controls.source?.value === "mock") setNativeSelectValue(controls.source, "live");
        }, 300);
      }
    };

    void inspectConnection();
    const { data: subscription } = client.auth.onAuthStateChange(() => void inspectConnection());
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [readChartControls]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      let parsed: URL | null = null;
      try { parsed = new URL(rawUrl, window.location.origin); } catch { parsed = null; }
      const isMarketRoute = parsed?.pathname === "/api/market-data";
      const isIntegrationRoute = Boolean(parsed?.pathname.includes("/functions/v1/integration-manager"));
      const requestedMode = parsed && isMarketRoute ? readModeFromUrl(parsed) : null;

      if (parsed && isMarketRoute && requestedMode === "historical" && connectionState === "connected") {
        try {
          const client = getSupabaseBrowserClient();
          const { data, error } = await client.functions.invoke("integration-manager", {
            body: {
              action: "market_data",
              provider: "twelve_data",
              environment: "data",
              mode: "historical",
              endDate: historicalEndDateRef.current,
              symbol: parsed.searchParams.get("symbol") || "AAPL",
              interval: parsed.searchParams.get("interval") || "5min",
              outputsize: Number(parsed.searchParams.get("outputsize")) || 180,
            },
          });
          if (error || data?.error) throw new Error(data?.error || error?.message || "Historique Twelve Data indisponible.");
          const payload = data as MarketDataResponse;
          publish(payload, "historical");
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (error) {
          setPanelMessage(error instanceof Error ? error.message : "Historique réel indisponible; vérification du repli interne.");
        }
      }

      let downstreamInput: RequestInfo | URL = input;
      if (parsed && isMarketRoute && requestedMode === "historical") {
        parsed.searchParams.set("endDate", historicalEndDateRef.current);
        downstreamInput = input instanceof Request ? new Request(parsed.toString(), input) : parsed.toString();
      }

      const response = await originalFetch(downstreamInput, init);
      if ((isMarketRoute || isIntegrationRoute) && response.headers.get("content-type")?.includes("application/json")) {
        void response.clone().json().then((payload: unknown) => {
          if (!payload || typeof payload !== "object" || !("candles" in payload)) return;
          const mode = requestedMode || ((payload as MarketDataResponse).requestedMode as DataMode | undefined) || "live";
          publish(payload as MarketDataResponse, mode);
        }).catch(() => undefined);
      }
      return response;
    };

    window.fetch = patchedFetch;
    return () => { window.fetch = originalFetch; };
  }, [connectionState, publish]);

  useEffect(() => {
    if (!autoRefreshEnabled || connectionState !== "connected") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const controls = readChartControls();
      if (controls.source?.value === "live") controls.refresh?.click();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, connectionState, readChartControls]);

  const status = useMemo(() => {
    if (!snapshot) return { label: "EN ATTENTE", className: "pending" };
    if (snapshot.dataKind === "live") return { label: snapshot.stale ? "RÉEL · PÉRIMÉ" : "RÉEL · ACTIF", className: snapshot.stale ? "warning" : "live" };
    if (snapshot.dataKind === "historical") return { label: "HISTORIQUE RÉEL", className: "historical" };
    if (snapshot.dataKind === "fallback") return { label: "REPLI FICTIF", className: "warning" };
    return { label: "MOCK / FICTIF", className: "mock" };
  }, [snapshot]);

  if (!target) return null;

  return createPortal(
    <section className="market-source-inspector" aria-label="Provenance des données du graphique">
      <style>{`
        .market-source-inspector { border-top: 1px solid rgba(148,163,184,.25); padding: 16px 18px 18px; background: rgba(7,12,23,.72); }
        .market-source-inspector * { box-sizing: border-box; }
        .market-source-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; }
        .market-source-top h3 { margin:2px 0 4px; font-size:1rem; }
        .market-source-top p { margin:0; color:#94a3b8; font-size:.86rem; }
        .market-source-badge { border:1px solid rgba(148,163,184,.35); border-radius:999px; padding:7px 11px; font-size:.75rem; font-weight:800; letter-spacing:.05em; }
        .market-source-badge.live { color:#6ee7b7; border-color:rgba(52,211,153,.55); background:rgba(16,185,129,.10); }
        .market-source-badge.historical { color:#93c5fd; border-color:rgba(96,165,250,.55); background:rgba(59,130,246,.10); }
        .market-source-badge.mock { color:#cbd5e1; }
        .market-source-badge.warning { color:#fbbf24; border-color:rgba(245,158,11,.55); background:rgba(245,158,11,.10); }
        .market-source-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; margin-top:13px; }
        .market-source-item { border:1px solid rgba(148,163,184,.18); border-radius:10px; padding:10px; min-width:0; background:rgba(15,23,42,.52); }
        .market-source-item span { display:block; color:#94a3b8; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
        .market-source-item strong, .market-source-item a { display:block; color:#f8fafc; font-size:.86rem; overflow-wrap:anywhere; }
        .market-source-item a { text-decoration:underline; text-underline-offset:3px; }
        .market-source-actions { display:flex; gap:9px; align-items:end; flex-wrap:wrap; margin-top:12px; }
        .market-source-actions label { display:flex; flex-direction:column; gap:5px; color:#cbd5e1; font-size:.78rem; }
        .market-source-actions input { min-height:38px; border:1px solid rgba(148,163,184,.35); border-radius:8px; background:#0f172a; color:#f8fafc; padding:7px 9px; }
        .market-source-actions button { min-height:38px; border:1px solid rgba(96,165,250,.55); border-radius:8px; background:rgba(37,99,235,.16); color:#dbeafe; padding:7px 11px; font-weight:700; cursor:pointer; }
        .market-source-actions button.secondary { border-color:rgba(148,163,184,.35); background:rgba(30,41,59,.7); color:#e2e8f0; }
        .market-source-check { display:flex; align-items:center; gap:7px; min-height:38px; padding:0 4px; color:#cbd5e1; font-size:.8rem; }
        .market-source-check input { width:18px; height:18px; }
        .market-source-message { margin-top:10px; border-left:3px solid #f59e0b; background:rgba(245,158,11,.09); color:#fde68a; padding:9px 11px; border-radius:6px; font-size:.82rem; }
        .market-source-note { margin:10px 0 0; color:#94a3b8; font-size:.76rem; }
        @media (max-width:900px) { .market-source-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:520px) { .market-source-grid { grid-template-columns:1fr; } .market-source-actions > * { width:100%; } .market-source-actions button { width:100%; } }
      `}</style>
      <div className="market-source-top">
        <div>
          <p>PROVENANCE DU GRAPHIQUE</p>
          <h3>Source réellement affichée</h3>
          <p>{connectionState === "connected" ? "Twelve Data est connecté avec une clé chiffrée dans Supabase." : connectionState === "checking" ? "Vérification de Twelve Data…" : "Aucune connexion Twelve Data active détectée."}</p>
        </div>
        <span className={`market-source-badge ${status.className}`}>{status.label}</span>
      </div>

      <div className="market-source-grid">
        <div className="market-source-item"><span>Type de données</span><strong>{snapshot ? snapshot.dataKind === "live" ? "Temps réel par actualisation" : snapshot.dataKind === "historical" ? "Historique réel" : snapshot.dataKind === "fallback" ? "Fictif après échec" : "Mock volontaire" : "En attente du graphique"}</strong></div>
        <div className="market-source-item"><span>Fournisseur</span>{snapshot?.providerSite ? <a href={snapshot.providerSite} target="_blank" rel="noreferrer">{snapshot.providerName}</a> : <strong>{snapshot?.providerName || "—"}</strong>}</div>
        <div className="market-source-item"><span>Serveur de données</span><strong>{snapshot?.apiHost || "—"}</strong></div>
        <div className="market-source-item"><span>Connexion sécurisée</span><strong>{snapshot?.transport || "—"}</strong></div>
        <div className="market-source-item"><span>Instrument / intervalle</span><strong>{snapshot ? `${snapshot.symbol} · ${snapshot.interval}` : "—"}</strong></div>
        <div className="market-source-item"><span>Chandelles reçues</span><strong>{snapshot?.candleCount ?? "—"}</strong></div>
        <div className="market-source-item"><span>Dernière chandelle · Alberta</span><strong>{formatDate(snapshot?.latestCandleAt)}</strong></div>
        <div className="market-source-item"><span>Fraîcheur</span><strong>{snapshot?.dataKind === "historical" ? `Fin choisie : ${snapshot.historicalEndDate || historicalEndDate}` : `${formatAge(snapshot?.ageSeconds)}${snapshot?.stale ? " · PÉRIMÉE" : snapshot ? " · valide" : ""}`}</strong></div>
      </div>

      <div className="market-source-actions">
        <button type="button" onClick={() => requestChartRefresh("live")} disabled={connectionState !== "connected"}>Passer au temps réel</button>
        <label>Date de fin historique
          <input type="date" value={historicalEndDate} max={new Date().toISOString().slice(0, 10)} onChange={(event: ChangeEvent<HTMLInputElement>) => setHistoricalEndDate(event.target.value)} />
        </label>
        <button type="button" className="secondary" onClick={() => requestChartRefresh("historical")} disabled={connectionState !== "connected"}>Charger l’historique réel</button>
        <button type="button" className="secondary" onClick={() => requestChartRefresh("mock")}>Tester le mock</button>
        <label className="market-source-check"><input type="checkbox" checked={autoRefreshEnabled} onChange={(event: ChangeEvent<HTMLInputElement>) => setAutoRefreshEnabled(event.target.checked)} />Actualiser le réel toutes les 45 s</label>
      </div>

      {(panelMessage || snapshot?.error) && <div className="market-source-message">{panelMessage || snapshot?.error}</div>}
      <p className="market-source-note">Le graphique TradingView Lightweight Charts dessine seulement les chandelles. Les prix viennent de Twelve Data par la fonction Supabase sécurisée; aucune clé secrète n’est envoyée au navigateur.</p>
    </section>,
    target,
  );
}
