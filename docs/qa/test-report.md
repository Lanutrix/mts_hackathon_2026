# Фактические проверки

Обновлено 2026-11-21T08:31:26+00:00. Демонстрационный стенд опубликован на [mts-watermelon.ru](https://mts-watermelon.ru/). Доступны [матрица F01–F40](flow-coverage.csv) и [протокол публичной проверки](evidence/public-release.json).

| Проверка | Результат | Доказательство / предел |
|---|---|---|
| TypeScript + production Vite build | done | Node24/React19, pinned lockfile, self-hosted Golos Text |
| Unit/integration | 26/26 | [Полный вывод](evidence/unit-integration.txt); включая отдельный backend process restart |
| Original 44 | done | 0/2/1/5; 46 полей; ORIGINAL_PATH только локально; оригинал не публикуется |
| Browser E2E | 15 passed / 0 failed / 0 skipped | [Summary](evidence/e2e-summary.json); Chromium, Firefox, WebKit; 5 сценариев на движок |
| Real file → two contexts | done | Отдельный Node-процесс заменяет файл; карточки/группы/notifications меняются без reload |
| API auth/CSRF/roundtrip | done | viewer/coordinator/demo-admin, private namespace, 46 полей, 18-digit IDs, preview/commit/export |
| AI live smoke | model / 384 dimensions / 4038 ms | [Настоящий ONNX inference](evidence/ai-smoke.json), 5 тезисов, evidence; mock тестируется отдельно |
| AI faults/stale/injection | done | tests/analysis.test.ts; нет инструментов/побочных действий модели |
| A11y | automated critical/serious = 0 в прошедших browser suites | Dashboard/login axe; ручная проверка ниже; не сертификат WCAG |
| Impeccable explicit detect | 0 mechanical findings | [JSON](evidence/impeccable-detect.json); hook не включался, visual pass этим не подменяется |
| Process restart / offline backup restore | done локально | tests/restart.test.ts + tests/recovery.test.ts; отдельный процесс/каталог |
| PostgreSQL restore и release rollback на VDS | done в проверенных контурах | Рабочий dump восстановлен в отдельной БД, все 11 таблиц совпали. Откат между релизами выполнен на staging. |
| HTTPS / внешний smoke | done | Два независимых браузерных контекста, обработка SSE, reconnect, Secure-cookie, ITSM, ИИ и проверка готовности после удаления тестовой учётной записи. |

Тестовые учётные данные случайны и остаются только в памяти/хеш-файле `.runtime`, trace/video выключены. Снимки экрана снимаются только на публичной синтетике без формы пароля. Исторические failure traces с credentials не сохранялись по прямому запрету пользователя; вместо них — точные причины, assertions и безопасные публичные screenshots в defects.md. CI workflow закреплён SHA actions; его remote run не равен локальному pass.

Ручная проверка: правильный reading order заголовок→источник→фильтры→4 группы; видимый focus, skip link, Enter открывает карточку и тот же ITSM ID. Явный tabindex=0 обеспечивает доступность ссылок/кнопок и в WebKit. 200% text zoom без horizontal overflow, reduced motion; null/просроченный срок, Research, длинные русские подписи и неизвестные поля не теряются. Узкий экран складывает все четыре группы вертикально. Контраст рассчитан по semantic palette (см. design report). Состояние не передаётся одним цветом.

Ограничения: покрыты обязательные описанные классы, а не все мыслимые комбинации; 50 последних изменений в UI detail, вся история в БД; лента уведомлений имеет страницы по 200. Авторизация single-process, повторный вход после рестарта ожидаем. Измерения PGlite/Windows не заменяют PostgreSQL/VDS.
