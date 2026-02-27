// ═══ Tüm Varlık Verileri — Birleşik Index ═══
import { DEFAULT_COINS, BINANCE_OVERRIDES, genDemo } from './crypto';
import { BIST_DATA } from './bist';
import { US_DATA } from './us';
import { TEFAS_DATA } from './tefas';

// Birleşik stock data (BIST + US + TEFAS)
export const STOCK_DATA = { ...BIST_DATA, ...US_DATA, ...TEFAS_DATA };

// Tüm varlıklar (Crypto + Stocks)
export const ALL_ASSETS = {
  ...Object.fromEntries(DEFAULT_COINS.map(c => [c.id, c])),
  ...STOCK_DATA,
};

// ── Market Utility Fonksiyonları ──
export const isStock = (id) => {
  const a = ALL_ASSETS[id];
  return a && (a.market === "bist" || a.market === "us" || a.market === "tefas");
};

export const getMarketType = (id) => ALL_ASSETS[id]?.market || "crypto";

export const getMarketLabel = (m) => ({
  crypto: "Kripto",
  bist: "BIST",
  us: "ABD",
  tefas: "TEFAS",
})[m] || m;

export const getMarketColor = (m) => ({
  crypto: "#F7931A",
  bist: "#3b82f6",
  us: "#8b5cf6",
  tefas: "#06b6d4",
})[m] || "#8892a4";

// ── Sabitler ──
export const CLR = ["#F7931A","#627EEA","#F3BA2F","#9945FF","#00AAE4","#0033AD","#E84142","#E6007A","#C2A633","#2A5ADA","#FF0000","#8247E5","#BFBBBB","#FF007A","#4169E1","#FF6B6B","#48BB78","#ED8936","#9F7AEA","#38B2AC"];
export const REFRESH = [{label:"1dk",value:60000},{label:"5dk",value:300000},{label:"10dk",value:600000},{label:"30dk",value:1800000}];
export const MAX_RETRIES = 5;
export const RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];
export const USD_TRY_DEFAULT = 36.42;

// Re-export
export { DEFAULT_COINS, BINANCE_OVERRIDES, genDemo };
export { BIST_DATA } from './bist';
export { US_DATA } from './us';
export { TEFAS_DATA } from './tefas';
