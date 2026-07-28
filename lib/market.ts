export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketDataResponse = {
  symbol: string;
  interval: string;
  source: "twelve-data" | "mock";
  delayed: boolean;
  candles: Candle[];
  error?: string;
};

export type TradingMode = "manual" | "assisted" | "autonomous" | "replay";
export type OrderSide = "BUY" | "SELL";

export type Position = {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: string;
  origin: "manual" | "assisted" | "agent";
};

export type TradeLog = {
  id: string;
  time: string;
  agent: string;
  action: string;
  reason: string;
  result?: number;
};

export const INTERVALS = ["1min", "5min", "15min", "30min", "1h", "4h", "1day"] as const;

export const SYMBOLS = [
  { symbol: "AAPL", label: "Apple", market: "Nasdaq", currency: "USD" },
  { symbol: "MSFT", label: "Microsoft", market: "Nasdaq", currency: "USD" },
  { symbol: "SHOP", label: "Shopify", market: "TSX", currency: "CAD" },
  { symbol: "EUR/USD", label: "Euro / dollar US", market: "Forex", currency: "USD" },
  { symbol: "USD/CAD", label: "Dollar US / canadien", market: "Forex", currency: "CAD" },
  { symbol: "BTC/USD", label: "Bitcoin", market: "Crypto", currency: "USD" },
];

export function formatCad(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 5 : 2,
  }).format(value);
}

export function positionPnl(position: Position, currentPrice: number) {
  const direction = position.side === "BUY" ? 1 : -1;
  return (currentPrice - position.entryPrice) * position.quantity * direction;
}
