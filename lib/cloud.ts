import type { SupabaseClient } from "@supabase/supabase-js";
import type { Position, TradeLog, TradingMode } from "@/lib/market";

export type CloudContext = {
  client: SupabaseClient;
  userId: string;
  email: string;
  walletId: string;
  capital: number;
  cash: number;
  agentAllocation: number;
  mode: TradingMode;
  positions: Position[];
  logs: TradeLog[];
};
