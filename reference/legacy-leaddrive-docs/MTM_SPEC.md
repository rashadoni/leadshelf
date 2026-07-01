# MTM — Mobile Team Management
## Full System Specification v1.0

**Şirkət:** Guven Technology MMC
**Tarix:** 17 Mart 2026
**Müəllif:** Rashad Rahimsoy
**Status:** Active Development

---

## 1. Layihənin Məqsədi

Sahə komandalarının (satış, xidmət, çatdırılma) idarə edilməsi üçün kross-platforma sistem.
Azərbaycan və region bazarı üçün nəzərdə tutulub.

**Hədəf istifadəçilər:**
- Əczaçılıq şirkətləri (ZeytunPharma kimi)
- FMCG distribyutorlar
- Telekommunikasiya sahə komandaları
- İstənilən sahə agentləri olan biznes

**Rəqib:** Azercell MTM (ServicePortal Standard v5.2.0) — yalnız web-portal, mobil yoxdur.

---

## 2. Sistem Arxitekturası

### 2.1 Platformalar

| Platforma | Texnologiya | Məqsəd |
|-----------|-------------|--------|
| Admin Panel (Web) | Next.js 14+ App Router, Tailwind CSS, shadcn/ui | Menecerlər/adminlər üçün web panel |
| Mobil Tətbiq | React Native + Expo SDK 52+ | Sahə agentləri üçün iOS/Android |
| Backend | Firebase (Firestore, Auth, Storage, Functions, FCM) | Cloud infrastruktur |

### 2.2 İstifadəçi Rolları

| Rol | Platforma | Səlahiyyətlər |
|-----|-----------|---------------|
| Super Admin | Web | Bütün sistem, şirkətlər, modullar, parametrlər |
| Admin | Web | Bir şirkət daxilində tam idarə |
| Menecer | Web + Mobil | Dashboard, hesabatlar, xəritə, tapşırıq yaratma |
| Sahə Agenti | Mobil | Marşrut, check-in/out, foto, formlar, tapşırıq icra |

---

## 3. Admin Panel Modulları (Web)

### 3.1 Dashboard
- KPI kartları: planlanan/tamamlanan rut, rutdan kənar, tamamlanmamış tapşırıq
- Vaxt metriklər: ümumi rut vaxtı, ortalama, müştəri vaxtı
- Foto statistikası: bütün şəkillər, bəyənilmiş, bəyənilməmiş, rəy verilməmiş
- Aşağı batareyalı istifadəçilər monitorinqi
- **YENI:** Xətli trend qrafikləri (Recharts)
- **YENI:** KPI hədəf vs fakt müqayisə (progress bar)
- **YENI:** Period müqayisəsi (keçən həftə vs bu həftə)
- **YENI:** Pie-chart-lar, bar-chart-lar
- Filtrlər: günlük, həftəlik, aylıq, illik

### 3.2 Canlı Xəritə (Live Map)
- **YENI:** Bütün agentlərin real vaxt mövqeyi Google Maps-da
- **YENI:** Status rəngləri: yaşıl=check-in, mavi=yolda, qırmızı=gecikir, boz=offline
- **YENI:** Heat-map: ziyarət sıxlığı
- **YENI:** Marşrut replay: agentin gün ərzində getdiyi yol
- **YENI:** Geofence zonalarının vizualizasiyası
- Agent profil popup: ad, son aktivlik, batareya, sürət

### 3.3 Marşrut Planlayıcı
- **YENI:** Həftəlik/günlük marşrut planlaşdırma
- **YENI:** Drag-and-drop ilə noqtə sıralama
- **YENI:** AI optimal marşrut (Google Directions API)
- **YENI:** Kalendar görünüşü
- **YENI:** Şablon marşrutlar (təkrarlanan)
- Agent və müştəri təyinatı
- Tapşırıq əlavə etmə hər noqtəyə

### 3.4 Hesabatlar
Azercell-dən mövcud olan + yeniliklər:

**Tapşırıq Nəticələri:** Firma, tapşırıq adı, yaradan, keçərlilik/yaradılma tarixi, status filtrləri.
**Günlük İş Planı Statistikası:** İstifadəçilər üzrə ziyarət sayı, rut tamamlama, vaxt.
**Gündəlik İşlər:** Əməkdaş iş qeydləri, başlama/bitmə vaxtı, xəritə linki.
**Gündəlik Əməliyyatlar:** Əməliyyat növü, status, müştəri kodu/adı, tapşırıq.
**Müştəri Ziyarət Statistikası:** Ziyarət tezliyi, son ziyarət, ziyarət olunmamış müştərilər.
**Dinamik Hesabatlar:** Əsas və detallı günlük hesabat, rut faizi, ümumi faiz.

- **YENI:** PDF ixracı
- **YENI:** Avtomatik email göndərmə (schedule)
- **YENI:** Şablon filtrləri saxlama
- **YENI:** Period müqayisə hesabatları
- Excel ixracı (mövcud Azercell-dən)

### 3.5 Foto Hesabatlıq
Azercell-dən mövcud olan + yeniliklər:

**Foto Qalereya:** Şəkil kartları, bəyənmə/bəyənməmə, yeni tapşırıq yaratma.
**Bəyənmə Statistikası:** Bəyənilmiş/bəyənilməmiş/rəy verilməmiş sayları.
**Rəy Statistikası:** Menecer rəylərinin statistikası.
**Müqayisəli Qalereya:** Yaradıcı vs icraatçı, əvvəlki ziyarətlə müqayisə.

- **YENI:** Watermark yoxlaması (GPS, vaxt, agent adı şəkildə)
- **YENI:** AI keyfiyyət yoxlaması (bulanıq, qaranlıq foto aşkarlanması)
- **YENI:** Toplu bəyənmə/rəy

### 3.6 İstifadəçi İdarəsi
- Rol sistemi (super_admin, admin, menecer, agent)
- İcazə matrisi (modul bazalı)
- Şirkət/filial strukturu
- **YENI:** Cihaz idarəsi (agent hansı cihazı istifadə edir)
- **YENI:** Audit trail (kim nə vaxt dəyişib)
- **YENI:** Agent aktivlik tarixi

### 3.7 Bildiriş Sistemi (Admin tərəf)
- **YENI:** Anomaliya alertləri paneli
- **YENI:** Bildiriş konfiqurasiyası (hansı alertlər aktiv)
- **YENI:** Telegram bot əlaqəsi
- **YENI:** Alert tarixçəsi

### 3.8 Gamification + KPI (Admin tərəf)
- **YENI:** KPI hədəfləri təyin etmə (agent/komanda üçün)
- **YENI:** Liderlik cədvəli görünüşü
- **YENI:** Mükafat sistemi konfiqurasiyası
- **YENI:** Agent reytinq kartları

### 3.9 Parametrlər
- Şirkət profili, logo, rənglər
- Geofence radius parametri (default 100m)
- GPS tracking intervalı (default 30 san)
- Foto sıxışdırma keyfiyyəti
- Watermark parametrləri
- 1C/ERP inteqrasiya parametrləri
- SMS/Email gateway parametrləri

---

## 4. Mobil Tətbiq Modulları (React Native)

### 4.1 Giriş + Auth
- Email/telefon ilə giriş
- Firebase Auth
- Biometric giriş (Face ID, fingerprint)
- Auto-logout timeout
- Pin kod (offline giriş üçün)

### 4.2 Marşrut Görünüşü
- Günün marşrutu xəritədə (Google Maps)
- Noqtələr siyahısı (kartlar)
- Naviqasiya (Google/Waze/Apple Maps)
- Məsafə və vaxt hesabı
- "Günə Başla" düyməsi → GPS tracking başlayır

### 4.3 Check-in / Check-out
- Geofence əsaslı avtomatik check-in imkanı
- GPS koordinatı, vaxt stamp qeydiyyatı
- Uzaqda olsa — səbəb soruşma + manual icazə
- Ziyarət timer
- QR kod skanlama (optional check-in)
- GPS spoofing aşkarlanması (mock location detection)

### 4.4 Foto + Media
- Kamera ilə foto çəkmə
- Avtomatik watermark: GPS, tarix/vaxt, agent adı, şirkət logo
- Şəkil sıxışdırma (quality/size balance)
- Çoxlu foto (before/after)
- Səs qeydi (30 san max, ziyarət xülasəsi)
- QR/barkod skanlama
- Galereyadan şəkil seçmə bloku (yalnız kamera)

### 4.5 Formlar + Tapşırıqlar
- Dinamik formlar (admin-dən konfiqurasiya olunan)
- Tapşırıq icrası (checkbox, foto əlavə, qeyd)
- Sifariş yaratma (1C-yə sync)
- Müştəri qeydləri
- Əvvəlki ziyarət tarixçəsi

### 4.6 Offline Rejim
- WatermelonDB / AsyncStorage ilə local data
- Offline queue: check-in, foto, form, tapşırıq
- Internet gəldikdə avtomatik sync
- Conflict resolution strategiyası
- Offline üçün cached xəritə tiles (opsional)

### 4.7 Bildirişlər (Mobil)
- FCM Push bildirişlər
- Yeni marşrut bildirişi
- Menecer rəyi/bəyənməsi bildirişi
- Gecikme xəbərdarlığı
- Gün xülasəsi bildirişi

### 4.8 Gün Xülasəsi
- Ziyarət sayı (plan vs fakt)
- Foto sayı
- Ümumi vaxt
- KPI faizi
- Gamification xalları
- "Günü Bitir" düyməsi → GPS dayanır

---

## 5. Backend (Firebase)

### 5.1 Firestore Kolleksiyaları

```
companies/{companyId}
  - name, logo, settings, createdAt

companies/{companyId}/users/{userId}
  - email, name, role, phone, avatar, deviceInfo, status

companies/{companyId}/customers/{customerId}
  - code, name, address, location{lat,lng}, group, contactPerson, phone

companies/{companyId}/routes/{routeId}
  - agentId, date, status, points[], createdBy, createdAt

companies/{companyId}/visits/{visitId}
  - agentId, customerId, routeId, checkInTime, checkOutTime
  - checkInLocation{lat,lng}, checkOutLocation{lat,lng}
  - duration, status, photos[], tasks[], notes

companies/{companyId}/tasks/{taskId}
  - name, description, assignedTo, customerId, status
  - createdBy, dueDate, completedAt, result

companies/{companyId}/photos/{photoId}
  - visitId, agentId, customerId, url, thumbnailUrl
  - location{lat,lng}, timestamp, watermarkData
  - likeStatus (liked/disliked/pending), review, reviewedBy

companies/{companyId}/locations/{locationId}
  - agentId, lat, lng, timestamp, accuracy, speed, battery

companies/{companyId}/alerts/{alertId}
  - type, agentId, message, severity, createdAt, resolved

companies/{companyId}/reports/{reportId}
  - type, parameters, generatedAt, fileUrl
```

### 5.2 Cloud Functions
- `onVisitCreate` — real-time dashboard update
- `aggregateDailyStats` — gündəlik statistika hesablama
- `checkAnomalies` — anomaliya aşkarlanması (gecikir, uzun dayanma)
- `sendAlerts` — push/Telegram/SMS alert göndərmə
- `compressPhoto` — yüklənmiş şəkilləri sıxışdırma + thumbnail
- `generateReport` — PDF hesabat yaratma
- `syncTo1C` — 1C/ERP inteqrasiya endpoint

### 5.3 Security Rules
- Hər istifadəçi yalnız öz şirkət datasına müraciət edə bilir
- Agent yalnız öz məlumatlarını yaza bilir
- Menecer oxuya bilir, bəzi yerlərdə yaza bilir
- Admin tam icazə (şirkət daxilində)

---

## 6. Rəqib Müqayisəsi (Azercell MTM Audit)

| Funksiya | Azercell MTM | Bizim MTM |
|----------|-------------|-----------|
| Web portal hesabatlar | ✅ | ✅ |
| Excel ixracı | ✅ | ✅ |
| Foto qalereya + bəyənmə | ✅ | ✅ |
| Azərbaycan dili | ✅ | ✅ |
| Mobil nativ tətbiq | ❌ | ✅ |
| Canlı xəritə (live map) | ❌ | ✅ |
| GPS tracking (arxa fon) | ❌ | ✅ |
| Geofencing check-in/out | ❌ | ✅ |
| Offline rejim | ❌ | ✅ |
| Push bildirişlər | ❌ | ✅ |
| Foto watermark | ❌ | ✅ |
| AI marşrut optimizasiyası | ❌ | ✅ |
| KPI hədəfləri + gamification | ❌ | ✅ |
| 1C/ERP inteqrasiya | ❌ | ✅ |
| Qrafik/diaqramlı dashboard | ❌ | ✅ |
| PDF/Email avtomatik hesabat | ❌ | ✅ |
| Telegram/WhatsApp bildirişlər | ❌ | ✅ |
| QR/barkod skan | ❌ | ✅ |
| Səs qeydləri | ❌ | ✅ |
| Audit trail | ❌ | ✅ |

**Azercell MTM-də aşkar olunan BUG:** "Müştəri ziyarət statistikası" səhifəsi daxili xəta verir.

---

## 7. İnkişaf Fazaları

### Phase 0 — Setup (1 həftə)
- [x] Layihə spesifikasiyası
- [x] Azercell audit + workflow
- [ ] Next.js + Tailwind + Firebase setup
- [ ] Repo strukturu
- [ ] CI/CD pipeline

### Phase 1a — Admin Panel Core (2 həftə)
- [ ] Auth + rol sistemi
- [ ] Sidebar layout + naviqasiya
- [ ] Dashboard (KPI kartları + qrafiklər)
- [ ] İstifadəçi idarəsi CRUD

### Phase 1b — Admin Panel Hesabatlar (2 həftə)
- [ ] Tapşırıq nəticələri
- [ ] Günlük iş planı statistikası
- [ ] Gündəlik işlər
- [ ] Gündəlik əməliyyatlar
- [ ] Müştəri ziyarət statistikası
- [ ] Dinamik hesabatlar
- [ ] Excel/PDF ixrac

### Phase 1c — Admin Panel Xəritə + Foto (2 həftə)
- [ ] Canlı xəritə (Google Maps)
- [ ] Agent tracking görünüşü
- [ ] Foto qalereya
- [ ] Bəyənmə/rəy sistemi
- [ ] Müqayisəli qalereya

### Phase 1d — Admin Panel Planlaşdırma (1 həftə)
- [ ] Marşrut planlayıcı
- [ ] Drag-and-drop
- [ ] Kalendar görünüşü
- [ ] Tapşırıq yaratma

### Phase 1e — Mobil Tətbiq Core (3 həftə)
- [ ] Expo setup
- [ ] Auth + biometric
- [ ] Marşrut görünüşü + xəritə
- [ ] Check-in/out + geofencing
- [ ] Foto + watermark
- [ ] Offline rejim

### Phase 1f — Polish + Test (1 həftə)
- [ ] Bug fix
- [ ] Performance optimizasiya
- [ ] UI polish
- [ ] Test (manual + unit)

### Phase 2 — Genişlənmə
- [ ] 1C/ERP inteqrasiya
- [ ] Telegram bot
- [ ] AI marşrut optimizasiyası
- [ ] Gamification
- [ ] Səs qeydləri + AI xülasə

---

## 8. UI/UX Prinsipləri

- **Dark + Light tema** dəstəyi (toggle ilə)
- **Azərbaycan + Rus + İngilis** dil dəstəyi
- **Responsive:** Desktop (1200px+), Tablet (768-1199px), Mobil (320-767px)
- **Accessibility:** WCAG 2.1 AA uyğunluq
- **Rəng paleti:**
  - Primary: #6C63FF (Accent purple)
  - Secondary: #00BFA6 (Teal/green)
  - Warning: #FFC107
  - Danger: #E74C3C
  - Neutrals: #0B0B1E (dark bg) / #F4F5F9 (light bg)
- **Font:** Inter (Google Fonts)
- **İconlar:** Lucide React
- **Komponentlər:** shadcn/ui

---

## 9. Texniki Tələblər

- Node.js 18+
- Next.js 14+ (App Router)
- TypeScript (strict mode)
- Tailwind CSS 3.4+
- Firebase SDK 10+
- React Native / Expo SDK 52+
- Minimum dəstəklənən: iOS 15+, Android 10+
- Brauzer: Chrome 90+, Safari 15+, Firefox 90+, Edge 90+
