"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { MarketTerminal } from "@/components/market-terminal";
import type { CloudContext, RiskSettings } from "@/lib/cloud";
import { getSupabaseBrowserClient, hasSupabaseEnvironment } from "@/lib/supabase-browser";
import type { Position, TradeLog, TradingMode } from "@/lib/market";

const DEFAULT_AGENTS = [
  ["Chef de portefeuille", "Répartit le capital et arbitre les propositions", 2000],
  ["Régime de marché", "Classe tendance, range, volatilité et crise", 0],
  ["Agent tendance", "Momentum, cassures et suivi de tendance", 2500],
  ["Retour à la moyenne", "Écarts statistiques et normalisation", 1500],
  ["Moteur de risque", "Bloque les ordres qui dépassent les limites", 1500],
  ["Agent exécution", "Transforme les décisions approuvées en ordres paper", 2500],
] as const;

function mapPosition(row: Record<string, unknown>): Position {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    side: row.side === "SELL" ? "SELL" : "BUY",
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
    takeProfit: row.take_profit === null ? null : Number(row.take_profit),
    openedAt: String(row.opened_at),
    origin: row.origin === "agent" ? "agent" : row.origin === "assisted" ? "assisted" : "manual",
  };
}

function mapLog(row: Record<string, unknown>): TradeLog {
  return {
    id: String(row.id),
    time: String(row.created_at),
    agent: String(row.agent_name),
    action: String(row.action),
    reason: String(row.reason),
    result: row.result === null ? undefined : Number(row.result),
  };
}

function mapRiskSettings(value: unknown): Partial<RiskSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const settings = value as Record<string, unknown>;
  return {
    riskPerTradePct: Number(settings.riskPerTradePct) || undefined,
    maxDailyLossPct: Number(settings.maxDailyLossPct) || undefined,
    maxPositions: Number(settings.maxPositions) || undefined,
    minAgentConfidence: Number(settings.minAgentConfidence) || undefined,
    closeAgentsAtEnd: typeof settings.closeAgentsAtEnd === "boolean" ? settings.closeAgentsAtEnd : undefined,
    blockClosedMarkets: typeof settings.blockClosedMarkets === "boolean" ? settings.blockClosedMarkets : undefined,
  };
}

async function bootstrapCloud(client: SupabaseClient, session: Session): Promise<CloudContext> {
  const userId = session.user.id;
  const email = session.user.email || "Compte Supabase";

  const { error: profileError } = await client.from("profiles").upsert(
    {
      user_id: userId,
      display_name: email.split("@")[0],
      timezone: "America/Edmonton",
      currency: "CAD",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (profileError) throw profileError;

  let { data: wallet, error: walletError } = await client
    .from("paper_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (walletError) throw walletError;

  if (!wallet) {
    const created = await client
      .from("paper_wallets")
      .insert({
        user_id: userId,
        initial_capital: 100000,
        cash_balance: 100000,
        agent_allocation: 10000,
        trading_mode: "manual",
        base_currency: "CAD",
        kill_switch: false,
      })
      .select("*")
      .single();
    if (created.error) throw created.error;
    wallet = created.data;
  }

  const seedRows = DEFAULT_AGENTS.map(([name, role, capitalLimit], priority) => ({
    user_id: userId,
    name,
    role,
    capital_limit: capitalLimit,
    risk_per_trade_pct: 0.25,
    priority: priority + 1,
  }));
  const seedResult = await client.from("agent_profiles").upsert(seedRows, {
    onConflict: "user_id,name",
    ignoreDuplicates: true,
  });
  if (seedResult.error) throw seedResult.error;

  const [positionsResult, logsResult] = await Promise.all([
    client.from("positions").select("*").eq("user_id", userId).eq("status", "open").order("opened_at", { ascending: false }),
    client.from("trade_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (positionsResult.error) throw positionsResult.error;
  if (logsResult.error) throw logsResult.error;

  return {
    client,
    userId,
    email,
    walletId: String(wallet.id),
    capital: Number(wallet.initial_capital),
    cash: Number(wallet.cash_balance),
    agentAllocation: Number(wallet.agent_allocation),
    mode: (wallet.trading_mode || "manual") as TradingMode,
    killSwitch: Boolean(wallet.kill_switch),
    riskSettings: mapRiskSettings(wallet.risk_settings),
    positions: (positionsResult.data || []).map((row) => mapPosition(row as Record<string, unknown>)),
    logs: (logsResult.data || []).map((row) => mapLog(row as Record<string, unknown>)),
  };
}

export function AppGate() {
  const configured = hasSupabaseEnvironment();
  const client = useMemo(() => (configured ? getSupabaseBrowserClient() : null), [configured]);
  const [session, setSession] = useState<Session | null>(null);
  const [cloud, setCloud] = useState<CloudContext | null>(null);
  const [loading, setLoading] = useState(configured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const activeUserIdRef = useRef<string | null>(null);
  const bootstrapSequenceRef = useRef(0);
  const bootstrapRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const loadSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);

    if (!client || !nextSession) {
      bootstrapSequenceRef.current += 1;
      bootstrapRef.current = null;
      activeUserIdRef.current = null;
      setCloud(null);
      setLoading(false);
      return;
    }

    const userId = nextSession.user.id;

    // TOKEN_REFRESHED and INITIAL_SESSION can fire after getSession for the same
    // account. Keep the current terminal mounted instead of flashing the full
    // portfolio loading screen or issuing duplicate bootstrap queries.
    if (activeUserIdRef.current === userId) {
      setLoading(false);
      return;
    }

    if (bootstrapRef.current?.userId === userId) {
      await bootstrapRef.current.promise;
      return;
    }

    const sequence = ++bootstrapSequenceRef.current;
    setLoading(true);
    setCloud(null);

    const promise = (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (error || !data.user || data.user.id !== userId) throw error || new Error("Session invalide.");
        const nextCloud = await bootstrapCloud(client, nextSession);
        if (sequence !== bootstrapSequenceRef.current) return;
        activeUserIdRef.current = userId;
        setCloud(nextCloud);
        setMessage("");
      } catch (error) {
        if (sequence !== bootstrapSequenceRef.current) return;
        activeUserIdRef.current = null;
        setMessage(error instanceof Error ? error.message : "Erreur Supabase inconnue.");
      } finally {
        if (sequence === bootstrapSequenceRef.current) setLoading(false);
        if (bootstrapRef.current?.promise === promise) bootstrapRef.current = null;
      }
    })();

    bootstrapRef.current = { userId, promise };
    await promise;
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (active) void loadSession(data.session);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (active) void loadSession(nextSession);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, loadSession]);

  const submitAuth = async () => {
    if (!client || !email.includes("@") || password.length < 6) {
      setMessage("Entre un courriel valide et un mot de passe d’au moins 6 caractères.");
      return;
    }
    setLoading(true);
    setMessage("");
    const result = creating
      ? await client.auth.signUp({ email: email.trim(), password })
      : await client.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) {
      setMessage(result.error.message);
      setLoading(false);
      return;
    }
    if (creating && !result.data.session) {
      setMessage("Compte créé. Vérifie ton courriel pour confirmer l’adresse, puis connecte-toi.");
      setLoading(false);
    }
  };

  if (!configured) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">CONFIGURATION REQUISE</p>
          <h1>Relier Supabase à Vercel</h1>
          <p>Ajoute ces deux variables dans le projet Vercel, pour Production, Preview et Development :</p>
          <code>NEXT_PUBLIC_SUPABASE_URL</code>
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
          <p className="muted">La clé publishable est conçue pour le navigateur; les données privées demeurent protégées par RLS.</p>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="auth-shell"><section className="auth-card"><h1>Connexion au portefeuille…</h1><p className="muted">Chargement sécurisé depuis Supabase.</p></section></main>;
  }

  if (!session || !cloud) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">QUANTFARM AI · PAPER SEULEMENT</p>
          <h1>{creating ? "Créer le compte" : "Connexion"}</h1>
          <p className="muted">Ton portefeuille, tes positions, tes clés chiffrées et tes agents restent privés.</p>
          <label>Courriel<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Mot de passe<input type="password" autoComplete={creating ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {message && <div className="auth-message">{message}</div>}
          <button className="primary-button" onClick={() => void submitAuth()}>{creating ? "Créer mon compte" : "Me connecter"}</button>
          <button className="auth-switch" onClick={() => { setCreating((value) => !value); setMessage(""); }}>{creating ? "J’ai déjà un compte" : "Créer un nouveau compte"}</button>
        </section>
      </main>
    );
  }

  return <MarketTerminal cloud={cloud} onSignOut={() => client?.auth.signOut()} />;
}
