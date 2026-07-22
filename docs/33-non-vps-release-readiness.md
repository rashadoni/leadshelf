# Non-VPS release readiness

Обновлено: 2026-07-22. Граница этого среза: репозиторий, GitHub Actions,
mobile artifacts и release media. Никаких SSH/deploy/изменений VPS.

## Что закрыто

- Добавлен отдельный `Mobile native compile`: чистый Expo prebuild, Android
  x86_64 debug compile и 14-дневный APK/checksum artifact. Это compile evidence,
  а не production-подпись. Clean GitHub runner `29906911181` прошёл за 20m43s;
  artifact `8524754435` проверен повторным скачиванием, APK SHA-256:
  `bb6f52402f7d8e20a2f22161414b432d20543316a816859f3210336f21aeabe6`.
- Добавлен ручной fail-closed `Mobile signed release`: только exact `main`,
  protected `mobile-release` environment, явное `SIGNED-RELEASE`, pinned EAS
  CLI/action, frozen credentials, mobile tests + frozen protocol до build,
  скачивание APK/AAB/IPA, SHA-256 и минимальный evidence artifact.
- В `eas.json` preview и production явно фиксируют HTTPS API origin.
- Help-video release теперь допускает ровно bilingual overview package:
  AZ/RU MP4 с video+audio и AZ/RU JPEG poster. Тесты запрещают лишний файл и
  видео без voice stream. Реальный GitHub release `help-videos-v1` проверен:
  четыре файла, около 68 MiB, PASS; новый `SHA256SUMS` воспроизводим.
- GitHub `main` защищён: PR обязателен, ветка должна быть актуальна, checks
  `ci` и `Secret and production-image scan` обязательны, force-push/delete
  запрещены, review conversations должны быть разрешены.
- Caddy 2.11.4 пересобирается с patched `grpc-go`/`x/crypto`/`x/net`/`x/text`;
  remote run `29906911165` повторно подтвердил ноль High/Critical для web,
  workers, Caddy и PostgreSQL images, а также чистый secret scan.
- Environment `mobile-release` создан и допускает deployments только из
  `main`. Required reviewer недоступен на текущем private-repo billing plan;
  поэтому этот организационный gate нельзя считать закрытым.

## Что остаётся внешним и почему

1. В GitHub отсутствует environment secret `EXPO_TOKEN`, а EAS CLI локально не авторизован.
   Поэтому подписанный build намеренно не запускался.
2. Нужны заранее созданные и принятые владельцем EAS Android/iOS credentials.
   Workflow использует `--freeze-credentials` и не создаёт/не заменяет ключи.
3. Для Apple нужны team/ASC/TestFlight access и macOS/device evidence.
4. Полная device matrix требует физические/выделенные Android и iOS устройства;
   GitHub debug APK не подменяет подписанный on-device acceptance.

Локальный Android compile на этой машине дважды остановился из-за заполнения
диска на D8/dex merge; этот локальный инфраструктурный сбой закрыт указанным
выше успешным compile и проверенным artifact на чистом GitHub runner.

## Как завершить signed release без VPS

1. При доступном тарифе добавить required reviewer в существующий GitHub
   Environment `mobile-release`; до этого использовать ручное независимое
   подтверждение release owner вне GitHub.
2. Добавить environment secret `EXPO_TOKEN` владельца Expo/EAS.
3. В EAS один раз утвердить Android keystore и Apple credentials; сохранить
   recovery/custody procedure вне Git.
4. Запустить `Mobile signed release` из `main`, выбрать platform/profile и
   ввести `SIGNED-RELEASE`.
5. Проверить checksum/evidence artifact, затем установить preview artifact и
   выполнить `apps/mobile/e2e/execution-smoke.yaml` на утверждённой device matrix.

До выполнения пунктов 1–5 статус mobile production остаётся `BLOCKED`, а не
`сделано`.
