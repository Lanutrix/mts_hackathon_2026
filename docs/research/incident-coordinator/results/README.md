> Историческая редакция 20.11.2026. Объём MVP уточнён по официальному кейсу: [новая редакция](../../../requirements/incident-coordinator/official-case-revision.md). IN/ANL/OUT и ACK не являются обязательным ядром дашборда. Исходный текст сохранён ниже.

# Результаты исследования: интеллектуальный координатор инцидентов

**Статус:** исследование и проектная спецификация подготовлены, **не согласованы с заказчиком**.  
**Дата анализа:** 20 ноября 2026 года. **Основание:** [техническое задание](../work-brief.md), [все три записи обсуждения](../../../meetings/2026-11-20/README.md), [исходные требования](../../../requirements/incident-coordinator/README.md).  
**Доказательная политика:** на каждой теме различаются **внешний подтверждённый факт**, **слова участников**, **инженерная рекомендация**, **рабочая гипотеза** и **пробел данных**. Не представлены внутренние SLA, каталог команд, дампы инцидентов и реальный baseline МТС.

## Читать в первую очередь

- **[00 — Executive summary](00-executive-summary.md):** ключевые выводы, MVP, KPI «время до ACK корректной команды», неопределённости.
- **[10 — Ответы Q01–Q25](10-open-questions-answered.md):** что можно ответить, что остаётся неизвестным, кто и чем может подтвердить.
- **[11 — ADR и план реализации](11-recommended-decisions-and-roadmap.md):** предложения решений, scope, порядок работ, вопросы ментору.
- **[Источники](sources.md):** первичная документация, дата/версия, обращение, ограничения применимости.

## Все отчёты

| Файл | Область | Содержание / проверяемый результат |
|---|---|---|
| [00-executive-summary.md](00-executive-summary.md) | Решение | Рамки задачи, факты и неизвестное, гипотезы MVP, метрики |
| [01-domain-and-process.md](01-domain-and-process.md) | Предметная область | Incident/event/alert/problem/request, процесс, потери времени |
| [02-input-channels-and-data.md](02-input-channels-and-data.md) | IN | Адаптеры, типизация, canonical JSON, JSON Schema, восемь синтетических входов |
| [03-team-catalog-and-routing.md](03-team-catalog-and-routing.md) | Команды | Синтетический каталог, ownership, multi-team, routing, негативные кейсы |
| [04-sla-priority-lifecycle.md](04-sla-priority-lifecycle.md) | SLA | Раздельные часы, четыре политики смены приоритета, state machine, инварианты |
| [05-analytics-ml-and-memory.md](05-analytics-ml-and-memory.md) | ANL | Rules/TF-IDF/embeddings/LLM/RAG, confidence, abstain, verified feedback |
| [06-outbound-hil-and-notifications.md](06-outbound-hil-and-notifications.md) | OUT/HIL | Отправка vs доставка vs ACK, retry, верификация, безопасные уведомления |
| [07-ux-and-user-flows.md](07-ux-and-user-flows.md) | UX | Три user flow, пять экранов, таймеры, multi-coordinator conflicts |
| [08-mvp-demo-and-synthetic-data.md](08-mvp-demo-and-synthetic-data.md) | MVP | MUST/SHOULD/DEFER, synthetic generator, сценарий жюри и ×10 clock |
| [09-quality-evaluation-and-risks.md](09-quality-evaluation-and-risks.md) | QE | Формулы KPI, baseline protocol, 20 тестов, оценки рисков |
| [10-open-questions-answered.md](10-open-questions-answered.md) | Q01–Q25 | Все исходные вопросы со статусами, источниками и ответственными за проверку |
| [11-recommended-decisions-and-roadmap.md](11-recommended-decisions-and-roadmap.md) | Решения | 15 предложенных ADR, гейты и приоритеты работ |
| [sources.md](sources.md) | Библиография | Реестр внешних первоисточников и внутренних материалов, даты, applicability |

## Последовательность работы для команды

1. Прочитать [00](00-executive-summary.md) и согласовать с ментором определения **reaction / ACK / restoration / resolution** из [10](10-open-questions-answered.md). **2/6/12 часов — только слова участников**, не установленный SLA.
2. Зафиксировать схемы [IN](02-input-channels-and-data.md), [каталога команд](03-team-catalog-and-routing.md), [политику SLA и статусов](04-sla-priority-lifecycle.md), [OUT](06-outbound-hil-and-notifications.md).
3. Реализовать сквозной [MVP](08-mvp-demo-and-synthetic-data.md) с журналом событий и человеческой проверкой; провести протокольные [тесты и измерения](09-quality-evaluation-and-risks.md).
4. Только после разрешения на обработку данных и согласования политики обсуждать пилот с реальными обращениями; не выводить бизнес-эффект из синтетического replay.

## Оговорки и границы

- Все показанные incident payload, team IDs, priоrities, timings, log records и экспериментальные доли — **синтетические примеры или план**, не сведения о production МТС.
- **Ни один benchmark не был исполнен**: отчёты описывают воспроизводимый протокол, а не фактические измерения. Реальное сокращение времени реакции на данных заказчика **не установлено**.
- Документы заказчика не предоставлены: Q01–Q25 остаются открытыми до подтверждения соответствующим владельцем процесса.
- Исходные [расшифровки](../../../meetings/2026-11-20/README.md) не изменялись и не подменялись саммари. Если обнаружены ошибки автоматической речи, требуется подтверждение аудиозаписями.
- Предлагаемые решения не меняют [исходный decision-log](../../../requirements/incident-coordinator/decision-log.md), их можно утверждать отдельно.

[← Задание](../work-brief.md) · [↑ Исследовательский раздел](../README.md) · [Карта документации](../../../README.md)
