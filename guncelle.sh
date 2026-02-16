s#!/bin/bash

echo "♻️  Ecos Otomatik Güncelleme Aracı Başlatılıyor..."
echo "------------------------------------------------"

# Scriptin olduğu dizine git (böylece her yerden çalıştırılabilir)
cd "$(dirname "$0")"

# Git durumunu kontrol et (Değişiklik var mı?)
if [ -z "$(git status --porcelain)" ]; then 
  echo "⚠️  Herhangi bir değişiklik bulunamadı. Gönderilecek bir şey yok."
  exit 0
fi

# 1. Tüm değişiklikleri ekle
echo "📦 Dosyalar ekleniyor..."
git add .

# 2. Tarihli bir commit mesajı oluştur
TARIH=$(date "+%d.%m.%Y %H:%M:%S")
MESAJ="Otomatik Güncelleme: $TARIH"

echo "💾 Commit oluşturuluyor: '$MESAJ'"
git commit -m "$MESAJ"

# 3. GitHub'a (origin main) gönder
echo "🚀 GitHub'a gönderiliyor..."
git push origin main

# Sonuç kontrolü
if [ $? -eq 0 ]; then
  echo "------------------------------------------------"
  echo "✅ İŞLEM BAŞARILI!"
  echo "🌐 Kodlarınız GitHub'a yüklendi. Netlify build işlemi otomatik olarak başlayacaktır."
else
  echo "------------------------------------------------"
  echo "❌ HATA OLUŞTU!"
  echo "Lütfen internet bağlantınızı kontrol edin veya 'git pull' yapıp çakışmaları çözün."
fi
