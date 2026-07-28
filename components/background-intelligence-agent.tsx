"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./background-intelligence-agent.module.css";

type DurationPreset = "10m" | "1h" | "4h" | "unlimited";

type RuntimeSession = {
  id: string;
  wallet_id: string;
  data_mode: "live" | "mock" | "historical";
  status: "running" | "paused" | "completed" | "stopped";
  started_at: string;
  ends_at: string | null;
  last_worker_heartbeat_at: string | null;
  last_cycle_at: string | null;
  last_cycle_status: string | null;
  last_cycle_message: string | null;
  last_symbol: string | null;
  next_cycle_at: string | null;
  cycle_count: number;
};

type Connection = {
  provider: string;
  environment: string;
  status: "not_tested" | "connected" | "error" | "disabled";
  last_error: string | null;
};

type ResearchRun = {
  symbol: string;
  status: string;
  signal: "BUY" | "SELL" | "HOLD" | null;
  confidence: number | null;
  source_count: number;
  created_at: string;
  error: string | null;
};

type RuntimeSnapshot = {
  active: RuntimeSession | null;
  latest: RuntimeSession | null;
  connections: Connection[];
  research: ResearchRun | null;
};

const DURATIONS: Array<{ id: DurationPreset; label: string; seconds: number | null }> = [
  { id: "10m", label: "10 min", seconds: 600 },
  { id: "1h", label: "1 heure", seconds: 3600 },
  { id: "4h", label: "4 heures", seconds: 14400 },
  { id: "unlimited", label: "Illimité", seconds: null },
];

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatRemaining(endsAt: string | null, now: number) {
  if (!endsAt) return "ILLIMITÉ";
  const seconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function ageSeconds(value: string | null, now: number) {
  return value ? Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000)) : null;
}

function runtimeLabel(session: RuntimeSession | null) {
  if (!session) return "ARRÊTÉ";
  if (session.status === "paused") return "EN PAUSE";
  if (session.data_mode !== "live") return "SIMULATION LOCALE";
  return "IA SERVEUR ACTIVE";
}

function statusTone(session: RuntimeSession | null, heartbeatAge: number | null) {
  if (!session) return "off";
  if (session.status === "paused") return "paused";
  if (session.data_mode !== "live") return "mock";
  if (session.last_cycle_status === "error") return "error";
  if (heartbeatAge !== null && heartbeatAge <= 150) return "ok";
  return "waiting";
}

export function BackgroundIntelligenceAgent() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>({ active: null, latest: null, connections: [], research: null });
  const [duration, setDuration] = useState<DurationPreset>("1h");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, [client]);

  const refresh = useCallback(async () => {
    if (!session) {
      setSnapshot({ active: null, latest: null, connections: [], research: null });
      return;
    }

    const userId = session.user.id;
    const [sessionsResult, connectionsResult, researchResult] = await Promise.all([
      client
        .from("agent_sessions")
        .select("id,wallet_id,data_mode,status,started_at,ends_at,last_worker_heartbeat_at,last_cycle_at,last_cycle_status,last_cycle_message,last_symbol,next_cycle_at,cycle_count")
        .eq("user_id", userId)
        .eq("trading_mode", "autonomous")
        .order("started_at", { ascending: false })
        .limit(8),
      client
        .from("integration_connections")
        .select("provider,environment,status,last_error")
        .eq("user_id", userId)
        .in("provider", ["openai", "twelve_data"]),
      client
        .from("market_research_runs")
        .select("symbol,status,signal,confidence,source_count,created_at,error")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const rows = (sessionsResult.data || []) as RuntimeSession[];
    const active = rows.find((item) =>
      (item.status === "running" || item.status === "paused") &&
      (!item.ends_at || new Date(item.ends_at).getTime() > Date.now()),
    ) || null;

    setSnapshot({
      active,
      latest: rows[0] || null,
      connections: (connectionsResult.data || []) as Connection[],
      research: (researchResult.data || null) as ResearchRun | null,
    });
  }, [client, session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, session]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const connection = (provider: string, environment: string) => snapshot.connections.find((item) => item.provider === provider && item.environment === environment);
  const openAi = connection("openai", "ai");
  const twelve = connection("twelve_data", "data");
  const connectionsReady = openAi?.status === "connected" && twelve?.status === "connected";
  const active = snapshot.active;
  const heartbeatAge = ageSeconds(active?.last_worker_heartbeat_at || null, now);
  const tone = statusTone(active, heartbeatAge);

  const startLiveSession = async () => {
    if (!session || busy) return;
    if (!connectionsReady) {
      setMessage("OpenAI et Twelve Data doivent être connectés et testés avant de démarrer l’IA serveur.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const userId = session.user.id;
      const walletResult = await client
        .from("paper_wallets")
        .select("id,initial_capital,cash_balance,kill_switch,risk_settings")
        .eq("user_id", userId)
        .single();
      if (walletResult.error) throw walletResult.error;
      if (walletResult.data.kill_switch) throw new Error("Le kill switch est actif. Désactive-le avant de démarrer l’IA.");

      await client
        .from("agent_sessions")
        .update({
          status: "stopped",
          stopped_at: new Date().toISOString(),
          last_cycle_status: "replaced",
          last_cycle_message: "Remplacée par une nouvelle session IA serveur.",
        })
        .eq("user_id", userId)
        .eq("trading_mode", "autonomous")
        .in("status", ["running", "paused"]);

      const preset = DURATIONS.find((item) => item.id === duration) || DURATIONS[1];
      const startedAt = new Date();
      const id = crypto.randomUUID();
      const insertResult = await client.from("agent_sessions").insert({
        id,
        user_id: userId,
        wallet_id: walletResult.data.id,
        trading_mode: "autonomous",
        data_mode: "live",
        duration_seconds: preset.seconds,
        status: "running",
        started_at: startedAt.toISOString(),
        ends_at: preset.seconds === null ? null : new Date(startedAt.getTime() + preset.seconds * 1000).toISOString(),
        starting_equity: Number(walletResult.data.cash_balance),
        settings: walletResult.data.risk_settings || {},
        next_cycle_at: startedAt.toISOString(),
        last_cycle_status: "queued",
        last_cycle_message: "Session créée. Le travailleur serveur prendra le prochain cycle automatique.",
      });
      if (insertResult.error) throw insertResult.error;

      await client.from("paper_wallets").update({ trading_mode: "autonomous", updated_at: startedAt.toISOString() }).eq("id", walletResult.data.id).eq("user_id", userId);
      setMessage("IA serveur démarrée. Elle continuera même si l’onglet ou la tablette passe en arrière-plan.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Démarrage de l’IA impossible.");
    } finally {
      setBusy(false);
    }
  };

  const updateSession = async (action: "pause" | "resume" | "stop") => {
    if (!session || !active || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const nextStatus = action === "pause" ? "paused" : action === "resume" ? "running" : "stopped";
      const patch: Record<string, unknown> = {
        status: nextStatus,
        last_cycle_status: nextStatus,
        last_cycle_message: action === "pause" ? "Session mise en pause par l’utilisateur." : action === "resume" ? "Session reprise; prochain cycle serveur en attente." : "Session arrêtée par l’utilisateur.",
      };
      if (action === "pause") patch.paused_at = new Date().toISOString();
      if (action === "resume") {
        patch.paused_at = null;
        patch.next_cycle_at = new Date().toISOString();
        patch.worker_lease_until = null;
      }
      if (action === "stop") {
        patch.stopped_at = new Date().toISOString();
        patch.next_cycle_at = null;
        patch.worker_lease_until = null;
      }

      const result = await client.from("agent_sessions").update(patch).eq("id", active.id).eq("user_id", session.user.id);
      if (result.error) throw result.error;
      if (action === "stop") await client.from("paper_wallets").update({ trading_mode: "manual", updated_at: new Date().toISOString() }).eq("id", active.wallet_id).eq("user_id", session.user.id);
      setMessage(action === "pause" ? "IA en pause." : action === "resume" ? "IA reprise." : "IA arrêtée.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  if (!session) return null;

  const visibleSession = active || snapshot.latest;
  const isLive = active?.data_mode === "live";
  const workerOnline = isLive && heartbeatAge !== null && heartbeatAge <= 150;

  return (
    <section className={styles.card} aria-label="État du travailleur IA autonome">
      <div className={styles.header}>
        <div>
          <p>TRAVAILLEUR AUTONOME CÔTÉ SERVEUR</p>
          <h2>L’IA continue sans dépendre du graphique ou de l’onglet</h2>
        </div>
        <span data-tone={tone}>{runtimeLabel(active)}</span>
      </div>

      <div className={styles.connectionRow}>
        <div><small>OpenAI</small><strong data-ok={openAi?.status === "connected"}>{openAi?.status === "connected" ? "Connecté" : "Non prêt"}</strong></div>
        <div><small>Twelve Data</small><strong data-ok={twelve?.status === "connected"}>{twelve?.status === "connected" ? "Connecté" : "Non prêt"}</strong></div>
        <div><small>Travailleur serveur</small><strong data-ok={workerOnline}>{active ? workerOnline ? "En ligne" : active.data_mode === "live" ? "En attente du prochain cycle" : "Non utilisé en mode fictif" : "Arrêté"}</strong></div>
        <div><small>Exécution</small><strong data-ok>Paper seulement</strong></div>
      </div>

      {active ? (
        <div className={styles.runtimeGrid}>
          <article>
            <small>Temps restant</small>
            <strong className={styles.countdown}>{formatRemaining(active.ends_at, now)}</strong>
          </article>
          <article>
            <small>Mode de données</small>
            <strong>{active.data_mode === "live" ? "Réel · Twelve Data + OpenAI" : active.data_mode === "mock" ? "Fictif · algorithme local" : "Historique · replay"}</strong>
          </article>
          <article>
            <small>Dernier cycle</small>
            <strong>{active.last_cycle_status || "En attente"}</strong>
            <span>{formatTime(active.last_cycle_at)}</span>
          </article>
          <article>
            <small>Dernier instrument</small>
            <strong>{active.last_symbol || "—"}</strong>
            <span>{active.cycle_count} cycle{active.cycle_count === 1 ? "" : "s"}</span>
          </article>
        </div>
      ) : (
        <div className={styles.stopped}>Aucune session autonome active. Choisis une durée pour démarrer le véritable moteur OpenAI côté serveur.</div>
      )}

      {visibleSession?.last_cycle_message && <div className={styles.cycleMessage} data-error={visibleSession.last_cycle_status === "error"}>{visibleSession.last_cycle_message}</div>}

      {snapshot.research && (
        <div className={styles.research}>
          <span>Dernière recherche IA</span>
          <strong>{snapshot.research.symbol} · {snapshot.research.status === "completed" ? snapshot.research.signal || "TERMINÉE" : snapshot.research.status.toUpperCase()}</strong>
          <em>{snapshot.research.confidence === null ? "—" : `${Math.round(Number(snapshot.research.confidence) * 100)} %`} · {snapshot.research.source_count || 0} sources · {formatTime(snapshot.research.created_at)}</em>
          {snapshot.research.error && <p>{snapshot.research.error}</p>}
        </div>
      )}

      {!active && (
        <div className={styles.startControls}>
          <div className={styles.durationButtons}>
            {DURATIONS.map((item) => <button key={item.id} type="button" data-active={duration === item.id} onClick={() => setDuration(item.id)}>{item.label}</button>)}
          </div>
          <button className={styles.startButton} type="button" disabled={busy || !connectionsReady} onClick={() => void startLiveSession()}>{busy ? "Démarrage…" : "DÉMARRER L’IA SERVEUR"}</button>
        </div>
      )}

      {active && (
        <div className={styles.sessionActions}>
          {active.status === "paused"
            ? <button type="button" disabled={busy} onClick={() => void updateSession("resume")}>Reprendre</button>
            : <button type="button" disabled={busy} onClick={() => void updateSession("pause")}>Pause</button>}
          <button type="button" disabled={busy} onClick={() => void updateSession("stop")}>Arrêter</button>
        </div>
      )}

      {active?.data_mode !== "live" && active && <div className={styles.warning}>Cette session a été démarrée avec les données fictives de l’ancien contrôle. OpenAI n’est pas utilisé dans ce mode. Arrête-la, puis démarre « IA serveur ».</div>}
      {message && <div className={styles.userMessage}>{message}</div>}
    </section>
  );
}
