import requests
import json
import os
import time

# Directory for storing financial data
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
FINANCIALS_FILE = os.path.join(DATA_DIR, "financials.json")

def load_financials():
    if os.path.exists(FINANCIALS_FILE):
        try:
            with open(FINANCIALS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_financials(data):
    try:
        with open(FINANCIALS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving financials: {e}")

# Cache in memory
FINANCIALS_CACHE = load_financials()

def fetch_financial_data(symbol):
    """
    Fetches the last 12 periods of financial data for a given symbol from Is Yatirim.
    """
    symbol = symbol.replace(".IS", "").upper()
    print(f"Fetching financials for {symbol}...")
    
    # Define last 12 quarters (approx 3 years)
    # We need to be dynamic with current date, but for simplicity let's start from 2024/9 backwards
    # Or use current year/month.
    
    current_year = int(time.strftime("%Y"))
    current_month = int(time.strftime("%m"))
    
    # Determine the latest possible quarter
    if current_month >= 11:
         start_period = 9
    elif current_month >= 8: # Q2 usually announced by August
         start_period = 6
    elif current_month >= 5: # Q1 by May
         start_period = 3
    else:
         start_period = 12
         current_year -= 1
         
    # Generate list of 12 periods [ (2024,9), (2024,6), ... ]
    periods = []
    y, p = current_year, start_period
    for _ in range(12):
        periods.append((y, p))
        p -= 3
        if p <= 0:
            p = 12
            y -= 1
            
    # Function to fetch a batch of periods (max 4 usually allowed per request structure)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Referer": "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/Mali-Tablolar.aspx"
    }
    
    # We will merge results into a single structure
    # Structure: { "YYYY/Q": { "Net Satışlar": 123, ... }, ... }
    merged_data = {}
    
    # Is Yatirim default financial group is XI_29 (IFRS). Banks use different codes (XI_29 usually still ok or different path).
    # For simplicity assuming XI_29.
    
    # Helper to map period to index in response (value1, value2, etc.)
    # We prefer making 3 requests of 4 periods each.
    
    chunks = [periods[i:i+4] for i in range(0, len(periods), 4)]
    
    for chunk in chunks:
        url = "https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
        params = {
            "companyCode": symbol,
            "exchange": "TRY",
            "financialGroup": "XI_29",
        }
        for i, (y, p) in enumerate(chunk):
            params[f"year{i+1}"] = y
            params[f"period{i+1}"] = p
            
        try:
            # Construct query string manually to ensure correct order/format if needed, 
            # but requests params usually work.
            response = requests.get(url, params=params, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                # Data is a list of items. Each item has value1, value2, value3, value4 corresponding to the requested periods.
                if not data:
                    continue
                    
                # Iterate rows
                for row in data:
                    item_code = row.get("itemCode")
                    item_name = row.get("itemDescTr")
                    
                    if not item_name: continue
                    
                    for i, (y, p) in enumerate(chunk):
                        val_key = f"value{i+1}"
                        val = row.get(val_key)
                        
                        period_key = f"{y}/{p}"
                        if period_key not in merged_data:
                            merged_data[period_key] = {}
                            
                        # Store simple key-value
                        merged_data[period_key][item_name] = val
                        merged_data[period_key][f"{item_name}_code"] = item_code

            time.sleep(0.5) # Be gentle
        except Exception as e:
            print(f"Error fetching chunk {chunk}: {e}")
            
    # Update cache
    if merged_data:
        FINANCIALS_CACHE[symbol] = merged_data
        save_financials(FINANCIALS_CACHE)
        return merged_data
    else:
        return {}

def get_stored_financials(symbol):
    symbol = symbol.replace(".IS", "").upper()
    return FINANCIALS_CACHE.get(symbol)
