from datetime import datetime
import json
import os
import urllib3
import pandas as pd
try:
    from isyatirimhisse import fetch_financials as isy_fetch
except ImportError:
    isy_fetch = None

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

FINANCIAL_CACHE_FILE = os.path.join(os.path.dirname(__file__), "financial_cache.json")

def load_financial_cache():
    if os.path.exists(FINANCIAL_CACHE_FILE):
        try:
            with open(FINANCIAL_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_financial_cache(cache):
    try:
        with open(FINANCIAL_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except:
        pass

FINANCIAL_CACHE = load_financial_cache()

def get_financial_group(symbol):
    """
    isyatirimhisse kütüphanesinin beklediği grup (1, 2, 3)
    1: XI_29 (Standart)
    2: UFRS (Bireysel)
    3: UFRS (Konsolide - Bankalar için de uygundur)
    """
    if symbol in ["AKBNK", "GARAN", "ISCTR", "HALKB", "VAKBN", "TSKB", "ICBCT"]:
        return "3"
    return "1"

def get_periods(count=12):
    """
    Son N dönemi (Yıl, Çeyrek) liste olarak döner.
    """
    now = datetime.now()
    year = now.year
    # Mevcut çeyrek (1: Mart, 2: Haziran, 3: Eylül, 4: Aralık)
    # Bilançolar genelde 2-3 ay sonra açıklanır. 
    # Mart (3), Haziran (6), Eylül (9), Aralık (12)
    month = now.month
    if month < 4:
        # Daha 1. çeyrek bilançoları gelmemiştir, geçen yılın sonundan başla
        start_year = year - 1
        start_period = 12
    elif month < 7:
        start_year = year
        start_period = 3
    elif month < 10:
        start_year = year
        start_period = 6
    else:
        start_year = year
        start_period = 9
    
    periods = []
    curr_y = start_year
    curr_p = start_period
    
    for _ in range(count):
        periods.append((curr_y, curr_p))
        curr_p -= 3
        if curr_p == 0:
            curr_p = 12
            curr_y -= 1
            
    return periods

def fetch_financials(symbol):
    """
    isyatirimhisse kütüphanesini kullanarak son 12 bilançoyu çeker.
    """
    print(f"BİLGİ: {symbol} için mali tablo çekme işlemi başladı...")
    if not isy_fetch:
        print("HATA: isyatirimhisse kütüphanesi yüklü değil! 'pip install isyatirimhisse pandas' komutunu çalıştırın.")
        return None

    symbol = symbol.upper().replace(".IS", "")
    group = get_financial_group(symbol)
    
    # Son 12 dönemi kapsayacak şekilde son 4 yılın verisini isteyelim
    curr_year = datetime.now().year
    start_year = curr_year - 4
    
    try:
        # Kütüphane yardımıyla veriyi çekelim
        df = isy_fetch(
            symbol=symbol, 
            start_year=str(start_year), 
            end_year=str(curr_year), 
            financial_group=group
        )
        
        if df is None or df.empty:
            print(f"Uyarı: {symbol} için veri bulunamadı.")
            return None

        print(f"BAŞARI: {symbol} için veri çekildi. Sütunlar: {df.columns.tolist()}")

        # Period sütunlarını bulalım (YYYY/M formatında olan sütunlar)
        meta_cols = ["FINANCIAL_ITEM_CODE", "FINANCIAL_ITEM_NAME_TR", "FINANCIAL_ITEM_NAME_EN", "SYMBOL"]
        period_cols = [c for c in df.columns if c not in meta_cols]
        
        # Dönemleri güncelden eskiye sıralayalım
        def sort_key(p):
            try:
                parts = p.split('/')
                return (int(parts[0]), int(parts[1]))
            except:
                return (0, 0)
        
        period_cols.sort(key=sort_key, reverse=True)
        period_cols = period_cols[:12] # Son 12 dönemi al
        
        all_data = []
        for _, row in df.iterrows():
            item = {
                "code": row.get("FINANCIAL_ITEM_CODE", ""),
                "label": row.get("FINANCIAL_ITEM_NAME_TR", ""),
                "values": {}
            }
            for p in period_cols:
                val = row.get(p)
                # NaN kontrolü (pandas'ta NaN !== NaN)
                if val != val or val is None:
                    val = None
                item["values"][p] = val
            all_data.append(item)
            
        if all_data:
            res = {
                "last_updated": datetime.now().isoformat(),
                "data": all_data,
                "periods": period_cols
            }
            FINANCIAL_CACHE[symbol] = res
            save_financial_cache(FINANCIAL_CACHE)
            return res
            
    except Exception as e:
        print(f"isyatirimhisse hatası ({symbol}): {e}")
        
    return None

def get_stock_financials(symbol):
    """
    Önce cache'e bakar, yoksa veya eskiyse çeker.
    """
    symbol = symbol.upper().replace(".IS", "")
    cached = FINANCIAL_CACHE.get(symbol)
    
    # Eğer cache yoksa veya 1 günden eskiyse güncelle
    should_update = True
    if cached:
        last_updated = datetime.fromisoformat(cached["last_updated"])
        if (datetime.now() - last_updated).days < 1:
            should_update = False
            
    if should_update:
        return fetch_financials(symbol)
    
    return cached
