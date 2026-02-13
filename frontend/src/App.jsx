import React, { useState, useEffect } from 'react';
import './index.css';

const APP_VERSION = 'v1.0.3'; // HER GÜNCELLEMEDE ARTIR
const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [suggestions, setSuggestions] = useState([]); // Arama önerileri
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [trackedSymbols, setTrackedSymbols] = useState([]); // Kullanıcının aradığı hisseler
  const [favoriteSymbols, setFavoriteSymbols] = useState([]); // Favori hisseler
  
  // Auth Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Admin State
  const [users, setUsers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setIsLoggedIn(true);
        setUser(data.user);
        setAuthError('');
      } else {
        setAuthError('Hatalı kullanıcı adı veya şifre');
      }
    } catch (err) {
      setAuthError('Sunucu bağlantı hatası');
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/users`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setUsers(data);
        } else {
          console.error("Beklenmeyen veri formatı:", data);
          setUsers([]);
        }
      } else {
        console.error("Kullanıcı listesi alınamadı:", response.status);
      }
    } catch (err) {
      console.error("User fetch error:", err);
    }
  };

  useEffect(() => {
    if (activeTab === 'Admin') {
      fetchUsers();
    }
  }, [activeTab]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/admin/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword })
      });
      
      if (response.ok) {
        alert('Kullanıcı oluşturuldu!');
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
      } else {
        alert('Kullanıcı oluşturulamadı. Lütfen sunucunun güncel olduğundan emin olun.');
      }
    } catch (err) {
      alert('Sunucu hatası oluştu');
    }
  };

  useEffect(() => {
    if (!isLoggedIn || !user) return;
    
    const sendHeartbeat = async () => {
      try {
        await fetch(`${API_BASE_URL}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user })
        });
      } catch (err) {}
    };

    const fetchOnlineUsers = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/admin/online-users`);
        const data = await response.json();
        setOnlineUsers(data);
      } catch (err) {}
    };

    sendHeartbeat();
    fetchOnlineUsers();

    const hInterval = setInterval(sendHeartbeat, 30000);
    const oInterval = setInterval(fetchOnlineUsers, 10000);

    return () => {
      clearInterval(hInterval);
      clearInterval(oInterval);
    };
  }, [isLoggedIn, user]);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = React.useRef(null);
  const [activeStock, setActiveStock] = useState(null); // Detay görünümü için seçili hisse

  // ... (Login ve User Fetch kodları aynı)

  // Stokları Çekme (Sayfalı)
  useEffect(() => {
    if (!isLoggedIn) return;
    
    const fetchStocks = async () => {
      // Eğer sayfa 1 ise yükleniyor göster, değilse background yükleme
      if (page === 1) setLoading(true);
      
      try {
        const symbolsParam = trackedSymbols.length > 0 ? `&symbols=${trackedSymbols.join(',')}` : '';
        const limit = 15;
        const response = await fetch(`${API_BASE_URL}/stocks?page=${page}&limit=${limit}${symbolsParam}`);
        const result = await response.json();
        
        // Yeni backend yapısı: { items: [], has_more: true/false }
        // Eski yapı (array) gelirse diye fallback
        const data = Array.isArray(result) ? result : (result.items || []);
        const serverHasMore = result.has_more !== undefined ? result.has_more : (data.length >= limit);

        setHasMore(serverHasMore);

        setStocks(prev => {
          if (page === 1) return data;
          
          // Duplicate kontrolü
          const newStocks = [...prev];
          data.forEach(item => {
            if (!newStocks.find(s => s.symbol === item.symbol)) {
              newStocks.push(item);
            }
          });
          return newStocks;
        });
        
        setLoading(false);
      } catch (error) {
        console.error("API Error:", error);
        setLoading(false);
      }
    };

    fetchStocks();
  }, [isLoggedIn, page, trackedSymbols]); // page değişince tetiklenir

  // Infinite Scroll Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loading) {
           setPage(prev => prev + 1);
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [hasMore, loading]);


  // Manuel Arama Reset
  const handleManualSearch = async (forcedSymbol = null) => {
    const targetSymbol = forcedSymbol || searchTerm.trim();
    if (!targetSymbol) return;
    
    // Aramada sayfayı başa sar ve arananı tracked'e ekle
    setPage(1);
    setHasMore(true);
    
    const symbol = targetSymbol.toUpperCase();
    setShowSuggestions(false);
    
    setTrackedSymbols(prev => {
        const cleanSymbol = symbol.replace('.IS', ''); // Temizle
        const filtered = prev.filter(s => s !== cleanSymbol && s !== symbol);
        return [cleanSymbol, ...filtered].slice(0, 20);
    });
    setSearchTerm('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  // Favoriler Yükleme
  useEffect(() => {
    if (user) {
      const savedFavs = localStorage.getItem(`favorite_symbols_${user}`);
      if (savedFavs) {
        try {
          setFavoriteSymbols(JSON.parse(savedFavs));
        } catch (e) {
          console.error("Favoriler yüklenemedi", e);
          setFavoriteSymbols([]);
        }
      }
    }
  }, [user]);

  // Favoriler Kaydetme
  useEffect(() => {
    if (user) {
      localStorage.setItem(`favorite_symbols_${user}`, JSON.stringify(favoriteSymbols));
    }
  }, [favoriteSymbols, user]);

  // Favori Ekle/Çıkar
  const toggleFavorite = (symbol, e) => {
    if(e) e.stopPropagation();
    setFavoriteSymbols(prev => {
      if (prev.includes(symbol)) {
        return prev.filter(s => s !== symbol);
      } else {
        return [...prev, symbol];
      }
    });
  };

  const getDisplayStocks = () => {
    let source = stocks || [];
    
    // Eğer favoriler sekmesindeysek sadece favorileri filtrele
    if (activeTab === 'Favorites') {
      source = source.filter(s => favoriteSymbols.includes(s.symbol));
    }

    return source.filter(stock => 
      stock && stock.symbol && (
        stock.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (stock.name && stock.name.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    );
  };

  // Kullanıcı değiştiğinde kayıtlı hisseleri yükle
  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`tracked_symbols_${user}`);
      if (saved) {
        try {
          setTrackedSymbols(JSON.parse(saved));
        } catch (e) {
          console.error("Geçmiş yüklenemedi", e);
          setTrackedSymbols([]);
        }
      } else {
        setTrackedSymbols([]);
      }
    }
  }, [user]);

  // Takip listesi değiştiğinde kaydet
  useEffect(() => {
    if (user) {
      localStorage.setItem(`tracked_symbols_${user}`, JSON.stringify(trackedSymbols));
    }
  }, [trackedSymbols, user]);

  // Arama Önerilerini Çek
  useEffect(() => {
    let active = true;
    
    const fetchSuggestions = async () => {
      if (searchTerm.trim().length < 2) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/search/suggestions?q=${searchTerm}`);
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setSuggestions(Array.isArray(data) ? data : []);
          }
        }
      } catch (err) {
        console.error("Suggestion fetch error:", err);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 300); // Debounce
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="logo" style={{ textAlign: 'center', marginBottom: '2rem', letterSpacing: '0px' }}>
            PhD TERMİNAL
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: 'normal' }}>{APP_VERSION}</div>
          </div>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Kullanıcı Adı</label>
              <input 
                type="text" 
                className="search-bar" 
                style={{ width: '100%' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Şifre</label>
              <input 
                type="password" 
                className="search-bar" 
                style={{ width: '100%' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {authError && <p style={{ color: 'var(--loss-color)', marginTop: '0.5rem' }}>{authError}</p>}
            <button type="submit" className="login-btn">Giriş Yap</button>
          </form>
        </div>
      </div>
    );
  }




  const displayedStocks = getDisplayStocks();

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo" style={{ letterSpacing: '0px' }}>
          PhD TERMİNAL
          <div style={{ fontSize: '0.7rem', color: 'var(--accent-color)', marginTop: '0.2rem', fontWeight: 'normal' }}>{APP_VERSION}</div>
        </div>
        <nav>
          <ul className="nav-links">
            <li className={`nav-item ${activeTab === 'Dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('Dashboard'); setActiveStock(null); }}>Dashboard</li>
            <li className={`nav-item ${activeTab === 'Favorites' ? 'active' : ''}`} onClick={() => { setActiveTab('Favorites'); setActiveStock(null); }}>Favoriler</li>
            {user === 'admin' && (
              <li className={`nav-item ${activeTab === 'Admin' ? 'active' : ''}`} onClick={() => setActiveTab('Admin')}>Admin Paneli</li>
            )}
            <li className="nav-item" onClick={() => setIsLoggedIn(false)}>Çıkış Yap</li>
          </ul>
        </nav>
      </aside>

      <div className="online-panel">
        <h4 style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', paddingLeft: '0.5rem'}}>ONLINE</h4>
        <div className="online-list">
          {onlineUsers.map(u => (
            <div key={u} className="online-user-item">
              <span className="online-dot shine"></span>
              <span className="online-name">{u}</span>
            </div>
          ))}
        </div>
      </div>

      <main className="main-content">
        {activeTab === 'Admin' && user === 'admin' ? (
          <div className="admin-view">
            <h1>Admin Paneli</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Kayıtlı kullanıcıları yönetin ve yenilerini ekleyin.</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem' }}>
              <div className="stock-card">
                <h3>Yeni Kullanıcı Ekle</h3>
                <form onSubmit={handleCreateUser} style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label>Kullanıcı Adı</label>
                    <input 
                      type="text" 
                      className="search-bar" 
                      style={{ width: '100%', marginBottom: '1rem' }}
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Şifre</label>
                    <input 
                      type="password" 
                      className="search-bar" 
                      style={{ width: '100%', marginBottom: '1rem' }}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="login-btn">Kullanıcıyı Kaydet</button>
                </form>
              </div>

              <div className="stock-table-container">
                <h3>Kayıtlı Kullanıcılar</h3>
                <table style={{ marginTop: '1rem' }}>
                  <thead>
                    <tr>
                      <th>KULLANICI ADI</th>
                      <th>YETKİ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((uname) => (
                      <tr key={uname}>
                        <td><strong>{uname}</strong></td>
                        <td>
                          <span className="badge" style={{ color: uname === 'admin' ? 'var(--accent-color)' : 'white' }}>
                            {uname === 'admin' ? 'Admin' : 'Arkadaş'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            ) : activeStock ? (
                <StockDetailView 
                    symbol={activeStock} 
                    onBack={() => setActiveStock(null)} 
                    toggleFavorite={toggleFavorite}
                    isFavorite={favoriteSymbols.includes(activeStock)}
                />
            ) : (
            <>
            <header>
              <h1>Hoş geldin, {user}</h1>
              <div className="search-container" style={{ position: 'relative', width: '100%', maxWidth: '600px', zIndex: 50 }}>
                <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                  <input 
                    type="text" 
                    className="search-bar" 
                    placeholder="Hisse ara (Örn: nv, karsn, thyao)..." 
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    style={{ flex: 1 }}
                  />
                  <button 
                    onClick={() => handleManualSearch()}
                    className="login-btn"
                    style={{ width: 'auto', padding: '0 1.5rem', height: '45px', marginTop: 0 }}
                  >
                    Ara
                  </button>
                </div>

                {showSuggestions && suggestions.length > 0 && (
                  <div className="suggestions-dropdown">
                    {suggestions.map((s, idx) => (
                      <div 
                        key={`${s.symbol}-${idx}`} 
                        className="suggestion-item"
                        onClick={() => handleManualSearch(s.symbol)}
                      >
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
              <small style={{display: 'block', color: 'var(--text-secondary)', marginTop: '0.5rem'}}>
                *Listede olmayan hisseler Yahoo Finance'den anlık çekilir.
              </small>
            </header>

            {loading ? (
              <div className="loading-state">Yükleniyor...</div>
            ) : (
              <>
                <div className="dashboard-grid-container">
                    {activeTab === 'Favorites' ? (
                        <div className="dashboard-grid">
                            {displayedStocks.map(stock => (
                                <div 
                                    key={stock.symbol} 
                                    className="stock-card" 
                                    style={{position: 'relative', cursor: 'pointer'}}
                                    onClick={() => setActiveStock(stock.symbol)}
                                >
                                <button 
                                    className="fav-btn"
                                    onClick={(e) => toggleFavorite(stock.symbol, e)}
                                    style={{
                                    position: 'absolute',
                                    top: '10px',
                                    right: '10px',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: favoriteSymbols.includes(stock.symbol) ? '#FFD700' : 'var(--text-secondary)',
                                    fontSize: '1.2rem',
                                    zIndex: 10
                                    }}
                                >
                                    {favoriteSymbols.includes(stock.symbol) ? '★' : '☆'}
                                </button>
                                <div className="stock-header">
                                    <div className="stock-id">
                                    <span className="stock-symbol">{stock.symbol.replace('.IS', '')}</span>
                                    <div className="stock-name-small">{stock.name}</div>
                                    </div>
                                    <div style={{textAlign: 'right', marginTop:'20px'}}>
                                    <div className={stock.change > 0 ? 'change-up' : stock.change < 0 ? 'change-down' : ''} style={{fontWeight: 'bold', fontSize: '1.2rem'}}>
                                        {stock.changePercent}%
                                    </div>
                                    </div>
                                </div>
                                <div className="stock-price">{stock.price.toLocaleString()}</div>
                                <div style={{fontSize: '0.8rem', color:'var(--text-secondary)', marginTop:'5px'}}>
                                    Açılış: {stock.open ? stock.open.toLocaleString() : '-'}
                                </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        // Dashboard View - Grouped by Sector
                        Object.entries(
                            displayedStocks.reduce((groups, stock) => {
                                const sector = stock.sector_group || 'Diğer';
                                if (!groups[sector]) groups[sector] = [];
                                groups[sector].push(stock);
                                return groups;
                            }, {})
                        ).map(([sector, stocks]) => (
                            <div key={sector} style={{ marginBottom: '2rem' }}>
                                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--accent-color)' }}>
                                    {sector}
                                </h3>
                                <div className="dashboard-grid">
                                    {stocks.map(stock => (
                                        <div 
                                            key={stock.symbol} 
                                            className="stock-card" 
                                            style={{position: 'relative', cursor: 'pointer'}}
                                            onClick={() => setActiveStock(stock.symbol)}
                                        >
                                            <button 
                                                className="fav-btn"
                                                onClick={(e) => toggleFavorite(stock.symbol, e)}
                                                style={{
                                                position: 'absolute',
                                                top: '10px',
                                                right: '10px',
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: favoriteSymbols.includes(stock.symbol) ? '#FFD700' : 'var(--text-secondary)',
                                                fontSize: '1.2rem',
                                                zIndex: 10
                                                }}
                                            >
                                                {favoriteSymbols.includes(stock.symbol) ? '★' : '☆'}
                                            </button>
                                            <div className="stock-header">
                                                <div className="stock-id">
                                                <span className="stock-symbol">{stock.symbol.replace('.IS', '')}</span>
                                                <div className="stock-name-small">{stock.name}</div>
                                                </div>
                                                <div style={{textAlign: 'right', marginTop:'20px'}}>
                                                <div className={stock.change > 0 ? 'change-up' : stock.change < 0 ? 'change-down' : ''} style={{fontWeight: 'bold', fontSize: '1.2rem'}}>
                                                    {stock.changePercent}%
                                                </div>
                                                </div>
                                            </div>
                                            <div className="stock-price">{stock.price.toLocaleString()}</div>
                                            <div style={{fontSize: '0.8rem', color:'var(--text-secondary)', marginTop:'5px'}}>
                                                Açılış: {stock.open ? stock.open.toLocaleString() : '-'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {activeTab === 'Dashboard' && displayedStocks.length > 5 && (
                  <div className="stock-table-container">
                    <h3>Diğer Geçmiş</h3>
                    <table style={{ marginTop: '1rem' }}>
                      <thead>
                        <tr>
                          <th>SEMBOL</th>
                          <th>AÇILIŞ</th>
                          <th>FİYAT</th>
                          <th>DEĞİŞİM</th>
                           <th>FAVORİ</th> 
                        </tr>
                      </thead>
                      <tbody>
                        {displayedStocks.slice(5).map(stock => (
                          <tr key={stock.symbol} onClick={() => setActiveStock(stock.symbol)} style={{cursor:'pointer'}}>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span className="badge" style={{width: 'fit-content', marginBottom:'4px'}}>{stock.symbol.replace('.IS', '')}</span>
                                <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{stock.name}</small>
                              </div>
                            </td>
                            <td>{stock.open ? stock.open.toLocaleString() : '-'}</td>
                            <td>{stock.price.toLocaleString()}</td>
                            <td className={stock.change > 0 ? 'change-up' : stock.change < 0 ? 'change-down' : ''}>
                               <span style={{fontWeight:'bold'}}>{stock.changePercent}%</span>
                            </td>
                             <td style={{textAlign: 'center'}}>
                              <button 
                                onClick={(e) => toggleFavorite(stock.symbol, e)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: favoriteSymbols.includes(stock.symbol) ? '#FFD700' : 'var(--text-secondary)',
                                  fontSize: '1.2rem',
                                  cursor: 'pointer'
                                }}
                              >
                                {favoriteSymbols.includes(stock.symbol) ? '★' : '☆'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {/* Infinite Scroll Tetikleyici */}
                    <div ref={observerTarget} style={{ height: '20px', margin: '10px 0' }}>
                       {hasMore && !loading && <span style={{color:'var(--text-secondary)', fontSize:'0.8rem'}}>Daha fazla yükleniyor...</span>}
                    </div>

                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StockDetailView({ symbol, onBack, toggleFavorite, isFavorite }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="loading-state">Detaylar yükleniyor...</div>;
  if (!detail) return <div className="loading-state">Veri bulunamadı. <button onClick={onBack}>Geri Dön</button></div>;

  const formatLargeNumber = (num) => {
      if (!num) return '-';
      if (num >= 1e9) return (num / 1e9).toFixed(2) + ' Mr';
      if (num >= 1e6) return (num / 1e6).toFixed(2) + ' Mn';
      return num.toLocaleString();
  };

  return (
      <div className="fade-in" style={{ maxWidth: '1000px', margin: '0 auto' }}>
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
      </div>
  );
}

export default App;
