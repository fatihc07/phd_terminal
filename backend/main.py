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

        return {
            "symbol": original_symbol,
            "name": fullname,
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
    results_map = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(get_google_finance_data, s): s for s in batch_symbols}
        for f in futures:
            res = f.result()
            if res: results_map[futures[f]] = res

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
    for s in DEFAULT_STOCKS:
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

        # Temel veriler
        data = {
            "symbol": original_symbol,
            "name": get_val("longName", get_val("shortName")),
            "description": get_val("longBusinessSummary", "Şirket açıklaması bulunamadı."),
            "sector": get_val("sector"),
            "industry": get_val("industry"),
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

DEFAULT_STOCKS = [
    "A1CAP.IS", "ACSEL.IS", "ADEL.IS", "ADESE.IS", "ADGYO.IS", "AEFES.IS", "AFYON.IS", "AGESA.IS", "AGHOL.IS", "AGYO.IS", "AHGAZ.IS", "AKBNK.IS", "AKCNS.IS", "AKENR.IS", "AKFGY.IS", "AKFYE.IS", "AKGRT.IS", "AKMGY.IS", "AKSA.IS", "AKSEN.IS", "AKSGY.IS", "AKSUE.IS", "AKYHO.IS", "ALARK.IS", "ALBRK.IS", "ALCAR.IS", "ALCTL.IS", "ALFAS.IS", "ALGYO.IS", "ALKA.IS", "ALKIM.IS", "ALMAD.IS",
    "ALPF.IS", "ALTNY.IS", "ANELE.IS", "ANGEN.IS", "ANHYT.IS", "ANSGR.IS", "ARASE.IS", "ARCLK.IS", "ARDYZ.IS", "ARENA.IS", "ARSAN.IS", "ARTMS.IS", "ARZUM.IS", "ASELS.IS", "ASGYO.IS", "ASTOR.IS", "ASUZU.IS", "ATAGY.IS", "ATAKP.IS", "ATP.IS", "AVGYO.IS", "AVHOL.IS", "AVOD.IS", "AVPGY.IS", "AYCES.IS", "AYDEM.IS", "AYEN.IS", "AYES.IS", "AYGAZ.IS", "AZTEK.IS",
    "BAGFS.IS", "BAKAB.IS", "BALAT.IS", "BANVT.IS", "BARMA.IS", "BASCM.IS", "BASGZ.IS", "BAYRK.IS", "BEGYO.IS", "BERA.IS", "BEYAZ.IS", "BFREN.IS", "BIENY.IS", "BIGCH.IS", "BIMAS.IS", "BINHO.IS", "BIOEN.IS", "BIZIM.IS", "BJKAS.IS", "BLCYT.IS", "BMSCH.IS", "BMSTL.IS", "BNTAS.IS", "BOBET.IS", "BOSSA.IS", "BRISA.IS", "BRKO.IS", "BRKSN.IS", "BRKVY.IS", "BRLSM.IS", "BRMEN.IS", "BRSAN.IS", "BRYAT.IS", "BSOKE.IS", "BTCIM.IS", "BUCIM.IS", "BURCE.IS", "BURVA.IS", "BVSAN.IS",
    "CANTE.IS", "CASA.IS", "CATES.IS", "CCOLA.IS", "CELHA.IS", "CEMAS.IS", "CEMTS.IS", "CEOEM.IS", "CIMSA.IS", "CLEBI.IS", "CMBTN.IS", "CMENT.IS", "CONSE.IS", "COSMO.IS", "CRDFA.IS", "CRFSA.IS", "CUSAN.IS", "CVKMD.IS", "CWENE.IS",
    "DAGHL.IS", "DAGI.IS", "DAPGM.IS", "DARDL.IS", "DENGE.IS", "DERHL.IS", "DERIM.IS", "DESA.IS", "DESPC.IS", "DEVA.IS", "DGATE.IS", "DGGYO.IS", "DGNMO.IS", "DIRIT.IS", "DITAS.IS", "DMSAS.IS", "DNISI.IS", "DOAS.IS", "DOBUR.IS", "DOCO.IS", "DOGUB.IS", "DOHOL.IS", "DOKTA.IS", "DURDO.IS", "DYOBY.IS", "DZGYO.IS",
    "EBEBK.IS", "ECILC.IS", "ECZYT.IS", "EDATA.IS", "EDIP.IS", "EGEEN.IS", "EGGUB.IS", "EGPRO.IS", "EGSER.IS", "EKGYO.IS", "EKIZ.IS", "EKSUN.IS", "ELITE.IS", "EMKEL.IS", "EMNIS.IS", "ENJSA.IS", "ENKAI.IS", "ENSRI.IS", "EPLAS.IS", "ERBOS.IS", "ERCB.IS", "EREGL.IS", "ERSU.IS", "ESCAR.IS", "ESCOM.IS", "ESEN.IS", "ETILR.IS", "ETYAT.IS", "EUHOL.IS", "EUKYO.IS", "EUPWR.IS", "EUREN.IS", "EUYO.IS", "EYGYO.IS",
    "FADE.IS", "FENER.IS", "FLAP.IS", "FMIZP.IS", "FONET.IS", "FORMT.IS", "FORTE.IS", "FRIGO.IS", "FROTO.IS", "FZLGY.IS",
    "GARAN.IS", "GARFA.IS", "GEDIK.IS", "GEDZA.IS", "GENIL.IS", "GENTS.IS", "GEREL.IS", "GESAN.IS", "GLBMD.IS", "GLCVY.IS", "GLRYH.IS", "GLYHO.IS", "GMTAS.IS", "GOKNR.IS", "GOLTS.IS", "GOODY.IS", "GOZDE.IS", "GRNYO.IS", "GRSEL.IS", "GRTRK.IS", "GSDDE.IS", "GSDHO.IS", "GSRAY.IS", "GUBRF.IS", "GWIND.IS", "GZNMI.IS",
    "HALKB.IS", "HATEK.IS", "HDFGS.IS", "HEDEF.IS", "HEKTS.IS", "HKTM.IS", "HLGYO.IS", "HTTBT.IS", "HUBVC.IS", "HUNER.IS", "HURGZ.IS",
    "ICBCT.IS", "IDEAS.IS", "IDGYO.IS", "IEYHO.IS", "IHEVA.IS", "IHGZT.IS", "IHLAS.IS", "IHLGM.IS", "IHYAY.IS", "IMASM.IS", "INDES.IS", "INFO.IS", "INGRM.IS", "INTEM.IS", "INVEO.IS", "INVES.IS", "IPEKE.IS", "ISATR.IS", "ISBIR.IS", "ISBTR.IS", "ISCTR.IS", "ISDMR.IS", "ISFIN.IS", "ISGSY.IS", "ISGYO.IS", "ISKPL.IS", "ISKUR.IS", "ISMEN.IS", "ISSEN.IS", "IZENR.IS", "IZFAS.IS", "IZINV.IS", "IZMDC.IS",
    "JANTS.IS",
    "KAPLM.IS", "KAREL.IS", "KARSN.IS", "KARTN.IS", "KARYE.IS", "KATMR.IS", "KAYSE.IS", "KCAER.IS", "KCHOL.IS", "KENT.IS", "KERVN.IS", "KERVT.IS", "KFEIN.IS", "KGYO.IS", "KIMMR.IS", "KLGYO.IS", "KLKIM.IS", "KLMSN.IS", "KLNMA.IS", "KLRHO.IS", "KMPUR.IS", "KNFRT.IS", "KONKA.IS", "KONTR.IS", "KONYA.IS", "KOPOL.IS", "KORDS.IS", "KOZAA.IS", "KOZAL.IS", "KRDMA.IS", "KRDMB.IS", "KRDMD.IS", "KRGYO.IS", "KRONT.IS", "KRPLS.IS", "KRSTL.IS", "KRTEK.IS", "KRVGD.IS", "KSTUR.IS", "KTLEV.IS", "KTSKR.IS", "KUTPO.IS", "KUYAS.IS",
    "LIDER.IS", "LIDFA.IS", "LINK.IS", "LKMNH.IS", "LOGO.IS", "LUKSK.IS",
    "MAALT.IS", "MACKO.IS", "MAGEN.IS", "MAKIM.IS", "MAKTK.IS", "MANAS.IS", "MARKA.IS", "MARTI.IS", "MAVI.IS", "MEDTR.IS", "MEGAP.IS", "MEGMT.IS", "MEKAG.IS", "MEPET.IS", "MERCN.IS", "MERIT.IS", "MERKO.IS", "METRO.IS", "METUR.IS", "MGROS.IS", "MIATK.IS", "MIPAZ.IS", "MMCAS.IS", "MNDRS.IS", "MNDTR.IS", "MOBTL.IS", "MPARK.IS", "MRGYO.IS", "MRSHL.IS", "MSGYO.IS", "MTRKS.IS", "MTRYO.IS", "MZHLD.IS",
    "NATEN.IS", "NETAS.IS", "NIBAS.IS", "NTGAZ.IS", "NTHOL.IS", "NUGYO.IS", "NUHCM.IS",
    "OBAMS.IS", "ODAS.IS", "OFSYM.IS", "ONCSM.IS", "ORCAY.IS", "ORGE.IS", "ORMA.IS", "OSMEN.IS", "OSTIM.IS", "OTKAR.IS", "OTTO.IS", "OYAKC.IS", "OYAYO.IS", "OYLUM.IS", "OYYAT.IS", "OZGYO.IS", "OZKGY.IS", "OZRDN.IS", "OZSUB.IS",
    "PAGYO.IS", "PAMEL.IS", "PAPIL.IS", "PARSN.IS", "PASEU.IS", "PCILT.IS", "PEGYO.IS", "PEKGY.IS", "PENGD.IS", "PENTA.IS", "PETKM.IS", "PETUN.IS", "PGSUS.IS", "PINSU.IS", "PKART.IS", "PKENT.IS", "PLAT.IS", "PNLSN.IS", "PNSUT.IS", "POLHO.IS", "POLTK.IS", "PRDGS.IS", "PRKAB.IS", "PRKME.IS", "PRZMA.IS", "PSDTC.IS", "PSGYO.IS", "PYMD.IS",
    "QNBFL.IS", "QUAGR.IS",
    "RALYH.IS", "RAYSG.IS", "RNPOL.IS", "RODRG.IS", "ROYAL.IS", "RTALB.IS", "RUBNS.IS", "RYGYO.IS", "RYSAS.IS",
    "SAHOL.IS", "SAMAT.IS", "SANEL.IS", "SANFM.IS", "SANKO.IS", "SARKY.IS", "SASA.IS", "SAYAS.IS", "SDTTR.IS", "SEKFK.IS", "SEKUR.IS", "SELEC.IS", "SELGD.IS", "SELVA.IS", "SEYKM.IS", "SILVR.IS", "SISE.IS", "SKBNK.IS", "SKTAS.IS", "SMART.IS", "SMRTG.IS", "SNGYO.IS", "SNKRN.IS", "SNPAM.IS", "SODSN.IS", "SOKE.IS", "SOKM.IS", "SONME.IS", "SRVGY.IS", "SUMAS.IS", "SUNTK.IS", "SURGY.IS", "SUWEN.IS",
    "TABGD.IS", "TARKM.IS", "TATEN.IS", "TATGD.IS", "TAVHL.IS", "TBORG.IS", "TCELL.IS", "TDGYO.IS", "TEKTU.IS", "TERA.IS", "TETMT.IS", "TEZOL.IS", "TGSAS.IS", "THYAO.IS", "TKFEN.IS", "TKNSA.IS", "TLMAN.IS", "TMPOL.IS", "TMSN.IS", "TNZTP.IS", "TOASO.IS", "TRCAS.IS", "TRGYO.IS", "TRILC.IS", "TSGYO.IS", "TSKB.IS", "TSPOR.IS", "TTKOM.IS", "TTRAK.IS", "TUCLK.IS", "TUKAS.IS", "TUPRS.IS", "TURGG.IS", "TURSG.IS", "UFUK.IS",
    "ULAS.IS", "ULKER.IS", "ULUFA.IS", "ULUSE.IS", "ULUUN.IS", "UMPAS.IS", "UNLU.IS", "USAK.IS", "UYUM.IS", "UZERB.IS",
    "VAKBN.IS", "VAKFN.IS", "VAKKO.IS", "VANGD.IS", "VBTYZ.IS", "VERTU.IS", "VERUS.IS", "VESBE.IS", "VESTL.IS", "VKFYO.IS", "VKGYO.IS", "VKING.IS",
    "YAPRK.IS", "YATAS.IS", "YAYLA.IS", "YEOTK.IS", "YESIL.IS", "YGGYO.IS", "YGGCY.IS", "YGYO.IS", "YKBNK.IS", "YKSLN.IS", "YONGA.IS", "YUNSA.IS", "YYAPI.IS",
    "ZEDUR.IS", "ZOREN.IS", "ZRGYO.IS"
]

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
