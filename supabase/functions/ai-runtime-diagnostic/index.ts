import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

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

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Méthode non permise." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuration serveur incomplète." }, 500);

  const suppliedSecret = request.headers.get("x-worker-secret") || "";
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config } = await admin.from("worker_configuration").select("secret_hash,enabled").eq("name", "autonomous_market_worker").maybeSingle();
  if (!suppliedSecret || !config || config.enabled !== true || await sha256(suppliedSecret) !== config.secret_hash) return json({ error: "Accès refusé." }, 403);

  const { data: connection, error: connectionError } = await admin
    .from("integration_connections")
    .select("user_id,status")
    .eq("provider", "openai")
    .eq("environment", "ai")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  if (connectionError || !connection) return json({ error: "Connexion OpenAI active introuvable." }, 400);

  const userId = connection.user_id;
  const [{ data: credentials, error: credentialError }, { data: settings }] = await Promise.all([
    admin.rpc("get_integration_credentials", { p_user_id: userId, p_provider: "openai", p_environment: "ai" }),
    admin.from("intelligence_settings").select("research_model").eq("user_id", userId).maybeSingle(),
  ]);
  const apiKey = secretText(credentials, "apiKey");
  const model = settings?.research_model || "gpt-5.6-luna";
  if (credentialError || !apiKey) return json({ error: "Clé OpenAI chiffrée introuvable." }, 400);

  const startedAt = Date.now();
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        instructions: "Tu exécutes un diagnostic technique. Réponds uniquement avec le mot OK.",
        input: "Vérifie que le modèle peut répondre à une requête Responses API.",
        text: { verbosity: "low" },
        max_output_tokens: 40,
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const error = payload.error as Record<string, unknown> | undefined;
      throw new Error(typeof error?.message === "string" ? error.message : `OpenAI HTTP ${response.status}`);
    }
    const output = outputText(payload).trim();
    if (!output) throw new Error("OpenAI a répondu sans texte exploitable.");
    const latencyMs = Date.now() - startedAt;
    await admin.from("runtime_diagnostics").insert({
      user_id: userId,
      component: "openai_responses_api",
      status: "passed",
      message: `OpenAI ${model} répond correctement.`,
      metadata: { model, latencyMs, responseId: payload.id || null, outputPreview: output.slice(0, 20) },
    });
    return json({ ok: true, model, latencyMs, outputPreview: output.slice(0, 20) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur OpenAI inconnue.";
    await admin.from("runtime_diagnostics").insert({
      user_id: userId,
      component: "openai_responses_api",
      status: "failed",
      message: message.slice(0, 500),
      metadata: { model, latencyMs: Date.now() - startedAt },
    });
    return json({ ok: false, model, error: message }, 400);
  }
});
