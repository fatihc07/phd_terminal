
import React, { useState, useEffect, useRef } from 'react';
import './index.css';

const API_BASE_URL = 'http://localhost:8000'; // Or your deployed backend URL

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [hasMoreStocks, setHasMoreStocks] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedStock, setSelectedStock] = useState(null);
  const [favorites, setFavorites] = useState([]);

  // Login State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Online Panel State
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    // Load favorites from local storage
    const savedFavs = localStorage.getItem('ecos_favorites');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));
    
    // Check if user is logged in (basic session)
    const savedUser = localStorage.getItem('ecos_user');
    if (savedUser) setUser(savedUser);
  }, []);

  useEffect(() => {
    if (user) {
        fetchStocks();
        // Start Heartbeat
        const interval = setInterval(() => {
            fetch(`${API_BASE_URL}/heartbeat`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: user })
            }).catch(() => {});
            
            // Fetch online users
            fetch(`${API_BASE_URL}/admin/online-users`)
                .then(r => r.json())
                .then(data => setOnlineUsers(data))
                .catch(() => {});
        }, 5000);
        return () => clearInterval(interval);
    }
  }, [user]);

  const fetchStocks = async (pageNum = 1) => {
      setLoadingStocks(true);
      try {
          // If searching, send symbols
          let url = `${API_BASE_URL}/stocks?page=${pageNum}&limit=20`;
          
          const res = await fetch(url);
          const data = await res.json();
          
          if (pageNum === 1) {
              setStocks(data.items);
          } else {
              setStocks(prev => [...prev, ...data.items]);
          }
          setHasMoreStocks(data.has_more);
          setPage(pageNum);
      } catch (e) {
          console.error(e);
      }
      setLoadingStocks(false);
  };

  const handleLogin = async (e) => {
      e.preventDefault();
      try {
          const res = await fetch(`${API_BASE_URL}/login`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username, password })
          });
          if (res.ok) {
              const data = await res.json();
              setUser(data.user);
              localStorage.setItem('ecos_user', data.user);
              setLoginError('');
          } else {
              setLoginError('Hatalı kullanıcı adı veya şifre');
          }
      } catch (e) {
          setLoginError('Sunucu hatası');
      }
  };

  const logout = () => {
      setUser(null);
      localStorage.removeItem('ecos_user');
      setActiveView('dashboard');
  };

  const toggleFavorite = (symbol, e) => {
      e?.stopPropagation();
      let newFavs;
      if (favorites.includes(symbol)) {
          newFavs = favorites.filter(s => s !== symbol);
      } else {
          newFavs = [...favorites, symbol];
      }
      setFavorites(newFavs);
      localStorage.setItem('ecos_favorites', JSON.stringify(newFavs));
  };

  const handleSearch = async (val) => {
      setSearchTerm(val);
      if (val.length >= 2) {
          try {
              const res = await fetch(`${API_BASE_URL}/search/suggestions?q=${val}`);
              if (res.ok) {
                  const data = await res.json();
                  setSearchSuggestions(data);
                  setShowSuggestions(true);
              }
          } catch(e) {}
      } else {
          setSearchSuggestions([]);
          setShowSuggestions(false);
      }
  };
  
  const selectSuggestion = (s) => {
      setSearchTerm('');
      setShowSuggestions(false);
      // For simplicity, just open detail view immediately if clicked
      setSelectedStock(s.symbol);
      setActiveView('detail');
  };

  if (!user) {
      return (
          <div className="login-container">
              <div className="login-box fade-in">
                  <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                      <h1 className="logo" style={{ fontSize: '3rem', marginBottom: '1rem' }}>ECOS</h1>
                      <p style={{ color: 'var(--text-secondary)' }}>Finansal Terminale Giriş</p>
                  </div>
                  <form onSubmit={handleLogin}>
                      <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                          <label>Kullanıcı Adı</label>
                          <input 
                              type="text" 
                              className="search-bar" 
                              style={{ width: '100%' }}
                              value={username}
                              onChange={e => setUsername(e.target.value)}
                          />
                      </div>
                      <div className="form-group">
                          <label>Şifre</label>
                          <input 
                              type="password" 
                              className="search-bar" 
                              style={{ width: '100%' }}
                              value={password}
                              onChange={e => setPassword(e.target.value)}
                          />
                      </div>
                      {loginError && <p style={{ color: 'var(--loss-color)', marginTop: '1rem', fontSize: '0.9rem' }}>{loginError}</p>}
                      <button type="submit" className="login-btn">Giriş Yap</button>
                  </form>
              </div>
          </div>
      );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
          <div className="logo">ECOS</div>
          <ul className="nav-links">
              <li className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => { setActiveView('dashboard'); setSelectedStock(null); }}>
                  📊 Pano
              </li>
              <li className={`nav-item ${activeView === 'favorites' ? 'active' : ''}`} onClick={() => { setActiveView('favorites'); setSelectedStock(null); }}>
                  ★ Favoriler
              </li>
              <li className="nav-item" onClick={logout}>
                  🚪 Çıkış
              </li>
          </ul>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header>
            <div style={{ position: 'relative' }}>
                <input 
                    type="text" 
                    className="search-bar" 
                    placeholder="Hisse Ara (örn: THYAO)..." 
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    onFocus={() => searchTerm.length >= 2 && setShowSuggestions(true)}
                />
                {showSuggestions && searchSuggestions.length > 0 && (
                    <div className="suggestions-dropdown">
                        {searchSuggestions.map((s) => (
                            <div key={s.symbol} className="suggestion-item" onClick={() => selectSuggestion(s)}>
                                <div className="suggestion-info">
                                    <span className="suggestion-symbol">{s.symbol}</span>
                                    <span className="suggestion-name">{s.name}</span>
                                </div>
                                <span className="suggestion-exchange">{s.exchange}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{user}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)' }}>● Çevrimiçi</div>
                </div>
            </div>
        </header>

        {activeView === 'detail' && selectedStock ? (
            <StockDetailView 
                symbol={selectedStock} 
                onBack={() => setActiveView('dashboard')} 
                toggleFavorite={toggleFavorite}
                isFavorite={favorites.includes(selectedStock)}
            />
        ) : (
          <>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
                    {activeView === 'dashboard' ? 'Piyasa Genel Bakış' : 'Favorilerim'}
                </h1>
                <p style={{ color: 'var(--text-secondary)' }}>
                    {activeView === 'dashboard' ? 'BIST 100 ve popüler hisselerin anlık durumu' : 'Takip ettiğiniz hisseler'}
                </p>
            </div>

            {loadingStocks && page === 1 ? (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Veriler yükleniyor...</p>
                </div>
            ) : (
              <>
                <div className="dashboard-grid">
                    {(activeView === 'favorites' ? stocks.filter(s => favorites.includes(s.symbol)) : stocks).map(stock => (
                        <div key={stock.symbol} className="stock-card" onClick={() => { setSelectedStock(stock.symbol); setActiveView('detail'); }}>
                            <div className="stock-header">
                                <div className="stock-id">
                                    <span className="stock-symbol">{stock.symbol.replace('.IS', '')}</span>
                                    <span className="stock-name-small">{stock.name}</span>
                                </div>
                                <button 
                                    className="fav-btn"
                                    onClick={(e) => toggleFavorite(stock.symbol, e)}
                                    style={{ color: favorites.includes(stock.symbol) ? '#FFD700' : 'rgba(255,255,255,0.2)' }}
                                >
                                    ★
                                </button>
                            </div>
                            <div className="stock-price">
                                {stock.price?.toFixed(2)} ₺
                            </div>
                            <div className="stock-meta">
                                <span className={stock.change > 0 ? 'change-up' : 'change-down'}>
                                    {stock.change > 0 ? '+' : ''}{stock.changePercent}%
                                </span>
                                <span>Vol: {(stock.volume / 1e6).toFixed(1)}M</span>
                            </div>
                            {stock.sector_group && (
                                <div style={{ marginTop: '10px' }}>
                                    <span className="badge" style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                                        {stock.sector_group}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                
                {activeView === 'dashboard' && hasMoreStocks && (
                  <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                      <button 
                        onClick={() => fetchStocks(page + 1)}
                        className="login-btn"
                        style={{ width: 'auto', padding: '10px 30px', background: 'var(--card-bg)', color: 'white', border: '1px solid var(--border-color)' }}
                      >
                          {loadingStocks ? 'Yükleniyor...' : 'Daha Fazla Göster'}
                      </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Online Users Panel */}
      {onlineUsers.length > 0 && (
          <div className="online-panel fade-in">
              <h4 style={{ marginBottom: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Çevrimiçi ({onlineUsers.length})</h4>
              <div className="online-list">
                  {onlineUsers.map((u, i) => (
                      <div key={i} className="online-user-item">
                          <div className="online-dot shine"></div>
                          <span className="online-name">{u}</span>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
}

function StockDetailView({ symbol, onBack, toggleFavorite, isFavorite }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');
  const [financials, setFinancials] = useState(null);
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/stocks/${symbol}/detail`);
            if (res.ok) {
                const data = await res.json();
                setDetail(data);
            }
            setLoading(false);
        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    };
    fetchDetail();
  }, [symbol]);

  // Fetch financials when tab changes to Financials
  useEffect(() => {
      if (activeTab === 'Financials' && !financials && !loadingFinancials) {
          const fetchFinancials = async () => {
              setLoadingFinancials(true);
              try {
                  const res = await fetch(`${API_BASE_URL}/stocks/${symbol}/financials`);
                  if (res.ok) {
                      const data = await res.json();
                      setFinancials(data);
                  }
              } catch(e) {
                  console.error(e);
              } finally {
                  setLoadingFinancials(false);
              }
          };
          fetchFinancials();
      }
  }, [activeTab, symbol, financials]);

  if (loading) return <div className="loading-state">Detaylar yükleniyor...</div>;
  if (!detail) return <div className="loading-state">Veri bulunamadı. <button onClick={onBack}>Geri Dön</button></div>;

  const formatLargeNumber = (num) => {
      if (!num) return '-';
      if (num >= 1e9) return (num / 1e9).toFixed(2) + ' Mr';
      if (num >= 1e6) return (num / 1e6).toFixed(2) + ' Mn';
      return num.toLocaleString();
  };

  // Helper to render financials table
  const renderFinancials = () => {
      if (loadingFinancials) return <div className="loading-state">Finansallar yükleniyor...</div>;
      if (!financials || Object.keys(financials).length === 0) return <div className="loading-state">Finansal veri bulunamadı.</div>;

      // Extract periods (sorted descending)
      const periods = Object.keys(financials).sort((a, b) => {
          const [y1, p1] = a.split('/').map(Number);
          const [y2, p2] = b.split('/').map(Number);
          if (y1 !== y2) return y2 - y1;
          return p2 - p1;
      });

      // Extract all unique item names from the first period (assuming consistent structure)
      // Or collect visible items
      const firstPeriod = periods[0];
      const items = Object.keys(financials[firstPeriod]).filter(k => !k.endsWith('_code'));

      return (
          <div className="stock-card" style={{ overflowX: 'auto' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px' }}>Mali Tablolar (Son 12 Dönem)</h3>
              <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
                  <thead>
                      <tr>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid var(--border-color)', position: 'sticky', left: 0, background: 'var(--secondary-color)', zIndex: 1 }}>Kalem</th>
                          {periods.map(p => (
                              <th key={p} style={{ padding: '10px', textAlign: 'right', borderBottom: '1px solid var(--border-color)', minWidth: '100px' }}>{p}</th>
                          ))}
                      </tr>
                  </thead>
                  <tbody>
                      {items.map(item => (
                          <tr key={item} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '10px', fontWeight: '500', position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 1 }}>{item}</td>
                              {periods.map(p => {
                                  const val = financials[p]?.[item];
                                  return (
                                      <td key={`${p}-${item}`} style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
                                          {val !== undefined ? val.toLocaleString() : '-'}
                                      </td>
                                  );
                              })}
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      );
  };

  return (
      <div className="fade-in" style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <button onClick={onBack} style={{ marginBottom: '1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display:'flex', alignItems:'center', gap:'5px' }}>
              ← Listeye Dön
          </button>

          {/* Header Card */}
          <div className="stock-card" style={{ marginBottom: '2rem', background: 'linear-gradient(145deg, rgba(20,20,20,0.9), rgba(10,10,10,0.95))', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                      <h1 style={{ fontSize: '2.5rem', margin: 0, lineHeight: 1 }}>{detail.symbol.replace('.IS', '')}</h1>
                      <h2 style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal', margin: '5px 0 0 0' }}>{detail.name}</h2>
                      <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                          {detail.sector && <span className="badge" style={{ background: 'rgba(0, 200, 5, 0.1)', color: 'var(--accent-color)' }}>{detail.sector}</span>}
                          {detail.industry && <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' }}>{detail.industry}</span>}
                      </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{detail.price?.toLocaleString()} ₺</div>
                      <div className={detail.change > 0 ? 'change-up' : 'change-down'} style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '5px' }}>
                          <span>{detail.change > 0 ? '+' : ''}{detail.change?.toFixed(2)}</span>
                          <span style={{ fontSize: '1rem', opacity: 0.8 }}>({detail.changePercent?.toFixed(2)}%)</span>
                      </div>
                      <button 
                        onClick={(e) => toggleFavorite(detail.symbol, e)}
                        style={{ marginTop: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: isFavorite ? '#FFD700' : 'var(--text-primary)', padding: '5px 15px', borderRadius: '20px', cursor:'pointer' }}
                      >
                         {isFavorite ? '★ Favorilerde' : '☆ Favoriye Ekle'}
                      </button>
                  </div>
              </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setActiveTab('Overview')} 
                style={{ 
                    padding: '10px 20px', 
                    background: 'none', 
                    border: 'none', 
                    borderBottom: activeTab === 'Overview' ? '2px solid var(--accent-color)' : '2px solid transparent',
                    color: activeTab === 'Overview' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '1rem'
                }}
              >
                  Genel Bakış
              </button>
              <button 
                onClick={() => setActiveTab('Financials')} 
                style={{ 
                    padding: '10px 20px', 
                    background: 'none', 
                    border: 'none', 
                    borderBottom: activeTab === 'Financials' ? '2px solid var(--accent-color)' : '2px solid transparent',
                    color: activeTab === 'Financials' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '1rem'
                }}
              >
                  Finansallar
              </button>
          </div>

          {activeTab === 'Overview' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
                  
                  {/* Sol Kolon: Açıklama ve İstatistikler */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                      
                      {/* Şirket Künyesi / Açıklama */}
                      <div className="stock-card">
                          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px' }}>Şirket Hakkında</h3>
                          <p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                              {detail.description}
                          </p>
                          {detail.website && (
                              <a href={detail.website} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '15px', color: 'var(--accent-color)', textDecoration: 'none' }}>
                                  Resmi Web Sitesi →
                              </a>
                          )}
                      </div>

                      {/* Piyasa Verileri */}
                      <div className="stock-card">
                           <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px' }}>Piyasa Verileri</h3>
                           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                               <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Piyasa Değeri</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{formatLargeNumber(detail.marketCap)}</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>F/K Oranı</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{detail.peRatio ? detail.peRatio.toFixed(2) : '-'}</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Temettü Verimi</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{detail.dividendYield ? (detail.dividendYield * 100).toFixed(2) + '%' : '-'}</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ort. Hacim (3 Ay)</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{formatLargeNumber(detail.averageVolume)}</div>
                               </div>
                                <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Açılış</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{detail.open?.toLocaleString()}</div>
                               </div>
                               <div>
                                   <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Önceki Kapanış</div>
                                   <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{detail.previousClose?.toLocaleString()}</div>
                               </div>
                           </div>
                      </div>
                  </div>

                  {/* Sağ Kolon: Fiyat Aralığı */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                      <div className="stock-card">
                          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px' }}>Fiyat Aralığı</h3>
                          
                          {/* Günlük Aralık */}
                          <div style={{ marginBottom: '20px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                                  <span>Günlük Düşük</span>
                                  <span>Günlük Yüksek</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                  <span>{detail.dayLow?.toLocaleString()}</span>
                                  <span>{detail.dayHigh?.toLocaleString()}</span>
                              </div>
                              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', marginTop: '5px', borderRadius: '2px', position: 'relative' }}>
                                 <div style={{ 
                                     position: 'absolute', 
                                     top: 0, bottom: 0, 
                                     left: `${((detail.price - detail.dayLow) / (detail.dayHigh - detail.dayLow)) * 100}%`, 
                                     width: '6px', height: '10px', marginTop: '-3px', background: 'var(--accent-color)', borderRadius: '50%' 
                                 }} />
                              </div>
                          </div>

                          {/* 52 Haftalık Aralık */}
                           <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                                  <span>52 Hafta Düşük</span>
                                  <span>52 Hafta Yüksek</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                  <span>{detail.fiftyTwoWeekLow?.toLocaleString()}</span>
                                  <span>{detail.fiftyTwoWeekHigh?.toLocaleString()}</span>
                              </div>
                              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', marginTop: '5px', borderRadius: '2px', position: 'relative' }}>
                                   <div style={{ 
                                     position: 'absolute', 
                                     top: 0, bottom: 0, 
                                     left: `${((detail.price - detail.fiftyTwoWeekLow) / (detail.fiftyTwoWeekHigh - detail.fiftyTwoWeekLow)) * 100}%`, 
                                     width: '6px', height: '10px', marginTop: '-3px', background: 'var(--accent-color)', borderRadius: '50%' 
                                 }} />
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          ) : (
              renderFinancials()
          )}
      </div>
  );
}

export default App;
