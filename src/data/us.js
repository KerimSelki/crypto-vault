// ═══ ABD Hisse & ETF Verileri ═══
const u = (id, symbol, name, sector) => ({ id, symbol, name, market: "us", currency: "$", sector });

export const US_DATA = {
  "AAPL": u("AAPL","AAPL","Apple Inc.","Teknoloji"),
  "MSFT": u("MSFT","MSFT","Microsoft Corp.","Teknoloji"),
  "TSLA": u("TSLA","TSLA","Tesla Inc.","Otomotiv"),
  "NVDA": u("NVDA","NVDA","NVIDIA Corp.","Teknoloji"),
  "GOOGL": u("GOOGL","GOOGL","Alphabet Inc.","Teknoloji"),
  "AMZN": u("AMZN","AMZN","Amazon.com","E-Ticaret"),
  "META": u("META","META","Meta Platforms","Teknoloji"),
  "VOO": u("VOO","VOO","Vanguard S&P 500 ETF","ETF"),
  "QQQ": u("QQQ","QQQ","Invesco QQQ Trust","ETF"),
  "SPY": u("SPY","SPY","SPDR S&P 500 ETF","ETF"),
};
