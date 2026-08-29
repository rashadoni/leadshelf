# Workforce H5: QR, доверенное устройство и локальная биометрия

**Статус:** реализация H5 mobile trust, 2026-08-29.
**Граница:** только `LeadDrive Field`-вариант мобильного приложения и
capability-gated Workforce API LeadDrive. Это не перенос CRM в LeadShelf и не
изменяет shelf/planogram execution.

## Цель и неизменяемые правила

H5 добавляет необязательные уровни проверки attendance: rotating QR станции,
доверенный ключ устройства и локальное биометрическое подтверждение подписи.
Обычный Workforce продолжает работать без этих add-ons; выключенный add-on не
запрашивает камеру, не создаёт ключ и не меняет существующий workday flow.

- Биометрические шаблоны, изображения лица, результат отпечатка/лица и PIN не
  передаются на сервер, не пишутся в SQLite/SecureStore и не попадают в логи.
- Уникальный `deviceId` из SecureStore является только идентификатором клиента,
  а не доказательством доверия.
- Приватный ключ неэкспортируемый и остаётся в Android Keystore. Сервер хранит
  только публичный ключ, fingerprint, lifecycle enrollment и аудит.
- QR не является долговременным credential: он короткоживущий, серверно
  подписан и одноразово погашается сервером.
- Tenant, actor, capability и policy определяет сервер/RLS, а не QR payload или
  мобильный клиент.

## Выбранный технический срез

**Stack.** Оставляем Expo SDK 57 + dev-client/prebuild. Для настоящего
server-verifiable подтверждения добавляется малый локальный Expo native module
на Kotlin/Android Keystore; одного `expo-local-authentication` недостаточно,
поскольку он возвращает только локальный результат, а не подпись действия.

**Ключ.** Модуль создаёт `EC` P-256 ключ с Android Keystore и
`BiometricPrompt.CryptoObject(Signature)`. После успешной системной
биометрии он подписывает каноническую, versioned строку действия:

```text
workforce-device-attendance:v1
organizationId=<organizationId>
agentId=<agentId>
enrollmentId=<enrollmentId>
clientEventId=<operationId>
action=<START|PAUSE|RESUME|FINISH>
workdayId=<workdayId>
occurredAt=<ISO-8601 instant>
```

На сервер отправляются только `enrollmentId` и DER `signature` (base64) в
`attendance.device`; `keyId`, `proofNonce`, algorithm-version и поле
`biometric=true` не являются частью H5 контракта. Сервер проверяет подпись
публичным ключом, привязку ко всем полям операции и fingerprint доказательства.
QR nonce имеет отдельный server-side one-time/TTL ledger.

**QR.** Отдельный scanner-экран использует существующий `expo-camera`, но не
переиспользует shelf barcode semantics. Он считывает только QR attendance
станции, передаёт короткий opaque token в H5 action envelope и очищает его из
памяти сразу после ответа. Сырой QR token не сохраняется в outbox, SQLite,
analytics или diagnostics. При обязательном QR офлайн-отправка не создаёт
ложно-доверенное событие: сотрудник получает понятный статус «нужна сеть,
отсканируйте свежий код». Подписанное device proof может быть поставлено в
существующий Workforce outbox и проверяется сервером при доставке.

## Граница интерфейсов и файлов

1. **Server-first contract.** LeadDrive добавляет additive H5 schema/API:
   станции, signed short-lived QR, одноразовый nonce ledger, enrollment
   challenge/approval/revoke/replace и verification audit. Bootstrap manifest
   передаёт `attendance` с `qrEnabled`, `deviceTrustEnabled`, status
   `NOT_CONFIGURED|ACTIVE|INVALID`, `enforcementVersion`, `configVersion` и
   списками required actions. Мобильный код действует только при валидном
   `ACTIVE`/v1 manifest; сервер остаётся enforcement point.
2. **Shared mobile contract.** `apps/mobile/src/field/contracts.ts` получает
   versioned `attendance` manifest и proof envelope; parsing fail-closed для
   неизвестного/некорректного policy status. `apps/mobile/src/api/mobile-client.ts`
   отправляет proof только в independent Workforce lane.
3. **Native boundary.** Новый `apps/mobile/modules/workforce-attendance-trust`
   exposes only `getAvailability`, `createEnrollmentKey`, `sign` и
   `removeEnrollmentKey`. Kotlin хранит alias и private key в Keystore;
   TypeScript хранит только scoped enrollment ID, alias и lifecycle status для
   UI/recovery — не public key, challenge, QR, signature или biometric result.
   `app.json` получает только необходимое Android biometric permission/config;
   Expo Go не считается доказательством этой функции.
4. **Workday UX.** `apps/mobile/app/(app)/workday.tsx` сначала читает manifest,
   затем перед mutation показывает QR scanner и/или системный biometric prompt
   ровно для policy-required action. QR-bearing action идёт одной immediate
   network-операцией и не попадает в offline outbox; device-only proof может
   быть durable. Одна primary action, явные причины unavailable/expired/revoked
   и безопасный переход в recovery center.
   Обычный HRM UI и shelf/route sync не меняются.
5. **Lifecycle.** Enrollment начинается с server challenge и proof владения
   ключом; при обрыве сети после создания server resume использует только тот
   же ещё не подтверждённый pending key, погашает старый one-time challenge и
   выдаёт новый. После proof мобильный pointer имеет `PENDING` и не подписывает
   workday до lifecycle `ACTIVE`; revoke/replacement очищают только
   соответствующий Keystore alias, не удаляют Workforce history или outbox.
   Local auth cancel/failure не создаёт mutation. Сервер остаётся источником
   истины при rename/reinstall/transfer/revocation.

## Безопасные значения по умолчанию

- Оба add-on выключены, H5 policy отсутствует, QR/device endpoint не вызывается.
- Неподдерживаемый API, отсутствие hardware biometric, invalid/expired/replayed
  QR, revoked key или policy/manifest mismatch дают machine code и не создают
  attendance fact.
- QR привязан к tenant и короткому TTL; device signature привязана к tenant,
  employee, operation ID, action, workday и instant. Повтор QR nonce и
  повтор fingerprint доказательства отклоняются сервером.
- Camera/biometric permission запрашивается только после явного действия
  сотрудника; отказ не маскируется как успешная отметка.

## Нерешённые owner-policy значения

Эти значения не выбираются мобильным кодом и не должны получить скрытый
default при реализации:

1. Какие actions требуют QR, device trust и biometric confirmation.
2. Self-service или manager-approved enrollment; максимум активных устройств,
   правила emergency replacement и срок grace period.
3. Допустим ли QR только online (рекомендуемый первый вариант) либо нужен
   отдельный безопасный offline protocol.
4. Поддерживаемые Android API/device classes и точное окно APK upgrade/rollback.

## Проверка и H6 hand-off

- Pure tests: canonical payload, no raw QR persistence, resumable unverified
  enrollment, unavailable/revoked/replayed/expired proof и capability-off
  ordinary flow.
- Native CI: Expo prebuild + release APK на GitHub Actions; Maestro получает
  отдельный H5 fixture flow, но emulator не заменяет hardware biometric proof.
- Physical Android H6: два устройства, enrolled system biometric, QR station,
  HRM-only и Both tenant cohorts, online/offline/restart/date-rollover и
  two-device/revoke/replacement матрица. Evidence содержит только SHA, APK,
  device class, capability/policy versions, machine codes и агрегированные
  результаты — без QR tokens, GPS, PIN, biometric data или employee reasons.

Это адаптированная реализация для LeadDrive Field, не прямой перенос кода из
LeadDrive. Server-first контракт уже добавлен в отдельной ветке LeadDrive;
физические owner-policy и device prerequisites из H6 по-прежнему не
подменяются мобильными defaults.
