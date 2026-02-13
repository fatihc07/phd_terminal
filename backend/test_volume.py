import yfinance as yf
import requests
import re

def check_google(symbol):
    print(f"--- Checking Google for {symbol} ---")
    search_symbol = symbol.replace(".IS", "")
    url = f"https://www.google.com/finance/quote/{search_symbol}:IST"
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        html = response.text
        print(f"Status: {response.status_code}")
        
        # Test Regex
        m_v = re.search(r'(?:Volume|Hacim)</div>[^<]*<div[^>]*>([\d.,]+[KMB]?)</div>', html, re.IGNORECASE)
        if m_v:
            print(f"Regex Match: {m_v.group(1)}")
        else:
            print("Regex No Match")
            # Let's print a snippet around "Volume" or "Hacim" if found
            idx = html.find("Volume")
            if idx == -1: idx = html.find("Hacim")
            if idx != -1:
                print(f"Snippet: {html[idx:idx+200]}")
    except Exception as e:
        print(f"Error: {e}")

def check_yfinance(symbol):
    print(f"--- Checking YFinance for {symbol} ---")
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="5d")
        if not hist.empty:
            print(hist[['Close', 'Volume']].tail())
            last = hist.iloc[-1]
            print(f"Last Volume: {last['Volume']}")
        else:
            print("History empty")
    except Exception as e:
        print(f"Error: {e}")

check_google("THYAO")
check_yfinance("THYAO.IS")
