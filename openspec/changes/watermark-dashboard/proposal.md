# Proposal
## Why
Официальный кейс требует наблюдать исходный файл, быстро замечать критические инциденты и назначения. Прежний исследовательский scope IN/ANL/OUT не соответствует обязательному dashboard MVP.
## What Changes
- Четыре независимые группы, карточка, history, notices и wallboard.
- Надёжный файловый ingestion исходного массива, PostgreSQL projection, SSE/recovery.
- Анализ с evidence, безопасные роли, импорт/экспорт и воспроизводимая синтетика.
- Редактируемый Figma, матрица F01–F40, проверяемый release на VDS.
## Capabilities
### New Capabilities
- `incident-observation`: группы, статусы, сроки, качество и история.
- `snapshot-ingestion`: файловые снимки, persistence и realtime.
- `coordinator-workspace`: интерфейс, уведомления, анализ, доступ и демо.
### Modified Capabilities
Нет существующих specs.
## Impact
apps/web, apps/server, apps/worker, packages/domain/contracts/ui, migrations, tests, deploy и docs. Исторические транскрипции неизменны. Публично только синтетика.
