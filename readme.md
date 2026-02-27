# 🏷️ Twitter/X User Stats Badges

Twitter/X'te kullanıcı adlarının yanına **tweet sayısı**, **takipçi sayısı**, **hesap açılış tarihi** ve **Credibility DNA skoru** badge'leri ekleyen; status sayfalarında da **Raid Radar** analizi yapan Chrome extension.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

<!-- Buraya ekran görüntüsü ekle -->
<!-- ![Screenshot](./screenshots/demo.png) -->

## Ne İşe Yarar?

Twitter'da bir takipçi listesine, timeline'a veya profil kartına baktığında her `@kullaniciadi`'nın yanında şu bilgileri görürsün:

| Badge | Bilgi | Renk |
|-------|-------|------|
| 📝 12.5K | Tweet sayısı | 🟠 Turuncu |
| → 1.2K | Takipçi sayısı | 🔵 Mavi |
| 📅 Ağu 2008 | Hesap açılış tarihi | 🟢 Yeşil |
| 🧬 78 | Credibility DNA (0-100) | 🟩/🟨/🟥 |

Böylece bir kullanıcıya bakar bakmaz hesabın ne kadar aktif olduğunu, ne zaman açıldığını, kaç takipçisi olduğunu ve hesap güvenilirlik sinyalini görebilirsin — her seferinde profile tıklamana gerek kalmaz.

Status (`/status/...`) sayfalarında ise sağ altta çıkan **Raid Radar** paneli ile görünür reply hesaplarının toplu risk sinyalini görürsün.

## Kurulum

### 1. Repoyu indir

```bash
git clone https://github.com/radioheavy/twitter-stats-badges.git
```

ya da **Code → Download ZIP** ile indir ve bir klasöre çıkart.

### 2. Chrome'a yükle

1. Chrome'da `chrome://extensions` adresine git
2. Sağ üst köşeden **Geliştirici modu**'nu aç
3. **"Paketlenmemiş öğe yükle"** butonuna tıkla
4. İndirdiğin klasörü seç

### 3. Kullan

Twitter/X'e git, herhangi bir takipçi listesini veya timeline'ı aç. Badge'ler otomatik olarak görünecek.

## Nasıl Çalışır?

```
Sayfa yüklendi
    ↓
MutationObserver sayfayı izliyor
    ↓
@kullaniciadi linkleri tespit ediliyor
    ↓
Twitter GraphQL API'ye istek atılıyor (kendi session'ınla)
    ↓
Gelen veri badge olarak DOM'a inject ediliyor
    ↓
10 dakika cache'te tutuluyor
```

### Credibility DNA nasıl hesaplanır?

- Hesap yaşı
- Takipçi/takip dengesi
- Aktivite yoğunluğu (tweet/gün)
- Profil sinyalleri (doğrulama, default profil fotoğrafı vb.)
- Anormal davranış cezaları

Sonuç 0-100 arası tek bir skor olarak gösterilir.

### Raid Radar nasıl çalışır?

- Sadece status sayfalarında çalışır
- Görünen reply hesaplarından örnek alır
- Yeni açılmış hesap oranı, düşük DNA oranı ve açılış dönemi kümelenmesini ölçer
- Sonucu `Temiz / İzlemede / Orta / Yüksek` risk olarak panelde gösterir

Extension, Twitter'ın kendi internal GraphQL API'sini (`UserByScreenName` endpoint'i) kullanır. Ekstra API key veya token gerekmez — zaten Twitter'a giriş yapmış olduğun session cookie'n (`ct0`) ile çalışır.

## Dosya Yapısı

```
twitter-stats-badges/
├── manifest.json    # Chrome MV3 extension tanımı
├── content.js       # Ana script — tüm logic burada
├── icon48.png       # Extension ikonu (48x48)
├── icon128.png      # Extension ikonu (128x128)
└── README.md
```

## Ayarlar

`content.js` dosyasının başındaki config değerlerini ihtiyacına göre değiştirebilirsin:

```javascript
const CACHE_TTL = 10 * 60 * 1000;  // Cache süresi (varsayılan: 10 dakika)
const BATCH_DELAY = 300;            // İstekler arası bekleme (ms)
const DEBUG = true;                 // Console logları (true/false)
```

**Debug modu** açıkken tarayıcı Console'unda `[TW-Stats]` etiketiyle detaylı loglar görebilirsin:

```
[TW-Stats] 🚀 Twitter Stats Badges v1.0 başlatılıyor...
[TW-Stats] 🔎 5 kullanıcı bulundu
[TW-Stats] ✅ OK: ersinkoc (4.5K takipçi)
[TW-Stats] 📦 Cache: arda_cavdar
```

## Sık Sorulan Sorular

**Tampermonkey gerekli mi?**
Hayır. Bu standalone bir Chrome extension, Tampermonkey'e ihtiyaç duymaz.

**API key gerekiyor mu?**
Hayır. Twitter'a giriş yaptığın session cookie'ni kullanır.

**Rate limit'e takılır mıyım?**
Extension istekler arasında 300ms bekler ve 10 dakika cache tutar. Normal kullanımda rate limit'e takılmazsın. Yine de 429 hatası alınırsa otomatik olarak 60 saniye bekler.

**Neden bazı kullanıcılarda badge görünmüyor?**
Askıya alınmış veya gizli hesaplarda API veri döndürmez, bu durumda badge eklenmez.

**GraphQL hash değişirse ne olur?**
Twitter API endpoint hash'ini (`xc8f1g7BYqr6VTzTbvNlGw`) zaman zaman değiştirebilir. Çalışmayı durdurursa bu hash'i güncellemeniz gerekebilir. Güncel hash'i bulmak için Twitter'da bir profil açıp DevTools Network sekmesinde `UserByScreenName` araması yapabilirsiniz.

## Bilinen Sınırlamalar

- Twitter GraphQL endpoint hash'i değişebilir — güncelleme gerekebilir
- Çok hızlı scroll edildiğinde bazı kullanıcılar atlanabilir (sayfa güncellenince yakalanır)
- Sadece `@kullaniciadi` formatında görünen linklerde çalışır

## Katkıda Bulunma

PR'lar ve issue'lar açıktır. Katkıda bulunmak istersen:

1. Bu repoyu fork'la
2. Feature branch oluştur (`git checkout -b yeni-ozellik`)
3. Değişiklikleri commit'le (`git commit -m 'Yeni özellik eklendi'`)
4. Branch'i push'la (`git push origin yeni-ozellik`)
5. Pull Request aç

## Yapılabilecekler

- [x] Credibility DNA (0-100) badge skoru
- [x] Status sayfaları için Raid Radar paneli
- [ ] Takip edilen (following) sayısını da gösterme opsiyonu
- [ ] Badge renklerini ve görünümünü özelleştirme paneli (popup)
- [ ] Firefox desteği
- [ ] Badge'lere tıklayınca profil popup'ı gösterme
- [ ] Hesap yaşı hesaplama (ör. "16 yıllık hesap")

## Lisans

MIT — istediğin gibi kullan, değiştir, dağıt.

## İlham

[Ersin Koç](https://x.com/ersinkoc)'un Tampermonkey scripti fikrinden ilham alınmıştır.
