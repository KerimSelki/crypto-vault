// /api/stocklist.js — Vercel Serverless Function
// FMP'den tüm NYSE + NASDAQ hisse listesini çeker ve cache'ler

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  // 24 saat cache — liste günde 1 kez güncellenir
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=172800");

  if (req.method === "OPTIONS") return res.status(200).end();

  const FMP_KEY = process.env.FMP_KEY || "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";

  try {
    // FMP stock list — tüm hisseler
    const url = `https://financialmodelingprep.com/api/v3/stock/list?apikey=${FMP_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    
    if (!response.ok) {
      return res.status(502).json({ error: "FMP API error", status: response.status });
    }

    const data = await response.json();
    
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: "Invalid response from FMP" });
    }

    // Sadece NYSE, NASDAQ, AMEX ve IST (BIST) borsalarını filtrele
    // Ayrıca ETF'leri de dahil et
    const exchanges = new Set(["NYSE", "NASDAQ", "AMEX", "New York Stock Exchange", "NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "IST"]);
    
    const filtered = data
      .filter(s => {
        if (!s.symbol || !s.name) return false;
        // Exchange filtresi veya ETF ise dahil et
        if (s.exchangeShortName && exchanges.has(s.exchangeShortName)) return true;
        if (s.type === "etf" || s.type === "fund") return true;
        // .IS ile biten BIST hisseleri
        if (s.symbol.endsWith(".IS")) return true;
        return false;
      })
      .map(s => ({
        s: s.symbol,           // symbol
        n: s.name,             // name
        e: s.exchangeShortName || "", // exchange
        t: s.type || "stock",  // type: stock, etf, fund
        p: s.price || 0,       // son fiyat (varsa)
      }));

    return res.status(200).json({
      count: filtered.length,
      updated: new Date().toISOString(),
      stocks: filtered,
    });

  } catch (e) {
    console.error("Stock list error:", e.message);
    return res.status(502).json({ error: e.message });
  }
}
