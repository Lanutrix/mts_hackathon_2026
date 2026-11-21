# Архитектура текущего MVP

Решение проекта ADR-W01: модульный монолит Node.js + отдельный модуль worker, React/TypeScript/Vite. Один writer на namespace. PostgreSQL хранит projection, immutable before/after, snapshots, notifications/read state, ingestion и audit; входной файл авторитетен. Локальный PostgreSQL-совместимый стенд может использовать PGlite, а VDS — PostgreSQL при достаточных ресурсах (уточнение в stack-decision).

Поток: разрешённая директория → bounded stable read → parse/validate → canonical hash → транзакция snapshots/incidents/history/notifications/watermark → SSE с cursor. fs.watch подкреплён polling. Невалидный снимок сохраняет последнее принятое состояние и помечает его устаревшим. Пустой снимок/исчезновение записи не закрывают инцидент.

apps/web: S01–S12; apps/server: API/auth/SSE; apps/worker: чтение файла и jobs; packages/domain: чистые правила; packages/contracts: DTO/OpenAPI; packages/ui: tokens/components. Публичный стенд только synthetic read-only. Изменения доступны серверно авторизованному demo-admin и проходят обычный watcher. ИИ не меняет state и не имеет shell/tools.

Основные проверки: независимый oracle, file→DB→SSE→два браузера, восстановление snapshot после рестарта, RBAC/CSRF, malformed/import/export, stale AI и реальный inference. Полный перечень остаётся в [acceptance](acceptance.md). [Историческая архитектура](history/architecture.md) сохранена.
