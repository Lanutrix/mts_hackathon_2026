# Состояние реализации

Обновлено UTC 2026-11-21T08:31:26+00:00. Ветка feat/watermelon-dashboard-20261121, база research 54ae863, main cf4ad3f. PR2 открыт и не слит. Транскрипции и оригиналы не изменялись.

| Этап | Статус | Доказательство / следующий шаг |
|---|---|---|
| Источники и требования | done | source-manifest, revised specs, D01–D14 сохранены |
| Domain/generator/ingestion | done | 120 комбинаций ×4 seeds; 16 datasets; 46 fields; original0/2/1/5; transactional history |
| UI/auth/AI | done локально | Реальные маршруты, read-only demo, роли/CSRF, ONNX smoke 4038ms |
| Browser suite | done | 15/15, unexpected=0; финальный отчёт qa/test-report.md |
| Figma | done с описанными handoff ограничениями | Редактируемые S01–S12, 5 ширин, states, tokens, prototype; Code Connect publish blocked |
| QA/performance | done локально | samples/soak, defects, coverage; PostgreSQL/VDS не подменён PGlite |
| VDS preflight/deploy key | done | Проверен host key, отдельный deploy, второй вход |
| VDS staging, restore и откат | done | [Протокол](../qa/evidence/vds-staging.json). Две браузерные сессии, PostgreSQL 18.6, 11 таблиц восстановлены, переход на предыдущий коммит проверен |
| Публичный релиз | done | 166d769, системные службы включены, рабочая БД восстановлена отдельно и сверена по всем 11 таблицам. [Дашборд](https://mts-watermelon.ru/) |
| DNS | done | Все четыре авторитетных NS Timeweb и два рекурсивных сервера возвращают 89.19.215.254 |
| TLS и внешний smoke | done | HTTP 308, доверенный TLS, две сессии Chromium, запись файла, SSE/reconnect, вход и ИИ с пятью основаниями за 6635 мс. [Протокол](../qa/evidence/public-release.json) |
| SSH password rotation/recovery | deferred | Root-вход и отдельный ключ deploy проверены. Владелец поручил опубликовать стенд без ожидания подтверждения ротации и recovery-консоли. |
| Tooling lock | done | Версии/SHA/лицензии/capabilities/smoke; Astryx unverified |
| OpenSpec | done для завершённых этапов | 50/55. В 1.13 открыта проверка recovery провайдера, F37–F40 отложены. |
| PR | done | [Draft PR #3](https://github.com/Lanutrix/mts_hackathon_2026/pull/3), main; без merge |
| F37–F40 | deferred | Адаптеры каналов/routing/ACK не реализованы |

На домене работает релиз 166d769. PR открыт как draft. Откат между релизами проверялся на закрытом стенде. Это первый публичный релиз.
