import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

type Instrument = {
  id: string;
  provider_symbol: string;
  exchange_code: string | null;
  mic_code: string | null;
  timezone: string;
  session_kind: "exchange" | "forex" | "crypto";
  sessions: Array<{ name: string; open: string; close: string }>;
};

type Position = {
  id: string;
  user_id: string;
  wallet_id: string;
  session_id: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number | string;
  stop_loss: number | string | null;
  take_profit: number | string | null;
  trailing_stop_pct: number | string | null;
  market_instrument_id: string | null;
  exchange: string | null;
  mic_code: string | null;
};

type AgentSession = {
  id: string;
  status: "running" | "paused" | "stopped" | "completed" | "failed";
  ends_at: string | null;
  settings: Record<string, unknown>;
};

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secretText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw.trim() : "";
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
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) };
}

function marketIsOpen(instrument: Instrument, date = new Date()) {
  if (instrument.session_kind === "crypto") return true;
  if (instrument.session_kind === "forex") {
    const ny = localParts(date, "America/New_York");
    const decimal = ny.hour + ny.minute / 60;
    if (ny.weekday === "Sat") return false;
    if (ny.weekday === "Sun") return decimal >= 17;
    if (ny.weekday === "Fri") return decimal < 17;
    return true;
  }
  const local = localParts(date, instrument.timezone);
  if (local.weekday === "Sat" || local.weekday === "Sun") return false;
  const decimal = local.hour + local.minute / 60;
  return (instrument.sessions || []).some((session) => {
    const [openHour, openMinute] = session.open.split(":").map(Number);
    const [closeHour, closeMinute] = session.close.split(":").map(Number);
    return decimal >= openHour + openMinute / 60 && decimal < closeHour + closeMinute / 60;
  });
}

async function latestPrice(apiKey: string, position: Position, instrument: Instrument | undefined) {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", position.symbol);
  url.searchParams.set("interval", "1min");
  url.searchParams.set("outputsize", "2");
  url.searchParams.set("order", "DESC");
  url.searchParams.set("timezone", "UTC");
  if (instrument?.mic_code || position.mic_code) url.searchParams.set("mic_code", instrument?.mic_code || position.mic_code || "");
  else if (instrument?.exchange_code || position.exchange) url.searchParams.set("exchange", instrument?.exchange_code || position.exchange || "");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload?.status === "error" || !Array.isArray(payload?.values) || !payload.values.length) {
    throw new Error(payload?.message || `Prix Twelve Data indisponible pour ${position.symbol}.`);
  }

  const row = payload.values[0] as Record<string, string>;
  const price = Number(row.close);
  const candleAt = new Date(`${String(row.datetime).replace(" ", "T")}Z`);
  if (!Number.isFinite(price) || price <= 0 || Number.isNaN(candleAt.getTime())) throw new Error(`Prix invalide pour ${position.symbol}.`);
  return { price, candleAt, providerMeta: payload.meta || {} };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuration serveur incomplète." }, 500);

  const suppliedSecret = request.headers.get("x-worker-secret") || "";
  if (!suppliedSecret) return json({ error: "Secret du travailleur requis." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error: configError } = await admin
    .from("worker_configuration")
    .select("secret_hash,enabled")
    .eq("name", "autonomous_market_worker")
    .maybeSingle();
  if (configError || !config || config.enabled !== true || await sha256(suppliedSecret) !== config.secret_hash) return json({ error: "Accès refusé." }, 403);

  const [{ data: positions, error: positionError }, { data: instruments, error: instrumentError }] = await Promise.all([
    admin
      .from("positions")
      .select("id,user_id,wallet_id,session_id,symbol,side,entry_price,stop_loss,take_profit,trailing_stop_pct,market_instrument_id,exchange,mic_code")
      .eq("origin", "agent")
      .eq("status", "open")
      .order("opened_at", { ascending: true })
      .limit(100),
    admin
      .from("market_instruments")
      .select("id,provider_symbol,exchange_code,mic_code,timezone,session_kind,sessions")
      .eq("enabled", true),
  ]);
  if (positionError || instrumentError) return json({ error: positionError?.message || instrumentError?.message }, 500);

  const openPositions = (positions || []) as Position[];
  if (!openPositions.length) return json({ ok: true, checkedAt: new Date().toISOString(), positionCount: 0, results: [] });

  const sessionIds = [...new Set(openPositions.map((position) => position.session_id).filter(Boolean))] as string[];
  const { data: sessions } = sessionIds.length
    ? await admin.from("agent_sessions").select("id,status,ends_at,settings").in("id", sessionIds)
    : { data: [] };
  const sessionMap = new Map(((sessions || []) as AgentSession[]).map((session) => [session.id, session]));
  const instrumentRows = (instruments || []) as Instrument[];
  const instrumentById = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]));
  const instrumentBySymbol = new Map(instrumentRows.map((instrument) => [instrument.provider_symbol, instrument]));
  const userIds = [...new Set(openPositions.map((position) => position.user_id))];

  const keys = new Map<string, string>();
  const unavailableUsers = new Map<string, string>();
  for (const userId of userIds) {
    const { data: connection } = await admin
      .from("integration_connections")
      .select("status")
      .eq("user_id", userId)
      .eq("provider", "twelve_data")
      .eq("environment", "data")
      .maybeSingle();
    if (connection?.status !== "connected") {
      unavailableUsers.set(userId, "Twelve Data n’est pas connecté.");
      continue;
    }
    const { data: credentials, error } = await admin.rpc("get_integration_credentials", {
      p_user_id: userId,
      p_provider: "twelve_data",
      p_environment: "data",
    });
    const apiKey = secretText(credentials, "apiKey");
    if (error || !apiKey) unavailableUsers.set(userId, "Clé Twelve Data introuvable dans Vault.");
    else keys.set(userId, apiKey);
  }

  const quoteCache = new Map<string, Awaited<ReturnType<typeof latestPrice>>>();
  const results: Array<Record<string, unknown>> = [];
  const now = new Date();

  for (const position of openPositions) {
    const unavailable = unavailableUsers.get(position.user_id);
    if (unavailable) {
      results.push({ positionId: position.id, symbol: position.symbol, managed: false, error: unavailable });
      continue;
    }

    try {
      const apiKey = keys.get(position.user_id)!;
      const instrument = position.market_instrument_id
        ? instrumentById.get(position.market_instrument_id)
        : instrumentBySymbol.get(position.symbol);
      const cacheKey = `${position.user_id}:${position.symbol}:${instrument?.mic_code || position.mic_code || instrument?.exchange_code || position.exchange || ""}`;
      let quote = quoteCache.get(cacheKey);
      if (!quote) {
        quote = await latestPrice(apiKey, position, instrument);
        quoteCache.set(cacheKey, quote);
      }

      const session = position.session_id ? sessionMap.get(position.session_id) : undefined;
      const sessionEnded = !session || ["stopped", "completed", "failed"].includes(session.status) || (session.ends_at !== null && new Date(session.ends_at).getTime() <= now.getTime());
      const closeAtEnd = session?.settings?.closeAgentsAtEnd !== false;
      const forceClose = sessionEnded && closeAtEnd;
      const marketOpen = instrument ? marketIsOpen(instrument, now) : true;
      const ageSeconds = Math.max(0, Math.floor((now.getTime() - quote.candleAt.getTime()) / 1000));

      if (!forceClose && marketOpen && ageSeconds > 300) {
        throw new Error(`Prix ${position.symbol} trop ancien (${ageSeconds} secondes).`);
      }
      if (!forceClose && !marketOpen) {
        results.push({ positionId: position.id, symbol: position.symbol, managed: false, waiting: "Marché fermé" });
        continue;
      }

      const trailingStopPct = Math.max(0.05, Math.min(10, Number(session?.settings?.trailingStopPct) || Number(position.trailing_stop_pct) || 0.75));
      const { data, error } = await admin.rpc("manage_agent_paper_position", {
        p_user_id: position.user_id,
        p_position_id: position.id,
        p_market_price: quote.price,
        p_trailing_stop_pct: trailingStopPct,
        p_force_close: forceClose,
        p_force_reason: forceClose ? "Fin de la session autonome; fermeture paper de sécurité." : null,
        p_metadata: {
          serverPositionManager: true,
          provider: "twelve_data",
          quoteAt: quote.candleAt.toISOString(),
          quoteAgeSeconds: ageSeconds,
          marketOpen,
          sessionStatus: session?.status || "missing",
          providerMeta: quote.providerMeta,
        },
      });
      if (error) throw error;
      results.push({ positionId: position.id, symbol: position.symbol, managed: true, ...((data || {}) as Record<string, unknown>) });
    } catch (error) {
      results.push({ positionId: position.id, symbol: position.symbol, managed: false, error: error instanceof Error ? error.message : "Erreur inconnue." });
    }
  }

  return json({ ok: true, checkedAt: now.toISOString(), positionCount: openPositions.length, results });
});
