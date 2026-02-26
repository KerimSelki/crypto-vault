// /api/stocks.js — Vercel Serverless Function
// Yahoo Finance proxy — no CORS issues from server-side
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

  const symList = symbols.split(",").slice(0, 50); // max 50

  try {
    // Yahoo Finance v8 quote endpoint
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symList.join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName,currency,marketState`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      // Fallback: try v8 chart for each symbol individually
      const results = [];
      for (const sym of symList.slice(0, 20)) {
        try {
          const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
          const r = await fetch(chartUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (r.ok) {
            const d = await r.json();
            const meta = d?.chart?.result?.[0]?.meta;
            if (meta) {
              results.push({
                symbol: sym,
                regularMarketPrice: meta.regularMarketPrice,
                regularMarketChangePercent: meta.previousClose > 0
                  ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100
                  : 0,
                shortName: sym,
                currency: meta.currency || "TRY",
              });
            }
          }
        } catch (e) {}
      }
      return res.status(200).json({ quoteResponse: { result: results } });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
