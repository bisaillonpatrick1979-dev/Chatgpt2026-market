import type { SupabaseClient } from "@supabase/supabase-js";
import type { Position, TradeLog, TradingMode } from "@/lib/market";

export type RiskSettings = {
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxPositions: number;
  minAgentConfidence: number;
  closeAgentsAtEnd: boolean;
  blockClosedMarkets: boolean;
};

export type CloudContext = {
  client: SupabaseClient;
  userId: string;
  email: string;
  walletId: string;
  capital: number;
  cash: number;
  agentAllocation: number;
  mode: TradingMode;
  killSwitch: boolean;
  riskSettings: Partial<RiskSettings>;
  positions: Position[];
  logs: TradeLog[];
};
