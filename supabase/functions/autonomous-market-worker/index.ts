import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

type Signal = "BUY" | "SELL" | "HOLD";
type Stance = "bullish" | "bearish" | "neutral";
type SourceClass = "official" | "regulator" | "central_bank" | "exchange" | "major_media" | "other";

type Source = {
  url: string;
  title: string | null;
  domain: string;
  sourceClass: SourceClass;
  credibility: number;
};

type Instrument = {
  id: string;
  provider_symbol: string;
  label: string;
  asset_type: string;
  market_region: string;
  venue_name: string;
  exchange_code: string | null;
  mic_code: string | null;
  timezone: string;
  currency: string;
  session_kind: "exchange" | "forex" | "crypto";
  sessions: Array<{ name: string; open: string; close: string }>;
  data_provider: string;
  execution_provider: string;
  access_note: string | null;
  sort_order: number;
};

type AgentSession = {
  id: string;
  user_id: string;
  wallet_id: string;
  status: string;
  ends_at: string | null;
  settings: Record<string, unknown>;
};

const DEFAULT_DOMAINS = [
  "reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com",
  "sec.gov", "federalreserve.gov", "bankofcanada.ca", "bls.gov", "bea.gov",
  "ecb.europa.eu", "bankofengland.co.uk", "boj.or.jp", "rba.gov.au",
  "nyse.com", "nasdaq.com", "tsx.com", "asx.com.au", "jpx.co.jp",
  "londonstockexchange.com", "euronext.com", "oecd.org", "imf.org", "worldbank.org",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-worker-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["signal", "stance", "confidence", "summary", "risks", "agentVotes", "paperTradePlan"],
  properties: {
    signal: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
    stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" }, maxItems: 10 },
    agentVotes: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "stance", "confidence", "rationale"],
        properties: {
          agent: { type: "string" },
          stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
      },
    },
    paperTradePlan: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "side", "stopLossPct", "takeProfitPct", "maxRiskPct", "invalidation"],
      properties: {
        enabled: { type: "boolean" },
        side: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
        stopLossPct: { type: "number", minimum: 0, maximum: 20 },
        takeProfitPct: { type: "number", minimum: 0, maximum: 50 },
        maxRiskPct: { type: "number", minimum: 0, maximum: 0.5 },
        invalidation: { type: "string" },
      },
    },
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function secretText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw.trim() : "";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function domainOf(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function classify(domain: string): SourceClass {
  if (["sec.gov", "bls.gov", "bea.gov"].some((item) => domain === item || domain.endsWith(`.${item}`))) return "regulator";
  if (["federalreserve.gov", "bankofcanada.ca", "ecb.europa.eu", "bankofengland.co.uk", "boj.or.jp", "rba.gov.au"].some((item) => domain === item || domain.endsWith(`.${item}`))) return "central_bank";
  if (["nyse.com", "nasdaq.com", "tsx.com", "asx.com.au", "jpx.co.jp", "londonstockexchange.com", "euronext.com"].some((item) => domain === item || domain.endsWith(`.${item}`))) return "exchange";
  if (["oecd.org", "imf.org", "worldbank.org"].some((item) => domain === item || domain.endsWith(`.${item}`))) return "official";
  if (["reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com"].some((item) => domain === item || domain.endsWith(`.${item}`))) return "major_media";
  return "other";
}

function credibility(kind: SourceClass) {
  if (["official", "regulator", "central_bank", "exchange"].includes(kind)) return 0.98;
  if (kind === "major_media") return 0.90;
  return 0.65;
}

function collectSources(output: unknown): Source[] {
  const sources = new Map<string, Source>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== "string" || !url.startsWith("http")) return;
    const domain = domainOf(url);
    const sourceClass = classify(domain);
    sources.set(url, {
      url,
      title: typeof title === "string" ? title.slice(0, 500) : null,
      domain,
      sourceClass,
      credibility: credibility(sourceClass),
    });
  };

  for (const item of (Array.isArray(output) ? output : []) as Array<Record<string, unknown>>) {
    if (item.type === "web_search_call") {
      const action = item.action as Record<string, unknown> | undefined;
      for (const source of (Array.isArray(action?.sources) ? action?.sources : []) as Array<Record<string, unknown>>) add(source.url, source.title);
    }
    if (item.type === "message") {
      for (const part of (Array.isArray(item.content) ? item.content : []) as Array<Record<string, unknown>>) {
        for (const annotation of (Array.isArray(part.annotations) ? part.annotations : []) as Array<Record<string, unknown>>) {
          if (annotation.type === "url_citation") add(annotation.url, annotation.title);
        }
      }
    }
  }
  return [...sources.values()].slice(0, 30);
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of (Array.isArray(payload.output) ? payload.output : []) as Array<Record<string, unknown>>) {
    if (item.type !== "message") continue;
    for (const part of (Array.isArray(item.content) ? item.content : []) as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function technicalContext(candles: Array<{ open: number; high: number; low: number; close: number }>) {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const five = candles.slice(-5);
  const twenty = candles.slice(-20);
  const fourteen = candles.slice(-14);
  const sma5 = mean(five.map((item) => item.close));
  const sma20 = mean(twenty.map((item) => item.close));
  const atr14 = mean(fourteen.map((item) => Math.max(item.high - item.low, 0.000001)));
  return {
    lastPrice: latest?.close || 0,
    changePct: latest && previous ? ((latest.close - previous.close) / previous.close) * 100 : 0,
    sma5,
    sma20,
    atr14,
    high20: twenty.length ? Math.max(...twenty.map((item) => item.high)) : 0,
    low20: twenty.length ? Math.min(...twenty.map((item) => item.low)) : 0,
    trend: sma5 > sma20 ? "up" : sma5 < sma20 ? "down" : "flat",
    candleCount: candles.length,
  };
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

function sessionLabel(instrument: Instrument, date = new Date()) {
  if (instrument.session_kind === "crypto") return "24/7";
  if (instrument.session_kind === "forex") {
    const ny = localParts(date, "America/New_York");
    const nyHour = ny.hour + ny.minute / 60;
    if (ny.weekday === "Sat" || (ny.weekday === "Sun" && nyHour < 17) || (ny.weekday === "Fri" && nyHour >= 17)) return "Fermé hebdomadaire";
    const active: string[] = [];
    for (const [label, timezone] of [["Sydney", "Australia/Sydney"], ["Tokyo", "Asia/Tokyo"], ["Londres", "Europe/London"], ["New York", "America/New_York"]] as const) {
      const local = localParts(date, timezone);
      const hour = local.hour + local.minute / 60;
      if (hour >= 8 && hour < 17) active.push(label);
    }
    return active.length ? active.join(" + ") : "Entre sessions principales";
  }

  const local = localParts(date, instrument.timezone);
  if (local.weekday === "Sat" || local.weekday === "Sun") return "Fermé";
  const hour = local.hour + local.minute / 60;
  const active = (instrument.sessions || []).find((item) => {
    const [openHour, openMinute] = item.open.split(":").map(Number);
    const [closeHour, closeMinute] = item.close.split(":").map(Number);
    return hour >= openHour + openMinute / 60 && hour < closeHour + closeMinute / 60;
  });
  return active?.name || "Hors séance";
}

function marketOpen(label: string) {
  return !["Fermé", "Hors séance", "Fermé hebdomadaire"].includes(label);
}

async function finishCycle(admin: ReturnType<typeof createClient>, sessionId: string, status: string, message: string, symbol: string | null, nextSeconds: number) {
  await admin.rpc("finish_autonomous_session_cycle", {
    p_session_id: sessionId,
    p_status: status,
    p_message: message,
    p_symbol: symbol,
    p_next_seconds: nextSeconds,
  });
}

async function processSession(admin: ReturnType<typeof createClient>, session: AgentSession) {
  const claimed = await admin.rpc("claim_autonomous_session_cycle", { p_session_id: session.id, p_lease_seconds: 420 });
  if (claimed.error || claimed.data !== true) return { sessionId: session.id, skipped: true, reason: "cycle-not-due-or-claimed" };

  let targetSymbol: string | null = null;
  let runId: string | null = null;
  try {
    const [settingsResult, walletResult, connectionsResult, openPositionsResult, watchlistResult, instrumentsResult] = await Promise.all([
      admin.from("intelligence_settings").select("*").eq("user_id", session.user_id).maybeSingle(),
      admin.from("paper_wallets").select("id,cash_balance,agent_allocation,risk_settings,kill_switch").eq("id", session.wallet_id).eq("user_id", session.user_id).single(),
      admin.from("integration_connections").select("provider,environment,status,last_error").eq("user_id", session.user_id).in("provider", ["openai", "twelve_data"]),
      admin.from("positions").select("symbol").eq("user_id", session.user_id).eq("status", "open").order("opened_at", { ascending: true }),
      admin.from("watchlist_items").select("symbol").eq("user_id", session.user_id).order("created_at", { ascending: true }),
      admin.from("market_instruments").select("id,provider_symbol,label,asset_type,market_region,venue_name,exchange_code,mic_code,timezone,currency,session_kind,sessions,data_provider,execution_provider,access_note,sort_order").eq("enabled", true).order("sort_order", { ascending: true }),
    ]);

    if (settingsResult.error || walletResult.error || connectionsResult.error || instrumentsResult.error) throw new Error("Configuration du travailleur impossible à charger.");
    const settings = settingsResult.data || {};
    const wallet = walletResult.data;
    if (settings.enabled === false) {
      await finishCycle(admin, session.id, "disabled", "Intelligence IA désactivée dans les paramètres.", null, 300);
      return { sessionId: session.id, skipped: true, reason: "intelligence-disabled" };
    }
    if (wallet.kill_switch) {
      await finishCycle(admin, session.id, "blocked", "Kill switch actif; aucune nouvelle analyse exécutable.", null, 300);
      return { sessionId: session.id, skipped: true, reason: "kill-switch" };
    }

    const connections = connectionsResult.data || [];
    const openAiConnected = connections.some((item) => item.provider === "openai" && item.environment === "ai" && item.status === "connected");
    const twelveConnected = connections.some((item) => item.provider === "twelve_data" && item.environment === "data" && item.status === "connected");
    if (!openAiConnected || !twelveConnected) throw new Error(`Connexion manquante : ${!openAiConnected ? "OpenAI" : ""}${!openAiConnected && !twelveConnected ? " et " : ""}${!twelveConnected ? "Twelve Data" : ""}.`);

    const [openAiCredentialResult, twelveCredentialResult] = await Promise.all([
      admin.rpc("get_integration_credentials", { p_user_id: session.user_id, p_provider: "openai", p_environment: "ai" }),
      admin.rpc("get_integration_credentials", { p_user_id: session.user_id, p_provider: "twelve_data", p_environment: "data" }),
    ]);
    if (openAiCredentialResult.error || twelveCredentialResult.error) throw new Error("Identifiants chiffrés impossibles à lire.");
    const openAiKey = secretText(openAiCredentialResult.data, "apiKey");
    const twelveKey = secretText(twelveCredentialResult.data, "apiKey");
    if (!openAiKey || !twelveKey) throw new Error("Clé OpenAI ou Twelve Data absente du coffre-fort.");

    const instruments = (instrumentsResult.data || []) as Instrument[];
    const instrumentBySymbol = new Map(instruments.map((item) => [item.provider_symbol, item]));
    const orderedSymbols = [...new Set([
      ...(openPositionsResult.data || []).map((item) => item.symbol),
      ...(watchlistResult.data || []).map((item) => item.symbol),
      ...instruments.filter((item) => item.default_watchlist !== false).map((item) => item.provider_symbol),
    ])].filter((symbol) => instrumentBySymbol.has(symbol));

    if (!orderedSymbols.length) throw new Error("Aucun instrument valide dans la surveillance mondiale.");

    const { data: validRuns } = await admin
      .from("market_research_runs")
      .select("symbol,expires_at,status")
      .eq("user_id", session.user_id)
      .eq("status", "completed")
      .in("symbol", orderedSymbols)
      .gt("expires_at", new Date().toISOString());
    const freshSymbols = new Set((validRuns || []).map((item) => item.symbol));

    const candidates = orderedSymbols
      .map((symbol) => instrumentBySymbol.get(symbol)!)
      .filter((instrument) => !freshSymbols.has(instrument.provider_symbol))
      .map((instrument) => ({ instrument, session: sessionLabel(instrument) }))
      .filter((item) => marketOpen(item.session));

    if (!candidates.length) {
      await finishCycle(admin, session.id, "idle", "Toutes les recherches des marchés ouverts sont encore valides. Prochain contrôle automatique.", null, 60);
      return { sessionId: session.id, skipped: true, reason: "all-research-fresh-or-markets-closed" };
    }

    const instrument = candidates[0].instrument;
    const activeMarketSession = candidates[0].session;
    targetSymbol = instrument.provider_symbol;

    const marketUrl = new URL("https://api.twelvedata.com/time_series");
    marketUrl.searchParams.set("symbol", targetSymbol);
    marketUrl.searchParams.set("interval", "5min");
    marketUrl.searchParams.set("outputsize", "180");
    marketUrl.searchParams.set("order", "ASC");
    marketUrl.searchParams.set("timezone", "UTC");
    if (instrument.mic_code) marketUrl.searchParams.set("mic_code", instrument.mic_code);
    else if (instrument.exchange_code) marketUrl.searchParams.set("exchange", instrument.exchange_code);
    marketUrl.searchParams.set("apikey", twelveKey);

    const marketResponse = await fetch(marketUrl);
    const marketPayload = await marketResponse.json();
    if (!marketResponse.ok || marketPayload?.status === "error" || !Array.isArray(marketPayload?.values)) throw new Error(marketPayload?.message || `Twelve Data n’a pas fourni ${targetSymbol}.`);

    const candles = marketPayload.values.map((value: Record<string, string>) => ({
      time: Math.floor(new Date(`${String(value.datetime).replace(" ", "T")}Z`).getTime() / 1000),
      open: Number(value.open),
      high: Number(value.high),
      low: Number(value.low),
      close: Number(value.close),
    })).filter((value: Record<string, number>) => Number.isFinite(value.time) && Number.isFinite(value.close));
    if (candles.length < 30) throw new Error(`Seulement ${candles.length} chandelles valides reçues pour ${targetSymbol}.`);

    const receivedAt = new Date();
    const latestCandleAt = new Date(candles.at(-1)!.time * 1000);
    const ageSeconds = Math.max(0, Math.floor((receivedAt.getTime() - latestCandleAt.getTime()) / 1000));
    const staleAfterSeconds = 750;
    const stale = ageSeconds > staleAfterSeconds;
    const context = technicalContext(candles);
    const marketContext = {
      instrumentId: instrument.id,
      label: instrument.label,
      assetType: instrument.asset_type,
      marketRegion: instrument.market_region,
      venueName: instrument.venue_name,
      exchangeCode: instrument.exchange_code,
      micCode: instrument.mic_code,
      timezone: instrument.timezone,
      currency: instrument.currency,
      session: activeMarketSession,
      dataProvider: instrument.data_provider,
      executionProvider: instrument.execution_provider,
      accessNote: instrument.access_note,
    };

    await admin.from("market_data_health").upsert({
      user_id: session.user_id,
      symbol: targetSymbol,
      interval: "5min",
      provider: "twelve_data",
      latest_candle_at: latestCandleAt.toISOString(),
      received_at: receivedAt.toISOString(),
      age_seconds: ageSeconds,
      stale_after_seconds: staleAfterSeconds,
      stale,
      metadata: { latestPrice: context.lastPrice, candleCount: candles.length, marketContext, providerMeta: marketPayload?.meta || {}, serverWorker: true },
      updated_at: receivedAt.toISOString(),
    }, { onConflict: "user_id,symbol,interval,provider" });

    if (stale) throw new Error(`Données ${targetSymbol} trop anciennes (${ageSeconds} secondes).`);

    runId = crypto.randomUUID();
    const minimumSources = Math.max(4, Number(settings.minimum_sources) || 6);
    const minimumDomains = Math.max(3, Number(settings.minimum_distinct_domains) || 4);
    const minimumConfidence = Math.max(0.60, Number(settings.minimum_confidence) || 0.68);
    const minimumAgreement = Math.max(0.55, Number(settings.minimum_directional_agreement) || 0.60);
    const validityMinutes = Math.max(5, Math.min(60, Number(settings.max_research_age_minutes) || 15));
    const allowedDomains = Array.isArray(settings.allowed_domains) && settings.allowed_domains.length ? settings.allowed_domains : DEFAULT_DOMAINS;
    const model = typeof settings.research_model === "string" && settings.research_model ? settings.research_model : "gpt-5.6-luna";

    await admin.from("market_research_runs").insert({
      id: runId,
      user_id: session.user_id,
      wallet_id: session.wallet_id,
      symbol: targetSymbol,
      asset_type: instrument.asset_type,
      interval: "5min",
      horizon: "intraday",
      mode: "quick",
      model,
      status: "running",
      request_context: { technicalContext: context, marketContext, dataMode: "live", serverWorker: true, sessionId: session.id },
    });

    const openAiBody = {
      model,
      store: false,
      reasoning: { effort: "low" },
      instructions: "Tu es l’orchestrateur professionnel de QuantFarm AI, strictement paper trading. Analyse les faits actuels avec des spécialistes indépendants: macro, nouvelles, fondamentaux, technique, risques et contradicteur. Distingue la source de prix, la place de marché et le portefeuille paper. Force HOLD quand les sources, la fraîcheur, l’accord ou la confiance sont insuffisants. Aucun ordre réel et aucune promesse de rendement.",
      input: `Analyse ${targetSymbol} (${instrument.asset_type}) sur ${instrument.venue_name}${instrument.mic_code ? `, MIC ${instrument.mic_code}` : ""}. Session active: ${activeMarketSession}. Heure UTC: ${receivedAt.toISOString()}. Données Twelve Data: ${JSON.stringify(context)}. Source de prix: Twelve Data. Destination: portefeuille paper Supabase. Produis une décision structurée et prudente.`,
      tools: [{
        type: "web_search",
        search_context_size: "medium",
        filters: { allowed_domains: allowedDomains.slice(0, 40) },
        user_location: { type: "approximate", city: "Calgary", region: "Alberta", country: "CA", timezone: "America/Edmonton" },
      }],
      tool_choice: "required",
      max_tool_calls: 7,
      include: ["web_search_call.action.sources"],
      text: {
        verbosity: "medium",
        format: { type: "json_schema", name: "autonomous_market_decision", strict: true, schema: responseSchema },
      },
    };

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(openAiBody),
    });
    const aiPayload = await aiResponse.json() as Record<string, unknown>;
    if (!aiResponse.ok) {
      const error = aiPayload.error as Record<string, unknown> | undefined;
      throw new Error(typeof error?.message === "string" ? error.message : `${model} a refusé l’analyse.`);
    }

    const text = outputText(aiPayload);
    if (!text) throw new Error(`${model} n’a retourné aucune décision structurée.`);
    const result = JSON.parse(text) as Record<string, unknown>;
    const sources = collectSources(aiPayload.output);
    const distinctDomains = new Set(sources.map((item) => item.domain).filter((item) => item !== "unknown")).size;
    const officialCount = sources.filter((item) => ["official", "regulator", "central_bank", "exchange"].includes(item.sourceClass)).length;
    const averageCredibility = sources.length ? mean(sources.map((item) => item.credibility)) : 0;
    let signal = (["BUY", "SELL", "HOLD"].includes(String(result.signal)) ? result.signal : "HOLD") as Signal;
    let confidence = clamp(Number(result.confidence) || 0, 0, 1);
    const votes = Array.isArray(result.agentVotes) ? result.agentVotes as Array<Record<string, unknown>> : [];
    const expectedStance: Stance = signal === "BUY" ? "bullish" : signal === "SELL" ? "bearish" : "neutral";
    const agreement = signal === "HOLD" ? 1 : votes.length ? votes.filter((vote) => vote.stance === expectedStance && Number(vote.confidence) >= 0.55).length / votes.length : 0;
    const failures: string[] = [];
    if (sources.length < minimumSources) failures.push(`${sources.length} sources; ${minimumSources} requises.`);
    if (distinctDomains < minimumDomains) failures.push(`${distinctDomains} domaines; ${minimumDomains} requis.`);
    if (officialCount < 1) failures.push("Aucune source officielle, réglementaire, banque centrale ou bourse.");
    if (averageCredibility < 0.80) failures.push(`Crédibilité moyenne ${Math.round(averageCredibility * 100)} % trop faible.`);
    if (confidence < minimumConfidence) failures.push(`Confiance ${Math.round(confidence * 100)} % sous ${Math.round(minimumConfidence * 100)} %.`);
    if (signal !== "HOLD" && agreement < minimumAgreement) failures.push(`Accord ${Math.round(agreement * 100)} % sous ${Math.round(minimumAgreement * 100)} %.`);

    if (failures.length) {
      signal = "HOLD";
      confidence = Math.min(confidence, 0.49);
    }

    const plan = result.paperTradePlan && typeof result.paperTradePlan === "object" ? result.paperTradePlan as Record<string, unknown> : {};
    const guardedResult = {
      ...result,
      signal,
      confidence,
      marketContext,
      serverWorker: true,
      qualityGate: {
        passed: failures.length === 0,
        failures,
        sourceCount: sources.length,
        distinctDomainCount: distinctDomains,
        officialSourceCount: officialCount,
        averageCredibility,
        directionalAgreement: agreement,
        minimumSources,
        minimumDomains,
        minimumConfidence,
        minimumAgreement,
      },
    };

    if (sources.length) {
      await admin.from("market_research_sources").insert(sources.map((source) => ({
        run_id: runId,
        user_id: session.user_id,
        url: source.url,
        title: source.title,
        domain: source.domain,
        source_class: source.sourceClass,
        credibility_score: source.credibility,
        relevance_score: 0.75,
      })));
    }
    if (votes.length) {
      await admin.from("market_agent_votes").insert(votes.map((vote) => ({
        run_id: runId,
        user_id: session.user_id,
        agent_name: String(vote.agent || "Agent"),
        stance: ["bullish", "bearish", "neutral"].includes(String(vote.stance)) ? vote.stance : "neutral",
        confidence: clamp(Number(vote.confidence) || 0, 0, 1),
        rationale: String(vote.rationale || "Aucune justification."),
      })));
    }

    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + validityMinutes * 60_000);
    await admin.from("market_research_runs").update({
      status: "completed",
      result: guardedResult,
      overall_sentiment: result.stance === "bullish" ? confidence : result.stance === "bearish" ? -confidence : 0,
      confidence,
      signal,
      source_count: sources.length,
      official_source_count: officialCount,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }).eq("id", runId);

    await admin.from("trade_logs").insert({
      user_id: session.user_id,
      wallet_id: session.wallet_id,
      session_id: session.id,
      agent_name: "Travailleur IA serveur",
      action: `Analyse ${targetSymbol} — ${signal}`,
      reason: String(result.summary || "Analyse autonome terminée."),
      payload: { runId, signal, confidence, marketContext, sourceCount: sources.length, failures, paperOnly: true, serverWorker: true },
    });

    let execution: Record<string, unknown> | null = null;
    const planEnabled = plan.enabled === true && plan.side === signal;
    if (signal !== "HOLD" && failures.length === 0 && planEnabled) {
      const entryPrice = Number(context.lastPrice) || 0;
      const stopLossPct = clamp(Number(plan.stopLossPct) || 0, 0, 20);
      const takeProfitPct = clamp(Number(plan.takeProfitPct) || 0, 0, 50);
      const walletRisk = wallet.risk_settings && typeof wallet.risk_settings === "object" ? Number((wallet.risk_settings as Record<string, unknown>).riskPerTradePct) || 0.25 : 0.25;
      const maxRiskPct = clamp(Math.min(Number(plan.maxRiskPct) || walletRisk, walletRisk, 0.5), 0.01, 0.5);
      if (entryPrice > 0 && stopLossPct > 0 && takeProfitPct > 0) {
        const stopLoss = signal === "BUY" ? entryPrice * (1 - stopLossPct / 100) : entryPrice * (1 + stopLossPct / 100);
        const takeProfit = signal === "BUY" ? entryPrice * (1 + takeProfitPct / 100) : entryPrice * (1 - takeProfitPct / 100);
        const stopDistance = Math.abs(entryPrice - stopLoss);
        const allocation = Number(wallet.agent_allocation) || 0;
        const cash = Number(wallet.cash_balance) || 0;
        const riskQuantity = (allocation * (maxRiskPct / 100)) / Math.max(stopDistance, 0.000001);
        const allocationQuantity = (allocation * 0.20) / entryPrice;
        const cashQuantity = signal === "BUY" ? cash / entryPrice : allocationQuantity;
        const quantity = Math.max(0, Math.min(riskQuantity, allocationQuantity, cashQuantity));
        if (quantity > 0) {
          const executionResult = await admin.rpc("execute_agent_paper_trade", {
            p_user_id: session.user_id,
            p_session_id: session.id,
            p_symbol: targetSymbol,
            p_side: signal,
            p_entry_price: entryPrice,
            p_stop_loss: stopLoss,
            p_take_profit: takeProfit,
            p_quantity: Number(quantity.toFixed(8)),
            p_research_run_id: runId,
            p_market_context: { marketContext, serverWorker: true, dataMode: "live" },
          });
          if (!executionResult.error) execution = executionResult.data as Record<string, unknown>;
          else execution = { executed: false, reason: executionResult.error.message };
        }
      }
    }

    const status = execution && execution.ok === true ? "executed" : signal === "HOLD" ? "hold" : "analyzed";
    const message = execution && execution.ok === true
      ? `${signal} ${targetSymbol} exécuté dans le portefeuille paper sur ${instrument.venue_name}.`
      : signal === "HOLD"
        ? `Analyse ${targetSymbol} terminée : HOLD. ${failures[0] || "Aucune entrée suffisamment forte."}`
        : `Analyse ${targetSymbol} terminée sans nouvel ordre paper.`;
    await finishCycle(admin, session.id, status, message, targetSymbol, 60);
    return { sessionId: session.id, symbol: targetSymbol, signal, confidence, execution, sourceCount: sources.length, failures };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur autonome inconnue.";
    if (runId) await admin.from("market_research_runs").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", runId);
    await finishCycle(admin, session.id, "error", message, targetSymbol, 180);
    await admin.from("trade_logs").insert({
      user_id: session.user_id,
      wallet_id: session.wallet_id,
      session_id: session.id,
      agent_name: "Travailleur IA serveur",
      action: "Cycle autonome en erreur",
      reason: message.slice(0, 500),
      payload: { symbol: targetSymbol, paperOnly: true, serverWorker: true },
    });
    return { sessionId: session.id, symbol: targetSymbol, error: message };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
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
  if (configError || !config || config.enabled !== true || await sha256(suppliedSecret) !== config.secret_hash) return json({ error: "Accès au travailleur refusé." }, 403);

  await admin.rpc("expire_autonomous_sessions");
  const { data: sessions, error: sessionsError } = await admin
    .from("agent_sessions")
    .select("id,user_id,wallet_id,status,ends_at,settings")
    .eq("trading_mode", "autonomous")
    .eq("data_mode", "live")
    .eq("status", "running")
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .order("started_at", { ascending: true })
    .limit(4);
  if (sessionsError) return json({ error: sessionsError.message }, 500);

  const results = [];
  for (const session of (sessions || []) as AgentSession[]) results.push(await processSession(admin, session));
  return json({ ok: true, processedAt: new Date().toISOString(), sessionCount: results.length, results });
});
