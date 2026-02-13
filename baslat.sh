#!/bin/bash

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Bilgisayarının Yerel IP Adresini otomatik bulalım
MY_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)

echo -e "${BLUE}=== PhD TERMİNAL Wi-Fi Modu ===${NC}"
echo -e "${GREEN}Bağlantı Linki: http://$MY_IP:3000${NC}"
echo -e "${BLUE}Arkadaşların bu linki tarayıcılarına yapıştırabilir.${NC}"

BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Temizlik
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null

# Backend'i başlat (0.0.0.0 ile her yerden erişime açıyoruz)
cd "$BASE_DIR/backend"
python3 main.py > "$BASE_DIR/backend.log" 2>&1 &

# Frontend'i başlat (--host ile dışarıya açıyoruz)
cd "$BASE_DIR/frontend"
npm run dev -- --host 0.0.0.0
