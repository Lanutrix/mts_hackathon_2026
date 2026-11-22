# Источники, первичные документы и границы применимости

**Дата просмотра открытых источников:** 20 ноября 2026 года. **Методика:** проверены открытые официальные документы поставщиков инструментов, разработчиков стандартов и разработчиков практик, смежная техническая документация. Для каждого источника указаны автор/организация, заголовок, версия или дата публикации (если известна), дата обращения, конкретная применимость и предел вывода. Для «latest» и динамических страниц **дата публикации не установлена**: ссылка указывает на текущую документацию на дату проверки, а не на неизменную версию.

**Критическое ограничение:** эти документы **не** подтверждают наличия в МТС конкретной системы/настроек/SLA/команды, либо эффективности предлагаемого продукта. Отраслевые цифры «сократит время на N%» не обнаружены в применимых к данному проекту подтверждённых исходных данных; поэтому такие результаты не приводятся. Не заменять ITSM-классификацию руководствами по киберинцидентам.

## Внутренний корпус (не внешние доказательства о компании)

- [Запись 152 — транскрипция](../../../meetings/2026-11-20/transcripts/recording-152.md): первичная дискуссия о роли координатора, командах, ответственности. Автоматическая транскрипция; неопределённость терминов.
- [Запись 153 — транскрипция](../../../meetings/2026-11-20/transcripts/recording-153.md): каналы, три вида обращений, гипотеза 2/6/12, память правильной команды, архитектура и демо. Не регламент.
- [Запись 154 — транскрипция](../../../meetings/2026-11-20/transcripts/recording-154.md): изменение приоритета через три часа, HIL, уведомления/«дятел», UX, несколько координаторов. Не регламент.
- [Саммари встречи](../../../meetings/2026-11-20/summary.md) и [журнал решений](../../../requirements/incident-coordinator/decision-log.md): сжатое представление, не вместо расшифровок.
- [Architecture draft](../../../requirements/incident-coordinator/architecture.md), [workflows](../../../requirements/incident-coordinator/workflows.md), [Q01–Q25](../../../requirements/incident-coordinator/open-questions.md), [задание](../work-brief.md): авторская постановка и открытые вопросы.

## Проверенные внешние источники

### S01

**Google — Site Reliability Engineering Workbook: [Incident Response](https://sre.google/workbook/incident-response/)**.  
**Дата/версия:** SRE Workbook, 2018; глава доступна как онлайн-документация (отдельная дата последнего изменения не указана). **Обращение:** 20.11.2026. **Проверено:** различение management/mitigation, roles IC/CL/OL, 3C coordination/communication/control, заранее подготовленные каналы/контакты. **Применимость:** ролевая координация. **Не подтверждает:** роли, организацию МТС или показатели времени реакции МТС.

### S02

**Google — Site Reliability Engineering: [Managing Incidents](https://sre.google/sre-book/managing-incidents/)**.  
**Дата/версия:** книга Site Reliability Engineering, 2016, глава в открытой веб-версии, дата обновления не указана. **Обращение:** 20.11.2026. **Проверено:** command, operational work, communications, planning. **Применимость:** разделение ownership и инженерной работы. **Не подтверждает:** внутреннюю ITSM-структуру заказчика.

### S03

**Google — SRE Workbook: [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)**.  
**Дата/версия:** SRE Workbook, 2018; динамическое онлайн-представление. **Обращение:** 20.11.2026. **Проверено:** multi-window/multi-burn-rate alerting, компромисс detection/false positives. **Применимость:** снижение шума от мониторинга. **Ограничение:** SLO и метрики отсутствуют в корпусе МТС; цифры из книги не переносить на проект.

### S04

**Atlassian — [The incident management process: an ITIL workflow, step by step](https://www.atlassian.com/incident-management/itsm)**.  
**Дата/версия:** живая страница производителя, дата версии не указана. **Обращение:** 20.11.2026. **Проверено:** идентификация, регистрация, категоризация, impact/urgency, расследование/эскалация, закрытие при подтверждении. **Применимость:** популярная публичная интерпретация ITSM, **не официальный лицензированный текст ITIL**, не SLA МТС.

### S05

**Atlassian — [What is problem management?](https://www.atlassian.com/itsm/problem-management)**.  
**Дата/версия:** живая страница производителя, дата последнего обновления не указана. **Обращение:** 20.11.2026. **Проверено:** problem как причина или потенциальная причина инцидентов, отличие от восстановления услуги, связь с service requests и changes. **Применимость:** таксономия, не терминологический регламент МТС.

### S06

**PagerDuty — [Escalation Policy Basics](https://support.pagerduty.com/main/docs/escalation-policies)**.  
**Дата/версия:** живая документация продукта, версия/дата не указаны. **Обращение:** 20.11.2026. **Проверено:** escalation timeout, stop on acknowledgement, acknowledgement != resolution, on-call escalation. **Применимость:** пример отдельной семантики ACK. **Ограничение:** 30 минут у PagerDuty — не общая норма и не установленный срок МТС.

### S07

**Prometheus — [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)**.  
**Дата/версия:** ветка документации `latest`, изменяемая; точный продуктовый релиз на странице не закреплён. **Обращение:** 20.11.2026. **Проверено:** deduplication, grouping, routing, inhibition, silences. **Применимость:** дизайн корреляции/уведомлений; **не подтверждает**, что МТС использует Alertmanager.

### S08

**Grafana Labs — [Configure the webhook notifier for Alerting](https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/)**.  
**Дата/версия:** `latest` Grafana Alerting docs, динамическая страница, конкретный релиз не закреплён. **Обращение:** 20.11.2026. **Проверено:** JSON webhook payload, `alerts[]`, `fingerprint`, `startsAt`, `status`, HMAC signatures, resolved messages, optional custom payloads. **Применимость:** правдоподобный mock adapter; **не** фактический контракт webhook МТС.

### S09

**CNCF CloudEvents — [CloudEvents Specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)** и [перечень версий](https://github.com/cloudevents/spec).  
**Дата/версия:** последняя отмеченная стабильная версия **v1.0.2** в официальном репозитории; ссылка на `main` — развивающаяся ветка, её дата изменения не фиксирована. **Обращение:** 20.11.2026. **Проверено:** уникальность `source + id`, mandatory `type`/`source`/`id`/`specversion`, optional `time` в RFC3339, ограничения на sensitive metadata. **Применимость:** принципы event identity; канонический Incident JSON проекта **не заявляется CloudEvents-compliant**.

### S10

**OpenTelemetry — [Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)**.  
**Дата/версия:** помечен **Stable** на дату обращения, версия спецификации на данной странице не закреплена. **Обращение:** 20.11.2026. **Проверено:** `Timestamp` (произошло) vs `ObservedTimestamp` (замечено/получено), поля trace ID, severity, resource/attributes. **Применимость:** временные и observability-поля; **не** нормативная дефиниция SLA.

### S11

**JSON Schema — [Draft 2020-12](https://json-schema.org/draft/2020-12)**.  
**Дата/версия:** опубликовано **16.06.2022**, draft 2020-12. **Обращение:** 20.11.2026. **Проверено:** типизация и валидация JSON, `properties`, `required`, `items`, `format` vocabulary. **Применимость:** вариант валидации IN schema; реализация должна включать поддержку `format` assertion отдельно.

### S12

**scikit-learn — [TfidfVectorizer](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html)**.  
**Дата/версия:** documentation `stable`, при проверке маркировка пакета **1.9.1**, дата публикации страницы не указана. **Обращение:** 20.11.2026. **Проверено:** word/character n-grams, TF-IDF representation, нормировка. **Применимость:** низкозатратный lexical baseline; не доказательство его точности на МТС.

### S13

**scikit-learn — [Probability calibration](https://scikit-learn.org/stable/modules/calibration)**.  
**Дата/версия:** `stable`, при проверке документы **1.9.1**, публикация страницы не указана. **Обращение:** 20.11.2026. **Проверено:** confidence requires calibration; calibration curves, Brier/log-loss caveats. **Применимость:** отказ от псевдоуверенности score=probability.

### S14

**scikit-learn — [top_k_accuracy_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.top_k_accuracy_score.html)**.  
**Дата/версия:** `stable` документация **1.9.1** при проверке, публикация страницы не указана. **Обращение:** 20.11.2026. **Проверено:** корректный top-k для single-label задачи, не multilabel. **Применимость:** routing benchmark при одном эталонном owner.

### S15

**OWASP GenAI Security Project — [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)**.  
**Дата/версия:** LLM Top 10 **2025** (risk identifier LLM01:2025), дата последней правки онлайн-страницы не указана. **Обращение:** 20.11.2026. **Проверено:** prompt injection, недоверенные инструкции в данных, least privilege, approval for high-risk actions. **Применимость:** read-only retrieval / LLM suggestions. **Не утверждает:** абсолютную безопасность от filtering/RAG.

### S16

**GitHub Docs — [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)**.  
**Дата/версия:** живая GitHub REST webhook documentation, версия/дата изменения не указаны. **Обращение:** 20.11.2026. **Проверено:** signatures/HTTPS, delivery ID/retries, async queue. **Применимость:** инженерная аналогия для OUT; **не** интеграция GitHub в решение МТС.

### S17

**AWS — [REL05-BP03 Control and limit retry calls](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html)**.  
**Дата/версия:** AWS Well-Architected Framework, `latest`, динамическая версия; сравнимый [датированный snapshot 2022-03-31](https://docs.aws.amazon.com/wellarchitected/2022-03-31/framework/rel_mitigate_interaction_failure_limit_retries.html). **Обращение:** 20.11.2026. **Проверено:** ограниченный exponential backoff, jitter, запрет retry storm, idempotency. **Применимость:** OUT/retry policy; выбранные числа retry в отчётах — демо-параметры, а не стандарт AWS.

### S18

**PostgreSQL — [PostgreSQL 18: SELECT](https://www.postgresql.org/docs/18/sql-select.html)**.  
**Дата/версия:** документация **PostgreSQL 18** (путь фиксирует major release), конкретная дата изменения страницы не установлена. **Обращение:** 20.11.2026. **Проверено:** `FOR UPDATE`/`SKIP LOCKED` и caveat об inconsistent view, допустимость для очередеподобных таблиц. **Применимость:** queue claim concurrency; возможен и иной DB/optimistic CAS.

### S19

**Минтруд России — [Федеральный закон от 27.07.2006 №152-ФЗ «О персональных данных»](https://mintrud.gov.ru/docs/laws/130)**.  
**Дата/версия:** закон №152-ФЗ от **27.07.2006**; опубликованная государственным органом страница **не гарантирует актуальность всех поправок на 20.11.2026**. **Обращение:** 20.11.2026. **Проверено:** общие принципы законности, ограничения цели, минимизации, точности и срока хранения. **Применимость:** правовой ориентир при обработке ПДн в российском контуре; **не юридическое заключение**, обязательна проверка актуальной редакции и юрисдикций.

### S20

**NIST — [SP 800-61 Revision 3: Incident Response Recommendations and Considerations for Cybersecurity Risk Management](https://csrc.nist.gov/pubs/sp/800/61/r3/final)**.  
**Дата/версия:** **3 апреля 2025**, Final Rev. 3, supersedes Rev. 2 (2012); DOI **10.6028/NIST.SP.800-61r3** указан NIST. **Обращение:** 20.11.2026. **Проверено:** incident response как часть cybersecurity risk management, preparedness/detection/response/recovery. **Применимость:** только связанные с ИБ-инцидентами риски; **не** документ об обычном service desk и **не** источник дедлайнов МТС.

### S21

**MDN Web Docs — [If-Match request header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match)**.  
**Дата/версия:** динамическая справка HTTP, дата последней редакции на странице не подтверждена. **Обращение:** 20.11.2026. **Проверено:** conditional writes `If-Match`, strong ETag и `412 Precondition Failed` для предотвращения lost updates. **Применимость:** возможный транспорт optimistic concurrency; сам проект может использовать DB version + HTTP `409` вместо ETag.

## Границы достоверности и запросы на дополнительные доказательства

- **Только сведения участников:** формулировка задачи, 2/6/12, три типа, предполагаемые каналы, «PILA», идея автоматического reset, модульные команды, «дятел» и 30 минут. Автоматическая транскрипция, собеседники не размечены; [записи](../../../meetings/2026-11-20/README.md) не являются утверждённым договором.
- **Отсутствует:** официальный внутренний регламент инцидентов/priority/SLA, CMDB, каталог команд, ИТ-архитектура заказчика, примеры payload, реальные incident event logs, разрешённая оценочная разметка, полевые замеры, подтверждённые затраты coordinator time, протокол безопасности/PII.
- **Следствие:** [Q01–Q25](10-open-questions-answered.md) нельзя считать подтверждённо закрытыми, а [синтетический demo](08-mvp-demo-and-synthetic-data.md) нельзя выдавать за production benchmark.
- **Протокол обновления:** для каждого дополненного корпоративного факта записать документ+редакцию+дату+scope+разрешение, автора проверки и ADR; при конфликте — не переносить невидимое изменение в «официальный» статус без согласования.

[Оглавление](README.md) · [Executive summary](00-executive-summary.md).
