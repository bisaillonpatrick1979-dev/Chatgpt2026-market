import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

type Horizon = "intraday" | "swing" | "position" | "macro";
type Mode = "quick" | "deep";
type Signal = "BUY" | "SELL" | "HOLD";
type Stance = "bullish" | "bearish" | "neutral";
type SourceClass = "official" | "regulator" | "central_bank" | "exchange" | "major_media" | "company" | "research" | "other";

type RequestBody = {
  symbol?: string;
  assetType?: string;
  interval?: string;
  horizon?: Horizon;
  mode?: Mode;
  dataMode?: "live" | "mock" | "historical";
  technicalContext?: Record<string, unknown>;
};

type Source = {
  url: string;
  title: string | null;
  domain: string;
  sourceClass: SourceClass;
  credibility: number;
  relevance: number;
};

type Policy = {
  minimumSources: number;
  minimumDomains: number;
  minimumConfidence: number;
  minimumAgreement: number;
  validityMinutes: number;
  searchContext: "low" | "medium" | "high";
  maxToolCalls: number;
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
  country: string | null;
  timezone: string;
  currency: string;
  session_kind: string;
  sessions: unknown;
  data_provider: string;
  execution_provider: string;
  access_note: string | null;
};

const DEFAULT_DOMAINS = [
  "reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com",
  "sec.gov", "federalreserve.gov", "bankofcanada.ca", "bls.gov", "bea.gov",
  "ecb.europa.eu", "bankofengland.co.uk", "boj.or.jp", "rba.gov.au",
  "nyse.com", "nasdaq.com", "tsx.com", "asx.com.au", "jpx.co.jp", "londonstockexchange.com",
  "euronext.com", "oecd.org", "imf.org", "worldbank.org",
];

const DEFAULT_AGENTS = [
  "Macro et banques centrales", "Nouvelles et événements", "Sentiment et consensus",
  "Fondamentaux et dépôts officiels", "Régime technique", "Contradicteur et risques", "Chef de portefeuille",
];

const BASE_POLICY: Record<Horizon, Policy> = {
  intraday: { minimumSources: 6, minimumDomains: 4, minimumConfidence: 0.72, minimumAgreement: 0.65, validityMinutes: 15, searchContext: "medium", maxToolCalls: 7 },
  swing: { minimumSources: 7, minimumDomains: 4, minimumConfidence: 0.69, minimumAgreement: 0.62, validityMinutes: 90, searchContext: "high", maxToolCalls: 9 },
  position: { minimumSources: 8, minimumDomains: 5, minimumConfidence: 0.68, minimumAgreement: 0.60, validityMinutes: 240, searchContext: "high", maxToolCalls: 10 },
  macro: { minimumSources: 8, minimumDomains: 5, minimumConfidence: 0.67, minimumAgreement: 0.60, validityMinutes: 360, searchContext: "high", maxToolCalls: 12 },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSymbol(value: string) {
  return value.replace(/[^A-Z0-9/._-]/gi, "").slice(0, 24).toUpperCase();
}

function secretText(credentials: Record<string, unknown>, key: string) {
  return typeof credentials[key] === "string" ? String(credentials[key]).trim() : "";
}

function domainOf(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function classify(domain: string): SourceClass {
  if (["sec.gov", "bls.gov", "bea.gov"].some((d) => domain === d || domain.endsWith(`.${d}`))) return "regulator";
  if (["federalreserve.gov", "bankofcanada.ca", "ecb.europa.eu", "bankofengland.co.uk", "boj.or.jp", "rba.gov.au"].some((d) => domain === d || domain.endsWith(`.${d}`))) return "central_bank";
  if (["nyse.com", "nasdaq.com", "tsx.com", "asx.com.au", "jpx.co.jp", "londonstockexchange.com", "euronext.com"].some((d) => domain === d || domain.endsWith(`.${d}`))) return "exchange";
  if (["oecd.org", "imf.org", "worldbank.org"].some((d) => domain === d || domain.endsWith(`.${d}`))) return "official";
  if (["reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com"].some((d) => domain === d || domain.endsWith(`.${d}`))) return "major_media";
  return "other";
}

function credibility(kind: SourceClass) {
  if (["official", "regulator", "central_bank", "exchange"].includes(kind)) return 0.98;
  if (kind === "major_media") return 0.90;
  if (kind === "company") return 0.85;
  if (kind === "research") return 0.82;
  return 0.65;
}

function collectSources(output: unknown): Source[] {
  const result = new Map<string, Source>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== "string" || !url.startsWith("http")) return;
    const domain = domainOf(url);
    const sourceClass = classify(domain);
    result.set(url, {
      url,
      title: typeof title === "string" ? title.slice(0, 500) : null,
      domain,
      sourceClass,
      credibility: credibility(sourceClass),
      relevance: 0.75,
    });
  };
  for (const item of (Array.isArray(output) ? output : []) as Array<Record<string, unknown>>) {
    if (item.type === "web_search_call") {
      const action = item.action as Record<string, unknown> | undefined;
      for (const source of (Array.isArray(action?.sources) ? action.sources : []) as Array<Record<string, unknown>>) add(source.url, source.title);
    }
    if (item.type === "message") {
      for (const part of (Array.isArray(item.content) ? item.content : []) as Array<Record<string, unknown>>) {
        for (const annotation of (Array.isArray(part.annotations) ? part.annotations : []) as Array<Record<string, unknown>>) {
          if (annotation.type === "url_citation") add(annotation.url, annotation.title);
        }
      }
    }
  }
  return [...result.values()].slice(0, 30);
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

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["symbol", "generatedAt", "marketRegime", "overallSentiment", "confidence", "horizon", "stance", "signal", "summary", "keyDrivers", "catalysts", "risks", "agentVotes", "paperTradePlan"],
  properties: {
    symbol: { type: "string" },
    generatedAt: { type: "string" },
    marketRegime: { type: "string", enum: ["trend_up", "trend_down", "range", "high_volatility", "risk_off", "unclear"] },
    overallSentiment: { type: "number", minimum: -1, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    horizon: { type: "string", enum: ["intraday", "swing", "position", "macro"] },
    stance: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    signal: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
    summary: { type: "string" },
    keyDrivers: { type: "array", items: { type: "string" }, maxItems: 8 },
    catalysts: { type: "array", items: { type: "string" }, maxItems: 8 },
    risks: { type: "array", items: { type: "string" }, maxItems: 10 },
    agentVotes: {
      type: "array", minItems: 4, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
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
      type: "object", additionalProperties: false,
      required: ["enabled", "side", "entryCondition", "stopLossPct", "takeProfitPct", "maxRiskPct", "invalidation"],
      properties: {
        enabled: { type: "boolean" },
        side: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
        entryCondition: { type: "string" },
        stopLossPct: { type: "number", minimum: 0, maximum: 20 },
        takeProfitPct: { type: "number", minimum: 0, maximum: 50 },
        maxRiskPct: { type: "number", minimum: 0, maximum: 2 },
        invalidation: { type: "string" },
      },
    },
  },
};

async function runModel(args: {
  apiKey: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh";
  instructions: string;
  input: string;
  search?: { context: "low" | "medium" | "high"; domains: string[]; maxCalls: number };
}) {
  const body: Record<string, unknown> = {
    model: args.model,
    store: false,
    reasoning: { effort: args.effort },
    instructions: args.instructions,
    input: args.input,
    text: {
      verbosity: args.effort === "high" || args.effort === "xhigh" ? "high" : "medium",
      format: { type: "json_schema", name: "market_intelligence", strict: true, schema },
    },
  };
  if (args.search) {
    body.tools = [{
      type: "web_search",
      search_context_size: args.search.context,
      filters: { allowed_domains: args.search.domains.slice(0, 40) },
      user_location: { type: "approximate", city: "Calgary", region: "Alberta", country: "CA", timezone: "America/Edmonton" },
    }];
    body.tool_choice = "required";
    body.max_tool_calls = args.search.maxCalls;
    body.include = ["web_search_call.action.sources"];
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    throw new Error(typeof error?.message === "string" ? error.message : `${args.model} a refusé la requête.`);
  }
  const text = outputText(payload);
  if (!text) throw new Error(`${args.model} n’a retourné aucun résultat structuré.`);
  return { payload, result: JSON.parse(text) as Record<string, unknown> };
}

function agreement(result: Record<string, unknown>, signal: Signal) {
  if (signal === "HOLD") return 1;
  const votes = Array.isArray(result.agentVotes) ? result.agentVotes as Array<Record<string, unknown>> : [];
  if (!votes.length) return 0;
  const expected: Stance = signal === "BUY" ? "bullish" : "bearish";
  return votes.filter((vote) => vote.stance === expected && Number(vote.confidence) >= 0.55).length / votes.length;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Configuration serveur incomplète." }, 500);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply({ error: "Authentification requise." }, 401);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Session invalide ou expirée." }, 401);

  let body: RequestBody;
  try { body = await request.json(); } catch { return reply({ error: "Corps JSON invalide." }, 400); }
  if (body.dataMode === "historical") return reply({ error: "La recherche Web actuelle est bloquée en replay historique." }, 400);

  const symbol = normalizeSymbol(body.symbol || "AAPL");
  const interval = String(body.interval || "5min").slice(0, 16);
  const horizon: Horizon = ["intraday", "swing", "position", "macro"].includes(body.horizon || "") ? body.horizon as Horizon : "intraday";
  const mode: Mode = body.mode === "deep" ? "deep" : "quick";
  const technicalContext = body.technicalContext && typeof body.technicalContext === "object" ? body.technicalContext : {};
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = userData.user.id;

  const [{ data: wallet }, { data: settings }, { data: credentials, error: credentialError }, { data: instrumentData }] = await Promise.all([
    admin.from("paper_wallets").select("id,risk_settings,agent_allocation,cash_balance,kill_switch").eq("user_id", userId).maybeSingle(),
    admin.from("intelligence_settings").select("*").eq("user_id", userId).maybeSingle(),
    admin.rpc("get_integration_credentials", { p_user_id: userId, p_provider: "openai", p_environment: "ai" }),
    admin.from("market_instruments").select("id,provider_symbol,label,asset_type,market_region,venue_name,exchange_code,mic_code,country,timezone,currency,session_kind,sessions,data_provider,execution_provider,access_note").eq("provider_symbol", symbol).eq("enabled", true).order("sort_order", { ascending: true }).limit(1).maybeSingle(),
  ]);

  if (credentialError || !credentials || typeof credentials !== "object") return reply({ error: "Ajoute d’abord une clé OpenAI dans Intelligence IA." }, 400);
  const apiKey = secretText(credentials as Record<string, unknown>, "apiKey");
  if (!apiKey) return reply({ error: "Clé OpenAI manquante." }, 400);

  const instrument = instrumentData as Instrument | null;
  const assetType = String(body.assetType || instrument?.asset_type || (symbol.includes("/") ? "forex" : symbol.includes("BTC") ? "crypto" : "equity")).slice(0, 32);
  const marketContext = {
    instrumentId: instrument?.id || null,
    label: instrument?.label || symbol,
    assetType,
    marketRegion: instrument?.market_region || "unknown",
    venueName: instrument?.venue_name || "Non déterminée",
    exchangeCode: instrument?.exchange_code || null,
    micCode: instrument?.mic_code || null,
    country: instrument?.country || null,
    timezone: instrument?.timezone || "UTC",
    currency: instrument?.currency || null,
    sessionKind: instrument?.session_kind || null,
    sessions: instrument?.sessions || [],
    dataProvider: instrument?.data_provider || "twelve_data",
    executionProvider: instrument?.execution_provider || "internal_paper",
    accessNote: instrument?.access_note || null,
  };

  const agents = Array.isArray(settings?.enabled_agents) && settings.enabled_agents.length ? settings.enabled_agents : DEFAULT_AGENTS;
  const domains = Array.isArray(settings?.allowed_domains) && settings.allowed_domains.length ? settings.allowed_domains : DEFAULT_DOMAINS;
  const base = BASE_POLICY[horizon];
  const policy: Policy = {
    minimumSources: Math.max(base.minimumSources, Number(settings?.minimum_sources) || 6),
    minimumDomains: Math.max(base.minimumDomains, Number(settings?.minimum_distinct_domains) || 4),
    minimumConfidence: Math.max(base.minimumConfidence, Number(settings?.minimum_confidence) || 0.68),
    minimumAgreement: Math.max(base.minimumAgreement, Number(settings?.minimum_directional_agreement) || 0.60),
    validityMinutes: mode === "deep" ? Math.max(base.validityMinutes, Number(settings?.max_research_age_minutes) || 20) : Math.min(base.validityMinutes, Math.max(5, Number(settings?.max_research_age_minutes) || 20)),
    searchContext: mode === "deep" ? "high" : base.searchContext,
    maxToolCalls: mode === "deep" ? Math.min(14, base.maxToolCalls + 2) : base.maxToolCalls,
  };

  const automatic = (settings?.orchestration_mode || "automatic") === "automatic";
  const credentialModel = secretText(credentials as Record<string, unknown>, "model");
  const singleModel = settings?.model && settings.model !== "auto" ? settings.model : credentialModel && credentialModel !== "auto" ? credentialModel : "gpt-5.6-terra";
  const researchModel = automatic ? (mode === "deep" ? settings?.specialist_model || "gpt-5.6-terra" : settings?.research_model || "gpt-5.6-luna") : singleModel;
  const synthesisModel = automatic && mode === "deep" && (settings?.deep_review_enabled ?? true) ? settings?.synthesis_model || "gpt-5.6-sol" : null;
  const modelChain = synthesisModel ? `${researchModel} → ${synthesisModel}` : researchModel;

  const runId = crypto.randomUUID();
  await admin.from("market_research_runs").insert({
    id: runId, user_id: userId, wallet_id: wallet?.id || null, symbol, asset_type: assetType, interval, horizon, mode,
    model: modelChain, status: "running",
    request_context: { technicalContext, dataMode: body.dataMode || "live", marketContext, orchestration: { researchModel, synthesisModel, policy } },
  });

  try {
    const venueDescription = `${marketContext.venueName}${marketContext.micCode ? ` (${marketContext.micCode})` : ""}, région ${marketContext.marketRegion}, fuseau ${marketContext.timezone}`;
    const research = await runModel({
      apiKey,
      model: researchModel,
      effort: mode === "deep" ? "high" : "low",
      instructions: `Tu coordonnes les spécialistes de QuantFarm AI, strictement paper trading. Distingue toujours la source de données, la place de marché et la destination d’exécution paper. Aucun ordre réel ni promesse de rendement. Recherche des faits actuels, privilégie les sources officielles et reconnues, distingue faits et inférences, exige un vote indépendant de chaque spécialiste et force HOLD si les preuves sont insuffisantes ou contradictoires. Le Contradicteur cherche activement les raisons de refuser. Spécialistes : ${agents.join(", ")}.`,
      input: `Analyse ${symbol} (${assetType}) sur ${venueDescription} pour l’horizon ${horizon}, intervalle ${interval}, au ${new Date().toISOString()}. Source de prix prévue : ${marketContext.dataProvider}. Destination : ${marketContext.executionProvider}. Contexte technique : ${JSON.stringify(technicalContext)}. Produis un signal provisoire BUY, SELL ou HOLD pour une expérience paper seulement.`,
      search: { context: policy.searchContext, domains, maxCalls: policy.maxToolCalls },
    });

    const sources = collectSources(research.payload.output);
    let result = research.result;
    let reviewFailure: string | null = null;
    if (synthesisModel) {
      try {
        const review = await runModel({
          apiKey,
          model: synthesisModel,
          effort: "xhigh",
          instructions: "Tu es le Chef de portefeuille et le Contradicteur final. Audite uniquement le dossier fourni, sans inventer ni rechercher de nouveaux faits. Vérifie que le marché, la session, la source de données et la destination paper sont cohérents. Réduis la confiance ou choisis HOLD au moindre doute matériel.",
          input: `Dossier ${symbol}/${horizon}: ${JSON.stringify(result)}\nPlace: ${JSON.stringify(marketContext)}\nSources: ${JSON.stringify(sources.map((s) => ({ domain: s.domain, class: s.sourceClass, credibility: s.credibility, title: s.title })))}\nTechnique: ${JSON.stringify(technicalContext)}. Produis la synthèse finale structurée.`,
        });
        result = review.result;
      } catch (error) {
        reviewFailure = error instanceof Error ? error.message : "Révision Sol impossible.";
      }
    }

    const officialCount = sources.filter((source) => ["official", "regulator", "central_bank", "exchange"].includes(source.sourceClass)).length;
    const distinctDomains = new Set(sources.map((source) => source.domain).filter((domain) => domain !== "unknown")).size;
    const averageCredibility = sources.length ? sources.reduce((sum, source) => sum + source.credibility, 0) / sources.length : 0;
    let signal = (["BUY", "SELL", "HOLD"].includes(String(result.signal)) ? result.signal : "HOLD") as Signal;
    let confidence = clamp(Number(result.confidence) || 0, 0, 1);
    const directionAgreement = agreement(result, signal);
    const risks = Array.isArray(result.risks) ? result.risks.map(String) : [];
    const failures: string[] = [];

    const staleLive = body.dataMode === "live" && (technicalContext.stale === true || technicalContext.delayed === true || (typeof technicalContext.dataSource === "string" && technicalContext.dataSource !== "twelve-data"));
    if (!instrument) failures.push("Instrument absent du registre mondial des places de marché.");
    if (sources.length < policy.minimumSources) failures.push(`${sources.length} sources; ${policy.minimumSources} requises.`);
    if (distinctDomains < policy.minimumDomains) failures.push(`${distinctDomains} domaines distincts; ${policy.minimumDomains} requis.`);
    if ((settings?.require_official_source ?? true) && officialCount === 0) failures.push("Aucune source officielle, réglementaire, banque centrale ou bourse.");
    if (averageCredibility < 0.80) failures.push(`Crédibilité moyenne ${Math.round(averageCredibility * 100)} % trop faible.`);
    if (confidence < policy.minimumConfidence) failures.push(`Confiance ${Math.round(confidence * 100)} % sous ${Math.round(policy.minimumConfidence * 100)} %.`);
    if (signal !== "HOLD" && directionAgreement < policy.minimumAgreement) failures.push(`Accord directionnel ${Math.round(directionAgreement * 100)} % sous ${Math.round(policy.minimumAgreement * 100)} %.`);
    if (staleLive) failures.push("Données live périmées, retardées ou non confirmées par Twelve Data.");
    if (reviewFailure) failures.push(`Révision finale non validée : ${reviewFailure}`);

    if (failures.length) {
      signal = "HOLD";
      confidence = Math.min(confidence, 0.49);
      risks.push(...failures.map((failure) => `Garde-fou : ${failure}`));
    }

    const walletRisk = wallet?.risk_settings && typeof wallet.risk_settings === "object" ? Number((wallet.risk_settings as Record<string, unknown>).riskPerTradePct) || 0.25 : 0.25;
    const paperPlan = result.paperTradePlan && typeof result.paperTradePlan === "object" ? { ...(result.paperTradePlan as Record<string, unknown>) } : {};
    paperPlan.maxRiskPct = clamp(Math.min(Number(paperPlan.maxRiskPct) || walletRisk, walletRisk, 0.5), 0, 0.5);
    paperPlan.side = signal;
    paperPlan.enabled = signal !== "HOLD" && Boolean(paperPlan.enabled);

    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + policy.validityMinutes * 60_000);
    let guardedResult: Record<string, unknown> = {
      ...result,
      symbol,
      generatedAt: generatedAt.toISOString(),
      signal,
      confidence,
      risks,
      paperTradePlan: paperPlan,
      marketContext,
      orchestration: { mode: automatic ? "automatic" : "single_model", researchModel, synthesisModel, modelChain },
      qualityGate: {
        passed: failures.length === 0,
        failures,
        sourceCount: sources.length,
        officialSourceCount: officialCount,
        distinctDomainCount: distinctDomains,
        averageCredibility,
        directionalAgreement: directionAgreement,
        minimumSources: policy.minimumSources,
        minimumDomains: policy.minimumDomains,
        minimumConfidence: policy.minimumConfidence,
        minimumAgreement: policy.minimumAgreement,
        validityMinutes: policy.validityMinutes,
      },
    };

    if (sources.length) await admin.from("market_research_sources").insert(sources.map((source) => ({
      run_id: runId, user_id: userId, url: source.url, title: source.title, domain: source.domain,
      source_class: source.sourceClass, credibility_score: source.credibility, relevance_score: source.relevance,
    })));

    const votes = Array.isArray(guardedResult.agentVotes) ? guardedResult.agentVotes : [];
    if (votes.length) await admin.from("market_agent_votes").insert(votes.map((vote) => {
      const item = vote as Record<string, unknown>;
      return {
        run_id: runId, user_id: userId, agent_name: String(item.agent || "Agent"),
        stance: (["bullish", "bearish", "neutral"].includes(String(item.stance)) ? item.stance : "neutral") as Stance,
        confidence: clamp(Number(item.confidence) || 0, 0, 1), rationale: String(item.rationale || "Aucune justification."),
      };
    }));

    await admin.from("market_research_runs").update({
      status: "completed", model: modelChain, result: guardedResult,
      overall_sentiment: clamp(Number(guardedResult.overallSentiment) || 0, -1, 1), confidence, signal,
      source_count: sources.length, official_source_count: officialCount,
      generated_at: generatedAt.toISOString(), expires_at: expiresAt.toISOString(),
    }).eq("id", runId);

    await admin.from("trade_logs").insert({
      user_id: userId, wallet_id: wallet?.id || null, agent_name: "Orchestrateur Intelligence IA",
      action: `Recherche ${symbol} — ${signal}`,
      reason: String(guardedResult.summary || "Analyse terminée."),
      payload: { runId, signal, confidence, sourceCount: sources.length, distinctDomains, officialSourceCount: officialCount, directionAgreement, modelChain, marketContext, paperOnly: true },
    });

    let paperExecution: Record<string, unknown> = { attempted: false, reason: "Cycle de recherche seulement." };
    const automaticCycle = technicalContext.automaticCycle === true;
    const activeSessionId = typeof technicalContext.activeSessionId === "string" ? technicalContext.activeSessionId : "";
    if (automaticCycle && activeSessionId && signal !== "HOLD" && failures.length === 0 && paperPlan.enabled === true && wallet && !wallet.kill_switch) {
      try {
        const entryPrice = Number(technicalContext.lastPrice) || 0;
        const stopLossPct = clamp(Number(paperPlan.stopLossPct) || 0, 0, 20);
        const takeProfitPct = clamp(Number(paperPlan.takeProfitPct) || 0, 0, 50);
        const maxRiskPct = clamp(Number(paperPlan.maxRiskPct) || 0, 0, 0.5);
        const allocation = Number(wallet.agent_allocation) || 0;
        const cashBalance = Number(wallet.cash_balance) || 0;
        if (entryPrice <= 0 || stopLossPct <= 0 || takeProfitPct <= 0 || maxRiskPct <= 0 || allocation <= 0) throw new Error("Plan paper incomplet pour une exécution autonome.");

        const stopLoss = signal === "BUY" ? entryPrice * (1 - stopLossPct / 100) : entryPrice * (1 + stopLossPct / 100);
        const takeProfit = signal === "BUY" ? entryPrice * (1 + takeProfitPct / 100) : entryPrice * (1 - takeProfitPct / 100);
        const stopDistance = Math.abs(entryPrice - stopLoss);
        const riskBudget = allocation * (maxRiskPct / 100);
        const riskQuantity = riskBudget / Math.max(stopDistance, 0.000001);
        const notionalQuantity = (allocation * 0.20) / entryPrice;
        const cashQuantity = signal === "BUY" ? cashBalance / entryPrice : notionalQuantity;
        const quantity = Math.max(0, Math.min(riskQuantity, notionalQuantity, cashQuantity));
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantité autonome calculée invalide.");

        const { data: execution, error: executionError } = await admin.rpc("execute_agent_paper_trade", {
          p_user_id: userId,
          p_session_id: activeSessionId,
          p_symbol: symbol,
          p_side: signal,
          p_entry_price: entryPrice,
          p_stop_loss: stopLoss,
          p_take_profit: takeProfit,
          p_quantity: Number(quantity.toFixed(8)),
          p_research_run_id: runId,
          p_market_context: { marketContext, dataMode: "live", sourceCount: sources.length, confidence },
        });
        if (executionError) throw executionError;
        paperExecution = { attempted: true, executed: true, ...(execution as Record<string, unknown>) };
      } catch (error) {
        paperExecution = { attempted: true, executed: false, reason: error instanceof Error ? error.message : "Exécution paper refusée." };
      }
      guardedResult = { ...guardedResult, paperExecution };
      await admin.from("market_research_runs").update({ result: guardedResult }).eq("id", runId);
    }

    return reply({ ok: true, runId, result: guardedResult, sources, expiresAt: expiresAt.toISOString(), model: modelChain, policy, marketContext, paperExecution });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur IA inconnue.";
    await admin.from("market_research_runs").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", runId);
    return reply({ error: message.slice(0, 1000), runId }, 400);
  }
});
