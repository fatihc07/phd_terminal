import requests
import re
import yfinance as yf
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import uvicorn
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

# --- Google Finance Scraper (Terminal Testine Göre Optimize Edildi) ---
# --- YFinance Data Fetcher (Single Source of Truth) ---
def get_google_finance_data(symbol: str):
    # Bu fonksiyon tamamen YFinance kullanarak veri çeker.
    original_symbol = symbol.upper()
    
    # BIST sembolü düzeltme (.IS ekle)
    yf_symbol = original_symbol
    if "." not in yf_symbol:
        yf_symbol = f"{original_symbol}.IS"
        
    try:
        ticker = yf.Ticker(yf_symbol)
        
        # 1. Hacim (Öncelik: fast_info > info > history)
        # fast_info, anlık hacim konusunda genellikle daha tutarlıdır.
        volume = 0
        try:
            # last_volume genelde o günün son hacmi/kümülatif hacmidir
            if hasattr(ticker, 'fast_info') and 'last_volume' in ticker.fast_info:
                volume = float(ticker.fast_info['last_volume'])
        except: pass

        if volume == 0:
            try:
                info = ticker.info
                volume = info.get('volume') or info.get('regularMarketVolume') or 0
            except: pass

        # 2. Tarihçe ve Fiyat (History)
        hist = ticker.history(period="5d")
        
        if hist.empty:
            # Eğer history boşsa ama fast_info'dan hacim geldiyse bile fiyat yok demektir.
            return None

        current_row = hist.iloc[-1]
        price = float(current_row['Close'])

        # Eğer hala hacim 0 ise history'den al
        if volume == 0:
            vol_hist = float(current_row['Volume'])
            if vol_hist > 0:
                volume = vol_hist
            elif len(hist) >= 2:
                # Bugün veri yoksa dünü al (Piyasa kapalıyken)
                volume = float(hist['Volume'].iloc[-2])

        # 3. Değişim Hesaplama
        change = 0
        change_percent = 0
        
        if len(hist) >= 2:
            prev_close = float(hist['Close'].iloc[-2])
            change = price - prev_close
            if prev_close != 0:
                change_percent = (change / prev_close) * 100
        elif len(hist) == 1:
            open_price = float(hist['Open'].iloc[0])
            change = price - open_price
            if open_price != 0:
                change_percent = (change / open_price) * 100

        # 4. İsim
        fullname = original_symbol
        try:
            # info yukarıda çekildiyse cache'den gelir
            info = ticker.info
            fullname = info.get('longName') or info.get('shortName') or original_symbol
        except: pass

        # Açılış Fiyatı (Bugünün)
        open_price = 0
        if not hist.empty:
            # Son günün açılış verisini al
            open_price = float(current_row['Open'])
            
        # Sektör Cache Kontrolü
        cached_sector = SECTOR_CACHE.get(original_symbol)
        if cached_sector:
             sector = cached_sector
        else:
             sector = "Diğer"
             try:
                info = ticker.info
                fullname = info.get('longName') or info.get('shortName') or original_symbol
                raw_s = info.get('sector', 'Diğer')
                
                # Sektör Çevirisi yapıp cacheleyelim
                sector_trans = {
                    "Technology": "Teknoloji & Yazılım",
                    "Financial Services": "Bankacılık & Finans",
                    "Industrials": "Sanayi & Üretim",
                    "Energy": "Enerji",
                    "Consumer Cyclical": "Perakende & Ticaret",
                    "Basic Materials": "Madencilik & Metal",
                    "Healthcare": "Sağlık",
                    "Communication Services": "Ulaştırma & Havacılık",
                    "Real Estate": "GYO & İnşaat",
                    "Utilities": "Enerji & Altyapı",
                    "Consumer Defensive": "Gıda & İçecek"
                }
                sector = sector_trans.get(raw_s, raw_s) # Çeviri

                # Eğer anlamlı bir sektörse cache'e kaydet
                if sector != "Diğer":
                    SECTOR_CACHE[original_symbol] = sector
                    save_sector_cache(SECTOR_CACHE)
             except: pass

        return {
            "symbol": original_symbol,
            "name": fullname,
            "sector": sector, # Cache'den gelen veya yeni bulunan
            "price": round(price, 2),
            "open": round(open_price, 2), # Eklenen veri
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "volume": volume,
            "marketCap": 0
        }

    except Exception as e:
        print(f"Error fetching {original_symbol}: {e}")
        return None

app = FastAPI(title="PhD TERMİNAL Stock Portfolio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = os.path.join(os.path.dirname(__file__), "users.json")

def load_users():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r") as f: return json.load(f)
        except: pass
    return {"admin": "admin123"}

def save_users(users):
    with open(DB_FILE, "w") as f: json.dump(users, f)

USERS_DB = load_users()
ONLINE_USERS = {}

@app.post("/login")
def login(data: dict = Body(...)):
    u, p = data.get("username"), data.get("password")
    if u in USERS_DB and USERS_DB[u] == p:
        ONLINE_USERS[u] = time.time()
        return {"status": "success", "user": u}
    raise HTTPException(status_code=401)

@app.post("/heartbeat")
def heartbeat(data: dict = Body(...)):
    u = data.get("username")
    if u: ONLINE_USERS[u] = time.time()
    return {"status": "ok"}

# --- Sektör Cache Sistemi ---
SECTOR_DB_FILE = os.path.join(os.path.dirname(__file__), "sectors.json")

def load_sector_cache():
    if os.path.exists(SECTOR_DB_FILE):
        try:
            with open(SECTOR_DB_FILE, "r") as f: return json.load(f)
        except: pass
    return {}

def save_sector_cache(cache):
    try:
        with open(SECTOR_DB_FILE, "w") as f: json.dump(cache, f)
    except: pass

SECTOR_CACHE = load_sector_cache()

@app.get("/admin/users")
def get_users():
    return list(USERS_DB.keys())

@app.post("/admin/create-user")
def create_user(data: dict = Body(...)):
    u, p = data.get("username"), data.get("password")
    if u and p:
        USERS_DB[u] = p
        save_users(USERS_DB)
        return {"status": "success"}
    raise HTTPException(status_code=400, detail="Eksik bilgi")

@app.get("/admin/online-users")
def get_online_users():
    t = time.time()
    return [ un for un, la in ONLINE_USERS.items() if t - la < 120 ]

@app.get("/stocks")
def get_stocks(symbols: Optional[str] = None, page: int = 1, limit: int = 20):
    requested = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else []
    defaults = []
    
    # Dict yapısını düz listeye çevir (Sector bilgisini saklamak için map kullanacağız)
    sector_map = {}
    
    if isinstance(DEFAULT_STOCKS, dict):
        for sector, s_list in DEFAULT_STOCKS.items():
            for s in s_list:
                clean_s = s.replace(".IS", "")
                defaults.append(clean_s)
                sector_map[clean_s] = sector
    else:
        # Eski liste yapısı (Fallback)
        defaults = [s.replace(".IS", "") for s in DEFAULT_STOCKS]

    
    # 1. Birleştirme: Önce istenenler (Tracked), sonra varsayılanlar
    all_raw = requested + defaults
    
    # 2. Tekilleştirme (Sırayı bozmadan)
    seen = set()
    unique_symbols = [s for s in all_raw if not (s in seen or seen.add(s))]
    
    # 3. Sayfalama (Pagination)
    start = (page - 1) * limit
    end = start + limit
    batch_symbols = unique_symbols[start:end]
    
    # Daha fazla veri var mı kontrolü
    has_more = end < len(unique_symbols)
    
    if not batch_symbols:
        return {"items": [], "has_more": False}

    # 4. Veri Çekme (Sadece bu sayfa için)
    # yfinance ile veriyi çekerken sektör bilgisini de alıyoruz.
    results_map = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(get_google_finance_data, s): s for s in batch_symbols}
        for f in futures:
            res = f.result()
            if res: 
                # Sektör bilgisini ekle
                sym = res['symbol'].replace('.IS', '')
                res['sector_group'] = sector_map.get(sym, 'Genel')
                # Eğer yfinance'dan gelen sektör bilgisi varsa onu da kullanabiliriz ama sector_map daha temiz görünüyor frontend için.
                # Ama frontend'de 'sector' kullanılıyor mu 'sector_group' mu kontrol etmek lazım.
                # App.jsx: detail.sector ve detail.industry kullanıyor.
                # DashboardView.jsx: detail.sector_group? Muhtemelen.
                # Aslında get_google_finance_data zaten 'sector' döndürüyor.
                
                results_map[futures[f]] = res

    # 5. Sonuçları Sıraya Göre Dizme
    final = []
    for s in batch_symbols:
        if s in results_map: final.append(results_map[s])
        
    return {"items": final, "has_more": has_more}

@app.get("/search/suggestions")
def search_suggestions(q: str):
    if not q or len(q) < 2: return []
    q = q.upper()
    
    # 1. Yerel Havuzda Ara (BIST Hisseleri)
    local_matches = []
    
    # DEFAULT_STOCKS dict ise düz listeye çevirip ara
    defaults_flat = []
    if isinstance(DEFAULT_STOCKS, dict):
        for s_list in DEFAULT_STOCKS.values():
            defaults_flat.extend(s_list)
    else:
        defaults_flat = DEFAULT_STOCKS

    for s in defaults_flat:
        if q in s:
            local_matches.append({
                "symbol": s.replace(".IS", ""),
                "name": s.replace(".IS", ""),
                "exchange": "BIST"
            })
        if len(local_matches) >= 5: break

    # 2. Küresel Arama (Yahoo Finance Suggestion API - Kayıt gerektirmez)
    global_matches = []
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=5&newsCount=0"
        headers = {'User-Agent': 'Mozilla/5.0'}
        r = requests.get(url, headers=headers, timeout=3)
        if r.status_code == 200:
            data = r.json()
            for quote in data.get("quotes", []):
                sym = quote.get("symbol")
                if sym:
                    global_matches.append({
                        "symbol": sym,
                        "name": quote.get("shortname") or sym,
                        "exchange": quote.get("exchange")
                    })
    except: pass

    # Birleştir ve dön
    return local_matches + global_matches

@app.get("/stocks/{symbol}/detail")
def get_stock_detail(symbol: str):
    original_symbol = symbol.upper()
    yf_symbol = original_symbol
    if "." not in yf_symbol:
        yf_symbol = f"{original_symbol}.IS"
        
    try:
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
        
        # Güvenli veri çekme yardımcı fonksiyonu
        def get_val(key, default="-"):
            return info.get(key, default)

        # Çeviri Fonksiyonu (Opsiyonel)
        def tr(text):
            if not text or text == "-": return text
            try:
                # deep_translator yüklü ise kullan
                # from deep_translator import GoogleTranslator
                # return GoogleTranslator(source='auto', target='tr').translate(text)
                return text
            except Exception:
                return text

        description = get_val("longBusinessSummary", "Şirket açıklaması bulunamadı.")
        sector = get_val("sector")
        industry = get_val("industry")

        # Temel veriler
        data = {
            "symbol": original_symbol,
            "name": get_val("longName", get_val("shortName")),
            "description": tr(description) if description != "Şirket açıklaması bulunamadı." else description,
            "sector": tr(sector),
            "industry": tr(industry),
            "website": get_val("website"),
            "logo_url": get_val("logo_url", ""), 
            "price": get_val("currentPrice", get_val("regularMarketPrice", 0)),
            "currency": get_val("currency", "TRY"),
            
            # Finansallar
            "marketCap": get_val("marketCap", 0),
            "peRatio": get_val("trailingPE", 0),
            "dividendYield": get_val("dividendYield", 0),
            
            # Günlük / Yıllık Aralık
            "dayHigh": get_val("dayHigh", 0),
            "dayLow": get_val("dayLow", 0),
            "fiftyTwoWeekHigh": get_val("fiftyTwoWeekHigh", 0),
            "fiftyTwoWeekLow": get_val("fiftyTwoWeekLow", 0),
            "averageVolume": get_val("averageVolume", 0),
            "open": get_val("open", 0),
            "previousClose": get_val("previousClose", 0)
        }
        
        # Değişim hesapla (Eğer info'da yoksa manuel)
        if data["price"] and data["previousClose"]:
            data["change"] = data["price"] - data["previousClose"]
            data["changePercent"] = (data["change"] / data["previousClose"]) * 100
        else:
            data["change"] = 0
            data["changePercent"] = 0
            
        return data
    except Exception as e:
        print(f"Detail error: {e}")
        raise HTTPException(status_code=404, detail="Hisse detayları alınamadı")

import financial_service

@app.get("/stocks/{symbol}/financials")
def get_financials(symbol: str, refresh: bool = False):
    original_symbol = symbol.upper().replace(".IS", "")
    
    # Check cache first if refresh is not requested
    if not refresh:
        data = financial_service.get_stored_financials(original_symbol)
        if data:
            return data
            
    try:
        data = financial_service.fetch_financial_data(original_symbol)
        return data or {}
    except Exception as e:
        print(f"Financial fetch error: {e}")
        return {}

# Sektörel Gruplandırma
DEFAULT_STOCKS = {
    "Bankacılık & Finans": ["AKBNK.IS", "GARAN.IS", "ISCTR.IS", "YKBNK.IS", "VAKBN.IS", "HALKB.IS", "TSKB.IS", "SKBNK.IS", "ALBRK.IS", "ICBCT.IS", "QNBFL.IS"],
    "Sanayi & Üretim": ["EREGL.IS", "KRDMD.IS", "TUPRS.IS", "PETKM.IS", "SISE.IS", "ARCLK.IS", "VESTL.IS", "TOASO.IS", "FROTO.IS", "TTRAK.IS", "OTKAR.IS", "KCHOL.IS", "SAHOL.IS", "ULKER.IS", "AEFES.IS", "CCOLA.IS", "BRISA.IS", "SASA.IS", "HEKTS.IS"],
    "Teknoloji & Yazılım": ["ASELS.IS", "LOGO.IS", "NETAS.IS", "KFEIN.IS", "ALCTL.IS", "KAREL.IS", "KRONT.IS", "LINK.IS", "MIA.IS", "ARDYZ.IS", "FONET.IS", "SMART.IS", "VBTYZ.IS", "PAPIL.IS", "ESCOM.IS", "AZTEK.IS", "MIATK.IS", "KONTR.IS", "YEOTK.IS", "SDTTR.IS", "EUPWR.IS", "ASTOR.IS", "CVKMD.IS", "CWENE.IS"],
    "Enerji": ["ZOREN.IS", "ODAS.IS", "AKSEN.IS", "AYDEM.IS", "ENJSA.IS", "GWIND.IS", "NATEN.IS", "MAGEN.IS", "BIOEN.IS", "CONSE.IS", "SMRTG.IS", "ALFAS.IS", "AHGAZ.IS", "AKENR.IS", "AYEN.IS"],
    "Ulaştırma & Havacılık": ["THYAO.IS", "PGSUS.IS", "TAVHL.IS", "CLEBI.IS", "DOCO.IS", "RYSAS.IS", "TLMAN.IS"],
    "GYO & İnşaat": ["EKGYO.IS", "ISGYO.IS", "TRGYO.IS", "SNGYO.IS", "ALGYO.IS", "HLGYO.IS", "OZKGY.IS", "AKFGY.IS", "RYGYO.IS", "ENKAI.IS", "TKFEN.IS"],
    "Perakende & Ticaret": ["BIMAS.IS", "MGROS.IS", "SOKM.IS", "TKNSA.IS", "MAVI.IS", "YATAS.IS", "VAKKO.IS", "BOYP.IS", "BIZIM.IS"],
    "Madencilik & Metal": ["KOZAL.IS", "KOZAA.IS", "IPEKE.IS", "ALTNY.IS", "CVKMD.IS", "PARSN.IS", "DMSAS.IS", "CEMTS.IS"],
    "Diğer": ["GUBRF.IS", "BERA.IS", "IHLAS.IS", "METRO.IS", "FENER.IS", "GSRAY.IS", "BJKAS.IS", "TSPOR.IS"]
}

# Sektörel Grulandırma İçin Bekleme
# Bu fonksiyon arka planda sektörleri tarayıp cache'i dolduracak
import threading
def init_stock_cache():
    print("--- Stok Cache Güncellemesi Başladı ---")
    
    # 1. Hisseleri Tarayalım (Sektörleri Öğrenmek İçin)
    def fetch_sector_only(symbol):
        if symbol in SECTOR_CACHE: return # Zaten biliyoruz
        try:
            get_google_finance_data(symbol) # Bu fonksiyon veriyi çekerken cache'i de güncelliyor
        except: pass

    # Thread Pool ile Hızlıca Tarama (Rate Limit İçin Yavaşlatıldı)
    with ThreadPoolExecutor(max_workers=3) as executor:
         # Dict struct düzeltme
        defaults_flat = []
        if isinstance(DEFAULT_STOCKS, dict):
            for s_list in DEFAULT_STOCKS.values():
                defaults_flat.extend(s_list)
        else:
            defaults_flat = DEFAULT_STOCKS
            
        for symbol in defaults_flat:
            executor.submit(fetch_sector_only, symbol)
            time.sleep(2) # Her istek arası 2 saniye bekle
    
    print("--- Stok Cache Güncellemesi Bitti ---")


# Uygulama Başlarken Cache'i Başlat
threading.Thread(target=init_stock_cache, daemon=True).start()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
