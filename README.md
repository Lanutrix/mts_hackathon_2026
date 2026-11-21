# МТС Watermelon — дашборд координатора

Рабочий MVP наблюдения за JSON-файлом. Четыре независимые группы, SSE, история, уведомления, общий экран, импорт/экспорт, серверные роли и локальная ИИ-сводка. Это демонстрационный стенд, не официальная продуктивная система МТС.

[Открыть демо](https://mts-watermelon.ru/) · [Figma](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe) · [Требования](docs/requirements/incident-coordinator/official-case-revision.md) · [Статус и блокеры](docs/implementation/progress.md) · [Проверки](docs/qa/test-report.md) · [Матрица F01–F40](docs/qa/flow-coverage.csv) · [Деплой](docs/deploy/runbook.md)

## Обсуждения и интерфейс

21 ноября команда разобрала архитектуру и прототип, а затем обсудила повседневную работу дежурного. Из этого разбора следует практический критерий для дашборда. По карточке должно быть видно, **почему именно этот инцидент требует внимания сейчас**. Координатор может перейти к записи в ITSM и проверить предложенное действие. [Конспект и две расшифровки с таймкодами](docs/meetings/2026-11-21/README.md) · [Официальные требования к MVP](docs/requirements/incident-coordinator/official-case-revision.md)

У координатора два основных экрана.

- **Эфир смены.** Один инцидент занимает одну строку, даже когда у него несколько сигналов. Строка показывает причину включения, статус и время до срока. Четыре фильтра управляют выборкой и положением долек 3D-арбуза. Счётчик обновляется вместе с источником. У пользователей с включённым уменьшением движения смена ракурса происходит сразу. [Открыть эфир](https://mts-watermelon.ru/) · [Макет эфира](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=51-2)
- **Рабочая очередь.** Координатор ищет инциденты, группирует по продукту или команде и собирает до шести карточек для совместного разбора. Поступление следующей версии источника предлагает обновить список. Выбор сохраняется при поиске и перезагрузке вкладки. Ответы о сроках и ответственных берутся из полей ITSM, сводки по описаниям используют существующий сервис анализа. Решение о назначении принимает человек. [Открыть очередь](https://mts-watermelon.ru/workspace) · [Макет очереди](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=51-160)

На первой странице Figma находятся актуальные макеты продукта. В библиотеке «Срез» доступны 300 компонентов, а в прежнем атласе — 17 композиций и вспомогательных экранов. [Каталог компонентов](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=41-1191) · [Атлас](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=41-1269)

## Локальный запуск

Node **24.18.0**, npm **11.16.0**. Установка зависимостей строго по package-lock.json:

```sh
npm ci --ignore-scripts
npm run build
npm run dev
```

Откройте http://127.0.0.1:3000. Создаётся синтетическая выписка из 600 записей в `.runtime/demo/incidents.json`; PostgreSQL-совместимый PGlite хранит проекцию в `.runtime/db`. Измените файл отдельным процессом — интерфейс обновится без перезагрузки. Не запускайте два backend над одним DATA_DIR.

```sh
npm run generate -- 120 42 .runtime/acceptance
npx tsx scripts/mutate.ts .runtime/demo/incidents.json critical
```

Создание пользователя — в собственном интерактивном терминале, пароль не отображается и не передаётся аргументом:

```sh
npm run user -- operator demo-admin .runtime/users.json
```

Затем задайте `USERS_FILE` на созданный файл и перезапустите сервер. В PowerShell: `$env:USERS_FILE='.runtime/users.json'`; в POSIX shell: `export USERS_FILE=.runtime/users.json`. Фиксированного admin-пароля нет. Viewer читает, coordinator анализирует и сохраняет личные отметки, demo-admin управляет рабочими копиями и сценарием.

Для оригинального файла задайте `ORIGINAL_PATH` на внешний защищённый путь. Оригинал доступен только авторизованным и только для чтения; в Git и публичной демонстрации его нет. Импорт оригинального формата выполняйте в приватную рабочую копию. `DATABASE_URL` переключает хранилище на PostgreSQL; на VDS предусмотрена peer-аутентификация через Unix socket.

`.env.example` описывает настройки; автоматической загрузки .env нет — передавайте переменные средой или systemd EnvironmentFile. `ITSM_URL` принимается только как HTTPS URL без credentials. Без него показан явно обозначенный макет с тем же ID.

## Проверки и синтетика

```sh
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run ai:smoke
npx tsx scripts/fixtures.ts
npx tsx scripts/benchmark.ts
npx tsx scripts/soak.ts
```

`npm test` без ORIGINAL_PATH пропускает единственную проверку закрытого оригинала. Локальный отчёт включает её фактический запуск. AI smoke загружает публичную закреплённую ONNX-модель один раз; после кэширования работает локально. Этот запрос действительно выполняет ML; CI использует отдельный ограниченный mock для ошибок/таймаутов. Без модели показывается подписанный fallback.

Генератор: seeds 42/43/44/92831, 120/600/2000/10000 записей; фиксированные часы, независимый oracle и manifests. `--live` сдвигает время только новой копии. `data/demo/design.json` — одинаковая синтетика для Figma и визуальной проверки. Пограничные случаи — `data/demo/boundaries.json`.

## Навигация по реализации

- `packages/domain`: исходная схема, нормализация, группы, transitions, генератор.
- `apps/worker`: стабильное чтение файла, transactional ingestion и восстановление.
- `apps/server`: API, роли, история/read state, audit, AI worker и staging support.
- `apps/web`: React, Golos Text, semantic CSS tokens, доступные формы и wallboard.
- `packages/contracts/openapi.json`: фактические маршруты и DTO.
- `docs`: требования, ADR, дизайн, доказательства, runbooks и сценарий защиты.

F37–F40 (канальные адаптеры, routing/ACK/телефония) отложены явно. Статус публичного домена и VDS проверяется отдельно от успешной локальной сборки.
