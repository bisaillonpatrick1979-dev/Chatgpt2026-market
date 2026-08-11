import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

type Provider = "twelve_data" | "alpaca" | "oanda" | "polygon" | "ibkr" | "openai";
type Environment = "data" | "paper" | "practice" | "ai" | "live";
type Action = "save" | "test" | "delete" | "market_data";
type MarketDataMode = "live" | "historical";

type RequestBody = {
  action?: Action;
  provider?: Provider;
  environment?: Environment;
  label?: string;
  accountReference?: string;
  credentials?: Record<string, unknown>;
  symbol?: string;
  interval?: string;
  outputsize?: number;
  mode?: MarketDataMode;
  endDate?: string;
};

type MarketInstrument = {
  id: string;
  provider_symbol: string;
  label: string;
  asset_type: string;
  market_region: string;
  venue_name: string;
  exchange_code: string | null;
  mic_code: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  session_kind: string;
  sessions: unknown;
  data_provider: string;
  execution_provider: string;
  access_note: string | null;
};

const PROVIDERS = new Set<Provider>(["twelve_data", "alpaca", "oanda", "polygon", "ibkr", "openai"]);
const ENVIRONMENTS = new Set<Environment>(["data", "paper", "practice", "ai", "live"]);
const INTERVALS = new Set(["1min", "5min", "15min", "30min", "1h", "4h", "1day"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function textCredential(credentials: Record<string, unknown>, key: string) {
  const value = credentials[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSymbol(value: string) {
  return value.replace(/[^A-Z0-9/._-]/gi, "").slice(0, 24).toUpperCase();
}

function intervalSeconds(interval: string) {
  const values: Record<string, number> = {
    "1min": 60,
    "5min": 300,
    "15min": 900,
    "30min": 1800,
    "1h": 3600,
    "4h": 14400,
    "1day": 86400,
  };
  return values[interval] || 300;
}

function normalizeHistoricalEndDate(value: string | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10);
}

async function testProvider(provider: Provider, environment: Environment, credentials: Record<string, unknown>) {
  if (environment === "live") throw new Error("Le mode courtier réel est verrouillé. Utilise paper ou practice.");

  if (provider === "openai") {
    if (environment !== "ai") throw new Error("OpenAI doit utiliser l’environnement IA.");
    const apiKey = textCredential(credentials, "apiKey");
    if (!apiKey) throw new Error("Clé OpenAI manquante.");
    const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.data)) throw new Error(payload?.error?.message || "OpenAI a refusé la connexion.");
    return "OpenAI connecté. L’orchestration gérée Luna → Terra → Sol choisit automatiquement le modèle.";
  }

  if (provider === "twelve_data") {
    const apiKey = textCredential(credentials, "apiKey");
    if (!apiKey) throw new Error("Clé Twelve Data manquante.");
    const response = await fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${encodeURIComponent(apiKey)}`);
    const payload = await response.json();
    if (!response.ok || payload?.status === "error" || !payload?.price) throw new Error(payload?.message || "Twelve Data a refusé la connexion.");
    return "Twelve Data connecté. La couverture exacte dépend du marché et du forfait.";
  }

  if (provider === "alpaca") {
    if (environment !== "paper") throw new Error("Alpaca est limité à l’environnement paper.");
    const apiKey = textCredential(credentials, "apiKey");
    const secretKey = textCredential(credentials, "secretKey");
    if (!apiKey || !secretKey) throw new Error("Clé et secret Alpaca paper requis.");
    const response = await fetch("https://paper-api.alpaca.markets/v2/account", {
      headers: { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": secretKey },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.id) throw new Error(payload?.message || "Alpaca paper a refusé la connexion.");
    return "Alpaca paper connecté. Aucun ordre réel n’est envoyé.";
  }

  if (provider === "oanda") {
    if (environment !== "practice") throw new Error("OANDA est limité à l’environnement practice.");
    const token = textCredential(credentials, "token");
    const accountId = textCredential(credentials, "accountId");
    if (!token || !accountId) throw new Error("Jeton et identifiant OANDA practice requis.");
    const response = await fetch(`https://api-fxpractice.oanda.com/v3/accounts/${encodeURIComponent(accountId)}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.account?.id) throw new Error(payload?.errorMessage || "OANDA practice a refusé la connexion.");
    return "OANDA practice connecté. Aucun ordre réel n’est envoyé.";
  }

  if (provider === "polygon") {
    const apiKey = textCredential(credentials, "apiKey");
    if (!apiKey) throw new Error("Clé Polygon manquante.");
    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`);
    const payload = await response.json();
    if (!response.ok || payload?.status === "ERROR" || !Array.isArray(payload?.results)) throw new Error(payload?.error || payload?.message || "Polygon a refusé la connexion.");
    return "Polygon connecté et agrégat AAPL reçu.";
  }

  const accountId = textCredential(credentials, "accountId");
  if (!accountId) throw new Error("Identifiant de compte IBKR requis.");
  return "Configuration IBKR paper enregistrée. L’envoi externe demeure désactivé.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Configuration serveur incomplète." }, 500);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Authentification requise." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Session invalide ou expirée." }, 401);

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }

  const action = body.action;
  const provider = body.provider;
  const environment = body.environment;
  if (!action || !provider || !environment || !PROVIDERS.has(provider) || !ENVIRONMENTS.has(environment)) {
    return json({ error: "Action, fournisseur ou environnement invalide." }, 400);
  }
  if (environment === "live") return json({ error: "Les clés de courtier réel et les ordres réels sont verrouillés." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = userData.user.id;

  try {
    if (action === "delete") {
      const { data, error } = await admin.rpc("delete_integration_credentials_admin", {
        p_user_id: userId,
        p_provider: provider,
        p_environment: environment,
      });
      if (error) throw error;
      return json({ ok: true, deleted: Boolean(data) });
    }

    if (action === "save") {
      const credentials = body.credentials;
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return json({ error: "Identifiants manquants." }, 400);
      if (JSON.stringify(credentials).length > 16384) return json({ error: "Identifiants trop volumineux." }, 413);
      const { data, error } = await admin.rpc("store_integration_credentials", {
        p_user_id: userId,
        p_provider: provider,
        p_environment: environment,
        p_label: body.label || "",
        p_account_reference: body.accountReference || "",
        p_credentials: credentials,
      });
      if (error) throw error;
      return json({ ok: true, connection: data });
    }

    const { data: credentials, error: credentialsError } = await admin.rpc("get_integration_credentials", {
      p_user_id: userId,
      p_provider: provider,
      p_environment: environment,
    });
    if (credentialsError) throw credentialsError;
    if (!credentials || typeof credentials !== "object") throw new Error("Aucun identifiant enregistré pour cette connexion.");

    if (action === "market_data") {
      if (provider !== "twelve_data" || environment !== "data") return json({ error: "Source de données invalide." }, 400);
      const apiKey = textCredential(credentials as Record<string, unknown>, "apiKey");
      if (!apiKey) throw new Error("Clé Twelve Data manquante.");

      const requestedMode: MarketDataMode = body.mode === "historical" ? "historical" : "live";
      const historicalEndDate = requestedMode === "historical" ? normalizeHistoricalEndDate(body.endDate) : undefined;
      const requestedSymbol = normalizeSymbol(body.symbol || "AAPL");
      const { data: instrumentData } = await admin
        .from("market_instruments")
        .select("id,provider_symbol,label,asset_type,market_region,venue_name,exchange_code,mic_code,country,timezone,currency,session_kind,sessions,data_provider,execution_provider,access_note")
        .eq("provider_symbol", requestedSymbol)
        .eq("enabled", true)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      const instrument = instrumentData as MarketInstrument | null;
      const providerSymbol = instrument?.provider_symbol || requestedSymbol;
      const interval = INTERVALS.has(body.interval || "") ? String(body.interval) : "5min";
      const outputsize = Math.min(500, Math.max(40, Number(body.outputsize) || 180));

      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol", providerSymbol);
      url.searchParams.set("interval", interval);
      url.searchParams.set("outputsize", String(outputsize));
      url.searchParams.set("order", "ASC");
      url.searchParams.set("timezone", "UTC");
      if (instrument?.mic_code) url.searchParams.set("mic_code", instrument.mic_code);
      else if (instrument?.exchange_code) url.searchParams.set("exchange", instrument.exchange_code);
      if (historicalEndDate) url.searchParams.set("end_date", `${historicalEndDate}T23:59:59`);
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || payload?.status === "error" || !Array.isArray(payload?.values)) {
        throw new Error(payload?.message || "Twelve Data n’a pas retourné de chandelles pour cette place de marché.");
      }

      const candles = payload.values.map((value: Record<string, string>) => ({
        time: Math.floor(new Date(`${value.datetime.replace(" ", "T")}Z`).getTime() / 1000),
        open: Number(value.open),
        high: Number(value.high),
        low: Number(value.low),
        close: Number(value.close),
      })).filter((value: Record<string, number>) => Number.isFinite(value.time) && Number.isFinite(value.close));

      const receivedAt = new Date();
      const latest = candles.at(-1);
      if (!latest) throw new Error("Aucune chandelle valide n’a été reçue.");
      const latestCandleAt = new Date(Number(latest.time) * 1000);
      const ageSeconds = Math.max(0, Math.floor((receivedAt.getTime() - latestCandleAt.getTime()) / 1000));
      const staleAfterSeconds = Math.max(120, Math.round(intervalSeconds(interval) * 2.5));
      const stale = requestedMode === "live" ? ageSeconds > staleAfterSeconds : false;
      const marketContext = {
        instrumentId: instrument?.id || null,
        label: instrument?.label || providerSymbol,
        assetType: instrument?.asset_type || (providerSymbol.includes("/") ? "forex" : "equity"),
        marketRegion: instrument?.market_region || "unknown",
        venueName: instrument?.venue_name || payload?.meta?.exchange || "Non déterminée",
        exchangeCode: instrument?.exchange_code || payload?.meta?.exchange || null,
        micCode: instrument?.mic_code || null,
        country: instrument?.country || null,
        timezone: instrument?.timezone || payload?.meta?.exchange_timezone || "UTC",
        currency: instrument?.currency || payload?.meta?.currency || null,
        sessionKind: instrument?.session_kind || null,
        sessions: instrument?.sessions || [],
        dataProvider: "twelve_data",
        executionProvider: instrument?.execution_provider || "internal_paper",
        accessNote: instrument?.access_note || null,
      };

      if (requestedMode === "live") {
        const { error: healthError } = await admin.from("market_data_health").upsert({
          user_id: userId,
          symbol: providerSymbol,
          interval,
          provider: "twelve_data",
          latest_candle_at: latestCandleAt.toISOString(),
          received_at: receivedAt.toISOString(),
          age_seconds: ageSeconds,
          stale_after_seconds: staleAfterSeconds,
          stale,
          metadata: {
            outputsize,
            candleCount: candles.length,
            source: "twelve-data",
            requestedMode,
            latestPrice: latest.close,
            marketContext,
            providerMeta: payload?.meta || {},
          },
          updated_at: receivedAt.toISOString(),
        }, { onConflict: "user_id,symbol,interval,provider" });
        if (healthError) throw healthError;
      }

      return json({
        symbol: providerSymbol,
        interval,
        source: "twelve-data",
        requestedMode,
        dataKind: requestedMode,
        providerName: "Twelve Data",
        providerSite: "https://twelvedata.com",
        apiHost: "api.twelvedata.com",
        transport: "Fonction Supabase sécurisée",
        fallback: false,
        delayed: stale,
        candles,
        candleCount: candles.length,
        historicalEndDate,
        receivedAt: receivedAt.toISOString(),
        latestCandleAt: latestCandleAt.toISOString(),
        ageSeconds,
        staleAfterSeconds,
        stale,
        marketContext,
        providerMeta: payload?.meta || {},
      });
    }

    let success = false;
    let message = "";
    try {
      message = await testProvider(provider, environment, credentials as Record<string, unknown>);
      success = true;
    } catch (error) {
      message = error instanceof Error ? error.message : "Échec du test de connexion.";
    }

    const { error: statusError } = await admin.rpc("set_integration_test_result", {
      p_user_id: userId,
      p_provider: provider,
      p_environment: environment,
      p_success: success,
      p_error: success ? null : message,
    });
    if (statusError) throw statusError;
    return json({ ok: success, message }, success ? 200 : 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur serveur inconnue.";
    return json({ error: message.slice(0, 500) }, 400);
  }
});
