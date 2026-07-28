"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./autonomous-trade-monitor.module.css";

type AgentPosition = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number | string;
  entry_price: number | string;
  stop_loss: number | string | null;
  dynamic_stop_loss: number | string | null;
  take_profit: number | string | null;
  last_mark_price: number | string | null;
  last_marked_at: string | null;
  high_watermark: number | string | null;
  low_watermark: number | string | null;
  trailing_stop_pct: number | string | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  exit_price: number | string | null;
  realized_pnl: number | string | null;
  exit_reason: string | null;
  venue_name: string | null;
  market_session: string | null;
};

function money(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function price(value: number | string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 6 }).format(parsed);
}

function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function positionPnl(position: AgentPosition) {
  const mark = Number(position.last_mark_price) || Number(position.entry_price);
  const entry = Number(position.entry_price);
  const quantity = Number(position.quantity);
  return position.side === "BUY" ? (mark - entry) * quantity : (entry - mark) * quantity;
}

export function AutonomousTradeMonitor() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [positions, setPositions] = useState<AgentPosition[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, [client]);

  const refresh = useCallback(async () => {
    if (!session) {
      setPositions([]);
      setLoaded(true);
      return;
    }

    const { data } = await client
      .from("positions")
      .select("id,symbol,side,quantity,entry_price,stop_loss,dynamic_stop_loss,take_profit,last_mark_price,last_marked_at,high_watermark,low_watermark,trailing_stop_pct,status,opened_at,closed_at,exit_price,realized_pnl,exit_reason,venue_name,market_session")
      .eq("user_id", session.user.id)
      .eq("origin", "agent")
      .order("opened_at", { ascending: false })
      .limit(24);

    setPositions((data || []) as AgentPosition[]);
    setLoaded(true);
  }, [client, session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, session]);

  if (!session || !loaded) return null;

  const open = positions.filter((position) => position.status === "open");
  const closed = positions.filter((position) => position.status === "closed").slice(0, 8);
  const unrealized = open.reduce((sum, position) => sum + positionPnl(position), 0);
  const realized = closed.reduce((sum, position) => sum + Number(position.realized_pnl || 0), 0);

  return (
    <section className={styles.card} aria-label="Suivi des transactions autonomes">
      <div className={styles.header}>
        <div>
          <p>SUIVI AUTONOME EN DIRECT</p>
          <h2>Entrées, stops, cibles et sorties gérés par les agents</h2>
        </div>
        <div className={styles.totals}>
          <span>Ouvert <strong>{open.length}</strong></span>
          <span>P/L ouvert <strong data-positive={unrealized >= 0}>{money(unrealized)}</strong></span>
          <span>P/L fermé récent <strong data-positive={realized >= 0}>{money(realized)}</strong></span>
        </div>
      </div>

      {open.length ? (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Entrée / prix</th>
                <th>Stop géré</th>
                <th>Cible</th>
                <th>Profit/perte</th>
                <th>Marché</th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => {
                const pnl = positionPnl(position);
                const effectiveStop = position.dynamic_stop_loss || position.stop_loss;
                return (
                  <tr key={position.id}>
                    <td>
                      <strong>{position.side} {position.symbol}</strong>
                      <small>{Number(position.quantity)} lot{Number(position.quantity) === 1 ? "" : "s"} · ouvert {time(position.opened_at)}</small>
                    </td>
                    <td>
                      <strong>{price(position.entry_price)} → {price(position.last_mark_price)}</strong>
                      <small>Surveillé {time(position.last_marked_at)}</small>
                    </td>
                    <td>
                      <strong>{price(effectiveStop)}</strong>
                      <small>Initial {price(position.stop_loss)} · suivi {Number(position.trailing_stop_pct || 0).toFixed(2)} %</small>
                    </td>
                    <td><strong>{price(position.take_profit)}</strong></td>
                    <td><strong data-positive={pnl >= 0}>{money(pnl)}</strong></td>
                    <td>
                      <strong>{position.venue_name || "Marché mondial"}</strong>
                      <small>{position.market_session || "Session à confirmer"}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>Aucune position autonome ouverte. Les agents attendent un signal validé avant d’utiliser le capital paper.</div>
      )}

      <div className={styles.closedHeader}>
        <h3>Dernières sorties automatiques</h3>
        <span>Stop-loss · stop dynamique · take-profit · fin de session</span>
      </div>

      {closed.length ? (
        <div className={styles.closedGrid}>
          {closed.map((position) => (
            <article key={position.id}>
              <div><strong>{position.symbol}</strong><span>{position.side}</span></div>
              <p>{position.exit_reason || "Fermeture automatique"}</p>
              <dl>
                <div><dt>Entrée</dt><dd>{price(position.entry_price)}</dd></div>
                <div><dt>Sortie</dt><dd>{price(position.exit_price)}</dd></div>
                <div><dt>Résultat</dt><dd data-positive={Number(position.realized_pnl || 0) >= 0}>{money(Number(position.realized_pnl || 0))}</dd></div>
              </dl>
              <small>{time(position.closed_at)}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>Aucune sortie autonome enregistrée pour le moment.</div>
      )}
    </section>
  );
}
