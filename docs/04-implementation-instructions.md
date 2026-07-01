# Инструкции для реализации

## Правила работы

1. `leadshelf` - отдельный проект, не папка внутри `leaddrive-v2`.
2. Код хранить локально и в GitHub.
3. Google Drive использовать для архивов, документов, экспортов и бэкапов, но не как активную папку разработки.
4. До кода зафиксировать структуру репозитория и первые модели.
5. Не переносить CRM-модули.
6. Не делать "большой рефактор MTM" как старт. Нужно создать чистый продукт и переносить только проверенные идеи.

## Первый technical slice

Сначала сделать минимальный web-only MVP:

```text
Auth/Tenant
  -> Catalog import
  -> Equipment library
  -> Planogram editor manual placement
  -> Publish task stub
```

Mobile и AI подключать после того, как планограмма реально создается в web.

## Что можно подсмотреть в LeadDrive

Источник:

`/Users/rashadrahimov/Documents/leaddrive-v2`

Полезные документы:

- `docs/mtm-shelf-detector-self-hosted-plan.md`
- `docs/mtm-shelf-ai-golden-reference-architecture.md`
- `docs/mtm-image-recognition-spec.md`
- `docs/mtm-offline-sync-spec.md`
- `docs/mtm-fmcg-gap-analysis.md`
- `docs/mtm-sku-catalog-spec.md`
- `docs/mtm-photo-watermark-spec.md`

Полезный mobile reference:

- `/Users/rashadrahimov/Documents/mtm/MTMobileApp`

Но это reference, не источник для blind copy.

## Что нельзя делать

- Нельзя тащить весь MTM sidebar.
- Нельзя начинать с AI как с основного workflow.
- Нельзя делать planogram placements как просто картинки без физической модели.
- Нельзя строить отчеты только по текущим значениям без snapshots.
- Нельзя публиковать mutable draft на магазины.
- Нельзя делать мобильное приложение online-only.

## Проверки перед каждым крупным merge

- TypeScript.
- Prisma validate/generate.
- Unit tests для `packages/core` math.
- Browser smoke для editor.
- Mobile smoke для sync/photo flow.
- Seed demo tenant.

## Данные и единицы измерения

Рекомендация: хранить physical dimensions в миллиметрах.

UI может показывать сантиметры, но внутренняя математика должна быть в одном unit.

Поля размещения товара:

- xMm;
- yMm;
- zMm;
- widthMm;
- heightMm;
- depthMm;
- facingsX;
- facingsY;
- facingsZ;
- rotationX/Y/Z;
- compressionX/Y/Z;
- stackMode.

## Версионирование

Каждая планограмма должна иметь:

- draft version;
- published version;
- active assignments;
- history;
- author;
- publishedAt;
- target stores/formats.

Причина: когда задача ушла на торговую точку, она должна ссылаться на конкретную опубликованную версию, а не на живой draft.
