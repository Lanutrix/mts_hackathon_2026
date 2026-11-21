# Состояние реализации

Обновлено UTC 2026-11-20T23:56:12.848417+00:00. Ветка feat/watermelon-dashboard-20261121, база research 54ae863, main cf4ad3f. PR2 открыт и не слит. Транскрипции и оригиналы не изменялись.

| Этап | Статус | Доказательство / следующий шаг |
|---|---|---|
| Источники и требования | done | source-manifest, revised specs, D01–D14 сохранены |
| Domain/generator/ingestion | done | 120 комбинаций ×4 seeds; 16 datasets; 46 fields; original0/2/1/5; transactional history |
| UI/auth/AI | done локально | Реальные маршруты, read-only demo, роли/CSRF, ONNX smoke 3975ms |
| Browser suite | done | 15/15, unexpected=0; финальный отчёт qa/test-report.md |
| Figma | done с описанными handoff ограничениями | Редактируемые S01–S12, 5 ширин, states, tokens, prototype; Code Connect publish blocked |
| QA/performance | done локально | samples/soak, defects, coverage; PostgreSQL/VDS не подменён PGlite |
| VDS preflight/deploy key | done | Проверен host key, отдельный deploy, второй вход |
| VDS bootstrap/release/restore/rollback | blocked | Root interactive login не завершил bootstrap; psql/Node/app unit отсутствуют |
| DNS/TLS/external smoke | blocked | Нет DNS credentials; NXDOMAIN и authoritative timeout; domain не опубликован |
| SSH password rotation/recovery | blocked | Только пользователь/защищённая консоль; root/password policy сохранена |
| Tooling lock | done | Версии/SHA/лицензии/capabilities/smoke; Astryx unverified |
| OpenSpec | done для завершённых этапов | strict validate; 49/55 задач отмечены; deployment и deferred остаются открыты |
| PR | done | [Draft PR #3](https://github.com/Lanutrix/mts_hackathon_2026/pull/3), main; без merge |
| F37–F40 | deferred | Адаптеры каналов/routing/ACK не реализованы |

Ничего из blocked не объявляется pass. Ветка опубликована, PR создан. Release archive подготавливается отдельно и проверяется SHA-256; его загрузка не означает активацию. Следующее действие, зависящее от пользователя: защищённый интерактивный root-вход для bootstrap, подтверждение ротации пароля/recovery и контроль DNS. Пароли/приватные ключи не присылать в чат.
