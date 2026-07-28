"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./market-venue-ledger.module.css";

type Instrument = {
  id: string;
  provider_symbol: string;
  label: string;
  asset_type: "equity" | "forex" | "crypto" | string;
  market_region: string;
  venue_name: string;
  exchange_code: string | null;
  mic_code: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  session_kind: "exchange" | "forex" | "crypto";
  sessions: Array<{ name: string; open: string; close: string }>;
  data_provider: string;
  execution_provider: string;
  access_note: string | null;
  sort_order: number;
};

type PaperOrder = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  origin: "manual" | "assisted" | "agent";
  status: string;
  submitted_at: string;
  venue_name: string | null;
  mic_code: string | null;
  market_region: string | null;
  market_timezone: string | null;
  market_session: string | null;
  data_provider: string | null;
  execution_provider: string | null;
};

type Connection = {
  provider: string;
  environment: string;
  status: "not_tested" | "connected" | "error" | "disabled";
};

type RegionCard = Instrument & { symbols: string[] };

const REGION_LABELS: Record<string, string> = {
  new_york: "New York",
  toronto: "Toronto",
  london: "Londres",
  europe: "Europe",
  tokyo: "Tokyo",
  sydney: "Sydney",
  global_fx: "Forex mondial",
  crypto_global: "Crypto mondial",
};

function localClock(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function forexOpen(date: Date) {
  const ny = localParts(date, "America/New_York");
  const decimal = ny.hour + ny.minute / 60;
  if (ny.weekday === "Sat") return false;
  if (ny.weekday === "Sun") return decimal >= 17;
  if (ny.weekday === "Fri") return decimal < 17;
  return true;
}

function forexSession(date: Date) {
  if (!forexOpen(date)) return "Fermé hebdomadaire";
  const active: string[] = [];
  const windows = [
    ["Sydney", "Australia/Sydney"],
    ["Tokyo", "Asia/Tokyo"],
    ["Londres", "Europe/London"],
    ["New York", "America/New_York"],
  ] as const;
  for (const [name, timezone] of windows) {
    const local = localParts(date, timezone);
    const decimal = local.hour + local.minute / 60;
    if (decimal >= 8 && decimal < 17) active.push(name);
  }
  return active.length ? active.join(" + ") : "Entre sessions principales";
}

function sessionState(instrument: Instrument, date: Date) {
  if (instrument.session_kind === "crypto") return { open: true, label: "24/7" };
  if (instrument.session_kind === "forex") {
    const label = forexSession(date);
    return { open: label !== "Fermé hebdomadaire", label };
  }
  const local = localParts(date, instrument.timezone);
  if (local.weekday === "Sat" || local.weekday === "Sun") return { open: false, label: "Fermé" };
  const decimal = local.hour + local.minute / 60;
  const active = instrument.sessions.find((session) => {
    const [openHour, openMinute] = session.open.split(":").map(Number);
    const [closeHour, closeMinute] = session.close.split(":").map(Number);
    return decimal >= openHour + openMinute / 60 && decimal < closeHour + closeMinute / 60;
  });
  return active ? { open: true, label: active.name } : { open: false, label: "Hors séance" };
}

function providerLabel(value: string | null) {
  if (value === "twelve_data") return "Twelve Data";
  if (value === "internal_paper") return "Portefeuille paper Supabase";
  return value || "Non déterminé";
}

export function MarketVenueLedger() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    const load = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setLoaded(true);
        return;
      }

      const [instrumentResult, orderResult, connectionResult] = await Promise.all([
        client
          .from("market_instruments")
          .select("id,provider_symbol,label,asset_type,market_region,venue_name,exchange_code,mic_code,country,timezone,currency,session_kind,sessions,data_provider,execution_provider,access_note,sort_order")
          .order("sort_order", { ascending: true }),
        client
          .from("orders")
          .select("id,symbol,side,origin,status,submitted_at,venue_name,mic_code,market_region,market_timezone,market_session,data_provider,execution_provider")
          .eq("user_id", nextSession.user.id)
          .order("submitted_at", { ascending: false })
          .limit(12),
        client
          .from("integration_connections")
          .select("provider,environment,status")
          .eq("user_id", nextSession.user.id),
      ]);

      if (!active) return;
      setInstruments((instrumentResult.data || []) as Instrument[]);
      setOrders((orderResult.data || []) as PaperOrder[]);
      setConnections((connectionResult.data || []) as Connection[]);
      setLoaded(true);
    };

    void client.auth.getSession().then(({ data }) => void load(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => void load(nextSession));
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  const regions = useMemo(() => {
    const grouped = new Map<string, RegionCard>();
    for (const instrument of instruments) {
      const current = grouped.get(instrument.market_region);
      if (current) current.symbols.push(instrument.provider_symbol);
      else grouped.set(instrument.market_region, { ...instrument, symbols: [instrument.provider_symbol] });
    }
    return [...grouped.values()];
  }, [instruments]);

  const twelve = connections.find((connection) => connection.provider === "twelve_data" && connection.environment === "data");
  const openai = connections.find((connection) => connection.provider === "openai" && connection.environment === "ai");

  if (!loaded || !session) return null;

  return (
    <section className={styles.card} aria-label="Carte mondiale des marchés et registre d’exécution">
      <div className={styles.header}>
        <div>
          <p>CARTE MONDIALE D’EXÉCUTION</p>
          <h2>Source, place, session et destination de chaque décision</h2>
        </div>
        <span>PAPER UNIQUEMENT</span>
      </div>

      <div className={styles.pipeline}>
        <article>
          <small>Source de prix</small>
          <strong>Twelve Data</strong>
          <em data-state={twelve?.status === "connected" ? "ok" : "warning"}>{twelve?.status === "connected" ? "Connecté" : "À connecter ou tester"}</em>
        </article>
        <b>→</b>
        <article>
          <small>Analyse et vote</small>
          <strong>Luna → Terra → Sol</strong>
          <em data-state={openai?.status === "connected" ? "ok" : "warning"}>{openai?.status === "connected" ? "Connecté" : "À tester"}</em>
        </article>
        <b>→</b>
        <article>
          <small>Destination</small>
          <strong>Portefeuille paper Supabase</strong>
          <em data-state="ok">Aucun ordre réel</em>
        </article>
      </div>

      <p className={styles.explanation}>
        Twelve Data fournit les prix; ce n’est pas la bourse où l’ordre est exécuté. Pour les actions, la place est identifiée par son code MIC. Pour le Forex, il n’existe pas une bourse centrale unique : le registre indique plutôt la session de liquidité active, comme Tokyo, Londres ou New York.
      </p>

      <div className={styles.marketGrid}>
        {regions.map((market) => {
          const state = sessionState(market, now);
          return (
            <article key={market.market_region} className={styles.market}>
              <div className={styles.marketTop}>
                <div>
                  <small>{REGION_LABELS[market.market_region] || market.market_region}</small>
                  <strong>{market.venue_name}</strong>
                </div>
                <span data-open={state.open}>{state.open ? "OUVERT" : "FERMÉ"}</span>
              </div>
              <dl>
                <div><dt>Session</dt><dd>{state.label}</dd></div>
                <div><dt>Heure locale</dt><dd>{localClock(now, market.timezone)}</dd></div>
                <div><dt>MIC</dt><dd>{market.mic_code || "Marché décentralisé"}</dd></div>
                <div><dt>Devise</dt><dd>{market.currency}</dd></div>
              </dl>
              <p className={styles.symbols}>{market.symbols.join(" · ")}</p>
              <p className={styles.access}>{market.access_note}</p>
            </article>
          );
        })}
      </div>

      <div className={styles.ledgerHeader}>
        <div>
          <p>REGISTRE DES ORDRES PAPER</p>
          <h3>Où les agents ont placé chaque ordre</h3>
        </div>
        <span>{orders.length} récent{orders.length > 1 ? "s" : ""}</span>
      </div>

      {orders.length ? (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr><th>Date</th><th>Ordre</th><th>Place</th><th>Session</th><th>Données</th><th>Destination</th></tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Edmonton" }).format(new Date(order.submitted_at))}</td>
                  <td><strong>{order.side} {order.symbol}</strong><small>{order.origin}</small></td>
                  <td><strong>{order.venue_name || "Non déterminée"}</strong><small>{order.mic_code || order.market_region || "—"}</small></td>
                  <td>{order.market_session || "—"}</td>
                  <td>{providerLabel(order.data_provider)}</td>
                  <td>{providerLabel(order.execution_provider)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          Aucun ordre paper n’a encore été créé. Dès le premier ordre, la place, le MIC, la session, la source et la destination seront enregistrés ici automatiquement.
        </div>
      )}

      <p className={styles.note}>
        La surveillance automatique utilise maintenant la liste mondiale enregistrée dans Supabase et non seulement le graphique ouvert. Une exécution globale exige une session autonome live active, une donnée Twelve Data fraîche, une recherche IA valide, un marché ouvert et toutes les limites de risque respectées.
      </p>
    </section>
  );
}
