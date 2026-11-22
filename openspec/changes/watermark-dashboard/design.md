# Design
## Context
Исходный массив 44×46, четыре группы 0/2/1/5. Сервер 1 CPU/889 MB. Вся доменная семантика в docs/requirements/incident-coordinator.
## Goals / Non-Goals
Цель: доказуемый file→UI, достоверные статусы и полезный ИИ. Автоматическое назначение, ACK и реальные ITSM-записи вне P0.
## Decisions
Чистые правила, raw-preserving projection, canonical hash только последнего snapshot, транзакционные события, последовательный cursor SSE, degraded display, secure session/CSRF, synthetic namespace. Deadline из файла, без расчёта SLA.
## Risks / Trade-offs
Малая память VDS требует локальной сборки и ограничения runtime. DNS и credentials — внешние зависимости; их статус нельзя заменить HTTP 200. Реальный AI acceptance отдельно от mock.
## Migration Plan
Новая БД с additive migrations; backup/restore в отдельном namespace; неизменяемые releases и возврат предыдущего symlink после smoke. Существующие сайты и SSH не отключать.
## Open Questions
См. docs/requirements/incident-coordinator/open-questions.md.
