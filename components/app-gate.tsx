"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { MarketTerminal } from "@/components/market-terminal";
import type { CloudContext } from "@/lib/cloud";
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
  const seedResult = await client.from("agent_profiles").upsert(seedRows, { onConflict: "user_id,name" });
  if (seedResult.error) throw seedResult.error;

  const [positionsResult, logsResult] = await Promise.all([
    client.from("positions").select("*").eq("user_id", userId).eq("status", "open").order("opened_at", { ascending: false }),
    client.from("trade_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
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

  const loadSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setCloud(null);
    if (!client || !nextSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setCloud(await bootstrapCloud(client, nextSession));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur Supabase inconnue.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => loadSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      void loadSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, [client, loadSession]);

  const submitAuth = async () => {
    if (!client || !email || password.length < 6) {
      setMessage("Entre un courriel valide et un mot de passe d’au moins 6 caractères.");
      return;
    }
    setLoading(true);
    setMessage("");
    const result = creating
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
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
          <p className="muted">Redéploie ensuite l’application. La clé publishable est conçue pour le navigateur; les données restent protégées par RLS.</p>
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
          <p className="muted">Ton portefeuille, tes positions et tes agents seront privés dans Supabase.</p>
          <label>Courriel<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Mot de passe<input type="password" autoComplete={creating ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {message && <div className="auth-message">{message}</div>}
          <button className="primary-button" onClick={() => void submitAuth()}>{creating ? "Créer mon compte" : "Me connecter"}</button>
          <button className="auth-switch" onClick={() => { setCreating((value) => !value); setMessage(""); }}>{creating ? "J’ai déjà un compte" : "Créer un nouveau compte"}</button>
        </section>
      </main>
    );
  }

  return <MarketTerminal cloud={cloud} onSignOut={async () => { await client?.auth.signOut(); }} />;
}
