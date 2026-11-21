# Состояние реализации

Обновлено UTC 2026-11-21T00:23:51+00:00. Ветка feat/watermelon-dashboard-20261121, база research 54ae863, main cf4ad3f. PR2 открыт и не слит. Транскрипции и оригиналы не изменялись.

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
| Публичная активация и production rollback | blocked | Нужна системная установка через защищённый root-вход |
| DNS | done | Все четыре авторитетных NS Timeweb и два рекурсивных сервера возвращают 89.19.215.254 |
| TLS и внешний smoke | blocked | Системные прокси и приложение ожидают первоначальной установки |
| SSH password rotation/recovery | blocked | Только пользователь/защищённая консоль; root/password policy сохранена |
| Tooling lock | done | Версии/SHA/лицензии/capabilities/smoke; Astryx unverified |
| OpenSpec | done для завершённых этапов | strict validate; 49/55 задач отмечены; deployment и deferred остаются открыты |
| PR | done | [Draft PR #3](https://github.com/Lanutrix/mts_hackathon_2026/pull/3), main; без merge |
| F37–F40 | deferred | Адаптеры каналов/routing/ACK не реализованы |

Ничего из blocked не объявляется pass. Ветка опубликована, PR создан. Первый архив a5b35d4 передан и проверен по SHA-256. Выявленные на стенде дефекты исправлены в ветке PR. Следующее действие, зависящее от пользователя: защищённый интерактивный root-вход для bootstrap, ротация ранее раскрытого пароля и проверка recovery перед изменением SSH policy. Пароли/приватные ключи не присылать в чат.
