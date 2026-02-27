import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ═══ Modüler Veri Kaynakları ═══
import {
  DEFAULT_COINS, BINANCE_OVERRIDES, genDemo,
  STOCK_DATA, ALL_ASSETS,
  BIST_DATA, US_DATA, TEFAS_DATA,
  isStock, getMarketType, getMarketLabel, getMarketColor,
  CLR, REFRESH, MAX_RETRIES, RETRY_DELAYS,
} from "./data";
import { fmt, fmtTRY, fPct, genChart } from "./utils/format";

const Spark = ({data,color}) => (<ResponsiveContainer width={100} height={36}><AreaChart data={data.slice(-14)}><defs><linearGradient id={`s${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.3}/><stop offset="100%" stopColor={color} stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#s${color.replace("#","")})`} dot={false}/></AreaChart></ResponsiveContainer>);

// ═══ Coin Search/Picker Component ═══
const searchCache = {};
const CoinPicker = ({ value, onChange, prices, savedKey, knownCoins, fmpStocks }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [localResults, setLocalResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const found = knownCoins.find(c => c.id === value);
    if (found) setSelected(found);
  }, [value, knownCoins]);

  useEffect(() => {
    const handler = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Instant local filter + delayed API search
  const searchCoins = useCallback(async (q) => {
    if (!q || q.length < 1) { setResults([]); setLocalResults([]); return; }
    const ql = q.toLowerCase();

    // 1) Instant local filter from known coins + STOCK_DATA + FMP stocks
    const local = knownCoins.filter(c =>
      c.name.toLowerCase().includes(ql) || c.symbol.toLowerCase().includes(ql)
    ).map(c => ({ ...c, thumb: null, marketCapRank: null, isLocal: true }));
    
    // STOCK_DATA (BIST + US + TEFAS)
    const stockResults = Object.values(STOCK_DATA).filter(s =>
      s.name.toLowerCase().includes(ql) || s.symbol.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)
    ).map(s => ({ ...s, thumb: null, marketCapRank: null, isLocal: true, isStock: true }));
    
    // FMP full stock list (NYSE + NASDAQ + ETF) — tüm US hisseleri
    const fmpResults = (fmpStocks || []).filter(s =>
      s.n.toLowerCase().includes(ql) || s.s.toLowerCase().includes(ql)
    ).slice(0, 30).map(s => ({
      id: s.s, symbol: s.s, name: s.n,
      market: s.s.endsWith(".IS") ? "bist" : "us",
      currency: s.s.endsWith(".IS") ? "₺" : "$",
      sector: s.t === "etf" ? "ETF" : (s.e || "US"),
      thumb: null, marketCapRank: null, isLocal: true, isStock: true, isFMP: true,
    }));

    const combined = [];
    const seen = new Set();
    [...stockResults, ...fmpResults, ...local].forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); combined.push(c); } });
    setLocalResults(combined.slice(0, 30));

    // If stock results found and query is short, skip CoinGecko API
    if ((stockResults.length + fmpResults.length) > 0 && q.length <= 4) { setResults([]); setSearching(false); return; }

    if (q.length < 2) { setResults([]); return; }

    // 2) Check cache first
    if (searchCache[ql]) { setResults(searchCache[ql]); setSearching(false); return; }

    // 3) API search (CoinGecko — crypto only)
    setSearching(true);
    try {
      const base = savedKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
      const kp = savedKey ? `&x_cg_pro_api_key=${savedKey}` : "";
      const res = await fetch(`${base}/search?query=${encodeURIComponent(q)}${kp}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const coins = (data.coins || []).slice(0, 15).map(c => ({
        id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name,
        thumb: c.thumb, marketCapRank: c.market_cap_rank, market: "crypto",
      }));
      searchCache[ql] = coins;
      setResults(coins);
    } catch (e) {
      setResults([]);
    }
    setSearching(false);
  }, [savedKey, knownCoins, fmpStocks]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    if (val.length >= 1) {
      const ql = val.toLowerCase();
      const localCoins = knownCoins.filter(c =>
        c.name.toLowerCase().includes(ql) || c.symbol.toLowerCase().includes(ql)
      ).map(c => ({ ...c, thumb: null, marketCapRank: null, isLocal: true }));
      const stockMatches = Object.values(STOCK_DATA).filter(s =>
        s.name.toLowerCase().includes(ql) || s.symbol.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)
      ).map(s => ({ ...s, thumb: null, marketCapRank: null, isLocal: true, isStock: true }));
      const fmpMatches = (fmpStocks || []).filter(s =>
        s.n.toLowerCase().includes(ql) || s.s.toLowerCase().includes(ql)
      ).slice(0, 20).map(s => ({
        id: s.s, symbol: s.s, name: s.n,
        market: s.s.endsWith(".IS") ? "bist" : "us",
        currency: s.s.endsWith(".IS") ? "₺" : "$",
        sector: s.t === "etf" ? "ETF" : (s.e || "US"),
        thumb: null, marketCapRank: null, isLocal: true, isStock: true, isFMP: true,
      }));
      const seen = new Set();
      const combined = [];
      [...stockMatches, ...fmpMatches, ...localCoins].forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); combined.push(c); } });
      setLocalResults(combined.slice(0, 30));
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCoins(val), 250);
  };

  const selectCoin = (coin) => {
    setSelected(coin);
    setQuery("");
    setIsOpen(false);
    setResults([]);
    setLocalResults([]);
    onChange(coin);
  };

  // Merge local + API results, deduplicated (stocks first)
  const allResults = useMemo(() => {
    const seen = new Set();
    const merged = [];
    // Stock/TEFAS results first (instant, prioritized)
    localResults.filter(c => c.isStock).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    // Then other local results
    localResults.filter(c => !c.isStock).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    // Then API results (crypto)
    results.forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    return merged;
  }, [localResults, results]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <label style={{display:"block",fontSize:11,color:"#8892a4",marginBottom:6,fontWeight:500,textTransform:"uppercase",letterSpacing:.5}}>Varlık Ara & Seç</label>

      {/* Selected display */}
      {selected && !isOpen && (
        <div onClick={() => { setIsOpen(true); setQuery(""); }}
          style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:8,cursor:"pointer",transition:"border-color .2s"}}>
          {selected.thumb ? <img src={selected.thumb} alt="" style={{width:24,height:24,borderRadius:6}}/> :
            <div style={{width:24,height:24,borderRadius:6,background:"#F7931A22",color:"#F7931A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{selected.symbol?.charAt(0)}</div>}
          <div style={{flex:1}}>
            <span style={{fontWeight:600,fontSize:14,color:"#e2e8f0"}}>{selected.name}</span>
            <span style={{fontSize:12,color:"#4a5568",marginLeft:8,fontFamily:"'JetBrains Mono',monospace"}}>{selected.symbol}</span>
          </div>
          <span style={{fontSize:12,color:"#4a5568"}}>Değiştir ▾</span>
        </div>
      )}

      {/* Search input */}
      {(isOpen || !selected) && (
        <div style={{position:"relative"}}>
          <input
            autoFocus
            value={query}
            onChange={handleInput}
            onFocus={() => setIsOpen(true)}
            placeholder="BTC, THYAO, AAPL, IPB... yazın"
            style={{width:"100%",padding:"10px 12px 10px 36px",background:"#0d1117",border:"1px solid #F7931A44",borderRadius:8,color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"'Outfit',sans-serif"}}
          />
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#4a5568",fontSize:14}}>🔍</span>
          {searching && <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#F7931A",fontSize:12,animation:"spin 1s linear infinite"}}>◌</span>}
        </div>
      )}

      {/* Dropdown results */}
      {isOpen && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#131a27",border:"1px solid #1e2a3a",borderRadius:10,maxHeight:280,overflowY:"auto",zIndex:50,boxShadow:"0 12px 40px rgba(0,0,0,.5)"}}>
          {/* Show default coins when no search */}
          {query.length < 2 && (
            <>
              <div style={{padding:"8px 12px",fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #1a2332"}}>Popüler Kriptolar</div>
              {DEFAULT_COINS.slice(0,8).map(coin => {
                const p = prices[coin.id];
                return (
                  <div key={coin.id} onClick={() => selectCoin(coin)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid #111822",transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1a2332"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{width:28,height:28,borderRadius:7,background:"#F7931A15",color:"#F7931A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{coin.symbol.charAt(0)}</div>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:"#e2e8f0"}}>{coin.name}</div><div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}</div></div>
                    {p && <div style={{textAlign:"right"}}><div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#e2e8f0"}}>{fmt(p.usd,p.usd<1?4:2)}</div></div>}
                  </div>
                );
              })}
              <div style={{padding:"8px 12px",fontSize:11,color:"#3b82f6",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #1a2332",background:"#3b82f608"}}>BIST · ABD · TEFAS</div>
              {Object.values(STOCK_DATA).slice(0,15).map(asset => {
                const p = prices[asset.id];
                const mc = getMarketColor(asset.market);
                return (
                  <div key={asset.id} onClick={() => selectCoin(asset)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid #111822",transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1a2332"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{width:28,height:28,borderRadius:7,background:mc+"15",color:mc,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{asset.symbol.charAt(0)}</div>
                    <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:600,fontSize:13,color:"#e2e8f0"}}>{asset.name}</span><span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:mc+"18",color:mc,fontWeight:700}}>{getMarketLabel(asset.market)}</span></div><div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{asset.symbol}</div></div>
                    {p && <div style={{textAlign:"right"}}><div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#e2e8f0"}}>{fmt(p.usd,p.usd<1?4:2,asset.currency)}</div></div>}
                  </div>
                );
              })}
            </>
          )}

          {/* Search results */}
          {query.length >= 1 && allResults.length === 0 && !searching && (
            <div style={{padding:20,textAlign:"center",color:"#4a5568",fontSize:13}}>Sonuç bulunamadı</div>
          )}
          {query.length >= 1 && allResults.map(coin => {
            const mc = getMarketColor(coin.market||"crypto");
            return (
            <div key={coin.id} onClick={() => selectCoin(coin)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid #111822",transition:"background .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#1a2332"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {coin.thumb ? <img src={coin.thumb} alt="" style={{width:28,height:28,borderRadius:7}}/> :
                <div style={{width:28,height:28,borderRadius:7,background:mc+"22",color:mc,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{coin.symbol?.charAt(0)}</div>}
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:600,fontSize:13,color:"#e2e8f0"}}>{coin.name}</span>{coin.market&&coin.market!=="crypto"&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:mc+"18",color:mc,fontWeight:700}}>{getMarketLabel(coin.market)}</span>}</div>
                <div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}</div>
              </div>
              {coin.marketCapRank && <span style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>#{coin.marketCapRank}</span>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
};

// ═══ Connection Status Bar ═══
const ConnBar = ({status,retryCount,lastUpdate,refreshInterval,onRefreshChange,apiMode,onRetry,rateLimitInfo}) => {
  const c={connected:{color:"#00ff88",bg:"#00ff8812",bdr:"#00ff8833",icon:"●",lbl:"Canlı Bağlantı"},connecting:{color:"#ffaa00",bg:"#ffaa0012",bdr:"#ffaa0033",icon:"◌",lbl:"Bağlanıyor..."},retrying:{color:"#ff8800",bg:"#ff880012",bdr:"#ff880033",icon:"↻",lbl:`Yeniden Deneme (${retryCount}/${MAX_RETRIES})`},error:{color:"#ff4466",bg:"#ff446612",bdr:"#ff446633",icon:"✕",lbl:"Bağlantı Hatası"},ratelimited:{color:"#ff8800",bg:"#ff880012",bdr:"#ff880033",icon:"⏱",lbl:"Rate Limit"},demo:{color:"#8892a4",bg:"#8892a412",bdr:"#8892a433",icon:"◇",lbl:"Demo Modu"}}[status]||{color:"#8892a4",bg:"#8892a412",bdr:"#8892a433",icon:"◇",lbl:"Demo"};
  const spinning=status==="connecting"||status==="retrying";
  return (
    <div style={{padding:"10px 24px",background:"#080c14",borderBottom:"1px solid #111822"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,borderRadius:8,border:`1px solid ${c.bdr}`,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:c.color,fontSize:spinning?14:10,display:"inline-block",animation:spinning?"spin 1s linear infinite":"none"}}>{c.icon}</span></div>
          <div><div style={{fontSize:13,fontWeight:600,color:c.color}}>{c.lbl}</div><div style={{fontSize:11,color:"#4a5568"}}>{apiMode==="live"?"Binance + CoinGecko":"Çevrimdışı"}{lastUpdate&&` • ${lastUpdate.toLocaleTimeString("tr-TR")}`}</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {status==="error"&&<button onClick={onRetry} style={{padding:"6px 14px",background:"#111822",border:"1px solid #1e2a3a",color:"#F7931A",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}>↻ Tekrar Dene</button>}
          <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:"#4a5568",marginRight:4}}>Güncelleme:</span>
          {REFRESH.map(o=><button key={o.value} onClick={()=>onRefreshChange(o.value)} style={{padding:"4px 10px",background:refreshInterval===o.value?"#F7931A18":"transparent",border:`1px solid ${refreshInterval===o.value?"#F7931A44":"#1a2332"}`,color:refreshInterval===o.value?"#F7931A":"#4a5568",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}>{o.label}</button>)}</div>
        </div>
      </div>
      {rateLimitInfo&&<div style={{marginTop:8,padding:"8px 12px",background:"#1a120a",borderRadius:8,border:"1px solid #3d2800"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{color:"#ff8800",fontSize:11}}>⚠ Rate Limit</span><span style={{color:"#8892a4",fontSize:11}}>{rateLimitInfo}</span></div></div>}
    </div>
  );
};

// ═══ Settings Panel ═══
const Settings = ({show,onClose,apiKey,onKeyChange,onSave,keyStatus}) => {
  if(!show) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={onClose}>
      <div style={{background:"linear-gradient(135deg,#131a27,#0d1420)",border:"1px solid #1e2a3a",borderRadius:16,width:"100%",maxWidth:500,boxShadow:"0 24px 64px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #1a2332"}}><h3 style={{fontSize:16,fontWeight:600,color:"#e2e8f0"}}>⚙ API Ayarları</h3><button style={{background:"none",border:"none",color:"#4a5568",fontSize:18,cursor:"pointer"}} onClick={onClose}>✕</button></div>
        <div style={{padding:20}}>
          <div style={{marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>CoinGecko API</div>
            <div style={{fontSize:12,color:"#4a5568",lineHeight:1.5,marginBottom:12}}>Ücretsiz plan: ~10-30 req/dk. Pro plan ile daha yüksek limitler.</div>
            <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
              <div style={{flex:1}}><label style={{display:"block",fontSize:11,color:"#8892a4",marginBottom:6,fontWeight:500,textTransform:"uppercase",letterSpacing:.5}}>API Key (Opsiyonel)</label><input style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:8,color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} type="password" placeholder="CG-xxxxxxxxxxxx" value={apiKey} onChange={e=>onKeyChange(e.target.value)}/></div>
              <button style={{padding:"10px 16px",background:"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}} onClick={onSave}>Kaydet</button>
            </div>
            {keyStatus&&<div style={{marginTop:8,fontSize:12,fontWeight:500,color:keyStatus.type==="success"?"#00ff88":"#ffaa00"}}>{keyStatus.type==="success"?"✓":"⏳"} {keyStatus.message}</div>}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:10}}>Rate Limit Bilgisi</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["Ücretsiz","10-30/dk"],["Demo Key","30/dk"],["Pro","500/dk"]].map(([l,v])=><div key={l} style={{background:"#0d1117",borderRadius:8,padding:12,border:"1px solid #1a2332",textAlign:"center"}}><div style={{fontSize:10,color:"#4a5568",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{l}</div><div style={{fontSize:14,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#e2e8f0"}}>{v}</div></div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══ Auth System with Registration ═══
const AuthScreen = ({ onLogin }) => {
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Check auto-login
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cv_session");
      if (saved) { const s = JSON.parse(saved); if (s.user) onLogin(s.user); }
    } catch(e) {}
  }, [onLogin]);

  const getUsers = () => {
    try { return JSON.parse(localStorage.getItem("cv_users") || "{}"); } catch(e) { return {}; }
  };
  const saveUsers = (users) => localStorage.setItem("cv_users", JSON.stringify(users));

  const handleRegister = () => {
    if (!username.trim() || !email.trim() || !password || !confirmPass) { setError("Tüm alanları doldurun"); return; }
    if (username.trim().length < 3) { setError("Kullanıcı adı en az 3 karakter olmalı"); return; }
    if (!/\S+@\S+\.\S+/.test(email)) { setError("Geçerli bir e-posta girin"); return; }
    if (password.length < 6) { setError("Şifre en az 6 karakter olmalı"); return; }
    if (password !== confirmPass) { setError("Şifreler eşleşmiyor"); return; }
    const users = getUsers();
    if (users[username.trim().toLowerCase()]) { setError("Bu kullanıcı adı zaten kayıtlı"); return; }
    if (Object.values(users).find(u => u.email === email.trim().toLowerCase())) { setError("Bu e-posta zaten kayıtlı"); return; }
    setLoading(true); setError("");
    setTimeout(() => {
      users[username.trim().toLowerCase()] = { name: username.trim(), email: email.trim().toLowerCase(), password: btoa(password), created: new Date().toISOString() };
      saveUsers(users);
      setLoading(false); setSuccess("Hesap oluşturuldu! Şimdi giriş yapabilirsiniz.");
      setTimeout(() => { setMode("login"); setSuccess(""); setPassword(""); setConfirmPass(""); }, 1500);
    }, 1000);
  };

  const handleLogin = () => {
    if (!username.trim() || !password) { setError("Kullanıcı adı ve şifre gerekli"); return; }
    const users = getUsers();
    const user = users[username.trim().toLowerCase()];
    if (!user) { setError("Kullanıcı bulunamadı"); return; }
    if (atob(user.password) !== password) { setError("Şifre yanlış"); return; }
    setLoading(true); setError("");
    setTimeout(() => {
      if (rememberMe) localStorage.setItem("cv_session", JSON.stringify({ user: user.name }));
      onLogin(user.name);
      setLoading(false);
    }, 800);
  };

  const handleForgot = () => {
    if (!email.trim()) { setError("E-posta adresinizi girin"); return; }
    const users = getUsers();
    const found = Object.entries(users).find(([,u]) => u.email === email.trim().toLowerCase());
    if (!found) { setError("Bu e-posta ile kayıtlı hesap bulunamadı"); return; }
    setSuccess(`Kullanıcı adınız: ${found[1].name}`);
    setTimeout(() => { setMode("login"); setSuccess(""); }, 3000);
  };

  const inpSt = {width:"100%",padding:"12px 14px 12px 42px",background:"#0a0e17",border:"1px solid #1e2a3a",borderRadius:10,color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"'Outfit',sans-serif",transition:"all .2s"};
  const iconSt = {position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#4a5568"};
  const eyeSt = {position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:14,color:"#4a5568",userSelect:"none"};
  const Inp = (icon, val, set, ph, type="text", onKey=null) => (
    <div style={{position:"relative",marginBottom:16}}>
      <span style={iconSt}>{icon}</span>
      <input type={type==="password"?(showPass?"text":"password"):type} value={val}
        onChange={e=>{set(e.target.value);setError("");}}
        onKeyDown={e=>e.key==="Enter"&&onKey&&onKey()}
        onFocus={e=>e.target.style.borderColor="#F7931A44"}
        onBlur={e=>e.target.style.borderColor="#1e2a3a"}
        placeholder={ph} style={inpSt}/>
      {type==="password"&&<span onClick={()=>setShowPass(!showPass)} style={eyeSt}>{showPass?"◉":"◎"}</span>}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0a0e17",display:"flex",fontFamily:"'Outfit',sans-serif"}}>
      {/* Left - Branding */}
      <div style={{flex:1,background:"linear-gradient(135deg,#0d1420 0%,#111822 50%,#0a0e17 100%)",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:40,position:"relative",overflow:"hidden"}}>
        {/* Animated grid background */}
        <div style={{position:"absolute",inset:0,opacity:.05,backgroundImage:"radial-gradient(circle at 1px 1px, #F7931A 1px, transparent 0)",backgroundSize:"40px 40px"}}/>
        <div style={{position:"relative",zIndex:1,textAlign:"center",maxWidth:400}}>
          <div style={{fontSize:80,color:"#F7931A",marginBottom:20,filter:"drop-shadow(0 0 40px rgba(247,147,26,.25))",animation:"pulse 3s infinite"}}>◈</div>
          <div style={{fontSize:38,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff",letterSpacing:"-1px",marginBottom:12}}>CryptoVault</div>
          <div style={{fontSize:15,color:"#4a5568",lineHeight:1.6,marginBottom:32}}>Kripto, BIST, TEFAS ve ABD hisseleri. Gerçek zamanlı fiyatlar, detaylı analizler ve perpetual futures takibi.</div>
          <div style={{display:"flex",gap:24,justifyContent:"center"}}>
            {[["800+","Kripto"],["BIST","Hisse"],["TEFAS","Fon"],["US","Stocks"]].map(([n,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#F7931A"}}>{n}</div>
                <div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{position:"absolute",bottom:24,fontSize:11,color:"#1e2a3a"}}>© 2026 CryptoVault — Tüm hakları saklıdır</div>
      </div>

      {/* Right - Auth Form */}
      <div style={{width:480,display:"flex",alignItems:"center",justifyContent:"center",padding:40,background:"#080c14"}}>
        <div style={{width:"100%",maxWidth:380}}>
          {/* Mode Tabs */}
          <div style={{display:"flex",gap:2,background:"#0d1117",borderRadius:10,padding:3,marginBottom:32}}>
            {[["login","Giriş Yap"],["register","Kayıt Ol"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setSuccess("");}}
                style={{flex:1,padding:"10px",borderRadius:8,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif",
                  background:mode===m?"linear-gradient(135deg,#F7931A22,#e6820a11)":"transparent",
                  color:mode===m?"#F7931A":"#4a5568",transition:"all .2s"}}>{l}</button>
            ))}
          </div>

          {/* LOGIN */}
          {mode==="login"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>Hoş Geldiniz</h2>
            <p style={{fontSize:13,color:"#4a5568",marginBottom:28}}>Hesabınıza giriş yapın</p>
            {Inp("👤",username,setUsername,"Kullanıcı adı","text",handleLogin)}
            {Inp("🔒",password,setPassword,"Şifre","password",handleLogin)}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#4a5568"}}>
                <div onClick={()=>setRememberMe(!rememberMe)} style={{width:18,height:18,borderRadius:4,border:`1px solid ${rememberMe?"#F7931A":"#1e2a3a"}`,background:rememberMe?"#F7931A22":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .2s"}}>
                  {rememberMe&&<span style={{color:"#F7931A",fontSize:12}}>✓</span>}
                </div>
                Beni hatırla
              </label>
              <span onClick={()=>{setMode("forgot");setError("");}} style={{fontSize:12,color:"#F7931A",cursor:"pointer"}}>Şifremi unuttum</span>
            </div>
          </>}

          {/* REGISTER */}
          {mode==="register"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>Hesap Oluştur</h2>
            <p style={{fontSize:13,color:"#4a5568",marginBottom:28}}>Ücretsiz hesabınızı oluşturun</p>
            {Inp("👤",username,setUsername,"Kullanıcı adı (min. 3 karakter)")}
            {Inp("✉",email,setEmail,"E-posta adresi","email")}
            {Inp("🔒",password,setPassword,"Şifre (min. 6 karakter)","password")}
            {Inp("🔒",confirmPass,setConfirmPass,"Şifre tekrar","password",handleRegister)}
          </>}

          {/* FORGOT */}
          {mode==="forgot"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>Şifre Kurtarma</h2>
            <p style={{fontSize:13,color:"#4a5568",marginBottom:28}}>Kayıtlı e-posta adresinizi girin</p>
            {Inp("✉",email,setEmail,"E-posta adresi","email",handleForgot)}
            <span onClick={()=>{setMode("login");setError("");}} style={{fontSize:12,color:"#F7931A",cursor:"pointer"}}>← Giriş'e dön</span>
            <div style={{height:16}}/>
          </>}

          {error && <div style={{padding:"10px 14px",background:"#ff446612",border:"1px solid #ff446633",borderRadius:8,color:"#ff4466",fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><span>⚠</span>{error}</div>}
          {success && <div style={{padding:"10px 14px",background:"#00ff8812",border:"1px solid #00ff8833",borderRadius:8,color:"#00ff88",fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><span>✓</span>{success}</div>}

          <button onClick={mode==="login"?handleLogin:mode==="register"?handleRegister:handleForgot} disabled={loading}
            style={{width:"100%",padding:"14px",background:loading?"#6b4a0a":"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"'Outfit',sans-serif",transition:"all .2s",boxShadow:"0 4px 24px rgba(247,147,26,.25)",opacity:loading?.7:1}}>
            {loading?"İşleniyor...":mode==="login"?"Giriş Yap":mode==="register"?"Kayıt Ol":"Kullanıcı Adımı Göster"}
          </button>

          {/* Registered users count */}
          {mode==="register"&&<div style={{textAlign:"center",marginTop:20,fontSize:12,color:"#2d3a4a"}}>
            {Object.keys(getUsers()).length > 0 && `${Object.keys(getUsers()).length} kayıtlı kullanıcı`}
          </div>}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}body{background:#0a0e17}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
        @media(max-width:900px){
          div[style*="flex:1"]{display:none!important}
          div[style*="width:480"]{width:100%!important}
        }
      `}</style>
    </div>
  );
};

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function CryptoPortfolio() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState("");
  const [tab, setTab] = useState("overview");
  const [prices, setPrices] = useState({});
  const [knownCoins, setKnownCoins] = useState(() => {
    try { const s = localStorage.getItem("cv_knownCoins"); return s ? JSON.parse(s) : [...DEFAULT_COINS]; } catch(e) { return [...DEFAULT_COINS]; }
  });

  // Multi-portfolio system
  const [portfolios, setPortfolios] = useState(() => {
    try {
      const s = localStorage.getItem("cv_portfolios");
      return s ? JSON.parse(s) : { "Ana Portföy": [{coinId:"bitcoin",amount:0.5,buyPrice:65000},{coinId:"ethereum",amount:4,buyPrice:2800},{coinId:"solana",amount:25,buyPrice:120}] };
    } catch(e) { return { "Ana Portföy": [{coinId:"bitcoin",amount:0.5,buyPrice:65000},{coinId:"ethereum",amount:4,buyPrice:2800},{coinId:"solana",amount:25,buyPrice:120}] }; }
  });
  const [activePortfolio, setActivePortfolio] = useState(() => {
    try { return localStorage.getItem("cv_activePortfolio") || "Ana Portföy"; } catch(e) { return "Ana Portföy"; }
  });
  const [showPortfolioMenu, setShowPortfolioMenu] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Active portfolio items
  const portfolio = portfolios[activePortfolio] || [];
  const setPortfolio = (updater) => {
    setPortfolios(prev => {
      const current = prev[activePortfolio] || [];
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activePortfolio]: next };
    });
  };
  const [showAdd, setShowAdd] = useState(false);
  const [ncCoin, setNcCoin] = useState(null);
  const [ncAmount, setNcAmount] = useState("");
  const [ncBuyPrice, setNcBuyPrice] = useState("");
  const [ncSection, setNcSection] = useState("Genel");
  const [sections, setSections] = useState(() => {
    try { const s = localStorage.getItem("cv_sections"); return s ? JSON.parse(s) : ["Genel"]; } catch(e) { return ["Genel"]; }
  });
  const [newSectionInput, setNewSectionInput] = useState("");
  const [dragIdx, setDragIdx] = useState(null); // index of item being dragged
  const [dragOverSection, setDragOverSection] = useState(null); // section being hovered
  const [editSectionName, setEditSectionName] = useState(null);
  const [editSectionValue, setEditSectionValue] = useState("");
  const [chartData, setChartData] = useState({});
  const [selChart, setSelChart] = useState("bitcoin");
  const [loading, setLoading] = useState(true);
  const [fmpStocks, setFmpStocks] = useState([]);
  const [search, setSearch] = useState("");
  const [chartPeriod, setChartPeriod] = useState(30);
  const [editIdx, setEditIdx] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const [apiMode, setApiMode] = useState("connecting");
  const [connStatus, setConnStatus] = useState("connecting");
  const [retryCount, setRetryCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(300000);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  const [reqLog, setReqLog] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [keyStatus, setKeyStatus] = useState(null);
  const intRef = useRef(null);
  const retryRef = useRef(null);

  const log = useCallback((type,ok,detail)=>setReqLog(p=>[{time:new Date(),type,success:ok,detail},...p.slice(0,49)]),[]);

  // Save to localStorage on change
  useEffect(() => { try { localStorage.setItem("cv_portfolios", JSON.stringify(portfolios)); } catch(e) {} }, [portfolios]);
  useEffect(() => { try { localStorage.setItem("cv_activePortfolio", activePortfolio); } catch(e) {} }, [activePortfolio]);
  useEffect(() => { try { localStorage.setItem("cv_knownCoins", JSON.stringify(knownCoins)); } catch(e) {} }, [knownCoins]);
  useEffect(() => { try { localStorage.setItem("cv_sections", JSON.stringify(sections)); } catch(e) {} }, [sections]);

  const buildUrl = useCallback((path,params="")=>{
    const base=savedKey?"https://pro-api.coingecko.com/api/v3":"https://api.coingecko.com/api/v3";
    const kp=savedKey?`x_cg_pro_api_key=${savedKey}`:"";
    const parts=[params,kp].filter(Boolean).join("&");
    return `${base}${path}${parts?"?"+parts:""}`;
  },[savedKey]);

  // All Binance tickers stored here
  const binanceRef = useRef({}); // symbol -> ticker
  const futuresRef = useRef({}); // symbol -> futures ticker (perp)
  const [showPerp, setShowPerp] = useState(false); // Toggle spot/perp view

  // ── Fetch ALL Binance Spot USDT tickers ──
  const fetchAllBinance = useCallback(async () => {
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const map = {};
      data.forEach(t => { if (t.symbol.endsWith("USDT")) map[t.symbol] = t; });
      binanceRef.current = map;
      return map;
    } catch (e) {
      log("price", false, `Binance Spot: ${e.message}`);
      return null;
    }
  }, [log]);

  // ── Fetch ALL Binance Futures USDT Perpetual tickers + funding rates ──
  const fetchAllFutures = useCallback(async () => {
    try {
      const [tickerRes, fundingRes] = await Promise.all([
        fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"),
        fetch("https://fapi.binance.com/fapi/v1/premiumIndex"),
      ]);
      if (!tickerRes.ok) throw new Error(`Futures HTTP ${tickerRes.status}`);
      const tickers = await tickerRes.json();
      const funding = fundingRes.ok ? await fundingRes.json() : [];

      const fundingMap = {};
      funding.forEach(f => {
        fundingMap[f.symbol] = {
          markPrice: parseFloat(f.markPrice),
          indexPrice: parseFloat(f.indexPrice),
          fundingRate: parseFloat(f.lastFundingRate),
          nextFundingTime: f.nextFundingTime,
        };
      });

      const map = {};
      tickers.forEach(t => {
        if (t.symbol.endsWith("USDT")) {
          map[t.symbol] = {
            ...t,
            perp: true,
            markPrice: fundingMap[t.symbol]?.markPrice || parseFloat(t.lastPrice),
            indexPrice: fundingMap[t.symbol]?.indexPrice || 0,
            fundingRate: fundingMap[t.symbol]?.fundingRate || 0,
            nextFundingTime: fundingMap[t.symbol]?.nextFundingTime || 0,
          };
        }
      });
      futuresRef.current = map;
      return map;
    } catch (e) {
      log("price", false, `Binance Futures: ${e.message}`);
      return null;
    }
  }, [log]);

  // Resolve any coinId to Binance price
  const resolveBinancePrice = useCallback((coinId, binData) => {
    if (!binData || Object.keys(binData).length === 0) return null;
    // Known overrides where CoinGecko ID != Binance symbol
    const overrides = {
      "binancecoin":"BNB","avalanche-2":"AVAX","matic-network":"MATIC",
      "shiba-inu":"SHIB","internet-computer":"ICP","render-token":"RENDER",
      "injective-protocol":"INJ","sei-network":"SEI","fetch-ai":"FET",
      "the-graph":"GRT","lido-dao":"LDO","immutable-x":"IMX",
      "hedera-hashgraph":"HBAR","theta-token":"THETA","cosmos":"ATOM",
      "bitcoin-cash":"BCH","wrapped-bitcoin":"WBTC","crypto-com-chain":"CRO",
      "elrond-erd-2":"EGLD","axie-infinity":"AXS","decentraland":"MANA",
      "the-sandbox":"SAND","enjincoin":"ENJ","basic-attention-token":"BAT",
      "zilliqa":"ZIL","harmony":"ONE","pancakeswap-token":"CAKE",
      "thorchain":"RUNE","curve-dao-token":"CRV","convex-finance":"CVX",
      "compound-governance-token":"COMP","yearn-finance":"YFI","sushi":"SUSHI",
      "1inch":"1INCH","gala":"GALA","flow":"FLOW","mina-protocol":"MINA",
      "quant-network":"QNT","terra-luna-2":"LUNA","stepn":"GMT",
      "ocean-protocol":"OCEAN","rocket-pool":"RPL","staked-ether":"STETH",
    };
    // Try override
    const ov = overrides[coinId];
    if (ov && binData[ov + "USDT"]) return binData[ov + "USDT"];
    // Try coin symbol from knownCoins
    const coin = knownCoins.find(c => c.id === coinId);
    if (coin) {
      const sym = coin.symbol.toUpperCase() + "USDT";
      if (binData[sym]) return binData[sym];
    }
    // Try coinId as symbol
    const direct = coinId.toUpperCase().replace(/-\d+$/,"").replace(/-/g,"") + "USDT";
    if (binData[direct]) return binData[direct];
    return null;
  }, [knownCoins]);

  // ── Fetch CoinGecko markets (top 250 in ONE call) ──
  const fetchCoinGeckoMarkets = useCallback(async () => {
    try {
      const url = buildUrl("/coins/markets", "vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d");
      const res = await fetch(url);
      if (res.status === 429) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const f = {};
      data.forEach(c => {
        f[c.id] = {
          usd: c.current_price,
          usd_24h_change: c.price_change_percentage_24h || 0,
          usd_7d_change: c.price_change_percentage_7d_in_currency || 0,
          usd_market_cap: c.market_cap || 0,
        };
      });
      return f;
    } catch (e) {
      log("price", false, `CoinGecko markets: ${e.message}`);
      return null;
    }
  }, [buildUrl, log]);

  // ── Fetch specific coins from CoinGecko (for coins not in top 250) ──
  const fetchCoinGeckoSpecific = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return null;
    try {
      const url = buildUrl("/simple/price", `ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true`);
      const res = await fetch(url);
      if (res.status === 429 || !res.ok) return null;
      const data = await res.json();
      const f = {};
      Object.entries(data).forEach(([id, v]) => {
        f[id] = { usd: v.usd, usd_24h_change: v.usd_24h_change || 0, usd_7d_change: v.usd_7d_change || 0, usd_market_cap: v.usd_market_cap || 0 };
      });
      return f;
    } catch (e) { return null; }
  }, [buildUrl]);

  // ══ MAIN FETCH: Binance (all) + CoinGecko (top 250 + specific) ══
  const fetchPrices = useCallback(async (isRetry = false) => {
    if (!isRetry) setConnStatus("connecting");
    try {
      const allPrices = {};
      let source = "";

      // 1) Binance Spot — all USDT pairs, instant
      const binData = await fetchAllBinance();
      if (binData) {
        const allCoins = new Set([...DEFAULT_COINS.map(c=>c.id), ...knownCoins.map(c=>c.id), ...Object.values(portfolios).flat().map(p=>p.coinId)]);
        allCoins.forEach(coinId => {
          const ticker = resolveBinancePrice(coinId, binData);
          if (ticker) {
            allPrices[coinId] = {
              usd: parseFloat(ticker.lastPrice),
              usd_24h_change: parseFloat(ticker.priceChangePercent),
              usd_7d_change: 0,
              usd_market_cap: parseFloat(ticker.quoteVolume),
            };
          }
        });
        source = `Spot: ${Object.keys(allPrices).length}`;
      }

      // 1.5) Binance Futures Perpetual — mark price, funding rate
      const futData = await fetchAllFutures();
      if (futData) {
        const allCoins = new Set([...DEFAULT_COINS.map(c=>c.id), ...knownCoins.map(c=>c.id), ...Object.values(portfolios).flat().map(p=>p.coinId)]);
        let perpCount = 0;
        allCoins.forEach(coinId => {
          const ticker = resolveBinancePrice(coinId, futData);
          if (ticker && ticker.perp) {
            perpCount++;
            if (allPrices[coinId]) {
              // Add perp data to existing spot data
              allPrices[coinId].perp_price = parseFloat(ticker.lastPrice);
              allPrices[coinId].mark_price = ticker.markPrice;
              allPrices[coinId].index_price = ticker.indexPrice;
              allPrices[coinId].funding_rate = ticker.fundingRate;
              allPrices[coinId].next_funding = ticker.nextFundingTime;
              allPrices[coinId].perp_24h_change = parseFloat(ticker.priceChangePercent);
              allPrices[coinId].perp_volume = parseFloat(ticker.quoteVolume);
            } else {
              // No spot data, use perp as primary
              allPrices[coinId] = {
                usd: parseFloat(ticker.lastPrice),
                usd_24h_change: parseFloat(ticker.priceChangePercent),
                usd_7d_change: 0,
                usd_market_cap: parseFloat(ticker.quoteVolume),
                perp_price: parseFloat(ticker.lastPrice),
                mark_price: ticker.markPrice,
                index_price: ticker.indexPrice,
                funding_rate: ticker.fundingRate,
                next_funding: ticker.nextFundingTime,
                perp_24h_change: parseFloat(ticker.priceChangePercent),
                perp_volume: parseFloat(ticker.quoteVolume),
              };
            }
          }
        });
        source += ` + Perp: ${perpCount}`;
      }

      // 2) CoinGecko markets — top 250 (fills 7d change + market cap + missing coins)
      const cgMarkets = await fetchCoinGeckoMarkets();
      if (cgMarkets) {
        Object.entries(cgMarkets).forEach(([id, data]) => {
          if (!allPrices[id]) {
            allPrices[id] = data; // Coin not on Binance
          } else {
            // Merge: keep Binance price (more real-time) but add CG metadata
            allPrices[id] = {
              ...allPrices[id],
              usd_7d_change: data.usd_7d_change || allPrices[id].usd_7d_change,
              usd_market_cap: data.usd_market_cap || allPrices[id].usd_market_cap,
            };
          }
        });
        source += ` + CG: ${Object.keys(cgMarkets).length}`;
      }

      // 3) Any portfolio coins still missing? Fetch specifically
      const missing = [];
      [...new Set(Object.values(portfolios).flat().map(p=>p.coinId))].forEach(id => {
        if (!allPrices[id]) missing.push(id);
      });
      // Separate crypto missing from stock missing
      const cryptoMissing = missing.filter(id => !isStock(id));
      const stockMissing = missing.filter(id => isStock(id));

      if (cryptoMissing.length > 0) {
        const specific = await fetchCoinGeckoSpecific(cryptoMissing);
        if (specific) {
          Object.assign(allPrices, specific);
          source += ` + Specific: ${Object.keys(specific).length}`;
        }
      }

      // 4) Stock/TEFAS — Financial Modeling Prep API (CORS-free, fast)
      const FMP_KEY = "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";
      const portfolioStockIds = [...new Set(Object.values(portfolios).flat().map(p=>p.coinId).filter(id=>isStock(id)))];
      const allStockIds = Object.keys(STOCK_DATA);
      // Portföydeki hisseler öncelikli, sonra ilk 50 STOCK_DATA
      const stocksToFetch = [...new Set([...portfolioStockIds, ...allStockIds.slice(0, 80)])];

      if (stocksToFetch.length > 0) {
        const results = {};
        let stockSource = "";

        // FMP sembol formatı: THYAO.IS → THYAO.IS (aynı), AAPL → AAPL (aynı)
        const fetchFMPBatch = async (symbols) => {
          try {
            const symStr = symbols.join(",");
            const url = `https://financialmodelingprep.com/api/v3/quote/${symStr}?apikey=${FMP_KEY}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) return null;
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return { quotes: data, src: "FMP" };
          } catch (e) {}

          // Fallback: Own Vercel API route (Yahoo Finance proxy)
          try {
            const baseUrl = window.location.origin;
            const url = `${baseUrl}/api/stocks?symbols=${symbols.join(",")}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (res.ok) {
              const data = await res.json();
              if (data?.quoteResponse?.result?.length > 0) return { quotes: data.quoteResponse.result.map(q => ({
                symbol: q.symbol, price: q.regularMarketPrice, changesPercentage: q.regularMarketChangePercent, currency: q.currency
              })), src: "Yahoo" };
            }
          } catch (e) {}

          return null;
        };

        // FMP batch: 50 sembol/request (günlük 250 çağrı limiti — dikkatli kullan)
        for (let i = 0; i < stocksToFetch.length; i += 50) {
          const batch = stocksToFetch.slice(i, i + 50);
          const result = await fetchFMPBatch(batch);

          if (result) {
            if (!stockSource) stockSource = result.src;
            result.quotes.forEach(q => {
              const sym = q.symbol;
              const info = STOCK_DATA[sym];
              if (!sym) return;
              results[sym] = {
                usd: q.price || q.regularMarketPrice || 0,
                usd_24h_change: q.changesPercentage || q.regularMarketChangePercent || 0,
                usd_7d_change: 0,
                usd_market_cap: q.marketCap || 0,
                currency: info?.currency || (q.currency === "TRY" ? "₺" : "$"),
                market: info?.market || (sym.endsWith(".IS") ? "bist" : "us"),
              };
            });
          } else {
            stockSource = "Cache";
            break;
          }
          if (i + 50 < stocksToFetch.length) await new Promise(r => setTimeout(r, 300));
        }

        if (Object.keys(results).length > 0) {
          Object.assign(allPrices, results);
          source += ` + ${stockSource}: ${Object.keys(results).length}`;
          log("price", true, `Hisse/Fon: ${Object.keys(results).length} (${stockSource})`);
          // Cache all fetched
          try {
            const prev = JSON.parse(localStorage.getItem("cv_stock_prices") || "{}");
            const updated = { ...prev };
            Object.entries(results).forEach(([id, v]) => { updated[id] = { ...v, _ts: Date.now() }; });
            localStorage.setItem("cv_stock_prices", JSON.stringify(updated));
          } catch(e) {}
        } else {
          // Load from cache
          try {
            const cached = JSON.parse(localStorage.getItem("cv_stock_prices") || "{}");
            if (Object.keys(cached).length > 0) {
              Object.entries(cached).forEach(([id, v]) => { if (!allPrices[id]) allPrices[id] = v; });
              source += ` + StockCache: ${Object.keys(cached).length}`;
            }
          } catch(e) {}
          log("price", false, "Hisse/Fon: API erişilemedi, cache kullanıldı");
        }
      }

      // 5) TEFAS Fonları — Vercel serverless function üzerinden
      const tefasIds = Object.keys(TEFAS_DATA);
      const portfolioTefas = [...new Set(Object.values(portfolios).flat().map(p=>p.coinId).filter(id=>id.endsWith(".TEFAS")))];
      const tefasToFetch = [...new Set([...portfolioTefas, ...tefasIds])];

      if (tefasToFetch.length > 0) {
        try {
          const baseUrl = window.location.origin;
          const url = `${baseUrl}/api/tefas?symbols=${tefasToFetch.join(",")}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (res.ok) {
            const data = await res.json();
            if (data?.results?.length > 0) {
              data.results.forEach(r => {
                allPrices[r.symbol] = {
                  usd: r.price || 0,
                  usd_24h_change: r.changesPercentage || 0,
                  usd_7d_change: 0,
                  usd_market_cap: 0,
                  currency: "₺",
                  market: "tefas",
                };
              });
              source += ` + TEFAS: ${data.results.length}`;
              log("price", true, `TEFAS: ${data.results.length} fon`);
            }
          }
        } catch (e) {
          log("price", false, "TEFAS: API erişilemedi");
        }
      }

      if (Object.keys(allPrices).length > 0) {
        setPrices(prev => ({ ...prev, ...allPrices }));
        setApiMode("live"); setConnStatus("connected"); setLastUpdate(new Date());
        setRetryCount(0); setRateLimitInfo(null); setLoading(false);
        log("price", true, source);
        return;
      }

      throw new Error("Hiçbir kaynaktan veri alınamadı");
    } catch (err) {
      log("price", false, err.message);
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 60000;
        setConnStatus("retrying"); setRetryCount(p => p + 1);
        retryRef.current = setTimeout(() => fetchPrices(true), delay);
      } else {
        setPrices(genDemo()); setApiMode("demo"); setConnStatus("demo");
        setLastUpdate(new Date()); setLoading(false); setRetryCount(0);
      }
    }
  }, [retryCount, fetchAllBinance, resolveBinancePrice, fetchCoinGeckoMarkets, fetchCoinGeckoSpecific, knownCoins, portfolios, log]);

  // Fetch single coin price (for newly added coins)
  const fetchCoinPrice = useCallback(async (coinId) => {
    // Try Binance
    const ticker = resolveBinancePrice(coinId, binanceRef.current);
    if (ticker) {
      setPrices(prev => ({ ...prev, [coinId]: { usd: parseFloat(ticker.lastPrice), usd_24h_change: parseFloat(ticker.priceChangePercent), usd_7d_change: 0, usd_market_cap: parseFloat(ticker.quoteVolume) } }));
      return;
    }
    // Fallback CoinGecko
    try {
      const url = buildUrl("/simple/price", `ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
      const res = await fetch(url); if (!res.ok) return;
      const data = await res.json();
      if (data[coinId]) setPrices(prev => ({ ...prev, [coinId]: { usd: data[coinId].usd, usd_24h_change: data[coinId].usd_24h_change || 0, usd_7d_change: 0, usd_market_cap: 0 } }));
    } catch (e) {}
  }, [resolveBinancePrice, buildUrl]);

  const fetchChart = useCallback(async(coinId)=>{
    // Try Binance klines
    const ticker = resolveBinancePrice(coinId, binanceRef.current);
    if (ticker) {
      const symbol = Object.entries(binanceRef.current).find(([,v]) => v === ticker)?.[0];
      if (symbol) {
        try {
          const interval = chartPeriod <= 7 ? "1h" : chartPeriod <= 30 ? "4h" : "1d";
          const limit = chartPeriod <= 7 ? chartPeriod * 24 : chartPeriod <= 30 ? chartPeriod * 6 : chartPeriod;
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
          if (res.ok) {
            const data = await res.json();
            setChartData(p => ({ ...p, [`${coinId}-${chartPeriod}`]: data.map(k => ({ date: new Date(k[0]).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }), price: parseFloat(parseFloat(k[4]).toFixed(2)) })) }));
            log("chart", true, `Binance: ${coinId} ${chartPeriod}g`);
            return;
          }
        } catch (e) {}
      }
    }
    // Fallback CoinGecko
    try {
      const url=buildUrl(`/coins/${coinId}/market_chart`,`vs_currency=usd&days=${chartPeriod}`);
      const res=await fetch(url);
      if(res.status===429){setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:genChart(prices[coinId]?.usd||100,chartPeriod)}));return;}
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:data.prices.map(([ts,pr])=>({date:new Date(ts).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}),price:+pr.toFixed(2)}))}));
      log("chart",true,`CoinGecko: ${coinId} ${chartPeriod}g`);
    } catch(e){log("chart",false,e.message);setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:genChart(prices[coinId]?.usd||100,chartPeriod)}));}
  },[resolveBinancePrice,chartPeriod,prices,buildUrl,log]);

  useEffect(()=>{fetchPrices();return()=>{if(retryRef.current)clearTimeout(retryRef.current);};},[]);
  useEffect(()=>{if(intRef.current)clearInterval(intRef.current);intRef.current=setInterval(()=>{if(connStatus!=="retrying"&&connStatus!=="ratelimited")fetchPrices();},refreshInterval);return()=>{if(intRef.current)clearInterval(intRef.current);};},[refreshInterval,connStatus,fetchPrices]);

  // FMP tüm hisse listesi — startup'ta çek, 24 saat cache'le
  useEffect(() => {
    const loadFmpStocks = async () => {
      // Önce localStorage cache'e bak
      try {
        const cached = JSON.parse(localStorage.getItem("cv_fmp_stocklist") || "{}");
        if (cached.stocks && cached.ts && (Date.now() - cached.ts < 86400000)) {
          setFmpStocks(cached.stocks);
          return;
        }
      } catch(e) {}

      // Cache yoksa veya eski → API'den çek
      try {
        const baseUrl = window.location.origin;
        const res = await fetch(`${baseUrl}/api/stocklist`, { signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const data = await res.json();
          if (data?.stocks?.length > 0) {
            setFmpStocks(data.stocks);
            try { localStorage.setItem("cv_fmp_stocklist", JSON.stringify({ stocks: data.stocks, ts: Date.now() })); } catch(e) {}
          }
        }
      } catch (e) {
        console.log("FMP stock list fetch failed:", e.message);
      }
    };
    loadFmpStocks();
  }, []);
  useEffect(()=>{if(Object.keys(prices).length>0)fetchChart(selChart);},[selChart,chartPeriod,prices,fetchChart]);

  const saveKey=()=>{if(apiKey.trim()){setSavedKey(apiKey.trim());setKeyStatus({type:"success",message:"API key kaydedildi!"});setRetryCount(0);setTimeout(()=>fetchPrices(),500);}else{setSavedKey("");setKeyStatus({type:"info",message:"Key kaldırıldı."});}setTimeout(()=>setKeyStatus(null),4000);};
  const retry=()=>{setRetryCount(0);setConnStatus("connecting");if(retryRef.current)clearTimeout(retryRef.current);fetchPrices();};

  // Add coin with dynamic coin support
  const addCoin = () => {
    if (!ncCoin || !ncAmount || !ncBuyPrice) return;
    const coinId = ncCoin.id;
    const section = ncSection || "Genel";

    if (!knownCoins.find(c => c.id === coinId)) {
      setKnownCoins(prev => [...prev, { id: coinId, symbol: ncCoin.symbol, name: ncCoin.name, market: ncCoin.market, currency: ncCoin.currency }]);
    }

    if (editIdx !== null) {
      setPortfolio(p => p.map((it, i) => i === editIdx ? { coinId, amount: +ncAmount, buyPrice: +ncBuyPrice, section } : it));
      setEditIdx(null);
    } else {
      setPortfolio(p => [...p, { coinId, amount: +ncAmount, buyPrice: +ncBuyPrice, section }]);
    }

    // Fetch price if not available — different strategy for stocks vs crypto
    if (!prices[coinId]) {
      if (isStock(coinId)) {
        // Trigger a full fetchPrices which includes stock fetching
        fetchPrices();
      } else {
        fetchCoinPrice(coinId);
      }
    }

    setNcCoin(null); setNcAmount(""); setNcBuyPrice(""); setNcSection("Genel");
    setShowAdd(false);
  };

  const pData=useMemo(()=>portfolio.map(item=>{
    const coin = knownCoins.find(c=>c.id===item.coinId) || ALL_ASSETS[item.coinId] || {id:item.coinId,symbol:"?",name:item.coinId};
    const cp=prices[item.coinId]?.usd||0;const ch=prices[item.coinId]?.usd_24h_change||0;const cv=item.amount*cp;const iv=item.amount*item.buyPrice;const pnl=cv-iv;
    const mkt = getMarketType(item.coinId);
    const cur = ALL_ASSETS[item.coinId]?.currency || "$";
    return{...item,coin:{...coin,market:mkt,currency:cur},currentPrice:cp,change24h:ch,currentValue:cv,investedValue:iv,pnl,pnlPct:iv>0?(pnl/iv)*100:0,market:mkt,currency:cur};
  }),[portfolio,prices,knownCoins]);

  const totVal=pData.reduce((s,i)=>s+i.currentValue,0), totInv=pData.reduce((s,i)=>s+i.investedValue,0), totPnl=totVal-totInv, totPnlPct=totInv>0?(totPnl/totInv)*100:0, tot24h=pData.reduce((s,i)=>s+i.currentValue*(i.change24h/100),0);
  const pieData=pData.map((item,i)=>({name:item.coin?.symbol||"?",value:+item.currentValue.toFixed(2),color:CLR[i%CLR.length]}));

  // ══ ALL PORTFOLIOS combined data ══
  const allPData = useMemo(() => {
    const combined = {};
    Object.entries(portfolios).forEach(([pName, items]) => {
      items.forEach(item => {
        const coin = knownCoins.find(c => c.id === item.coinId) || { id: item.coinId, symbol: "?", name: item.coinId };
        const cp = prices[item.coinId]?.usd || 0;
        const ch = prices[item.coinId]?.usd_24h_change || 0;
        if (!combined[item.coinId]) {
          combined[item.coinId] = { coinId: item.coinId, coin, currentPrice: cp, change24h: ch, totalAmount: 0, totalInvested: 0, portfolios: [] };
        }
        combined[item.coinId].totalAmount += item.amount;
        combined[item.coinId].totalInvested += item.amount * item.buyPrice;
        combined[item.coinId].portfolios.push({ name: pName, amount: item.amount, buyPrice: item.buyPrice });
      });
    });
    return Object.values(combined).map(c => ({
      ...c,
      currentValue: c.totalAmount * c.currentPrice,
      pnl: (c.totalAmount * c.currentPrice) - c.totalInvested,
      pnlPct: c.totalInvested > 0 ? (((c.totalAmount * c.currentPrice) - c.totalInvested) / c.totalInvested) * 100 : 0,
    })).sort((a, b) => b.currentValue - a.currentValue);
  }, [portfolios, prices, knownCoins]);
  const allTotVal = allPData.reduce((s, i) => s + i.currentValue, 0);
  const allTotInv = allPData.reduce((s, i) => s + i.totalInvested, 0);
  const allTotPnl = allTotVal - allTotInv;
  const allTotPnlPct = allTotInv > 0 ? (allTotPnl / allTotInv) * 100 : 0;
  const allTot24h = allPData.reduce((s, i) => s + i.currentValue * (i.change24h / 100), 0);
  const allPieData = allPData.map((item, i) => ({ name: item.coin?.symbol || "?", value: +item.currentValue.toFixed(2), color: CLR[i % CLR.length] }));
  // Per-portfolio summary
  const portfolioSummaries = useMemo(() => {
    return Object.entries(portfolios).map(([name, items]) => {
      let val = 0, inv = 0, ch24 = 0;
      items.forEach(item => {
        const cp = prices[item.coinId]?.usd || 0;
        const change = prices[item.coinId]?.usd_24h_change || 0;
        const cv = item.amount * cp;
        val += cv; inv += item.amount * item.buyPrice; ch24 += cv * (change / 100);
      });
      return { name, value: val, invested: inv, pnl: val - inv, pnlPct: inv > 0 ? ((val - inv) / inv) * 100 : 0, change24h: ch24, count: items.length };
    });
  }, [portfolios, prices]);
  const [marketFilter, setMarketFilter] = useState("all"); // all | crypto | bist | us | tefas
  const [showReportNotif, setShowReportNotif] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [reportHistory, setReportHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cv_report_history") || "[]"); } catch(e) { return []; }
  });

  // Ay sonu hatırlatma — her ay 25'inden sonra göster
  useEffect(() => {
    const today = new Date();
    const day = today.getDate();
    const key = `cv_report_${today.getFullYear()}_${today.getMonth()}`;
    const generated = localStorage.getItem(key);
    if (day >= 25 && !generated) setShowReportNotif(true);
  }, []);

  // PDF Rapor Oluştur
  const generateReport = async () => {
    try {
      const doc = new jsPDF("p", "mm", "a4");
      const w = doc.internal.pageSize.getWidth();
      const now = new Date();
      const dateStr = now.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
      const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const monthName = now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

      // === SAYFA 1: Kapak + Özet ===
      doc.setFillColor(15, 20, 30);
      doc.rect(0, 0, w, 45, "F");
      doc.setFillColor(247, 147, 26);
      doc.rect(0, 43, w, 2, "F");

      doc.setTextColor(247, 147, 26);
      doc.setFontSize(28);
      doc.text("CryptoVault", 20, 22);
      doc.setFontSize(9);
      doc.setTextColor(130, 140, 160);
      doc.text("CRYPTO  BIST  TEFAS  US", 20, 30);
      doc.text(dateStr + " - " + timeStr, 20, 38);

      doc.setFontSize(10);
      doc.setTextColor(180, 180, 180);
      doc.text("Kullanici: " + currentUser, w - 20, 30, { align: "right" });
      doc.text("Aktif Portfoy: " + activePortfolio, w - 20, 38, { align: "right" });

      doc.setFontSize(18);
      doc.setTextColor(40, 40, 60);
      doc.text("Aylik Portfoy Raporu - " + monthName, 20, 60);

      // Özet kartlar
      let y = 72;
      const fmtR = (v) => v >= 1e6 ? "$" + (v/1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v/1e3).toFixed(1) + "K" : "$" + v.toFixed(2);

      const drawBox = (x, label, value, color) => {
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(x, y, 52, 28, 3, 3, "F");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 140);
        doc.text(label, x + 5, y + 10);
        doc.setFontSize(14);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(value, x + 5, y + 22);
      };

      drawBox(15, "Toplam Deger", fmtR(allTotVal), [30, 30, 50]);
      drawBox(72, "Toplam Yatirim", fmtR(allTotInv), [60, 60, 80]);
      drawBox(129, "Kar / Zarar", (allTotPnl >= 0 ? "+" : "") + fmtR(Math.abs(allTotPnl)), allTotPnl >= 0 ? [0, 180, 80] : [220, 60, 60]);

      y += 34;

      // Piyasa Dağılımı
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 60);
      doc.text("Piyasa Dagilimi", 20, y);
      y += 8;

      const mktTotals = {};
      allPData.forEach(item => { const m = getMarketType(item.coinId); mktTotals[m] = (mktTotals[m] || 0) + item.currentValue; });
      const mktColors = { crypto: [247, 147, 26], bist: [59, 130, 246], us: [139, 92, 246], tefas: [6, 182, 212] };
      const mktLabels2 = { crypto: "Kripto", bist: "BIST", us: "ABD", tefas: "TEFAS" };
      let barX = 20;
      const barW = w - 40;
      Object.entries(mktTotals).forEach(([m, val]) => {
        const pct = allTotVal > 0 ? val / allTotVal : 0;
        const segW = barW * pct;
        doc.setFillColor(mktColors[m]?.[0]||140, mktColors[m]?.[1]||140, mktColors[m]?.[2]||160);
        doc.rect(barX, y, Math.max(segW, 1), 6, "F");
        if (segW > 20) {
          doc.setFontSize(7);
          doc.setTextColor(255, 255, 255);
          doc.text((mktLabels2[m] || m) + " " + (pct * 100).toFixed(1) + "%", barX + 2, y + 4.5);
        }
        barX += segW;
      });
      y += 14;

      // Portföy bazlı özet
      if (Object.keys(portfolios).length > 1) {
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 60);
        doc.text("Portfolyolar", 20, y);
        y += 4;

        const pSumData = portfolioSummaries.map(p => [
          p.name, fmtR(p.value), fmtR(p.invested),
          (p.pnl >= 0 ? "+" : "") + fmtR(Math.abs(p.pnl)),
          (p.pnlPct >= 0 ? "+" : "") + p.pnlPct.toFixed(2) + "%",
          String(p.count),
        ]);

        autoTable(doc, {
          startY: y,
          head: [["Portfoy", "Deger", "Yatirim", "K/Z", "K/Z %", "Varlik"]],
          body: pSumData,
          theme: "grid",
          headStyles: { fillColor: [20, 28, 42], textColor: [200, 200, 220], fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [60, 60, 80] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 20, right: 20 },
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      // Tüm varlıklar tablosu
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 60);
      doc.text("Tum Varliklar", 20, y);
      y += 4;

      const tableData = allPData.map(item => {
        const mkt = getMarketType(item.coinId);
        const cur = ALL_ASSETS[item.coinId]?.currency || "$";
        const fV = (v) => cur === "₺" ? v.toFixed(2) + " TL" : fmtR(v);
        return [
          (item.coin?.symbol || "?") + " [" + getMarketLabel(mkt) + "]",
          item.totalAmount.toFixed(item.totalAmount < 1 ? 6 : 2),
          fV(item.currentPrice),
          fV(item.currentValue),
          fV(item.totalInvested),
          (item.pnl >= 0 ? "+" : "-") + fV(Math.abs(item.pnl)),
          (item.pnlPct >= 0 ? "+" : "") + item.pnlPct.toFixed(2) + "%",
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [["Varlik", "Miktar", "Fiyat", "Deger", "Yatirim", "K/Z", "K/Z %"]],
        body: tableData,
        theme: "grid",
        headStyles: { fillColor: [20, 28, 42], textColor: [200, 200, 220], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [60, 60, 80] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 15, right: 15 },
        didParseCell: (data) => {
          if (data.section === "body" && (data.column.index === 5 || data.column.index === 6)) {
            const val = data.cell.raw || "";
            if (val.startsWith("+")) data.cell.styles.textColor = [0, 160, 70];
            else if (val.startsWith("-")) data.cell.styles.textColor = [200, 50, 50];
          }
        },
      });

      // Footer
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 180);
        doc.text("CryptoVault Aylik Rapor - " + dateStr + " - Sayfa " + i + "/" + pageCount, w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });
      }

      // Preview olarak göster
      const pdfUrl = doc.output("bloburl");
      setPdfPreviewUrl(pdfUrl);

      // İşaretle
      localStorage.setItem("cv_report_" + now.getFullYear() + "_" + now.getMonth(), "1");
      setShowReportNotif(false);

      // Rapor geçmişi
      try {
        const hist = JSON.parse(localStorage.getItem("cv_report_history") || "[]");
        const entry = { date: now.toISOString(), totVal: allTotVal, totInv: allTotInv, pnl: allTotPnl, pnlPct: allTotPnlPct, assets: allPData.length, user: currentUser };
        hist.push(entry);
        const trimmed = hist.slice(-24);
        localStorage.setItem("cv_report_history", JSON.stringify(trimmed));
        setReportHistory(trimmed);
      } catch(e) {}

    } catch (err) {
      console.error("PDF rapor hatasi:", err);
      alert("Rapor olusturulurken hata olustu: " + err.message);
    }
  };
  const allAssetList = useMemo(() => [...DEFAULT_COINS, ...Object.values(STOCK_DATA)], []);
  const filtered = allAssetList.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.symbol.toLowerCase().includes(search.toLowerCase());
    const matchMarket = marketFilter === "all" || c.market === marketFilter;
    return matchSearch && matchMarket;
  });
  const curChart=chartData[`${selChart}-${chartPeriod}`]||[];
  const st={card:{background:"linear-gradient(135deg,#111822,#0d1420)",border:"1px solid #1a2332",borderRadius:14,padding:20,overflow:"hidden"},th:{padding:"10px 12px",fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:.8,fontWeight:600,textAlign:"left",borderBottom:"1px solid #1a2332",whiteSpace:"nowrap"},td:{padding:"11px 12px",fontSize:13,borderBottom:"1px solid #111822",verticalAlign:"middle"},tt:{background:"#1a2332",border:"1px solid #2d3a4a",borderRadius:8,color:"#e2e8f0",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}};

  if (!isLoggedIn) return <AuthScreen onLogin={(user) => { setCurrentUser(user); setIsLoggedIn(true); }} />;

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0a0e17",fontFamily:"'Outfit',sans-serif"}}>
      <div style={{textAlign:"center",animation:"pulse 2s infinite"}}>
        <div style={{fontSize:56,color:"#F7931A",marginBottom:16,fontFamily:"'Space Mono',monospace"}}>◈</div>
        <div style={{color:"#8892a4",fontSize:16,marginBottom:20}}>{connStatus==="retrying"?`Bağlantı kurulamadı (${retryCount}/${MAX_RETRIES})...`:connStatus==="ratelimited"?"Rate limit — Bekleniyor...":"CoinGecko'ya bağlanılıyor..."}</div>
        <div style={{width:200,height:3,background:"#1a2332",borderRadius:2,overflow:"hidden",margin:"0 auto"}}><div style={{height:"100%",background:"linear-gradient(90deg,#F7931A,#ff6b00)",borderRadius:2,animation:"loadBar 2s ease-in-out infinite"}}/></div>
        {connStatus==="retrying"&&<button onClick={retry} style={{marginTop:16,padding:"8px 20px",background:"#111822",border:"1px solid #1e2a3a",color:"#F7931A",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}>↻ Hemen Dene</button>}
      </div>
    </div>
  );

  return (
    <div style={{fontFamily:"'Outfit',sans-serif",background:"linear-gradient(180deg,#0a0e17 0%,#0d1420 50%,#0a0e17 100%)",minHeight:"100vh",color:"#e2e8f0"}}>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 24px",borderBottom:"1px solid #151d2b",background:"rgba(10,14,23,.9)",backdropFilter:"blur(20px)",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:28,color:"#F7931A",fontWeight:700}}>◈</span>
          <div><span style={{fontSize:22,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff"}}>CryptoVault</span><div style={{fontSize:10,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>CRYPTO · BIST · TEFAS · US</div></div>
          <div style={{width:8,height:8,borderRadius:"50%",marginLeft:8,background:connStatus==="connected"?"#00ff88":connStatus==="connecting"||connStatus==="retrying"?"#ffaa00":"#ff4466",boxShadow:`0 0 8px ${connStatus==="connected"?"#00ff8844":"#ff446644"}`,transition:"background .3s"}} title={connStatus==="connected"?"Canlı bağlantı":connStatus==="connecting"?"Bağlanıyor...":connStatus==="demo"?"Demo modu":"Hata"}/>
          {lastUpdate&&<span style={{fontSize:10,color:"#2d3a4a",fontFamily:"'JetBrains Mono',monospace",marginLeft:4}}>{lastUpdate.toLocaleTimeString("tr-TR")}</span>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:12,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>👤 {currentUser}</span>
          <button onClick={generateReport} style={{background:"#0d1f12",border:"1px solid #1a3320",color:"#48BB78",padding:"0 12px",height:34,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif",display:"flex",alignItems:"center",gap:4,position:"relative"}} title="PDF Rapor Oluştur">📄 Rapor{showReportNotif&&<span style={{position:"absolute",top:-2,right:-2,width:8,height:8,background:"#ff4466",borderRadius:"50%",border:"2px solid #0a0e17"}}/>}</button>
          <button onClick={()=>setShowReportHistory(true)} style={{background:"#111822",border:"1px solid #1a2332",color:"#8892a4",width:34,height:34,borderRadius:8,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center"}} title="Rapor Geçmişi">📋</button>
          <button onClick={()=>setShowSettings(true)} style={{background:"#111822",border:"1px solid #1a2332",color:"#8892a4",width:34,height:34,borderRadius:8,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center"}} title="Ayarlar">⚙</button>
          <button onClick={()=>{setIsLoggedIn(false);setCurrentUser("");try{localStorage.removeItem("cv_session");}catch(e){}}} style={{background:"#1a0d12",border:"1px solid #2a1520",color:"#ff4466",padding:"0 12px",height:34,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}>Çıkış</button>
        </div>
      </header>
      <nav style={{display:"flex",gap:4,padding:"10px 24px",borderBottom:"1px solid #111822",overflowX:"auto"}}>
        {[{id:"overview",lbl:"Dashboard",ic:"⊞"},{id:"portfolio",lbl:"Portföy",ic:"◎"},{id:"market",lbl:"Piyasa",ic:"◉"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 18px",background:tab===t.id?"#111822":"transparent",border:tab===t.id?"1px solid #1e2a3a":"1px solid transparent",color:tab===t.id?"#F7931A":"#4a5568",fontSize:13,fontWeight:500,cursor:"pointer",borderRadius:8,display:"flex",alignItems:"center",gap:6,fontFamily:"'Outfit',sans-serif",position:"relative",whiteSpace:"nowrap"}}>
            <span style={{fontSize:16}}>{t.ic}</span>{t.lbl}
          </button>)}
      </nav>
      <main style={{padding:"20px 24px",maxWidth:1300,margin:"0 auto"}}>
        {showReportNotif&&<div style={{background:"linear-gradient(135deg,#0d1f12,#111822)",border:"1px solid #1a3320",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>📊</span>
            <div><div style={{fontSize:13,color:"#48BB78",fontWeight:600}}>Aylık Rapor Zamanı</div><div style={{fontSize:11,color:"#4a5568",marginTop:2}}>Bu ay henüz portföy raporu oluşturmadınız</div></div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={generateReport} style={{background:"#48BB78",border:"none",color:"#000",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>Rapor Oluştur</button>
            <button onClick={()=>setShowReportNotif(false)} style={{background:"none",border:"1px solid #1a3320",color:"#4a5568",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:12}}>Kapat</button>
          </div>
        </div>}

        {/* ═══ PORTFOLIO ═══ */}
        {tab==="portfolio"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Portfolio Selector Bar */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap",position:"relative"}}>
            <div style={{display:"flex",gap:4,flex:1,overflowX:"auto",paddingBottom:4}}>
              {Object.keys(portfolios).map(name=>(
                <button key={name} onClick={()=>setActivePortfolio(name)}
                  onDoubleClick={()=>{setRenameTarget(name);setRenameValue(name);}}
                  style={{padding:"8px 16px",background:activePortfolio===name?"linear-gradient(135deg,#F7931A22,#e6820a11)":"#111822",border:`1px solid ${activePortfolio===name?"#F7931A44":"#1e2a3a"}`,color:activePortfolio===name?"#F7931A":"#8892a4",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:activePortfolio===name?600:400,fontFamily:"'Outfit',sans-serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                  {name}
                  <span style={{fontSize:11,color:"#4a5568"}}>({(portfolios[name]||[]).length})</span>
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setShowPortfolioMenu(!showPortfolioMenu)}
                style={{padding:"8px 12px",background:"#111822",border:"1px solid #1e2a3a",color:"#8892a4",borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Outfit',sans-serif"}}>+ Yeni Portföy</button>
              {Object.keys(portfolios).length>1&&<button onClick={()=>{
                if(window.confirm(`"${activePortfolio}" portföyünü silmek istediğinize emin misiniz?`)){
                  setPortfolios(prev=>{const next={...prev};delete next[activePortfolio];return next;});
                  setActivePortfolio(Object.keys(portfolios).find(k=>k!==activePortfolio)||"Ana Portföy");
                }
              }} style={{padding:"8px 12px",background:"#1a0d12",border:"1px solid #2a1520",color:"#ff4466",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Outfit',sans-serif"}}>🗑</button>}
            </div>

            {/* New Portfolio Input */}
            {showPortfolioMenu&&<div style={{position:"absolute",top:"100%",right:0,marginTop:4,background:"#131a27",border:"1px solid #1e2a3a",borderRadius:10,padding:12,zIndex:50,boxShadow:"0 12px 40px rgba(0,0,0,.5)",width:260}}>
              <div style={{fontSize:12,color:"#8892a4",marginBottom:8}}>Yeni portföy adı:</div>
              <div style={{display:"flex",gap:8}}>
                <input autoFocus value={newPortfolioName} onChange={e=>setNewPortfolioName(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newPortfolioName.trim()){setPortfolios(prev=>({...prev,[newPortfolioName.trim()]:[]}));setActivePortfolio(newPortfolioName.trim());setNewPortfolioName("");setShowPortfolioMenu(false);}}}
                  placeholder="örn: Uzun Vade"
                  style={{flex:1,padding:"8px 10px",background:"#0a0e17",border:"1px solid #1e2a3a",borderRadius:6,color:"#e2e8f0",fontSize:13,outline:"none",fontFamily:"'Outfit',sans-serif"}}/>
                <button onClick={()=>{if(newPortfolioName.trim()){setPortfolios(prev=>({...prev,[newPortfolioName.trim()]:[]}));setActivePortfolio(newPortfolioName.trim());setNewPortfolioName("");setShowPortfolioMenu(false);}}}
                  style={{padding:"8px 14px",background:"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>Ekle</button>
              </div>
            </div>}

            {/* Rename Modal */}
            {renameTarget&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setRenameTarget(null)}>
              <div style={{background:"#131a27",border:"1px solid #1e2a3a",borderRadius:12,padding:20,width:300}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:12}}>Portföyü Yeniden Adlandır</div>
                <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&renameValue.trim()&&renameValue!==renameTarget){
                    setPortfolios(prev=>{const next={};Object.entries(prev).forEach(([k,v])=>{next[k===renameTarget?renameValue.trim():k]=v;});return next;});
                    if(activePortfolio===renameTarget)setActivePortfolio(renameValue.trim());setRenameTarget(null);}}}
                  style={{width:"100%",padding:"10px 12px",background:"#0a0e17",border:"1px solid #1e2a3a",borderRadius:8,color:"#e2e8f0",fontSize:14,outline:"none",marginBottom:12,fontFamily:"'Outfit',sans-serif"}}/>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button onClick={()=>setRenameTarget(null)} style={{padding:"8px 16px",background:"#111822",border:"1px solid #1e2a3a",borderRadius:6,color:"#8892a4",fontSize:12,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>İptal</button>
                  <button onClick={()=>{if(renameValue.trim()&&renameValue!==renameTarget){setPortfolios(prev=>{const next={};Object.entries(prev).forEach(([k,v])=>{next[k===renameTarget?renameValue.trim():k]=v;});return next;});if(activePortfolio===renameTarget)setActivePortfolio(renameValue.trim());setRenameTarget(null);}}}
                    style={{padding:"8px 16px",background:"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>Kaydet</button>
                </div>
              </div>
            </div>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            <div style={{...st.card,background:"linear-gradient(135deg,#1a1508,#1a1000)",border:"1px solid #3d2800"}}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:500}}>Portföy Değeri</div><div style={{fontSize:28,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff"}}>{fmt(totVal)}</div><div style={{fontSize:13,marginTop:6,fontFamily:"'JetBrains Mono',monospace",color:tot24h>=0?"#00ff88":"#ff4466"}}>{tot24h>=0?"▲":"▼"} {fmt(Math.abs(tot24h))} (24s)</div></div>
            <div style={st.card}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Yatırım</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmt(totInv)}</div></div>
            <div style={st.card}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>K/Z</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Space Mono',monospace",color:totPnl>=0?"#00ff88":"#ff4466"}}>{totPnl>=0?"+":""}{fmt(totPnl)} <span style={{fontSize:13}}>{fPct(totPnlPct)}</span></div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:pieData.length>0?"260px 1fr":"1fr",gap:18}}>
            <div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Dağılım</h3>
              {pieData.length>0?<><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" stroke="none">{pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} contentStyle={st.tt}/></PieChart></ResponsiveContainer>
              <div style={{marginTop:8}}>{pieData.map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:"1px solid #111822"}}><span style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:"#8892a4"}}>{item.name}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{totVal>0?((item.value/totVal)*100).toFixed(1):0}%</span></div>)}</div></>:<div style={{textAlign:"center",padding:40,color:"#4a5568"}}>Portföye varlık ekleyin</div>}
            </div>
            <div style={st.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{fontSize:15,fontWeight:600}}>Varlıklar</h3><button onClick={()=>{setEditIdx(null);setNcCoin(null);setNcAmount("");setNcBuyPrice("");setNcSection("Genel");setShowAdd(true);}} style={{padding:"7px 14px",background:"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>+ Ekle</button></div>
              <div style={{overflowX:"auto"}}>
                {pData.length===0?<div style={{textAlign:"center",padding:40,color:"#4a5568"}}><div style={{fontSize:48,marginBottom:12}}>📊</div>Henüz varlık yok</div>:
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["","Coin","Fiyat","24s","Miktar","Değer","Ağırlık","K/Z","İşlem"].map((h,i)=><th key={i} style={{...st.th,textAlign:i<=1?"left":i===8?"center":"right",width:i===0?30:undefined}}>{h}</th>)}</tr></thead><tbody>
                {(()=>{
                  const grouped = {};
                  pData.forEach((item, i) => {
                    const sec = item.section || "Genel";
                    if (!grouped[sec]) grouped[sec] = [];
                    grouped[sec].push({ ...item, origIdx: i });
                  });
                  const sectionOrder = sections.filter(s => grouped[s]);
                  Object.keys(grouped).forEach(s => { if (!sectionOrder.includes(s)) sectionOrder.push(s); });
                  // Also show empty sections as drop targets
                  sections.forEach(s => { if (!sectionOrder.includes(s)) sectionOrder.push(s); });

                  const rows = [];
                  sectionOrder.forEach((secName, si) => {
                    const items = grouped[secName] || [];
                    const secVal = items.reduce((s, it) => s + it.currentValue, 0);
                    const secPnl = items.reduce((s, it) => s + it.pnl, 0);
                    const secInv = items.reduce((s, it) => s + it.investedValue, 0);
                    const isDropTarget = dragIdx !== null && dragOverSection === secName;

                    rows.push(
                      <tr key={`sec-${secName}`}
                        onDragOver={e=>{e.preventDefault();setDragOverSection(secName);}}
                        onDragLeave={()=>setDragOverSection(null)}
                        onDrop={e=>{e.preventDefault();if(dragIdx!==null){setPortfolio(p=>p.map((it,i)=>i===dragIdx?{...it,section:secName}:it));}setDragIdx(null);setDragOverSection(null);}}>
                        <td colSpan={9} style={{padding:items.length>0?"14px 12px 8px":"10px 12px",borderBottom:`2px solid ${isDropTarget?"#F7931A":"#1e2a3a"}`,background:isDropTarget?"#F7931A08":"#0d111799",transition:"all .2s"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:4,height:20,borderRadius:2,background:CLR[si%CLR.length]}}/>
                              {editSectionName===secName?(
                                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                  <input autoFocus value={editSectionValue} onChange={e=>setEditSectionValue(e.target.value)}
                                    onKeyDown={e=>{
                                      if(e.key==="Enter"&&editSectionValue.trim()){
                                        const nv=editSectionValue.trim();
                                        setSections(p=>p.map(s=>s===secName?nv:s));
                                        setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:nv}:it));
                                        setEditSectionName(null);
                                      }
                                      if(e.key==="Escape") setEditSectionName(null);
                                    }}
                                    style={{padding:"4px 8px",background:"#0a0e17",border:"1px solid #F7931A44",borderRadius:4,color:"#e2e8f0",fontSize:14,fontWeight:700,outline:"none",fontFamily:"'Outfit',sans-serif",width:160}}/>
                                  <button onClick={()=>{const nv=editSectionValue.trim();if(nv){setSections(p=>p.map(s=>s===secName?nv:s));setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:nv}:it));}setEditSectionName(null);}}
                                    style={{padding:"3px 8px",background:"#F7931A22",border:"1px solid #F7931A44",borderRadius:4,color:"#F7931A",fontSize:11,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>✓</button>
                                  <button onClick={()=>setEditSectionName(null)}
                                    style={{padding:"3px 8px",background:"#111822",border:"1px solid #1e2a3a",borderRadius:4,color:"#4a5568",fontSize:11,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>✕</button>
                                </div>
                              ):(
                                <>
                                  <span style={{fontSize:14,fontWeight:700,color:"#e2e8f0",letterSpacing:.3}}>{secName}</span>
                                  <span style={{fontSize:11,color:"#4a5568",background:"#111822",padding:"2px 8px",borderRadius:4}}>{items.length} coin</span>
                                  <button onClick={()=>{setEditSectionName(secName);setEditSectionValue(secName);}}
                                    style={{width:22,height:22,border:"1px solid #1e2a3a",background:"#111822",color:"#4a5568",borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}} title="Yeniden adlandır">✎</button>
                                  {sections.length>1&&<button onClick={()=>{
                                    const fallback=sections.find(s=>s!==secName)||"Kategorisiz";
                                    if(window.confirm(`"${secName}" kategorisini silmek istediğinize emin misiniz? İçindeki coinler "${fallback}" kategorisine taşınacak.`)){
                                      setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:fallback}:it));
                                      setSections(p=>p.filter(s=>s!==secName));
                                    }
                                  }} style={{width:22,height:22,border:"1px solid #2a1520",background:"#1a0d12",color:"#ff4466",borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}} title="Kategoriyi sil">✕</button>}
                                </>
                              )}
                              {isDropTarget&&<span style={{fontSize:11,color:"#F7931A",animation:"pulse 1s infinite"}}>← Buraya bırak</span>}
                            </div>
                            {items.length>0&&editSectionName!==secName&&<div style={{display:"flex",gap:16,fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>
                              <span style={{color:"#8892a4"}}>Değer: <span style={{color:"#e2e8f0",fontWeight:600}}>{fmt(secVal)}</span></span>
                              <span style={{color:"#8892a4"}}>K/Z: <span style={{color:secPnl>=0?"#00ff88":"#ff4466",fontWeight:600}}>{secPnl>=0?"+":""}{fmt(secPnl)} ({fPct(secInv>0?(secPnl/secInv)*100:0)})</span></span>
                              {totVal>0&&<span style={{color:"#F7931A"}}>{(secVal/totVal*100).toFixed(1)}%</span>}
                            </div>}
                          </div>
                        </td>
                      </tr>
                    );

                    items.forEach((item) => {
                      const i = item.origIdx;
                      const pct = totVal > 0 ? (item.currentValue / totVal * 100) : 0;
                      const isDragging = dragIdx === i;
                      rows.push(
                        <tr key={i} draggable
                          onDragStart={()=>setDragIdx(i)}
                          onDragEnd={()=>{setDragIdx(null);setDragOverSection(null);}}
                          style={{opacity:isDragging?.4:1,cursor:"grab",transition:"opacity .2s"}}>
                        <td style={{...st.td,width:30,textAlign:"center",color:"#2d3a4a",fontSize:14,cursor:"grab"}}>⠿</td>
                        <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,fontFamily:"'Space Mono',monospace",background:CLR[i%CLR.length]+"22",color:CLR[i%CLR.length]}}>{item.coin?.symbol?.charAt(0)||"?"}</div><div><div style={{fontWeight:600,fontSize:13}}>{item.coin?.name}</div><div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{item.coin?.symbol}</div></div></div></td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentPrice,item.currentPrice<1?4:2)}</td>
                        <td style={{...st.td,textAlign:"right",color:item.change24h>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace"}}>{fPct(item.change24h)}</td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{item.amount}</td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(item.currentValue)}</td>
                        <td style={{...st.td,textAlign:"right"}}><div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}><div style={{width:50,height:5,background:"#1a2332",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:CLR[i%CLR.length],borderRadius:3}}/></div><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#F7931A",fontWeight:600,minWidth:40,textAlign:"right"}}>{pct.toFixed(1)}%</span></div></td>
                        <td style={{...st.td,textAlign:"right"}}><div style={{color:item.pnl>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{item.pnl>=0?"+":""}{fmt(item.pnl)}</div><div style={{color:item.pnl>=0?"#00ff88aa":"#ff4466aa",fontSize:11}}>{fPct(item.pnlPct)}</div></td>
                        <td style={{...st.td,textAlign:"center"}}><div style={{display:"flex",gap:6,justifyContent:"center"}}><button onClick={()=>{const it=portfolio[i];const c=knownCoins.find(x=>x.id===it.coinId);setNcCoin(c||{id:it.coinId,symbol:"?",name:it.coinId});setNcAmount(""+it.amount);setNcBuyPrice(""+it.buyPrice);setNcSection(it.section||"Genel");setEditIdx(i);setShowAdd(true);}} style={{width:28,height:28,border:"1px solid #1e2a3a",background:"#111822",color:"#8892a4",borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button><button onClick={()=>setDelConfirm(i)} style={{width:28,height:28,border:"1px solid #2a1520",background:"#1a0d12",color:"#ff4466",borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div></td></tr>
                      );
                    });
                  });
                  return rows;
                })()}
                </tbody></table>}
              </div>
            </div>
          </div>
        </div>}

        {/* ═══ DASHBOARD ═══ */}
        {tab==="overview"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Summary Cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            <div style={{...st.card,background:"linear-gradient(135deg,#1a1508,#1a1000)",border:"1px solid #3d2800"}}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:500}}>Toplam Değer</div><div style={{fontSize:28,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff"}}>{fmt(allTotVal)}</div><div style={{fontSize:13,marginTop:6,fontFamily:"'JetBrains Mono',monospace",color:allTot24h>=0?"#00ff88":"#ff4466"}}>{allTot24h>=0?"▲":"▼"} {fmt(Math.abs(allTot24h))} (24s)</div></div>
            <div style={st.card}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Toplam Yatırım</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmt(allTotInv)}</div></div>
            <div style={st.card}><div style={{fontSize:11,color:"#4a5568",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Kar / Zarar</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Space Mono',monospace",color:allTotPnl>=0?"#00ff88":"#ff4466"}}>{allTotPnl>=0?"+":""}{fmt(allTotPnl)}</div><div style={{fontSize:12,marginTop:2,fontFamily:"'JetBrains Mono',monospace",color:allTotPnl>=0?"#00ff88":"#ff4466"}}>{fPct(allTotPnlPct)}</div></div>
          </div>

          {/* Market Distribution Bar */}
          {(()=>{
            const mktTotals={};
            allPData.forEach(item=>{const m=getMarketType(item.coinId);mktTotals[m]=(mktTotals[m]||0)+item.currentValue;});
            const mktE=Object.entries(mktTotals).sort((a,b)=>b[1]-a[1]);
            if(mktE.length===0) return null;
            return(<div style={{...st.card,marginBottom:20,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
                <span style={{fontSize:12,fontWeight:600,color:"#8892a4"}}>Piyasa Dağılımı</span>
                <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                  {mktE.map(([m,val])=>(<span key={m} style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:2,background:getMarketColor(m)}}/><span style={{color:"#8892a4"}}>{getMarketLabel(m)}</span><span style={{color:"#e2e8f0",fontWeight:600}}>{allTotVal>0?(val/allTotVal*100).toFixed(1):0}%</span></span>))}
                </div>
              </div>
              <div style={{height:8,borderRadius:4,overflow:"hidden",display:"flex",gap:2}}>
                {mktE.map(([m,val])=>(<div key={m} style={{height:"100%",flex:allTotVal>0?val/allTotVal:0,background:getMarketColor(m),borderRadius:2,transition:"flex .5s",minWidth:val>0?4:0}}/>))}
              </div>
            </div>);
          })()}

          {/* Portföy Kartları (sadece çoklu portföy varsa) */}
          {portfolioSummaries.length>1&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:20}}>
            {portfolioSummaries.map((ps,i)=>(<div key={ps.name} style={{...st.card,padding:16,cursor:"pointer",transition:"border-color .2s"}} onClick={()=>{setActivePortfolio(ps.name);setTab("portfolio");}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:14,fontWeight:600}}>{ps.name}</span><span style={{fontSize:11,color:"#4a5568"}}>{ps.count} varlık</span></div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff",marginBottom:4}}>{fmt(ps.value)}</div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}><span style={{color:ps.pnl>=0?"#00ff88":"#ff4466"}}>{ps.pnl>=0?"+":""}{fmt(ps.pnl)} ({fPct(ps.pnlPct)})</span><span style={{color:"#F7931A"}}>{allTotVal>0?(ps.value/allTotVal*100).toFixed(1):0}%</span></div>
            </div>))}
          </div>}

          {/* 🔥 Portföyümde En Çok Yükselen & Düşenler */}
          {allPData.length>1&&(()=>{
            const sorted=[...allPData].filter(x=>x.currentPrice>0).sort((a,b)=>b.change24h-a.change24h);
            const gainers=sorted.slice(0,5);
            const losers=[...sorted].reverse().slice(0,5);
            if(sorted.length===0) return null;
            const renderItem=(item,i,max)=>{
              const mc=getMarketColor(getMarketType(item.coinId));
              const isUp=item.change24h>=0;
              const absPct=Math.abs(item.change24h);
              const maxPct=Math.max(...sorted.map(x=>Math.abs(x.change24h)),1);
              const barW=Math.max((absPct/maxPct)*100,2);
              return(<div key={item.coinId} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<max-1?"1px solid #111822":"none"}}>
                <div style={{width:26,height:26,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,fontFamily:"'Space Mono',monospace",background:mc+"18",color:mc}}>{item.coin?.symbol?.charAt(0)||"?"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.coin?.symbol}</span>
                    <span style={{fontSize:7,padding:"1px 3px",borderRadius:2,background:mc+"15",color:mc,fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
                    <div style={{flex:1,height:3,background:"#1a2332",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:barW+"%",background:isUp?"#00ff88":"#ff4466",borderRadius:2,transition:"width .5s"}}/></div>
                  </div>
                </div>
                <div style={{textAlign:"right",minWidth:80}}>
                  <div style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:isUp?"#00ff88":"#ff4466"}}>{isUp?"▲":"▼"} {absPct.toFixed(2)}%</div>
                  <div style={{fontSize:10,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentValue)}</div>
                </div>
              </div>);
            };
            return(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}><span style={{fontSize:16}}>🚀</span><span style={{fontSize:13,fontWeight:600,color:"#00ff88"}}>En Çok Yükselen</span><span style={{fontSize:10,color:"#4a5568"}}>(24s)</span></div>
                {gainers.map((item,i)=>renderItem(item,i,gainers.length))}
              </div>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}><span style={{fontSize:16}}>📉</span><span style={{fontSize:13,fontWeight:600,color:"#ff4466"}}>En Çok Düşen</span><span style={{fontSize:10,color:"#4a5568"}}>(24s)</span></div>
                {losers.map((item,i)=>renderItem(item,i,losers.length))}
              </div>
            </div>);
          })()}

          {/* Dağılım + Tüm Varlıklar */}
          <div style={{display:"grid",gridTemplateColumns:allPData.length>0?"260px 1fr":"1fr",gap:18}}>
            {allPData.length>0&&<div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Dağılım</h3>
              <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={allPieData.slice(0,12)} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">{allPieData.slice(0,12).map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip formatter={v=>[fmt(v),""]} contentStyle={st.tt}/></PieChart></ResponsiveContainer>
              <div style={{marginTop:8,maxHeight:180,overflowY:"auto"}}>{allPieData.map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:"1px solid #111822"}}><span style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:"#8892a4"}}>{item.name}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"#F7931A"}}>{allTotVal>0?((item.value/allTotVal)*100).toFixed(1):0}%</span></div>)}</div>
            </div>}
            <div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Tüm Varlıklar</h3>
              <div style={{overflowX:"auto"}}>
                {allPData.length===0?<div style={{textAlign:"center",padding:40,color:"#4a5568"}}>Portföylere varlık ekleyin</div>:
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["Varlık","Fiyat","24s","Değer","Ağırlık","K/Z"].map((h,i)=><th key={h} style={{...st.th,textAlign:i===0?"left":"right"}}>{h}</th>)}</tr></thead><tbody>
                {allPData.map((item,i)=>{
                  const pct=allTotVal>0?(item.currentValue/allTotVal*100):0;const mc=getMarketColor(getMarketType(item.coinId));
                  return(<tr key={item.coinId}>
                    <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace",background:mc+"18",color:mc}}>{item.coin?.symbol?.charAt(0)||"?"}</div><div><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontWeight:600,fontSize:12}}>{item.coin?.name}</span><span style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:mc+"15",color:mc,fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span></div><div style={{fontSize:10,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{item.coin?.symbol}</div></div></div></td>
                    <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fmt(item.currentPrice,item.currentPrice<1?4:2)}</td>
                    <td style={{...st.td,textAlign:"right",color:item.change24h>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fPct(item.change24h)}</td>
                    <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:12}}>{fmt(item.currentValue)}</td>
                    <td style={{...st.td,textAlign:"right"}}><div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}><div style={{width:36,height:4,background:"#1a2332",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:CLR[i%CLR.length],borderRadius:2}}/></div><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#F7931A",fontWeight:600,minWidth:36,textAlign:"right"}}>{pct.toFixed(1)}%</span></div></td>
                    <td style={{...st.td,textAlign:"right"}}><span style={{color:item.pnl>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:12}}>{item.pnl>=0?"+":""}{fmt(item.pnl)}</span></td>
                  </tr>);})}
                </tbody></table>}
              </div>
            </div>
          </div>
        </div>}

        {/* ═══ MARKET ═══ */}
        {tab==="market"&&<div style={{animation:"fadeUp .4s ease-out"}}><div style={st.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <h3 style={{fontSize:15,fontWeight:600}}>Piyasa</h3>
              {/* Market filter */}
              <div style={{display:"flex",gap:2,background:"#0d1117",borderRadius:6,padding:2}}>
                {[{k:"all",l:"Tümü"},{k:"crypto",l:"Kripto"},{k:"bist",l:"BIST"},{k:"us",l:"ABD"},{k:"tefas",l:"TEFAS"}].map(f=>(
                  <button key={f.k} onClick={()=>setMarketFilter(f.k)} style={{padding:"5px 12px",borderRadius:5,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif",background:marketFilter===f.k?getMarketColor(f.k)+"22":"transparent",color:marketFilter===f.k?getMarketColor(f.k):"#4a5568"}}>{f.l}</button>
                ))}
              </div>
              {/* Spot/Perp toggle - only for crypto */}
              {marketFilter==="crypto"&&<div style={{display:"flex",gap:2,background:"#0d1117",borderRadius:6,padding:2}}>
                <button onClick={()=>setShowPerp(false)} style={{padding:"5px 12px",borderRadius:5,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif",background:!showPerp?"#F7931A22":"transparent",color:!showPerp?"#F7931A":"#4a5568"}}>Spot</button>
                <button onClick={()=>setShowPerp(true)} style={{padding:"5px 12px",borderRadius:5,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif",background:showPerp?"#9945FF22":"transparent",color:showPerp?"#9945FF":"#4a5568"}}>Perpetual</button>
              </div>}
            </div>
            <input style={{padding:"8px 14px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:8,color:"#e2e8f0",fontSize:13,outline:"none",width:180,fontFamily:"'Outfit',sans-serif"}} placeholder="Ara..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>
            {showPerp
              ? ["#","Coin","Perp Fiyat","Mark Price","24s","Funding","Hacim","İşlem"].map((h,i)=><th key={h} style={{...st.th,textAlign:i<2?"left":i===7?"center":"right"}}>{h}</th>)
              : ["#","Coin","Fiyat","24s","7g","Piy. Değeri","7g","İşlem"].map((h,i)=><th key={h} style={{...st.th,textAlign:i<2?"left":i>=6?"center":"right"}}>{h}</th>)
            }
          </tr></thead><tbody>
          {filtered.map((coin,i)=>{const p=prices[coin.id];const c24=p?.usd_24h_change||0;const c7=p?.usd_7d_change||0;
            if (showPerp && marketFilter==="crypto") {
              const perpPrice = p?.perp_price;
              if (!perpPrice) return null; // Skip coins without perp data
              const fr = p?.funding_rate || 0;
              const frColor = fr > 0 ? "#00ff88" : fr < 0 ? "#ff4466" : "#8892a4";
              const pc = p?.perp_24h_change || 0;
              return (
                <tr key={coin.id}><td style={{...st.td,color:"#8892a4",width:40}}>{i+1}</td>
                <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,fontFamily:"'Space Mono',monospace",background:CLR[i%CLR.length]+"22",color:CLR[i%CLR.length]}}>{coin.symbol.charAt(0)}</div><div><div style={{fontWeight:600,fontSize:13}}>{coin.name}</div><div style={{fontSize:11,color:"#9945FF",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}.P</div></div></div></td>
                <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(perpPrice,perpPrice<1?4:2)}</td>
                <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#8892a4"}}>{fmt(p?.mark_price,p?.mark_price<1?4:2)}</td>
                <td style={{...st.td,textAlign:"right",color:pc>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace"}}>{fPct(pc)}</td>
                <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:frColor}}>{(fr*100).toFixed(4)}%</td>
                <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fmt(p?.perp_volume)}</td>
                <td style={{...st.td,textAlign:"center"}}><button onClick={()=>{setNcCoin(coin);setNcAmount("");setNcBuyPrice(perpPrice?(perpPrice<1?perpPrice.toFixed(6):perpPrice.toFixed(2)):"");setEditIdx(null);setShowAdd(true);}} style={{padding:"5px 10px",background:"transparent",border:"1px solid #1e2a3a",color:"#F7931A",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:500,fontFamily:"'Outfit',sans-serif"}}>+ Ekle</button></td></tr>);
            }
            return(
            <tr key={coin.id}><td style={{...st.td,color:"#8892a4",width:40}}>{i+1}</td>
            <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,fontFamily:"'Space Mono',monospace",background:getMarketColor(coin.market||"crypto")+"22",color:getMarketColor(coin.market||"crypto")}}>{coin.symbol.charAt(0)}</div><div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:600,fontSize:13}}>{coin.name}</span><span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:getMarketColor(coin.market||"crypto")+"18",color:getMarketColor(coin.market||"crypto"),fontWeight:700,letterSpacing:.5}}>{getMarketLabel(coin.market||"crypto")}</span></div><div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}</div></div></div></td>
            <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(p?.usd,p?.usd<1?4:2,coin.currency||"$")}</td>
            <td style={{...st.td,textAlign:"right",color:c24>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace"}}>{fPct(c24)}</td>
            <td style={{...st.td,textAlign:"right",color:c7>=0?"#00ff88":"#ff4466",fontFamily:"'JetBrains Mono',monospace"}}>{fPct(c7)}</td>
            <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{coin.market==="crypto"?fmt(p?.usd_market_cap):coin.sector||"—"}</td>
            <td style={{...st.td,textAlign:"center"}}><Spark data={genChart(p?.usd||100,14)} color={c7>=0?"#00ff88":"#ff4466"}/></td>
            <td style={{...st.td,textAlign:"center"}}><button onClick={()=>{setNcCoin(coin);setNcAmount("");setNcBuyPrice(p?.usd?(p.usd<1?p.usd.toFixed(6):p.usd.toFixed(2)):"");setEditIdx(null);setShowAdd(true);}} style={{padding:"5px 10px",background:"transparent",border:"1px solid #1e2a3a",color:"#F7931A",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:500,fontFamily:"'Outfit',sans-serif"}}>+ Ekle</button></td></tr>);})}
          </tbody></table></div></div></div>}

      </main>

      {/* ═══ ADD/EDIT MODAL with CoinPicker ═══ */}
      {showAdd&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={()=>{setShowAdd(false);setEditIdx(null);}}>
        <div style={{background:"linear-gradient(135deg,#131a27,#0d1420)",border:"1px solid #1e2a3a",borderRadius:16,width:"100%",maxWidth:480,boxShadow:"0 24px 64px rgba(0,0,0,.5)",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #1a2332"}}><h3 style={{fontSize:16,fontWeight:600}}>{editIdx!==null?"Varlığı Düzenle":"Yeni Varlık Ekle"}</h3><button style={{background:"none",border:"none",color:"#4a5568",fontSize:18,cursor:"pointer"}} onClick={()=>{setShowAdd(false);setEditIdx(null);}}>✕</button></div>
          <div style={{padding:20}}>
            {/* Coin Picker */}
            <div style={{marginBottom:16}}>
              <CoinPicker
                value={ncCoin?.id || ""}
                onChange={async (coin) => {
                  setNcCoin(coin);
                  setNcAmount("");
                  const p = prices[coin.id]?.usd;
                  if (p) {
                    setNcBuyPrice(p < 1 ? p.toFixed(6) : p.toFixed(2));
                  } else {
                    setNcBuyPrice("");
                    // Stock/ETF ise FMP'den fiyat çek
                    if (coin.isStock || coin.isFMP || isStock(coin.id)) {
                      try {
                        const FMP_KEY = "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";
                        const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${coin.id}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(10000) });
                        if (res.ok) {
                          const data = await res.json();
                          if (data?.[0]?.price) {
                            const pr = data[0].price;
                            setNcBuyPrice(pr < 1 ? pr.toFixed(6) : pr.toFixed(2));
                            setPrices(prev => ({...prev, [coin.id]: { usd: pr, usd_24h_change: data[0].changesPercentage||0, usd_7d_change:0, usd_market_cap: data[0].marketCap||0, currency: coin.currency||"$", market: coin.market||"us" }}));
                          }
                        }
                      } catch(e) {}
                    } else {
                      // Crypto — CoinGecko
                      try {
                        const base = savedKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
                        const kp = savedKey ? `&x_cg_pro_api_key=${savedKey}` : "";
                        const res = await fetch(`${base}/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true${kp}`);
                        if (res.ok) {
                          const data = await res.json();
                          const usd = data[coin.id]?.usd;
                          if (usd) {
                            setNcBuyPrice(usd < 1 ? usd.toFixed(6) : usd.toFixed(2));
                            setPrices(prev => ({...prev, [coin.id]: {usd, usd_24h_change: data[coin.id]?.usd_24h_change||0, usd_7d_change:0, usd_market_cap:0}}));
                          }
                        }
                      } catch(e) {}
                    }
                  }
                }}
                prices={prices}
                savedKey={savedKey}
                knownCoins={knownCoins}
                fmpStocks={fmpStocks}
              />
            </div>

            {ncCoin && <div style={{background:"#0a0e17",borderRadius:10,padding:14,marginBottom:16,border:"1px solid #F7931A22"}}>
              <div style={{fontSize:10,color:"#F7931A",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>✓ Seçilen Coin</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:"#F7931A15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#F7931A"}}>{ncCoin.symbol?.charAt(0)}</div>
                <div><div style={{fontSize:14,fontWeight:600,color:"#e2e8f0"}}>{ncCoin.name}</div><div style={{fontSize:11,color:"#4a5568",fontFamily:"'JetBrains Mono',monospace"}}>{ncCoin.symbol}</div></div>
                {prices[ncCoin.id]&&<div style={{marginLeft:"auto",textAlign:"right"}}><div style={{fontSize:14,fontFamily:"'JetBrains Mono',monospace",color:"#00ff88",fontWeight:600}}>{fmt(prices[ncCoin.id].usd,prices[ncCoin.id].usd<1?4:2)}</div><div style={{fontSize:10,color:prices[ncCoin.id]?.usd_24h_change>=0?"#00ff88aa":"#ff4466aa"}}>{fPct(prices[ncCoin.id]?.usd_24h_change||0)}</div></div>}
              </div>
            </div>}

            {/* ── Section 2: Kategori Seçimi ── */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:"#8892a4",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:"1px solid #1a2332",paddingBottom:6}}>Kategori</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                {sections.map(s=>(
                  <button key={s} onClick={()=>setNcSection(s)}
                    style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${ncSection===s?"#F7931A44":"#1e2a3a"}`,background:ncSection===s?"#F7931A15":"#0d1117",color:ncSection===s?"#F7931A":"#8892a4",fontSize:11,cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:ncSection===s?600:400,transition:"all .15s"}}>
                    {s}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input value={newSectionInput} onChange={e=>setNewSectionInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newSectionInput.trim()&&!sections.includes(newSectionInput.trim())){setSections(p=>[...p,newSectionInput.trim()]);setNcSection(newSectionInput.trim());setNewSectionInput("");}}}
                  placeholder="Yeni kategori ekle..."
                  style={{flex:1,padding:"6px 10px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:6,color:"#e2e8f0",fontSize:12,outline:"none",fontFamily:"'Outfit',sans-serif"}}/>
                <button onClick={()=>{if(newSectionInput.trim()&&!sections.includes(newSectionInput.trim())){setSections(p=>[...p,newSectionInput.trim()]);setNcSection(newSectionInput.trim());setNewSectionInput("");}}}
                  style={{padding:"6px 12px",background:"#111822",border:"1px solid #1e2a3a",borderRadius:6,color:"#8892a4",fontSize:11,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>+</button>
              </div>
            </div>

            {/* ── Section 3: İşlem Bilgileri ── */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:"#8892a4",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:"1px solid #1a2332",paddingBottom:6}}>İşlem Bilgileri</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <label style={{display:"block",fontSize:11,color:"#8892a4",marginBottom:6,fontWeight:500}}>Miktar</label>
                  <input type="number" step="any" placeholder="örn: 0.5" value={ncAmount} onChange={e=>setNcAmount(e.target.value)} style={{width:"100%",padding:"11px 12px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:8,color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
                </div>
                <div>
                  <label style={{display:"block",fontSize:11,color:"#8892a4",marginBottom:6,fontWeight:500}}>Alış Fiyatı ($)</label>
                  <input type="number" step="any" placeholder="örn: 65000" value={ncBuyPrice} onChange={e=>setNcBuyPrice(e.target.value)} style={{width:"100%",padding:"11px 12px",background:"#0d1117",border:"1px solid #1e2a3a",borderRadius:8,color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
                </div>
              </div>
              {ncCoin && prices[ncCoin.id] && <div style={{marginTop:8,fontSize:11,color:"#4a5568"}}>Güncel fiyat: <span style={{color:"#F7931A",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(prices[ncCoin.id].usd,prices[ncCoin.id].usd<1?6:2)}</span></div>}
            </div>

            {/* ── Section 3: Hesap Özeti ── */}
            {ncCoin&&ncAmount&&ncBuyPrice&&<div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:"#8892a4",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:"1px solid #1a2332",paddingBottom:6}}>Hesap Özeti</div>
              <div style={{background:"#0d1117",borderRadius:10,padding:14,border:"1px solid #1a2332"}}>
                {[
                  ["Toplam Maliyet", fmt(ncAmount*ncBuyPrice), "#8892a4"],
                  ["Güncel Değer", fmt(ncAmount*(prices[ncCoin.id]?.usd||0)), "#e2e8f0"],
                  ["Tahmini K/Z", (()=>{const pnl=ncAmount*((prices[ncCoin.id]?.usd||0)-ncBuyPrice);return {text:(pnl>=0?"+":"")+fmt(Math.abs(pnl))+" ("+fPct(ncBuyPrice>0?((prices[ncCoin.id]?.usd||0)/ncBuyPrice-1)*100:0)+")",color:pnl>=0?"#00ff88":"#ff4466"};})(), null],
                ].map(([l,v,c],i)=>{
                  const isKZ = l==="Tahmini K/Z";
                  return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderBottom:i<2?"1px solid #111822":"none"}}>
                    <span style={{color:"#4a5568"}}>{l}</span>
                    <span style={{fontWeight:isKZ?700:600,fontFamily:"'JetBrains Mono',monospace",color:isKZ?v.color:c}}>{isKZ?v.text:v}</span>
                  </div>;
                })}
              </div>
            </div>}

            {/* ── Section 4: Portföy Seçimi ── */}
            {Object.keys(portfolios).length>1&&<div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:"#8892a4",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:"1px solid #1a2332",paddingBottom:6}}>Eklenecek Portföy</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.keys(portfolios).map(name=>(
                  <button key={name} onClick={()=>setActivePortfolio(name)}
                    style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${activePortfolio===name?"#F7931A44":"#1e2a3a"}`,background:activePortfolio===name?"#F7931A11":"#0d1117",color:activePortfolio===name?"#F7931A":"#8892a4",fontSize:12,cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:activePortfolio===name?600:400}}>
                    {name}
                  </button>
                ))}
              </div>
            </div>}

            <button onClick={addCoin} disabled={!ncCoin||!ncAmount||!ncBuyPrice} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#F7931A,#e6820a)",border:"none",borderRadius:10,color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif",opacity:ncCoin&&ncAmount&&ncBuyPrice?1:.5,boxShadow:"0 4px 20px rgba(247,147,26,.2)"}}>{editIdx!==null?"Güncelle":"Portföye Ekle"}</button>
          </div>
        </div>
      </div>}

      {/* Delete Confirm */}
      {delConfirm!==null&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={()=>setDelConfirm(null)}>
        <div style={{background:"linear-gradient(135deg,#131a27,#0d1420)",border:"1px solid #1e2a3a",borderRadius:16,width:"100%",maxWidth:380,boxShadow:"0 24px 64px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:30,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:16,fontWeight:600,marginBottom:8}}>Silmek istediğinize emin misiniz?</div>
            <div style={{color:"#8892a4",fontSize:13,marginBottom:20}}>{pData[delConfirm]?.coin?.name} kaldırılacak.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={()=>setDelConfirm(null)} style={{padding:"10px 24px",background:"#111822",border:"1px solid #1e2a3a",borderRadius:8,color:"#8892a4",fontSize:13,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>İptal</button>
              <button onClick={()=>{setPortfolio(p=>p.filter((_,j)=>j!==delConfirm));setDelConfirm(null);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#ff4466,#cc2244)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>Sil</button>
            </div>
          </div>
        </div>
      </div>}

      <Settings show={showSettings} onClose={()=>setShowSettings(false)} apiKey={apiKey} onKeyChange={setApiKey} onSave={saveKey} keyStatus={keyStatus}/>

      {/* PDF Preview Modal */}
      {pdfPreviewUrl&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:1000,display:"flex",flexDirection:"column",animation:"fadeUp .3s ease-out"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:"#111822",borderBottom:"1px solid #1a2332"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>📄</span>
            <span style={{fontSize:14,fontWeight:600,color:"#e2e8f0"}}>Portföy Raporu</span>
            <span style={{fontSize:11,color:"#4a5568"}}>{new Date().toLocaleDateString("tr-TR",{day:"2-digit",month:"long",year:"numeric"})}</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <a href={pdfPreviewUrl} download={"CryptoVault_Rapor_"+new Date().getFullYear()+"_"+String(new Date().getMonth()+1).padStart(2,"0")+".pdf"} style={{background:"#48BB78",color:"#000",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>⬇ İndir</a>
            <button onClick={()=>{URL.revokeObjectURL(pdfPreviewUrl);setPdfPreviewUrl(null);}} style={{background:"#1a0d12",border:"1px solid #2a1520",color:"#ff4466",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✕ Kapat</button>
          </div>
        </div>
        <iframe src={pdfPreviewUrl} style={{flex:1,border:"none",background:"#fff"}} title="PDF Preview"/>
      </div>}

      {/* Rapor Geçmişi Modal */}
      {showReportHistory&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeUp .3s ease-out"}} onClick={()=>setShowReportHistory(false)}>
        <div style={{background:"#131a27",border:"1px solid #1e2a3a",borderRadius:16,width:"90%",maxWidth:600,maxHeight:"80vh",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #1a2332"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>📋</span><span style={{fontSize:15,fontWeight:600,color:"#e2e8f0"}}>Rapor Geçmişi</span></div>
            <button onClick={()=>setShowReportHistory(false)} style={{background:"none",border:"none",color:"#4a5568",fontSize:18,cursor:"pointer"}}>✕</button>
          </div>
          <div style={{padding:16,overflowY:"auto",maxHeight:"65vh"}}>
            {reportHistory.length===0?<div style={{textAlign:"center",padding:40,color:"#4a5568"}}><div style={{fontSize:40,marginBottom:8}}>📄</div>Henüz rapor oluşturulmamış</div>:
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[...reportHistory].reverse().map((r,i)=>{
                const d=new Date(r.date);
                return(<div key={i} style={{background:"#0d1117",border:"1px solid #1a2332",borderRadius:10,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{d.toLocaleDateString("tr-TR",{day:"2-digit",month:"long",year:"numeric"})}</div>
                    <div style={{fontSize:11,color:"#4a5568",marginTop:2}}>{d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})} • {r.assets||0} varlık{r.user?" • "+r.user:""}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:14,fontWeight:700,fontFamily:"'Space Mono',monospace",color:"#fff"}}>{fmt(r.totVal||0)}</div>
                    <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:(r.pnl||0)>=0?"#00ff88":"#ff4466",marginTop:2}}>{(r.pnl||0)>=0?"+":""}{fmt(r.pnl||0)} ({r.pnlPct!=null?fPct(r.pnlPct):"—"})</div>
                  </div>
                </div>);
              })}
            </div>}
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid #1a2332",display:"flex",justifyContent:"space-between"}}>
            <button onClick={generateReport} style={{background:"#48BB78",border:"none",color:"#000",padding:"8px 20px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>📄 Yeni Rapor Oluştur</button>
            {reportHistory.length>0&&<button onClick={()=>{localStorage.removeItem("cv_report_history");setReportHistory([]);}} style={{background:"none",border:"1px solid #2a1520",color:"#ff4466",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:11}}>Geçmişi Temizle</button>}
          </div>
        </div>
      </div>}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}body{background:#0a0e17}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes loadBar{0%{width:0}50%{width:70%}100%{width:100%}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0d1117}::-webkit-scrollbar-thumb{background:#1e2a3a;border-radius:3px}
        table{border-collapse:collapse}select option{background:#131a27;color:#e2e8f0}
      `}</style>
    </div>
  );
}
