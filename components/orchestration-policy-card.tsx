"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./orchestration-policy-card.module.css";

type Settings = {
  orchestration_mode: "automatic" | "single_model";
  research_model: string;
  specialist_model: string;
  synthesis_model: string;
  deep_review_enabled: boolean;
  auto_refresh_minutes: number;
  max_research_age_minutes: number;
  minimum_sources: number;
  minimum_distinct_domains: number;
  minimum_confidence: number;
  minimum_directional_agreement: number;
  require_official_source: boolean;
  max_agent_orders_per_minute: number;
  minimum_seconds_between_agent_orders: number;
};

const DEFAULTS: Settings = {
  orchestration_mode: "automatic",
  research_model: "gpt-5.6-luna",
  specialist_model: "gpt-5.6-terra",
  synthesis_model: "gpt-5.6-sol",
  deep_review_enabled: true,
  auto_refresh_minutes: 15,
  max_research_age_minutes: 20,
  minimum_sources: 6,
  minimum_distinct_domains: 4,
  minimum_confidence: 0.68,
  minimum_directional_agreement: 0.60,
  require_official_source: true,
  max_agent_orders_per_minute: 2,
  minimum_seconds_between_agent_orders: 20,
};

const HORIZONS = [
  { name: "Intrajournalier", sources: 6, domains: 4, confidence: 0.72, agreement: 0.65, validity: 15 },
  { name: "Swing", sources: 7, domains: 4, confidence: 0.69, agreement: 0.62, validity: 90 },
  { name: "Position", sources: 8, domains: 5, confidence: 0.68, agreement: 0.60, validity: 240 },
  { name: "Macro", sources: 8, domains: 5, confidence: 0.67, agreement: 0.60, validity: 360 },
] as const;

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

export function OrchestrationPolicyCard() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setLoaded(true);
        return;
      }

      const { data } = await client
        .from("intelligence_settings")
        .select("orchestration_mode,research_model,specialist_model,synthesis_model,deep_review_enabled,auto_refresh_minutes,max_research_age_minutes,minimum_sources,minimum_distinct_domains,minimum_confidence,minimum_directional_agreement,require_official_source,max_agent_orders_per_minute,minimum_seconds_between_agent_orders")
        .eq("user_id", nextSession.user.id)
        .maybeSingle();

      if (!active) return;
      if (data) setSettings({ ...DEFAULTS, ...data } as Settings);
      setLoaded(true);
    };

    void client.auth.getSession().then(({ data }) => void load(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user.id !== session?.user.id) void load(nextSession);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, session?.user.id]);

  if (!loaded || !session) return null;

  return (
    <section className={styles.card} aria-label="Politique d’orchestration IA">
      <div className={styles.header}>
        <div>
          <p>ORCHESTRATION GÉRÉE AUTOMATIQUEMENT</p>
          <h2>Modèles, qualité et cadence</h2>
        </div>
        <span>{settings.orchestration_mode === "automatic" ? "MODE AUTOMATIQUE" : "MODÈLE UNIQUE"}</span>
      </div>

      <div className={styles.modelGrid}>
        <article>
          <small>Cycles rapides</small>
          <strong>{settings.research_model}</strong>
          <p>Surveillance fréquente, nouvelles et premier vote des spécialistes.</p>
        </article>
        <article>
          <small>Recherche approfondie</small>
          <strong>{settings.specialist_model}</strong>
          <p>Analyse macro, fondamentale, sentiment, technique et contradicteur.</p>
        </article>
        <article>
          <small>Arbitrage final</small>
          <strong>{settings.deep_review_enabled ? settings.synthesis_model : "Désactivé"}</strong>
          <p>Révision finale seulement lorsque le mode approfondi est demandé.</p>
        </article>
      </div>

      <div className={styles.guardGrid}>
        <div><span>Sources générales</span><strong>{settings.minimum_sources} minimum</strong></div>
        <div><span>Domaines distincts</span><strong>{settings.minimum_distinct_domains} minimum</strong></div>
        <div><span>Confiance générale</span><strong>{percent(settings.minimum_confidence)}</strong></div>
        <div><span>Accord directionnel</span><strong>{percent(settings.minimum_directional_agreement)}</strong></div>
        <div><span>Renouvellement conseillé</span><strong>{settings.auto_refresh_minutes} min</strong></div>
        <div><span>Source officielle</span><strong>{settings.require_official_source ? "Obligatoire" : "Optionnelle"}</strong></div>
        <div><span>Ordres autonomes</span><strong>{settings.max_agent_orders_per_minute}/min maximum</strong></div>
        <div><span>Temporisation</span><strong>{settings.minimum_seconds_between_agent_orders} s minimum</strong></div>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Horizon</th><th>Sources</th><th>Domaines</th><th>Confiance</th><th>Accord</th><th>Validité</th></tr></thead>
          <tbody>{HORIZONS.map((policy) => (
            <tr key={policy.name}>
              <td>{policy.name}</td>
              <td>{Math.max(policy.sources, settings.minimum_sources)}</td>
              <td>{Math.max(policy.domains, settings.minimum_distinct_domains)}</td>
              <td>{percent(Math.max(policy.confidence, settings.minimum_confidence))}</td>
              <td>{percent(Math.max(policy.agreement, settings.minimum_directional_agreement))}</td>
              <td>{Math.max(policy.validity, settings.max_research_age_minutes)} min</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <p className={styles.note}>Les agents ne peuvent pas contourner ces limites. Une recherche périmée, un garde-fou échoué, un consensus HOLD, des prix périmés ou une cadence dépassée bloquent l’ordre paper côté serveur.</p>
    </section>
  );
}
