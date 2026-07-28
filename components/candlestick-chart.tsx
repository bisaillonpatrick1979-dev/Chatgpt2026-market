"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/market";

export function CandlestickChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fittedOnceRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "#07101f" },
        textColor: "#aab7ca",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(133, 151, 178, 0.09)" },
        horzLines: { color: "rgba(133, 151, 178, 0.09)" },
      },
      rightPriceScale: { borderColor: "rgba(133, 151, 178, 0.2)" },
      timeScale: {
        borderColor: "rgba(133, 151, 178, 0.2)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(89, 154, 255, 0.55)" },
        horzLine: { color: "rgba(89, 154, 255, 0.55)" },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#32d296",
      downColor: "#ff6174",
      borderVisible: false,
      wickUpColor: "#32d296",
      wickDownColor: "#ff6174",
      priceLineVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      seriesRef.current = null;
      chartRef.current = null;
      fittedOnceRef.current = false;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || candles.length === 0) return;

    const normalized: CandlestickData<UTCTimestamp>[] = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const visibleRange = fittedOnceRef.current ? chart.timeScale().getVisibleLogicalRange() : null;
    series.setData(normalized);

    if (!fittedOnceRef.current) {
      chart.timeScale().fitContent();
      fittedOnceRef.current = true;
    } else if (visibleRange) {
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    }
  }, [candles]);

  return <div ref={containerRef} className="chart-canvas" aria-label="Graphique en chandelles" />;
}
