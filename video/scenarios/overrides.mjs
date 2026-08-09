/**
 * Hand-authored guide scenarios for LeadShelf (ported pipeline from leaddrive-v2).
 * scripts/produce-guides.mjs loads this file; shape is identical to the reference:
 *
 *   export default { "<slug>": { route, title{az,ru}, scenes:[
 *     { voice:{az,ru}, do: async (page, lang, h) => { ... } } ] } }
 *
 * LeadShelf specifics vs the reference:
 *  - Locales az/ru ONLY (no `en` in src/i18n/routing.ts) — voice maps have 2 keys.
 *  - Routes are locale-prefixed (`localePrefix: "always"`): recorder opens
 *    `${baseUrl}/${lang}${route}`; `route` here stays locale-less.
 *  - `h.ensureCursor()` (LeadShelf addition): re-inject cursor after real
 *    click-navigation. The recorder must also REFRESH the session cookies
 *    periodically — ls_access lives 15 min and this film runs ~20-30 min.
 *
 * overview — FULL-CYCLE FILM (~51 scenes, ≥20 min narration): Panel → Catalog
 * (search, quality filters, inline dims, create form, CSV import) → Equipment
 * constructor (live shelf preview) → Stores (detail: readiness, photo control)
 * → Floor plans → Planogram editor (workbench, facings, zones, auto-placement,
 * 3D, version history, publish) → GOLDEN REFERENCE (how the etalon is created
 * from an approved photo + SKU slots) → Tasks (lifecycle, detail) → Field force
 * (WHERE AGENT PHOTOS COME FROM: mobile app, check-in, offline sync; map,
 * routes, agents, leaderboard) → Photo reviews (AI vision pipeline, comparison
 * tabs, outcomes, human decisions) → Orders (field orders, sync health) →
 * Analytics (shelf execution, linear meters, over/under-spaced, like-for-like)
 * → back to Panel.
 *
 * MUTATION RULES (safe against the live demo tenant, no ALLOW_MUTATIONS):
 * forms are filled but NEVER submitted; approve/reject/save/publish/run-auto
 * buttons are hovered, NEVER clicked. Real clicks are only navigation, GET
 * filters and client-side tabs/view switches.
 *
 * Timing: beats use h.holdUntil(fraction) — never fixed sleeps. Last ≤0.92.
 * Selectors from apps/web source + messages az/ru; text selectors list both
 * locales. LIVE probe against the demo stand REQUIRED before recording.
 */

// ── sidebar navigation (locale-prefixed hrefs, $= matches both locales) ─────
// :visible is REQUIRED: the aside holds a hidden mobile nav grid FIRST in the
// DOM (overview/tasks/field-force/orders duplicated) — without :visible,
// .first() grabs the invisible mobile link and the click times out.
const NAV_EQUIP = ["aside a[href$='/equipment-library']:visible"];
const NAV_STORES = ["aside a[href$='/stores']:visible"];
const NAV_FLOOR = ["aside a[href$='/floor-plans']:visible"];
const NAV_PLANO = ["aside a[href$='/planograms']:visible"];
const NAV_TASKS = ["aside a[href$='/tasks']:visible"];
const NAV_FF = ["aside a[href$='/field-force']:visible"];
const NAV_REVIEWS = ["aside a[href$='/reviews']:visible"];
const NAV_ORDERS = ["aside a[href$='/orders']:visible"];
const NAV_ANALYTICS = ["aside a[href$='/analytics']:visible"];

// ── panel ────────────────────────────────────────────────────────────────────
const OV_TITLE = ["main h1"];
const OV_HERO_PLANO = ["main a[href*='/planograms/']", "main h1"];
const OV_KPI_PRODUCTS = ["main :text('Aktiv məhsullar')", "main :text('Активные товары')"];
const OV_KPI_PHOTO = ["main :text('Foto təsdiqlər')", "main :text('Фото-подтверждения')"];
const OV_FLOW_CATALOG = ["main a[href$='/catalog']"];
const OV_FLOW_REVIEW = ["main a[href$='/reviews']"];

// ── catalog ──────────────────────────────────────────────────────────────────
const CAT_SEARCH = ["main input[name='q']"];
const CAT_CREATE_FORM = ["[data-tour-id='catalog-create-form']"];
const CAT_CREATE_SKU_STABLE = ["[data-tour-id='catalog-create-sku']"];
const CAT_CREATE_NAME_STABLE = ["[data-tour-id='catalog-create-name']"];
const CAT_CREATE_BARCODE_STABLE = ["[data-tour-id='catalog-create-barcode']"];
const CAT_CREATE_SUBMIT_STABLE = ["[data-tour-id='catalog-create-submit']"];
const CAT_FILTERS = ["[data-tour-id='catalog-filters']"];
const CAT_TABLE = ["[data-tour-id='catalog-table']"];
const CAT_FILTER_DIMS = [
  "main label:has-text('Ölçüsüz')", "main label:has-text('Без размеров')",
  "main input[name='missingDimensions']",
];
const CAT_APPLY = ["main button:has-text('Tətbiq et')", "main button:has-text('Применить')"];
const CAT_RESET = ["main button:has-text('Sıfırla')", "main button:has-text('Сбросить')", "main a:has-text('Sıfırla')", "main a:has-text('Сбросить')"];
// The dims cell shows "250×120×80" (or "⚠ <edit>") — the localized label lives
// in the button's title attribute, so match by [title] (verified on source).
const CAT_DIMS_EDIT = ["main button[title='Ölçüləri düzəlt']", "main button[title='Править размеры']"];
const CAT_DIMS_CANCEL = ["main button:has-text('Ləğv et')", "main button:has-text('Отмена')"];
const CAT_CREATE_SKU = ["main input[placeholder='SKU']"];
const CAT_CREATE_NAME = ["main input[placeholder='Ad']", "main input[placeholder='Название']"];
const CAT_CREATE_BTN = ["main button:has-text('Məhsul yarat')", "main button:has-text('Создать товар')"]; // hover only
const CAT_TAB_IMPORT = ["main a:has-text('İdxal')", "main a:has-text('Импорт')"];
const CAT_TAB_QUALITY = ["main a:has-text('Data keyfiyyəti')", "main a:has-text('Качество данных')"];
const CAT_TAB_PRODUCTS_STABLE = ["[data-tour-id='catalog-tab-products']"];
const CAT_TAB_IMPORT_STABLE = ["[data-tour-id='catalog-tab-import']"];
const CAT_TAB_QUALITY_STABLE = ["[data-tour-id='catalog-tab-quality']"];
const CAT_IMPORT_FORM = ["[data-tour-id='catalog-import-form']"];
const CAT_IMPORT_ENTITY = ["[data-tour-id='catalog-import-entity']"];
const CAT_IMPORT_ENCODING = ["[data-tour-id='catalog-import-encoding']"];
const CAT_IMPORT_FILE = ["[data-tour-id='catalog-import-file']"];
const CAT_IMPORT_SUBMIT = ["[data-tour-id='catalog-import-submit']"];
const CAT_QUALITY_CARDS = ["[data-tour-id='catalog-quality-cards']"];
const CAT_QUALITY_IMPORTS = ["[data-tour-id='catalog-quality-imports']"];

// ── equipment ────────────────────────────────────────────────────────────────
const EQ_NEW = [
  "main a[href$='/equipment-library/new']",
  "main :text('Yeni avadanlıq')", "main :text('Новое оборудование')",
];
const EQ_TABLE = ["main table", "main"];
const EQ_NAME = ["main input:not([type='number']):not([type='checkbox'])"]; // 'Ad' label unsafe: substring of 'Avadanlıq'
const EQ_SHELF_COUNT = ["main label:has-text('Rəf sayı') input", "main label:has-text('Количество полок') input"];
const EQ_HOOKS = ["main :text('Hörüklər')", "main :text('Ячейки и крючки')", "main :text('Qarmaq')", "main form"];
const EQ_PREVIEW = ["main svg", "main :text('Öncədən baxış')", "main :text('Предпросмотр')"];
const EQ_SAVE = ["main button:has-text('Kitabxanaya saxla')", "main button:has-text('Сохранить в библиотеку')"]; // hover only

// ── stores ───────────────────────────────────────────────────────────────────
const ST_CARDS = ["main :text('Cəmi nöqtə')", "main :text('Всего точек')"];
const ST_TABLE = ["main table", "main"];
const ST_ROW = ["main a[href*='/stores/']"];
const ST_QUALITY = ["main :text('Nöqtə hazırlığı')", "main :text('Готовность точки')"];
const ST_PHOTO = ["main :text('Foto nəzarət')", "main :text('Фото-контроль')"];
const ST_FLOOR = ["main :text('Zal planları')", "main :text('Планы зала')", "main"];

// ── floor plans ──────────────────────────────────────────────────────────────
const FP_LIST = ["main h1", "main"];
const FP_ADD_EQ = ["main :text('Avadanlıq əlavə et')", "main :text('Добавить оборудование')", "main"];
const FP_COPY = ["main :text('Nöqtəyə kopyala')", "main :text('Копировать на точку')", "main"];

// ── planograms: list + editor ────────────────────────────────────────────────
const PL_OPEN = ['main a:text-is("Aç")', "main a:has-text('Открыть')"];
const PL_EDITOR_SEARCH = ["main input[placeholder='Məhsul axtar...']", "main input[placeholder='Поиск товара...']"];
const PL_WORKBENCH = ["main :text('İş paneli')", "main :text('Workbench')", "main"];
const PL_FACINGS = ["main :text('Feysinqlər')", "main :text('Фейсинги')", "main canvas", "main"];
const PL_ZONES = ["main :text('Zonalar')", "main :text('Зоны')", "main"];
const PL_AUTO = ["main :text('Avtomatik düzülüş')", "main :text('Автовыкладка')", "main"];
const PL_3D = ["main button:has-text('3D')"];
const PL_CANVAS = ["main canvas", "main svg", "main"];
const PL_HISTORY = ["main :text('Versiya tarixi')", "main :text('История версий')", "main"];
const PL_PUBLISH = ["main button:has-text('Dərc et')", "main button:has-text('Опубликовать')", "main"]; // hover only

// ── golden reference (inside the planogram editor) ───────────────────────────
// The demo planogram HAS a fully-annotated golden reference (verified live:
// 7/7 slots, BEV-* zones on the photo, bindings list). The chapter CLICKS the
// editor's "Etalon foto" view tab (client-side, safe on published) and tours
// the real zones + coverage + bindings.
const GR_TAB = ["main button:has-text('Etalon foto')", "main button:has-text('Эталон фото')"]; // views.reference.title (NOT goldenReference)
const GR_ZONE = ["main :text('BEV-101 zonası')", "main :text('Зона BEV-101')", "main :text('zonası')", "main :text('Зона BEV')", "main img"];
const GR_COVERAGE = ["main :text('əhatə edir')", "main :text('закрывает')", "main"];
const GR_CANDIDATES = ["main :text('Аптека №1')", "main img", "main"]; // photo candidates carry store names (data, locale-independent)
const GR_BINDINGS = ["main :text('Lipton')", "main :text('Pepsi')", "main"]; // SKU binding list (data names)

// ── tasks ────────────────────────────────────────────────────────────────────
const TASK_FILTER_PHOTO = ["main a[href*='PHOTO_SUBMITTED']", "main"];
const TASK_FILTER_ALL = ["main a:text-is('Hamısı')", "main a:text-is('Все')", "main a[href$='/tasks']"];
const TASK_ROW = ["main a[href*='/tasks/']:visible"]; // :visible skips the hidden mobile-card duplicate
const TASK_HISTORY = ["main :text('Status tarixi')", "main :text('История статусов')"];
const TASK_PHOTOS = ["main :text('Fotolar')", "main :text('Фото')", "main"];
const TASK_COMMENTS = ["main :text('Şərhlər')", "main :text('Комментарии')", "main"];
// Status action buttons depend on the task's current status — fall back to the
// history block so the beat degrades to a meaningful hover instead of <main>.
const TASK_ACCEPT = ["main button:has-text('Qəbul et')", "main button:has-text('Принять')", "main :text('Status tarixi')", "main :text('История статусов')"]; // hover only

// ── field force ──────────────────────────────────────────────────────────────
const FF_TITLE = ["main :text('Marşrut modulu')", "main :text('Маршрутный модуль')", "main h1"];
const FF_TAB_MAP = ["main button:has-text('Xəritə')", "main button:has-text('Карта')"];
const FF_TAB_ROUTES = ["main button:has-text('Marşrutlar')", "main button:has-text('Маршруты')"];
const FF_TAB_AGENTS = ["main button:has-text('Agentlər')", "main button:has-text('Агенты')"];
const FF_TAB_LEADER = ["main button:has-text('Reytinq')", "main button:has-text('Лидерборд')"];
const FF_TAB_ACTIVITY = ["main button:has-text('Aktivlik')", "main button:has-text('Активность')"];
const FF_TAB_REPORTS = ["main button:has-text('Hesabatlar')", "main button:has-text('Отчёты')"];
const FF_MAP = [".leaflet-container", "main canvas", "main"];

// ── reviews ──────────────────────────────────────────────────────────────────
const RV_DASH = ["main :text('Orta score')", "main :text('Средний score')", "main"];
const RV_GOLDEN = ["main :text('Etalon')", "main :text('Эталон')"];
const RV_TAB_SCHEME = ["main button:has-text('Sxem'):visible", "main button:has-text('Схема'):visible"];
const RV_TAB_PHOTO = ['main button:text-is("Foto"):visible', 'main button:text-is("Фото"):visible'];
const RV_TAB_RESULT = ["main button:has-text('Nəticə'):visible", "main button:has-text('Результат'):visible"];
const RV_MODE_GOLDEN = ['main button:text-is("Etalon"):visible', 'main button:text-is("Эталон"):visible', "main button:has-text('Fakt'):visible", "main button:has-text('Факт'):visible"];
const RV_MODE_OVERLAY = ["main button:has-text('Konturlar'):visible", "main button:has-text('Контуры'):visible"];
const RV_APPROVE = ["main button:has-text('Qəbul et')", "main button:has-text('Принять')"]; // hover only
const RV_RETAKE = ["main button:has-text('Yenidən çəkiliş')", "main button:has-text('пересъёмку')"]; // hover only
const RV_REJECT = ["main button:has-text('Rədd et')", "main button:has-text('Отклонить')"]; // hover only

// ── orders ───────────────────────────────────────────────────────────────────
const ORD_SUMMARY = ["main :text('Bütün sifarişlər')", "main :text('Всего заказов')", "main"];
const ORD_OFFLINE = ["main :text('Mobil cihazdan')", "main :text('С мобильного')", "main"];
const ORD_VISIT = ["main :text('Vizitdən')", "main :text('Из визита')", "main table", "main"];
const ORD_HEALTH = ["main :text('Mobil icra sağlamlığı')", "main :text('Состояние мобильного исполнения')", "main"];

// ── analytics ────────────────────────────────────────────────────────────────
const AN_EXEC_TITLE = ["main :text('Rəfin faktiki icrası')", "main :text('Фактическое исполнение полки')", "main"];
const AN_KPI_METERS = ["main :text('Xətti metr')", "main :text('Линейных метров')", "main"];
const AN_EXECUTIVE = ["main :text('Rəfdə problem nədir')", "main :text('Что не так с полкой')", "main"];
const AN_L4L = ["main :text('Like-for-like')", "main"];
const AN_EXPORT = ["main button:has-text('Excel')", "main"]; // hover only

// After a real click-navigation the injected cursor overlay dies with the old
// document — settle the new page, then re-inject before moving on.
const settleNav = async (page, h) => {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.locator("main h1, main h2, main table").first()
    .waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await h.ensureCursor();
};

const scenarios = {
  overview: {
    route: "/",
    title: { az: "LeadShelf — tam dövrə: kataloqdan yoxlanılmış rəfə", ru: "LeadShelf — полный цикл: от каталога до проверенной полки" },
    scenes: [
      // ═══ ГЛАВА 0 · ПАНЕЛЬ ═══════════════════════════════════════════════
      {
        voice: {
          az: "Salam! Bu — LeadShelf: merçendayzinqin tam idarəetmə sistemi. Bu bələdçi adi qısa icmal deyil — bu gün bütün dövrü əvvəldən axıra qədər keçəcəyik: məhsul kartını yaradacağıq, avadanlıq quracağıq, planoqram redaktorunu, etalon fotonun necə yarandığını görəcəyik, agentin telefonundan fotonun hara gəldiyini, süni intellektin onu necə yoxladığını, sifarişlərin və analitikanın haradan qidalandığını izləyəcəyik. Rahat oturun — başlayırıq Paneldən, sistemin əsas ekranından. Solda on bir bölmədən ibarət menyu var — hamısını görəcəyik.",
          ru: "Здравствуйте! Это LeadShelf — полная система управления мерчандайзингом. Этот гид — не короткий обзор: сегодня мы пройдём весь цикл от начала до конца. Создадим карточку товара, соберём оборудование, разберём редактор планограмм, увидим, как рождается эталонный снимок, куда прилетает фото с телефона агента, как его проверяет искусственный интеллект, и откуда питаются заказы и аналитика. Устраивайтесь удобнее — начинаем с Панели, главного экрана системы. Слева меню из одиннадцати разделов — мы увидим их все.",
        },
        do: async (page, lang, h) => {
          await h.hover(OV_TITLE);
          await h.holdUntil(0.45);
          await h.moveTo([`aside a[href='/${lang}']:visible`, "aside nav a"]);
          await h.holdUntil(0.68);
          await h.moveTo(["aside a[href$='/analytics']:visible", "aside nav"]);
          await h.holdUntil(0.85);
          await h.moveTo(OV_TITLE);
        },
      },
      {
        voice: {
          az: "Panel bütün sistemin nəbzidir. Yuxarıda — real datadan çəkilmiş son yayımlanmış planoqram və sahədən gələn ən təzə foto təsdiqi. Ortada beş sayğac: aktiv məhsullar və kataloq hazırlığı, satış nöqtələri və zal planları, avadanlıq şablonları, nəşrlər, yoxlamadakı fotolar. Aşağıda Demo axını — işin düzgün ardıcıllığı, və sağda data keyfiyyəti panelı. Yadda saxlayın: buradakı hər rəqəm bu gün görəcəyimiz dövrün canlı nəticəsidir. İndi isə dövrün birinci addımına — kataloqa.",
          ru: "Панель — это пульс всей системы. Вверху — последняя опубликованная планограмма, отрисованная из реальных данных, и свежее фото-подтверждение с поля. В центре пять счётчиков: активные товары и готовность каталога, торговые точки и планы залов, шаблоны оборудования, публикации, фото на проверке. Внизу — Demo-flow, правильный порядок работы, и справа — панель качества данных. Запомните: каждая цифра здесь — живой результат того цикла, который мы сегодня пройдём. А теперь — к первому шагу цикла, в каталог.",
        },
        do: async (page, lang, h) => {
          await h.hover(OV_HERO_PLANO);
          await h.holdUntil(0.3);
          await h.hover(OV_KPI_PRODUCTS);
          await h.holdUntil(0.5);
          await h.hover(OV_KPI_PHOTO);
          await h.holdUntil(0.66);
          await h.hover(OV_FLOW_CATALOG);
          await h.holdUntil(0.82);
          await h.hover(OV_FLOW_REVIEW);
          await h.holdUntil(0.9);
        },
      },

      // ═══ ГЛАВА 1 · КАТАЛОГ ══════════════════════════════════════════════
      {
        voice: {
          az: "«Məhsul kataloqu» sətrinə klik edirəm — və biz kataloqdayıq. Hər şey buradan başlayır: rəfə qoyulacaq hər məhsul əvvəlcə burada yaşamalıdır. Axtarış ad, SKU və barkod üzrə işləyir — bir simvol yığıram və cədvəl dərhal süzülür. Cədvəldə hər mövqe üçün SKU, barkod, kateqoriya, brend, təchizatçı, istehsalçı, ölçülər və çəki görünür. Bu, sadəcə siyahı deyil — planoqramların bünövrəsidir.",
          ru: "Кликаю «Каталог товаров» — и мы в каталоге. Всё начинается здесь: каждый товар, который встанет на полку, сначала должен жить в этой таблице. Поиск работает по названию, SKU и штрих-коду — набираю символ, и таблица тут же фильтруется. По каждой позиции видны SKU, штрих-код, категория, бренд, поставщик, производитель, размеры и вес. Это не просто список — это фундамент планограмм.",
        },
        do: async (page, lang, h) => {
          await h.click(OV_FLOW_CATALOG);
          await settleNav(page, h);
          await h.holdUntil(0.4);
          await h.fill(CAT_SEARCH, "a");
          await h.holdUntil(0.7);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "İndi keyfiyyət filtrləri. Kataloqda üç tipik problem olur: ölçüsüz, barkodsuz və şəkilsiz məhsullar. «Ölçüsüz» filtrini işarələyib «Tətbiq et» düyməsini basıram… və cədvəl boşdur. Bu, əla xəbərdir: demo kataloqda bütün ölçülər doldurulub — sağlam kataloq məhz belə görünür. Problem olsaydı, ekranda tək onlar qalardı: millimetrsiz məhsul rəfə düzgün qoyula bilməz. «Sıfırla» ilə tam siyahıya qayıdıram.",
          ru: "Теперь фильтры качества. В каталоге бывают три типичные проблемы: товары без размеров, без штрих-кода и без фото. Отмечаю «Без размеров», нажимаю «Применить»… и таблица пуста. Это отличная новость: в демо-каталоге все размеры заполнены — именно так выглядит здоровый каталог. Были бы проблемы — на экране остались бы только они: товар без миллиметров не поставить на полку корректно. «Сбросить» — и я снова в полном списке.",
        },
        do: async (page, lang, h) => {
          // Clear the previous scene's search so only the dims filter applies.
          await page.locator("main input[name='q']").first().fill("").catch(() => {});
          await h.click(CAT_FILTER_DIMS);
          await h.holdUntil(0.3);
          await h.click(CAT_APPLY); // GET form — safe
          await settleNav(page, h);
          await h.holdUntil(0.62);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.75);
          await h.click(CAT_RESET); // back to the full list
          await settleNav(page, h);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Ölçülər isə birbaşa cədvəldə düzəlir. Ölçü xanasına klik edirəm — sətirin özündə sahələr açılır: en, hündürlük, dərinlik, çəki. Heç bir ayrı səhifə, heç bir keçid — düzəliş cədvəlin içindədir. İndi heç nəyi dəyişməyəcəyəm — «Ləğv et». Amma prinsipi görürsünüz: kataloq datası bir kliklə, yerindəcə redaktə olunur.",
          ru: "А сами размеры правятся прямо в таблице. Кликаю по ячейке размеров — и в строке открываются поля: ширина, высота, глубина, вес. Ни отдельной страницы, ни перехода — правка внутри таблицы. Сейчас ничего менять не буду — «Отмена». Но принцип вы видите: данные каталога редактируются в один клик, на месте.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(CAT_DIMS_EDIT);
          await h.holdUntil(0.25);
          await h.click(CAT_DIMS_EDIT);
          await h.holdUntil(0.55);
          await h.moveTo(["main input[type='number']", "main table"]);
          await h.holdUntil(0.72);
          await h.click(CAT_DIMS_CANCEL);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Yeni məhsul da buradaca yaranır. Formada SKU, ad, barkod, kateqoriya, brend, təchizatçı və ölçülər var. Nümunə üçün doldururam: SKU… və ad… Kateqoriya və brend arayışlardan seçilir — kataloq nizamlı qalır. Amma «Məhsul yarat» düyməsini basmıram: bu, canlı demo bazadır və biz ona toxunmuruq. Sadəcə bilin: əl ilə yaratma bir dəqiqəlik işdir.",
          ru: "Новый товар тоже рождается прямо здесь. В форме — SKU, название, штрих-код, категория, бренд, поставщик и размеры. Заполняю для примера: SKU… и название… Категория и бренд выбираются из справочников — каталог остаётся аккуратным. Но кнопку «Создать товар» я не нажимаю: это живая демо-база, и мы её не трогаем. Просто знайте: ручное создание — минутное дело.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(CAT_CREATE_SKU);
          await h.holdUntil(0.2);
          await h.fill(CAT_CREATE_SKU, "DEMO-100");
          await h.holdUntil(0.42);
          await h.fill(CAT_CREATE_NAME, lang === "az" ? "Şokolad batonu 45 q" : "Шоколадный батончик 45 г");
          await h.holdUntil(0.68);
          await h.hover(CAT_CREATE_BTN);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Minlərlə mövqe üçün isə «İdxal» vərəqi var — keçirəm. Buraya CSV faylı yüklənir; sütun başlıqları üç dildə tanınır — Azərbaycan, rus və ingilis dilində. Sistem məhsulları, barkodları, kateqoriyaları toplu şəkildə gətirir. Yanındakı «Data keyfiyyəti» vərəqi isə bütün kataloqun boşluqlarını bir ekranda göstərir: nə çatışmır, harada. Kataloq hazırdır — indi bu məhsulları qoyacağımız rəfləri yaradaq.",
          ru: "А для тысяч позиций есть вкладка «Импорт» — перехожу. Сюда загружается CSV-файл; заголовки колонок распознаются на трёх языках — азербайджанском, русском и английском. Система приносит товары, штрих-коды и категории массово. Соседняя вкладка «Качество данных» показывает все пробелы каталога на одном экране: чего не хватает и где. Каталог готов — теперь создадим полки, на которые эти товары встанут.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(CAT_TAB_IMPORT);
          await h.holdUntil(0.2);
          await h.click(CAT_TAB_IMPORT);
          await settleNav(page, h);
          await h.holdUntil(0.6);
          await h.hover(CAT_TAB_QUALITY);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 2 · ОБОРУДОВАНИЕ ═════════════════════════════════════════
      {
        voice: {
          az: "Soldakı menyudan «Avadanlıq kitabxanası»na keçirəm. Burada mağazalarınızın bütün rəf tipləri yaşayır: divar stellajları, soyuducu vitrinlər, qarmaqlı panellər. Cədvəldə hər şablonun ölçüləri, rəf sayı və versiyası görünür. Versiyaya diqqət edin: planoqram nəşrə çıxan kimi avadanlığın həndəsəsi dondurulur — sonradan şablonu dəyişsəniz belə, köhnə planoqramlar pozulmur. Tarixçə müqəddəsdir.",
          ru: "Из меню слева перехожу в «Библиотеку оборудования». Здесь живут все типы полок ваших магазинов: пристенные стеллажи, холодильные витрины, крючковые панели. В таблице видны размеры каждого шаблона, число полок и версия. Обратите внимание на версии: как только планограмма уходит в публикацию, геометрия оборудования замораживается — даже если потом изменить шаблон, старые планограммы не сломаются. История неприкосновенна.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_EQUIP);
          await settleNav(page, h);
          await h.holdUntil(0.45);
          await h.hover(EQ_TABLE);
          await h.holdUntil(0.75);
          await h.moveTo(EQ_NEW);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Yeni avadanlıq» düyməsinə klik edirəm — və biz konstruktordayıq. Ad yazıram: «Divar stellajı — demo». Tip arayışdan seçilir, sonra qabarit ölçülər: en, hündürlük, dərinlik — hamısı millimetrlə. Sağda isə canlı öncədən baxış: stellaj öndən göründüyü kimi çəkilir. Bu, şəkil deyil — datadan qurulan real modeldir.",
          ru: "Кликаю «Новое оборудование» — и мы в конструкторе. Ввожу название: «Пристенный стеллаж — демо». Тип выбирается из справочника, дальше габариты: ширина, высота, глубина — всё в миллиметрах. А справа — живой предпросмотр: стеллаж отрисован так, как он выглядит спереди. Это не картинка — это настоящая модель, построенная из данных.",
        },
        do: async (page, lang, h) => {
          await h.click(EQ_NEW);
          await settleNav(page, h);
          await h.holdUntil(0.35);
          await h.fill(EQ_NAME, lang === "az" ? "Divar stellajı — demo" : "Пристенный стеллаж — демо");
          await h.holdUntil(0.68);
          await h.hover(EQ_PREVIEW);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "İndi ən maraqlısı — rəflər. «Rəf sayı» sahəsində rəqəmi altıya dəyişirəm… və baxın: öncədən baxış stellajı dərhal yenidən yığdı. Rəf qalınlığı, rəflər arası məsafə, yuxarı və aşağı boşluqlar — hamısı parametrlərdir. Və hamısı yoxlanılır: hündürlüyə sığmayan rəfləri, əlli millimetrdən dar aralığı forma sadəcə buraxmır. Səhv konfiqurasiya kitabxanaya düşə bilməz.",
          ru: "Теперь самое интересное — полки. В поле «Количество полок» меняю число на шесть… и смотрите: предпросмотр мгновенно пересобрал стеллаж. Толщина полки, просветы между полками, отступы сверху и снизу — всё это параметры. И всё проверяется: полки, которые не влезают по высоте, или просвет уже пятидесяти миллиметров форма просто не пропустит. Ошибочная конфигурация не может попасть в библиотеку.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(EQ_SHELF_COUNT);
          await h.holdUntil(0.22);
          await h.fill(EQ_SHELF_COUNT, "6");
          await h.holdUntil(0.55);
          await h.hover(EQ_PREVIEW);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Rəflərdən başqa ayrıca rejimlər də var: xanalar və qarmaqlar. Xana torları vitrin bölmələri üçün, qarmaqlar isə asılan mallar üçündür — sayı, hündürlüyü, uzunluğu ayrıca verilir. Hazır şablon «Kitabxanaya saxla» düyməsi ilə yadda saxlanır — mən basmıram, konstruktoru ayrıca bələdçidə dərindən açacağıq. Avadanlıq hazırdır. Bəs bu stellajlar hansı mağazalarda duracaq? Növbəti bölmə — satış nöqtələri.",
          ru: "Кроме полок есть отдельные режимы: ячейки и крючки. Сетки ячеек — для витринных секций, крючки — для навесного товара: их число, высота и длина задаются отдельно. Готовый шаблон сохраняется кнопкой «Сохранить в библиотеку» — я её не нажимаю, конструктор подробно разберём в отдельном гиде. Оборудование готово. Но в каких магазинах встанут эти стеллажи? Следующий раздел — торговые точки.",
        },
        do: async (page, lang, h) => {
          await h.hover(EQ_HOOKS);
          await h.holdUntil(0.45);
          await h.hover(EQ_PREVIEW);
          await h.holdUntil(0.66);
          await h.hover(EQ_SAVE);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 3 · ТОЧКИ И ФОРМАТЫ ══════════════════════════════════════
      {
        voice: {
          az: "«Satış nöqtələri» bölməsinə keçirəm. Yuxarıda dörd kart: cəmi nöqtə, aktivlər, formatlar və planoqram təyinatları. Format anlayışı vacibdir: «market», «süpermarket», «kiosk» — planoqramlar tək-tək mağazalara yox, bütöv formata dərc oluna bilir. Yüz mağazalıq şəbəkədə bu, yüz əl işini bir kliklə əvəz edir.",
          ru: "Перехожу в «Торговые точки». Вверху четыре карточки: всего точек, активные, форматы и назначения планограмм. Понятие формата — важное: «минимаркет», «супермаркет», «киоск» — планограммы публикуются не по одному магазину, а сразу на формат. В сети из ста магазинов это заменяет сто ручных операций одним кликом.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_STORES);
          await settleNav(page, h);
          await h.holdUntil(0.45);
          await h.hover(ST_CARDS);
          await h.holdUntil(0.7);
          await h.hover(ST_TABLE);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Cədvəl hər nöqtənin əməliyyat vəziyyətini göstərir: format, region, zal planlarının sayı, təyin olunmuş planoqramlar, açıq tapşırıqlar, marşrutlar və vizitlər. Yəni bir baxışla görürsünüz: bu mağazada plan var, planoqram təyin olunub, tapşırıq işləyir, agent gedib. İndi bir nöqtənin içinə baxaq — sətirə klik edirəm.",
          ru: "Таблица показывает операционное состояние каждой точки: формат, регион, число планов зала, назначенные планограммы, открытые задачи, маршруты и визиты. Одним взглядом видно: у этого магазина есть план, планограмма назначена, задача в работе, агент выехал. Теперь заглянем внутрь точки — кликаю по строке.",
        },
        do: async (page, lang, h) => {
          await h.hover(ST_TABLE);
          await h.holdUntil(0.4);
          await h.moveTo(ST_ROW);
          await h.holdUntil(0.6);
          await h.click(ST_ROW);
          await settleNav(page, h);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Nöqtənin səhifəsi — mağazanın tam pasportudur. Zal planları: hansı avadanlıq harada durur. Aktiv planoqramlar: bu mağazaya nə təyin olunub. Son tapşırıqlar öz statusları ilə, marşrutlar və vizitlər — agentlər bura nə vaxt gəlib.",
          ru: "Страница точки — полный паспорт магазина. Планы зала: какое оборудование где стоит. Активные планограммы: что назначено этому магазину. Последние задачи со статусами, маршруты и визиты — когда сюда приезжали агенты.",
        },
        do: async (page, lang, h) => {
          await h.hover(ST_FLOOR);
          await h.holdUntil(0.45);
          await h.hover(["main :text('Aktiv planoqramlar')", "main :text('Активные планограммы')", "main"]);
          await h.holdUntil(0.75);
          await h.hover(["main :text('Marşrutlar')", "main :text('Маршруты')", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Və iki nəzarət bloku: «Foto nəzarət» — bu nöqtədən gələn son şəkillər, birazdan onların yolunu tam izləyəcəyik. Və «Nöqtə hazırlığı» — mağazanın hazırlıq çeklisti: zal planı varmı, planoqram təyin olunubmu, açıq tapşırıqlar, yoxlamada review-lar. Yeni mağazanı işə salanda bu blok sizin yol xəritənizdir. İndi isə avadanlığı zalda yerləşdirən bölməyə — zal planlarına.",
          ru: "И два контрольных блока: «Фото-контроль» — последние снимки с этой точки, скоро мы проследим их путь целиком. И «Готовность точки» — чек-лист магазина: есть ли план зала, назначена ли планограмма, открытые задачи, review на проверке. Когда запускаете новый магазин, этот блок — ваша дорожная карта. А теперь — в раздел, который расставляет оборудование по залу: планы залов.",
        },
        do: async (page, lang, h) => {
          await h.hover(ST_PHOTO);
          await h.holdUntil(0.4);
          await h.hover(ST_QUALITY);
          await h.holdUntil(0.75);
          await h.moveTo(NAV_FLOOR);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 4 · ПЛАНЫ ЗАЛОВ ══════════════════════════════════════════
      {
        voice: {
          az: "«Zal planları» bölməsi kataloqla mağaza arasındakı körpüdür. Hər plan — konkret mağazanın və ya formatın zalıdır: kitabxanadan avadanlıq götürülür və zalda yerləşdirilir. Siyahıda hər planın nöqtəsi, formatı və avadanlıq sayı görünür.",
          ru: "Раздел «Планы залов» — мост между каталогом и магазином. Каждый план — это зал конкретного магазина или формата: оборудование берётся из библиотеки и расставляется по залу. В списке видно точку, формат и количество оборудования каждого плана.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_FLOOR);
          await settleNav(page, h);
          await h.holdUntil(0.5);
          await h.hover(FP_LIST);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Planın içində «Avadanlıq əlavə et» əməliyyatı stellajı zala qoyur, sonra hər avadanlığa planoqram bağlanır. Beləcə zəncir yaranır: kataloq → avadanlıq → zal planı → planoqram. Hər mağaza öz zalını, hər stellaj öz düzülüşünü tanıyır.",
          ru: "Внутри плана операция «Добавить оборудование» ставит стеллаж в зал, а затем к каждому оборудованию привязывается планограмма. Так складывается цепочка: каталог → оборудование → план зала → планограмма. Каждый магазин знает свой зал, каждый стеллаж — свою выкладку.",
        },
        do: async (page, lang, h) => {
          await h.hover(FP_ADD_EQ);
          await h.holdUntil(0.5);
          await h.hover(FP_LIST);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Diqqət edin: «Nöqtəyə kopyala» əməliyyatı hazır planı başqa mağazaya köçürür — şəbəkəni genişləndirəndə hər zalı sıfırdan yığmırsınız. Zal hazırdır, avadanlıq yerindədir. İndi isə sistemin ürəyinə gedirik — planoqram redaktoruna.",
          ru: "Обратите внимание на операцию «Копировать на точку»: готовый план переносится в другой магазин — при расширении сети вы не собираете каждый зал с нуля. Зал готов, оборудование на месте. А теперь — в сердце системы, в редактор планограмм.",
        },
        do: async (page, lang, h) => {
          await h.hover(FP_COPY);
          await h.holdUntil(0.5);
          await h.moveTo(NAV_PLANO);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 5 · ПЛАНОГРАММЫ: РЕДАКТОР ════════════════════════════════
      {
        voice: {
          az: "«Planoqramlar» siyahısındayıq. Hər sətirdə önizləmə, status və versiya, yerləşdirmələrin sayı, hədəflər və bağlı tapşırıqlar. Statuslar üçdür: qaralama, dərc olunmuş və arxiv. Yayımlanmış planoqramı açıram — redaktora daxil oluruq.",
          ru: "Мы в списке «Планограмм». В каждой строке — превью, статус и версия, число размещений, цели публикации и связанные задачи. Статусов три: черновик, опубликована и архив. Открываю опубликованную — входим в редактор.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_PLANO);
          await settleNav(page, h);
          await h.holdUntil(0.4);
          await h.moveTo(PL_OPEN);
          await h.holdUntil(0.58);
          await h.click(PL_OPEN);
          await settleNav(page, h);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Budur, düzülüş redaktoru. Qarşınızda real rəflərdir: hər məhsul öz yerində, öz ölçüsündə, real nisbətlərdə. İş qaralamasında solda məhsul paneli açılır — kataloqla birbaşa bağlıdır: axtarırsınız, tutub rəfə sürükləyirsiniz və ya iş paneli ilə seçilmiş rəfə bir kliklə qoyursunuz. Bizim açdığımız versiya isə yayımlanıb — o, dəyişilməzdir, ona görə redaktə panelləri gizlədilib: qarşımızda rəfin qorunan, təsdiqlənmiş vəziyyətidir.",
          ru: "Вот он, редактор выкладки. Перед вами настоящие полки: каждый товар на своём месте, в своём масштабе, в реальных пропорциях. В рабочем черновике слева открывается панель товаров — она напрямую связана с каталогом: ищете, берёте и перетаскиваете товар прямо на полку, либо ставите одним кликом через рабочую панель. А открытая нами версия опубликована — она неизменяема, поэтому панели редактирования скрыты: перед нами защищённое, утверждённое состояние полки.",
        },
        do: async (page, lang, h) => {
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.4);
          await h.moveTo(PL_WORKBENCH);
          await h.holdUntil(0.62);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Hər yerləşdirmənin parametrləri var: feysinqlər üç ox üzrə — neçə üz yan-yana, neçə mərtəbə üst-üstə, neçə sıra dərinliyə. Fırlatma, yığılma rejimi, mövqe. Sistem tutumu özü hesablayır: rəfin boş eni, sığan vahidlərin sayı — hamısı millimetr dəqiqliyi ilə. Kataloqdakı ölçülərin nə üçün vacib olduğunu indi görürsünüz.",
          ru: "У каждого размещения есть параметры: фейсинги по трём осям — сколько лиц в ряд, сколько этажей в высоту, сколько рядов в глубину. Поворот, режим штабелирования, позиция. Ёмкость система считает сама: свободная ширина полки, число влезающих единиц — всё с точностью до миллиметра. Теперь вы видите, зачем каталогу были нужны размеры.",
        },
        do: async (page, lang, h) => {
          await h.click(PL_CANVAS);
          await h.holdUntil(0.4);
          await h.hover(PL_FACINGS);
          await h.holdUntil(0.7);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Redaktorda iki güclü alət də var. Zonalar: rəfdə kateqoriya bölgələri çəkilir — «içkilər burada, qəlyanaltılar orada». Və avtomatik düzülüş: sistem ABC sinfinə, günlük dövriyyəyə və mənfəətə görə məhsulları özü yerləşdirir; brend payına limit qoymaq, öncədən baxış götürmək və bir kliklə geri qaytarmaq olar. Böyük rəfləri əllə yox, qaydalarla yığırsınız.",
          ru: "В редакторе есть и два мощных инструмента. Зоны: на полке рисуются категорийные области — «напитки здесь, снеки там». И автовыкладка: система сама расставляет товары по ABC-классу, дневному обороту и прибыли; можно ограничить долю бренда, получить предпросмотр и откатить одним кликом. Большие полки собираются не руками, а правилами.",
        },
        do: async (page, lang, h) => {
          await h.hover(PL_ZONES);
          await h.holdUntil(0.4);
          await h.hover(PL_AUTO);
          await h.holdUntil(0.75);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "İndi isə görüntünü dəyişək: 3D düyməsinə klik edirəm… və planoqram həcmə çevrilir. Stellaja ticarət zalındakı kimi baxırsınız: dərinlik, mərtəbələr, real nisbətlər. Rəhbərliklə düzülüşü razılaşdırmaq və ya təchizatçıya rəf yerini göstərmək üçün bundan yaxşı dil yoxdur.",
          ru: "А теперь сменим взгляд: кликаю кнопку 3D… и планограмма превращается в объём. Вы смотрите на стеллаж, как в торговом зале: глубина, этажи, реальные пропорции. Чтобы согласовать выкладку с руководством или показать поставщику его место на полке — лучшего языка не существует.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(PL_3D);
          await h.holdUntil(0.25);
          await h.click(PL_3D);
          await h.holdUntil(0.62);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Versiya tarixinə baxın: hər dəyişiklik versiyadır, köhnə versiya ilə fərqi — diff — göstərilir: nə əlavə olunub, nə silinib, nə dəyişib. Bu versiya dərc olunub, ona görə toxunulmazdır — düzəliş üçün yeni qaralama yaradılır. Auditor gəlsə, altı ay əvvəlki rəfin necə göründüyünü dəqiq deyə bilərsiniz.",
          ru: "Взгляните на историю версий: каждое изменение — версия, и разница с прошлой — diff — показывается явно: что добавлено, что убрано, что изменилось. Эта версия опубликована, поэтому неприкосновенна — для правок создаётся новый черновик. Придёт аудитор — вы точно скажете, как выглядела полка полгода назад.",
        },
        do: async (page, lang, h) => {
          await h.hover(PL_HISTORY);
          await h.holdUntil(0.5);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Və nəşr. «Dərc et» düyməsi — üzərinə basmıram, sadəcə göstərirəm — dialoq açır: hədəf format və ya konkret nöqtələr, icra müddəti, versiya şərhi. Nəşr anında üç şey baş verir: avadanlığın həndəsəsi donur, versiya toxunulmaz olur və hər hədəf mağazaya avtomatik tapşırıq yaradılır. Bax bu tapşırıqlar bizim növbəti dayanacağımızdır. Amma əvvəlcə — süni intellektin gözü: etalon foto.",
          ru: "И публикация. Кнопка «Опубликовать» — не нажимаю, просто показываю — открывает диалог: целевой формат или конкретные точки, срок исполнения, комментарий к версии. В момент публикации происходят три вещи: геометрия оборудования замораживается, версия становится неприкосновенной, и каждому целевому магазину автоматически создаётся задача. Эти задачи — наша следующая остановка. Но сначала — глаза искусственного интеллекта: эталонный снимок.",
        },
        do: async (page, lang, h) => {
          await h.hover(PL_PUBLISH);
          await h.holdUntil(0.55);
          await h.hover(PL_CANVAS);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 6 · ЭТАЛОН ═══════════════════════════════════════════════
      {
        voice: {
          az: "Elə redaktorun içində «Etalon foto» bölməsi var. Etalon nədir? Planoqram — nəzəriyyədir, sxemdir. Etalon isə düzgün yığılmış REAL rəfin fotosudur. Süni intellekt agentlərin şəkillərini məhz etalonla tutuşdurur: sxemlə yox, ideal nümunə ilə. Etalonsuz avtomatik yoxlama işləmir — bu, sistemin ən vacib qurbanlarından biridir.",
          ru: "Прямо внутри редактора есть блок «Эталонный снимок». Что такое эталон? Планограмма — это теория, схема. А эталон — фотография НАСТОЯЩЕЙ полки, выложенной правильно. Искусственный интеллект сравнивает снимки агентов именно с эталоном: не со схемой, а с идеальным образцом. Без эталона автоматическая проверка не работает — это один из ключевых элементов системы.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(GR_TAB);
          await h.holdUntil(0.3);
          await h.click(GR_TAB); // client-side view switch, safe on published
          await h.holdUntil(0.6);
          await h.hover(GR_ZONE); // the real golden photo with dashed SKU zones
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Etalon haradan gəlir? Dövrənin özündən: tapşırıq nöqtəyə gedir, merçendayzer rəfi ideal yığır, şəkil çəkir, ofis şəkli qəbul edir — və məhz bu QƏBUL OLUNMUŞ fotodan «Etalon foto yarat» düyməsi ilə etalon yaradılır. Yəni etalon kənardan gətirilmir, sistemin öz təsdiqlənmiş nəticəsindən doğulur.",
          ru: "Откуда берётся эталон? Из самого цикла: задача уходит на точку, мерчендайзер выкладывает полку идеально, фотографирует, офис принимает снимок — и именно из этого ПРИНЯТОГО фото кнопкой «Создать эталонный снимок» рождается эталон. Эталон не приносится извне — он вырастает из собственного подтверждённого результата системы.",
        },
        do: async (page, lang, h) => {
          await h.hover(GR_CANDIDATES); // task photos are the candidate pool
          await h.holdUntil(0.55);
          await h.hover(GR_ZONE);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Sonra etalonun üstündə slotlar açılır: fotonun üzərinə hər SKU üçün punktir zona çəkilir — «bu sahədə bu məhsul olmalıdır». Zonalar sürüşdürülür, ölçüsü dəyişdirilir; «qalan SKU-lar üçün sahə yarat» düyməsi planoqramdakı yerləşdirmələrdən slotları avtomatik doğurur. Sistem əhatəni də göstərir: neçə yerleşdirmədən neçəsi etalonla örtülüb. Bu slotlar süni intellektin yoxlama xəritəsidir. İndi görək bu xəritə işdə necə istifadə olunur — tapşırıqlara.",
          ru: "Затем на эталоне размечаются слоты: поверх фото для каждого SKU рисуется пунктирная зона — «в этой области должен стоять этот товар». Зоны двигаются и меняют размер; кнопка «создать слоты для оставшихся SKU» порождает их автоматически из размещений планограммы. Система показывает и покрытие: сколько размещений из скольких закрыто эталоном. Эти слоты — карта проверки для искусственного интеллекта. Теперь посмотрим, как эта карта работает в деле — идём в задачи.",
        },
        do: async (page, lang, h) => {
          await h.hover(GR_ZONE); // dashed zone on the photo
          await h.holdUntil(0.32);
          await h.hover(GR_BINDINGS); // SKU↔zone binding list
          await h.holdUntil(0.55);
          await h.hover(GR_COVERAGE); // "Etalon 7/7 …" coverage line
          await h.holdUntil(0.72);
          await h.moveTo(NAV_TASKS);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 7 · ЗАДАЧИ ═══════════════════════════════════════════════
      {
        voice: {
          az: "«Tapşırıqlar» bölməsi. Nəşr zamanı yaranan tapşırıqların hamısı burada: hansı nöqtəyə, hansı planoqram, son tarix, icraçı və status. Həyat dövrü belədir: «Yeni» → agent işə götürür → «İşdədir» → rəfi yığıb şəkil göndərir → «Foto yoxlamada» → ofis qəbul edir və ya rədd edir. Bir də vaxtı keçənlər var — onlar avtomatik «Gecikmiş» olur.",
          ru: "Раздел «Задачи». Все задачи, рождённые публикацией, здесь: какой точке, какая планограмма, срок, исполнитель и статус. Жизненный цикл такой: «Новая» → агент берёт в работу → «В работе» → выкладывает полку и отправляет фото → «Фото на проверке» → офис принимает или отклоняет. А просроченные автоматически становятся «Просрочена».",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_TASKS);
          await settleNav(page, h);
          await h.holdUntil(0.45);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Statuslar üzrə filtrlər cədvəlin üstündədir. «Foto yoxlamada» filtrinə klik edirəm — siyahı bir anda yalnız qərar gözləyən tapşırıqlara qədər daralır. Gündəlik iş rejimi məhz budur: səhər açdınız, süzdünüz, qərar verdiniz. «Hamısı» düyməsi ilə tam siyahıya qayıdıram.",
          ru: "Фильтры по статусам — над таблицей. Кликаю «Фото на проверке» — и список мгновенно сужается до задач, ждущих решения. Это ежедневный рабочий режим: утром открыли, отфильтровали, приняли решения. Кнопкой «Все» возвращаюсь к полному списку.",
        },
        do: async (page, lang, h) => {
          await h.moveTo(TASK_FILTER_PHOTO);
          await h.holdUntil(0.25);
          await h.click(TASK_FILTER_PHOTO);
          await settleNav(page, h);
          await h.holdUntil(0.6);
          await h.click(TASK_FILTER_ALL); // back to the full list (the filtered
          await settleNav(page, h);       // view can be empty on the demo)
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Tapşırığın içinə baxaq — sətirə klik edirəm. Detal səhifəsində tam mənzərə: bağlı planoqram, mağaza, icraçı və status tarixi — kim, nə vaxt, hansı addımı atıb. Heç nə itmir: hər status dəyişikliyi tarixçəyə yazılır.",
          ru: "Заглянем внутрь задачи — кликаю по строке. На детальной странице полная картина: связанная планограмма, магазин, исполнитель и история статусов — кто, когда и какой шаг сделал. Ничего не теряется: каждое изменение статуса записано в историю.",
        },
        do: async (page, lang, h) => {
          await h.click(TASK_ROW);
          await settleNav(page, h);
          await h.holdUntil(0.5);
          await h.hover(TASK_HISTORY);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Və əsası — sübutlar: agentin göndərdiyi fotolar və videolar, onlara bağlı yoxlamalar və şərhlər. «Qəbul et» düyməsi tapşırığı bir kliklə bağlayır — amma mən qərarı burada verməyəcəyəm: bu fotoların haradan gəldiyini əvvəlcə öz gözümüzlə görək. Sual budur: agent bu şəkli NƏ İLƏ çəkdi və o bura NECƏ düşdü? Cavab — səhra komandası bölməsində.",
          ru: "И главное — доказательства: фото и видео, присланные агентом, связанные с ними проверки и комментарии. Кнопка «Принять» закрывает задачу одним кликом — но решение я приму не здесь: сначала давайте своими глазами увидим, откуда эти фотографии берутся. Вопрос звучит так: ЧЕМ агент снял этот кадр и КАК он сюда попал? Ответ — в разделе полевой команды.",
        },
        do: async (page, lang, h) => {
          await h.hover(TASK_PHOTOS);
          await h.holdUntil(0.35);
          await h.hover(TASK_COMMENTS);
          await h.holdUntil(0.55);
          await h.hover(TASK_ACCEPT);
          await h.holdUntil(0.75);
          await h.moveTo(NAV_FF);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 8 · ПОЛЕВАЯ КОМАНДА: ОТКУДА ПРИХОДЯТ ФОТО ════════════════
      {
        voice: {
          az: "«Saha komandası» — marşrut modulu. Fotoların mənbəyi məhz buradadır. Hər agentin telefonunda LeadShelf mobil tətbiqi var: agent marşrutla nöqtəyə gəlir, GPS ilə çek-in edir, tapşırığı açır, rəfi yığır və kameradan şəkil çəkir. İnternet yoxdursa — problem deyil: şəkillər və əməliyyatlar telefonda oflayn növbəyə yığılır və rabitə qayıdan kimi serverlə sinxronlaşır. Bax elə o an şəkil sistemə düşür — tapşırıq «Foto yoxlamada» statusuna keçir.",
          ru: "«Полевая команда» — маршрутный модуль. Источник фотографий именно здесь. У каждого агента в телефоне мобильное приложение LeadShelf: агент приезжает на точку по маршруту, отмечается по GPS, открывает задачу, выкладывает полку и снимает её камерой. Нет интернета — не проблема: фото и операции копятся в офлайн-очереди телефона и синхронизируются с сервером, как только связь вернулась. Именно в этот момент снимок попадает в систему — и задача переходит в «Фото на проверке».",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_FF);
          await settleNav(page, h);
          await h.holdUntil(0.5);
          await h.hover(FF_TITLE);
          await h.holdUntil(0.75);
          await h.hover(FF_MAP);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Xəritə» vərəqi komandanın canlı hərəkətini göstərir: kim hansı nöqtədədir, kim yoldadır, kim gecikir, kim oflayndır. Bu, nəzarət üçün deyil — planlaşdırma üçündür: gün ərzində marşrutların real icrasını görürsünüz.",
          ru: "Вкладка «Карта» показывает живое движение команды: кто сейчас на точке, кто в пути, кто опаздывает, кто офлайн. Это не слежка — это планирование: вы видите реальное исполнение маршрутов в течение дня.",
        },
        do: async (page, lang, h) => {
          await h.click(FF_TAB_MAP);
          await h.holdUntil(0.4);
          await h.hover(FF_MAP);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Marşrutlar» vərəqi: hər marşrutun nöqtələri, tarixi, agenti və icra faizi. Marşrut buradaca yaradılır: nöqtələr seçilir, agent təyin olunur, tarix qoyulur. Statuslar: planlaşdırılıb, işdədir, tamamlanıb.",
          ru: "Вкладка «Маршруты»: точки каждого маршрута, дата, агент и процент исполнения. Маршрут создаётся прямо здесь: выбираются точки, назначается агент, ставится дата. Статусы: запланирован, в работе, завершён.",
        },
        do: async (page, lang, h) => {
          await h.click(FF_TAB_ROUTES);
          await h.holdUntil(0.45);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Agentlər» vərəqi — komandanın özü: kim hansı komandadadır, telefon, e-poçt, hazırkı status. Yeni agent buradan yaradılır və elə buradan mobil tətbiqə giriş alır. Agentlərin gördüyü hər şey — tapşırıqlar, marşrutlar, nöqtələr — məhz bu təyinatlardan gəlir.",
          ru: "Вкладка «Агенты» — сама команда: кто в какой группе, телефон, e-mail, текущий статус. Новый агент создаётся отсюда — и отсюда же получает доступ к мобильному приложению. Всё, что агент видит в телефоне — задачи, маршруты, точки — идёт именно из этих назначений.",
        },
        do: async (page, lang, h) => {
          await h.click(FF_TAB_AGENTS);
          await h.holdUntil(0.45);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Və motivasiya bloku: «Reytinq» — icra göstəricilərinə görə agentlərin lider cədvəli, «Aktivlik» — vizit hadisələrinin lenti, «Hesabatlar» — günün yekunu. Komanda böyükdürsə, rəqabət ruhu işi sürətləndirir. Beləliklə: agent şəkli çəkdi, sinxronizasiya onu serverə gətirdi. İndi ən maraqlı sual: sistem bu şəkli NECƏ yoxlayır? Gedirik foto yoxlamaya.",
          ru: "И блок мотивации: «Лидерборд» — рейтинг агентов по исполнению, «Активность» — лента событий визитов, «Отчёты» — дневная сводка. Когда команда большая, дух соревнования ускоряет работу. Итак: агент снял кадр, синхронизация принесла его на сервер. Теперь самый интересный вопрос: КАК система этот кадр проверяет? Идём в проверку фото.",
        },
        do: async (page, lang, h) => {
          await h.click(FF_TAB_LEADER);
          await h.holdUntil(0.35);
          await h.click(FF_TAB_ACTIVITY);
          await h.holdUntil(0.6);
          await h.hover(FF_TAB_REPORTS);
          await h.holdUntil(0.75);
          await h.moveTo(NAV_REVIEWS);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 9 · ПРОВЕРКА ФОТО: AI + ЧЕЛОВЕК ══════════════════════════
      {
        voice: {
          az: "«Foto yoxlama» — nəticəyə nəzarət mərkəzi. Yuxarıda statistika: yoxlamada, qəbul edilmiş, rədd edilmiş və orta score. Aşağıda isə növbə: hər kart — bir tapşırığın sübut fotosu, yanında mağaza, planoqram və süni intellektin analiz statusu: növbədə, analiz olunur, hazır.",
          ru: "«Проверка фото» — центр контроля результата. Вверху статистика: на проверке, принято, отклонено и средний score. Ниже — очередь: каждая карточка — фото-доказательство одной задачи, рядом магазин, планограмма и статус AI-анализа: в очереди, анализируется, готов.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_REVIEWS);
          await settleNav(page, h);
          await h.holdUntil(0.45);
          await h.hover(RV_DASH);
          await h.holdUntil(0.7);
          await h.hover(["main img", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Pərdə arxasında nə baş verir? Şəkil serverə düşən kimi vision xidməti işə düşür: etalonun slotlarını götürür, foto üzərində məhsulları axtarır və hər slot üzrə nəticə çıxarır — tapıldı, tapılmadı, başqa məhsul durub. Bu müqayisədən uyğunluq balı — score — doğulur. Balın hesabı şəffafdır: neçə slot uyğun gəldi, neçəsi boşdur, neçə kənar məhsul aşkarlandı.",
          ru: "Что происходит за кулисами? Как только снимок попал на сервер, включается vision-сервис: он берёт слоты эталона, ищет товары на фотографии и по каждому слоту выносит вердикт — найден, отсутствует, стоит другой товар. Из этого сравнения рождается балл соответствия — score. Расчёт прозрачен: сколько слотов совпало, сколько пустых, сколько лишних детекций.",
        },
        do: async (page, lang, h) => {
          await h.hover(["main img", "main"]);
          await h.holdUntil(0.4);
          await h.hover(RV_DASH);
          await h.holdUntil(0.7);
          await h.hover(RV_GOLDEN);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "İndi müqayisə alətinə baxaq. Üç vərəq var. «Sxem» — planoqramın nəzəri görünüşü. «Foto» vərəqində üç rejim: «Etalon» — ideal rəf, «Fakt» — agentin çəkdiyi, «Konturlar» — fakt fotonun üstündə süni intellektin çəkdiyi zonalar. «Konturlar» rejimini açıram — süni intellektin nə gördüyü birbaşa şəklin üstündədir. Fərq göz qabağındadır.",
          ru: "Теперь инструмент сравнения. Три вкладки. «Схема» — теоретический вид планограммы. На вкладке «Фото» три режима: «Эталон» — идеальная полка, «Факт» — то, что снял агент, «Контуры» — поверх фактического фото зоны, нарисованные искусственным интеллектом. Включаю «Контуры» — и то, что увидел AI, лежит прямо на снимке. Разница — на ладони.",
        },
        do: async (page, lang, h) => {
          await h.click(RV_TAB_SCHEME);
          await h.holdUntil(0.3);
          await h.click(RV_TAB_PHOTO);
          await h.holdUntil(0.5);
          await h.hover(RV_MODE_GOLDEN); // hover only: golden mode is disabled when the review has no reference
          await h.holdUntil(0.64);
          await h.click(RV_MODE_OVERLAY);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Nəticə» vərəqi yekun hökmdür: hər SKU üzrə konkret nəticə — yer və say uyğundur, məhsul yoxdur, başqa məhsul durub, öz rəfində deyil, feysinq sayı düz gəlmir. Və hər problemə konkret hərəkət təklif olunur: məhsulu çıxar, feysinq əlavə et, düzgün yerə köçür. Bu, merçendayzerə göndəriləcək düzəliş siyahısıdır — hazır şəkildə.",
          ru: "Вкладка «Результат» — итоговый вердикт: по каждому SKU конкретный исход — место и количество совпали, товар отсутствует, стоит другой товар, не на своей полке, не совпало число фейсингов. И к каждой проблеме предлагается конкретное действие: выложить товар, добавить фейсинги, переместить на правильное место. Это готовый список исправлений для мерчендайзера.",
        },
        do: async (page, lang, h) => {
          await h.click(RV_TAB_RESULT);
          await h.holdUntil(0.5);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Son söz həmişə insanındır. Üç düymə: «Qəbul et» — tapşırıq uğurla bağlanır; «Yenidən çəkiliş istə» — şəkil keyfiyyətsizdirsə, agent yenidən çəkir; «Rədd et» — düzülüş səhvdirsə, tapşırıq geri qayıdır. Süni intellekt əmin olmayanda isə rəfi əl ilə də işarələmək olar — ekranda xüsusi razmetka redaktoru var. Mən düymələrə toxunmuram — demo bazadır. Dövrə az qala tamamdır: rəf yoxlanıldı. Bəs satış? Gedirik sifarişlərə.",
          ru: "Последнее слово всегда за человеком. Три кнопки: «Принять» — задача успешно закрывается; «Запросить пересъёмку» — если кадр некачественный, агент снимает заново; «Отклонить» — если выкладка неверна, задача возвращается. А когда искусственный интеллект не уверен, полку можно разметить и вручную — на экране есть специальный редактор разметки. Кнопки я не трогаю — база демонстрационная. Цикл почти замкнулся: полка проверена. А продажи? Идём в заказы.",
        },
        do: async (page, lang, h) => {
          await h.hover(RV_APPROVE);
          await h.holdUntil(0.3);
          await h.hover(RV_RETAKE);
          await h.holdUntil(0.5);
          await h.hover(RV_REJECT);
          await h.holdUntil(0.68);
          await h.moveTo(NAV_ORDERS);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 10 · ЗАКАЗЫ ══════════════════════════════════════════════
      {
        voice: {
          az: "«Sifarişlər» bölməsi sahə işinin kommersiya nəticəsidir. Yuxarıda dörd sayğac: bütün sifarişlər, işdə olanlar, mobil cihazdan gələnlər və ümumi məbləğ. Agent nöqtədə rəfi yığandan sonra elə oradaca, mobil tətbiqdən sifariş də götürür — vizit tam nəticə ilə bağlanır.",
          ru: "Раздел «Заказы» — коммерческий результат полевой работы. Вверху четыре счётчика: всего заказов, в работе, с мобильного и общая сумма. Агент на точке, выложив полку, тут же — из того же мобильного приложения — снимает и заказ: визит закрывается полным результатом.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_ORDERS);
          await settleNav(page, h);
          await h.holdUntil(0.5);
          await h.hover(ORD_SUMMARY);
          await h.holdUntil(0.75);
          await h.hover(ORD_OFFLINE);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Cədvəldə hər sifarişin mənbəyi görünür: «Vizitdən» — marşrut viziti zamanı yaradılıb, birbaşa sifariş və ya mobil oflayn mənşə. Nöqtə, agent, tərkib, məbləğ, status: göndərilib, təsdiqlənib, çatdırılıb. Sifariş fotodan, vizitdən və marşrutdan bir zəncirdə bağlıdır — hansı vizitin nə gətirdiyi həmişə izlənilir.",
          ru: "В таблице виден источник каждого заказа: «Из визита» — создан во время маршрутного визита, прямой заказ или мобильное offline-происхождение. Точка, агент, состав, сумма, статус: отправлен, подтверждён, доставлен. Заказ связан в одну цепочку с фото, визитом и маршрутом — всегда видно, какой визит что принёс.",
        },
        do: async (page, lang, h) => {
          await h.hover(ORD_VISIT);
          await h.holdUntil(0.5);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Aşağıda «Mobil icra sağlamlığı» bloku — texniki nəbz: neçə cihaz sinxronlaşır, sync gecikməsi, konfliktlər, rədd edilən sifarişlər. Sahədə yüz telefon işləyəndə bu blok problemi müştəridən əvvəl görür. İndi isə finala — bütün bu dövrün rəqəmlərlə danışdığı yerə: analitikaya.",
          ru: "Внизу блок «Состояние мобильного исполнения» — технический пульс: сколько устройств синхронизируется, задержка sync, конфликты, отклонённые заказы. Когда в поле работает сотня телефонов, этот блок видит проблему раньше клиента. А теперь — к финалу, туда, где весь этот цикл начинает говорить цифрами: в аналитику.",
        },
        do: async (page, lang, h) => {
          await h.hover(ORD_HEALTH);
          await h.holdUntil(0.55);
          await h.moveTo(NAV_ANALYTICS);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ГЛАВА 11 · АНАЛИТИКА ═══════════════════════════════════════════
      {
        voice: {
          az: "«Analitika». Birinci blok — «Rəfin faktiki icrası»: yoxlamaların kanonik nəticələri. Orta uyğunluq, rəfdə olmayan SKU-lar, feysinq çatışmazlığı, ofisin rədd etdiyi şəkillər, yenidən çəkilişlər. Mağaza, merçendayzer, planoqram və dövr üzrə filtrlər var. Bu, kağız üzərində deyil — çöldəki REAL rəflərin icra hesabatıdır.",
          ru: "«Аналитика». Первый блок — «Фактическое исполнение полки»: канонические результаты проверок. Среднее соответствие, отсутствующие SKU, нехватка фейсингов, отклонённые офисом снимки, пересъёмки. Фильтры по магазину, мерчендайзеру, планограмме и периоду. Это отчёт об исполнении не на бумаге — по НАСТОЯЩИМ полкам в поле.",
        },
        do: async (page, lang, h) => {
          await h.click(NAV_ANALYTICS);
          await settleNav(page, h);
          await h.holdUntil(0.5);
          await h.hover(AN_EXEC_TITLE);
          await h.holdUntil(0.8);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Yuxarıdakı KPI-lar rəf sahəsini pulla bağlayır: planoqramlı mağazalar, aktiv planoqramlar, düzülüşdəki SKU-lar, xətti metrlər — yəni rəflərin fiziki uzunluğu — dövriyyə və mənfəət. Rəf yeri ticarətdə ən bahalı resursdur; LeadShelf onu ölçülən aktivə çevirir.",
          ru: "KPI сверху связывают полочное пространство с деньгами: магазины с планограммами, активные планограммы, SKU в выкладке, линейные метры — то есть физическая длина полок — оборот и прибыль. Полочное место — самый дорогой ресурс в торговле; LeadShelf превращает его в измеримый актив.",
        },
        do: async (page, lang, h) => {
          await h.hover(AN_KPI_METERS);
          await h.holdUntil(0.55);
          await h.hover(["main :text('SKU')", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "«Rəfdə problem nədir» bloku — rəhbər üçün üç siqnal. «Az yer verilib»: məhsul yerindən çox satır — feysinq artırın. «Çox yer verilib»: yer tutur, satmır — azaldın. «Balanslıdır» — toxunmayın. Rəf payı satış payı ilə tutuşdurulur; qərar bir cümləyə sığır.",
          ru: "Блок «Что не так с полкой» — три сигнала для руководителя. «Недо-выделено»: товар продаёт больше, чем занимает места — добавьте фейсинги. «Пере-выделено»: место занимает, а не продаёт — сократите. «Сбалансировано» — не трогайте. Доля полки сопоставляется с долей продаж; решение умещается в одну фразу.",
        },
        do: async (page, lang, h) => {
          await h.hover(AN_EXECUTIVE);
          await h.holdUntil(0.6);
          await h.hover(["main table", "main"]);
          await h.holdUntil(0.88);
        },
      },
      {
        voice: {
          az: "Və dövr müqayisəsi — like-for-like: eyni mağazalar, eyni SKU-lar, iki dövr. Düzülüşü dəyişdiniz — satış necə dəyişdi? Cavab burada. Bütün hesabatlar «Excel ixracı» düyməsi ilə yüklənir. Rəqəmlər dövrü bağladı — indi geri, başladığımız yerə.",
          ru: "И сравнение периодов — like-for-like: те же магазины, те же SKU, два периода. Изменили выкладку — как изменились продажи? Ответ здесь. Любой отчёт выгружается кнопкой «Экспорт Excel». Цифры замкнули цикл — теперь назад, туда, где мы начали.",
        },
        do: async (page, lang, h) => {
          await h.hover(AN_L4L);
          await h.holdUntil(0.45);
          await h.hover(AN_EXPORT);
          await h.holdUntil(0.7);
          await h.moveTo([`aside a[href='/${lang}']:visible`, "aside nav a"]);
          await h.holdUntil(0.88);
        },
      },

      // ═══ ФИНАЛ ══════════════════════════════════════════════════════════
      {
        voice: {
          az: "Və biz yenidən Paneldəyik. İndi bu ekran tamam başqa cür oxunur, elə deyilmi? Kataloq məhsulları verdi, konstruktor rəfləri qurdu, zal planı onları mağazaya qoydu, planoqram düzülüşü çəkdi, nəşr tapşırıqları doğurdu, agent telefonu ilə şəkil çəkdi, süni intellekt etalonla tutuşdurdu, insan qərar verdi, sifariş pulu gətirdi, analitika hamısını ölçdü. Bu — LeadShelf-in tam dövrüdür. Hər bölmənin öz ətraflı bələdçisi də olacaq. Baxdığınız üçün təşəkkürlər — görüşənədək!",
          ru: "И мы снова на Панели. Теперь этот экран читается совсем иначе, правда? Каталог дал товары, конструктор собрал полки, план зала расставил их по магазину, планограмма нарисовала выкладку, публикация родила задачи, агент снял полку телефоном, искусственный интеллект сверил её с эталоном, человек принял решение, заказ принёс деньги, аналитика всё измерила. Это и есть полный цикл LeadShelf. У каждого раздела будет и свой подробный гид. Спасибо, что досмотрели — до встречи!",
        },
        do: async (page, lang, h) => {
          await h.click([`aside a[href='/${lang}']:visible`, "aside nav a"]);
          await settleNav(page, h);
          await h.holdUntil(0.4);
          await h.hover(OV_FLOW_CATALOG);
          await h.holdUntil(0.58);
          await h.hover(OV_FLOW_REVIEW);
          await h.holdUntil(0.72);
          await h.hover(OV_KPI_PHOTO);
          await h.holdUntil(0.84);
          await h.moveTo(OV_TITLE);
        },
      },
    ],
  },
};

// First per-section guide. It is intentionally independent from the legacy
// full-cycle film above: it starts on the real catalog route, uses stable
// data-tour-id anchors, demonstrates all three catalog tabs, and never saves.
scenarios.catalog = {
  route: "/catalog",
  title: { az: "Məhsul kataloqu: gündəlik iş və data keyfiyyəti" },
  scenes: [
    {
      voice: {
        az: "Məhsul kataloqu LeadShelf-də bütün sonrakı işlərin başlanğıc nöqtəsidir. Buradakı real məhsul kartları avadanlıq konstruktorda, planoqramda, mobil tapşırıqda və analitikada eyni identifikatorla istifadə olunur. Ekranın yuxarısında yeni məhsul forması, onun altında axtarış və keyfiyyət filtrləri, daha aşağıda isə demo təşkilatının canlı məhsul cədvəli görünür. Əvvəlcə ekranın quruluşunu nəzərdən keçirək.",
      },
      do: async (page, lang, h) => {
        await h.moveTo(["main h1"]);
        await h.holdUntil(0.25);
        await h.moveTo(CAT_CREATE_FORM);
        await h.holdUntil(0.48);
        await h.moveTo(CAT_FILTERS);
        await h.holdUntil(0.68);
        await h.moveTo(CAT_TABLE);
        await h.holdUntil(0.88);
      },
    },
    {
      voice: {
        az: "Yeni məhsul əlavə etmək üçün ayrıca pəncərə axtarmaq lazım deyil. Nümunə kimi SKU, məhsul adı və barkod sahələrini doldururam. Sonrakı sətirdə kateqoriya, brend, təchizatçı, istehsalçı və qablaşdırmanın millimetrlə ölçüləri seçilir. Yumşaq qablaşdırma işarəsi avtomatik sıxılma qaydalarında istifadə olunur. «Məhsul yarat» düyməsini yalnız göstərirəm; bu təlimatda heç nə saxlanılmır.",
      },
      do: async (page, lang, h) => {
        await h.fill(CAT_CREATE_SKU_STABLE, "GUIDE-SKU-001");
        await h.holdUntil(0.28);
        await h.fill(CAT_CREATE_NAME_STABLE, "Nümunə məhsul");
        await h.holdUntil(0.5);
        await h.fill(CAT_CREATE_BARCODE_STABLE, "4760000000012");
        await h.holdUntil(0.7);
        await h.moveTo(CAT_CREATE_SUBMIT_STABLE);
        await h.holdUntil(0.9);
      },
    },
    {
      voice: {
        az: "İndi səhifəni ilkin vəziyyətə qaytardım və axtarışı real məlumat üzərində yoxlayıram. Axtarış sahəsi məhsul adı, SKU və barkodun başlanğıcı ilə işləyir. Məsələn, Pepsi yazıb «Tətbiq et» düyməsinə basdıqda server yalnız uyğun kartları qaytarır. Bu, minlərlə SKU olan kataloqda lazımi məhsulu tez tapmağa imkan verir. Sonra «Sıfırla» ilə bütün axtarış şərtlərini təmizləyirəm.",
      },
      do: async (page, lang, h) => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await settleNav(page, h);
        await h.fill(CAT_SEARCH, "Pepsi");
        await h.holdUntil(0.35);
        await h.click(CAT_APPLY);
        await settleNav(page, h);
        await h.holdUntil(0.68);
        await h.moveTo(CAT_TABLE);
        await h.holdUntil(0.82);
        await h.click(CAT_RESET);
        await settleNav(page, h);
      },
    },
    {
      voice: {
        az: "Kataloq sadəcə siyahı deyil, master-data nəzarət ekranıdır. «Ölçüsüz» filtrini seçib tətbiq edirəm. Nəticədə yalnız eni, hündürlüyü və ya dərinliyi çatışmayan məhsullar qalır. Belə SKU planoqrama təhlükəsiz yerləşdirilə bilməz, çünki sistem onun rəfə sığıb-sığmadığını hesablaya bilmir. Eyni qayda barkodsuz və şəkilsiz kartlar üçün də var. Filtrlər problemi gizlətmir, düzəldiləcək iş siyahısına çevirir.",
      },
      do: async (page, lang, h) => {
        await h.click(CAT_FILTER_DIMS);
        await h.holdUntil(0.3);
        await h.click(CAT_APPLY);
        await settleNav(page, h);
        await h.holdUntil(0.62);
        await h.moveTo(CAT_TABLE);
        await h.holdUntil(0.82);
        await h.click(CAT_RESET);
        await settleNav(page, h);
      },
    },
    {
      voice: {
        az: "Ölçünü düzəltmək üçün məhsulun sətrindəki ölçü xanasına klik edirəm. Dörd kiçik sahə açılır: en, hündürlük, dərinlik və çəki. Dəyərlər canonical olaraq millimetr və qramla saxlanır; buna görə avadanlıq və planoqram riyaziyyatı eyni vahidlərlə işləyir. Dəyişikliyi nümayiş etdirdim, amma saxlamıram. «Ləğv et» düyməsi sətri əvvəlki vəziyyətinə qaytarır.",
      },
      do: async (page, lang, h) => {
        await h.click(["[data-tour-id='catalog-dimensions-edit']"]);
        await h.holdUntil(0.38);
        await h.moveTo(["main input[type='number']"]);
        await h.holdUntil(0.68);
        await h.click(["[data-tour-id='catalog-dimensions-cancel']"]);
        await h.holdUntil(0.88);
      },
    },
    {
      voice: {
        az: "Cədvəldə foto, SKU, ad, əsas barkod, kateqoriya, brend, təchizatçı, istehsalçı, ölçü vahidi və fiziki ölçülər bir sətirdə görünür. Bu məlumatın bütövlüyü vacibdir: foto mobil yoxlamada tanınmanı asanlaşdırır, barkod agentə skan etməyə imkan verir, kateqoriya və brend avtomatik yerləşdirmə qaydalarını qidalandırır, ölçülər isə rəfin real tutumunu hesablayır. Sağdakı redaktə əməliyyatları da məhsulu silmədən yeniləmək üçündür.",
      },
      do: async (page, lang, h) => {
        await h.moveTo(["[data-tour-id='catalog-table'] thead"]);
        await h.holdUntil(0.3);
        await h.moveTo(["[data-tour-id='catalog-table'] tbody tr:first-child td:first-child"]);
        await h.holdUntil(0.55);
        await h.moveTo(["[data-tour-id='catalog-table'] tbody tr:first-child td:nth-last-child(3)"]);
        await h.holdUntil(0.75);
        await h.moveTo(["[data-tour-id='catalog-table'] tbody tr:first-child td:last-child"]);
        await h.holdUntil(0.9);
      },
    },
    {
      voice: {
        az: "Çoxlu məhsulu əl ilə yaratmaq əvəzinə «İdxal» vərəqinə keçirəm. Burada məhsullar, qiymətlər, qalıqlar, satışlar və assortiment üçün ayrı import növləri var. Mənbə UTF-8 və ya bir çox 1C ixracında istifadə olunan Windows-1251 kodlaşdırmasında ola bilər. Sistem CSV və XLSX faylını staging qatından keçirir, hər sətri sayır və səhvləri ayrıca saxlayır. Fayl seçmədən və göndərmədən formanın quruluşunu göstərirəm.",
      },
      do: async (page, lang, h) => {
        await h.click(CAT_TAB_IMPORT_STABLE);
        await settleNav(page, h);
        await h.holdUntil(0.34);
        await h.moveTo(CAT_IMPORT_ENTITY);
        await h.holdUntil(0.52);
        await h.moveTo(CAT_IMPORT_ENCODING);
        await h.holdUntil(0.68);
        await h.moveTo(CAT_IMPORT_FILE);
        await h.holdUntil(0.82);
        await h.moveTo(CAT_IMPORT_SUBMIT);
        await h.holdUntil(0.9);
      },
    },
    {
      voice: {
        az: "İdxal bitəndə nəticə bloku ümumi, uğurlu və səhv sətirlərin sayını göstərir. Reconciliation yoxlaması mənbə checksum-u ilə qəbul edilən sətirləri tutuşdurur; heç bir sətir səssizcə itmir. Səhv varsa, sətir nömrəsi, sahə, səbəb və təklif olunan düzəliş cədvəldə qalır. Bu yanaşma gündəlik ERP mübadiləsinin tam və təkrarolunan olmasını yoxlamağa imkan verir. İndi «Data keyfiyyəti» vərəqinə keçirəm.",
      },
      do: async (page, lang, h) => {
        await h.moveTo(CAT_IMPORT_FORM);
        await h.holdUntil(0.45);
        await h.moveTo(CAT_IMPORT_SUBMIT);
        await h.holdUntil(0.7);
        await h.click(CAT_TAB_QUALITY_STABLE);
        await settleNav(page, h);
        await h.holdUntil(0.9);
      },
    },
    {
      voice: {
        az: "Data keyfiyyəti ekranındakı kartlar demo tenantın real vəziyyətini xülasə edir: ümumi məhsul sayı, planoqrama hazır kartlar, ölçüsü, barkodu, şəkli və ya kateqoriyası çatışmayanlar. Problem kartına klik kataloqa uyğun filtrlə qayıdır. Aşağıdakı tarixçə son import paketlərini, statusu, ümumi və səhv sətir sayını göstərir. Beləliklə, menecer səhər bir baxışda gecə mübadiləsinin tam olub-olmadığını anlayır.",
      },
      do: async (page, lang, h) => {
        await h.moveTo(CAT_QUALITY_CARDS);
        await h.holdUntil(0.5);
        await h.moveTo(CAT_QUALITY_IMPORTS);
        await h.holdUntil(0.88);
      },
    },
    {
      voice: {
        az: "Kataloq üzrə əsas gündəlik ardıcıllıq budur: əvvəl import nəticəsini və checksum-u yoxlayın, sonra data keyfiyyəti kartlarından çatışmazlıqları açın, ölçü və master-data səhvlərini düzəldin, yalnız bundan sonra məhsulları planoqramda istifadə edin. Məhsullar vərəqinə qayıdıram. Bu təlimatda heç bir kart yaradılmadı, dəyişdirilmədi və silinmədi; göstərilən bütün əməliyyatlar təhlükəsiz baxış və ləğv ilə tamamlandı.",
      },
      do: async (page, lang, h) => {
        await h.moveTo(CAT_QUALITY_CARDS);
        await h.holdUntil(0.3);
        await h.click(CAT_TAB_PRODUCTS_STABLE);
        await settleNav(page, h);
        await h.holdUntil(0.62);
        await h.moveTo(CAT_FILTERS);
        await h.holdUntil(0.78);
        await h.moveTo(CAT_TABLE);
        await h.holdUntil(0.9);
      },
    },
  ],
};

// Split the already source-reviewed full-cycle chapters into independent
// section scenarios. Each starts on its own real route; later recording phases
// must still run the live clickability probe and duration gate before approval.
const fullCycleScenes = scenarios.overview.scenes;
scenarios.overview = {
  route: "/",
  title: { az: "LeadShelf paneli və tam iş dövrü" },
  scenes: [fullCycleScenes[0], fullCycleScenes[1], fullCycleScenes[49]],
};
scenarios["equipment-library"] = {
  route: "/equipment-library",
  title: { az: "Avadanlıq kitabxanası və konstruktor" },
  scenes: fullCycleScenes.slice(7, 11),
};
scenarios.stores = {
  route: "/stores",
  title: { az: "Satış nöqtələri və mağaza hazırlığı" },
  scenes: fullCycleScenes.slice(11, 15),
};
scenarios["floor-plans"] = {
  route: "/floor-plans",
  title: { az: "Zal planları və avadanlığın yerləşdirilməsi" },
  scenes: fullCycleScenes.slice(15, 18),
};
scenarios.planograms = {
  route: "/planograms",
  title: { az: "Planoqram redaktoru, etalon və nəşr" },
  scenes: fullCycleScenes.slice(18, 28),
};
scenarios.tasks = {
  route: "/tasks",
  title: { az: "Tapşırıq dövrü və foto sübutlar" },
  scenes: fullCycleScenes.slice(28, 32),
};
scenarios["field-force"] = {
  route: "/field-force",
  title: { az: "Sahə komandası, marşrutlar və mobil icra" },
  scenes: fullCycleScenes.slice(32, 37),
};
scenarios.reviews = {
  route: "/reviews",
  title: { az: "Foto yoxlama və etalonla müqayisə" },
  scenes: fullCycleScenes.slice(37, 42),
};
scenarios.orders = {
  route: "/orders",
  title: { az: "Sahədən gələn sifarişlər və sinxronizasiya" },
  scenes: fullCycleScenes.slice(42, 45),
};
scenarios.analytics = {
  route: "/analytics",
  title: { az: "Rəf analitikası və biznes qərarları" },
  scenes: fullCycleScenes.slice(45, 49),
};

export default scenarios;
