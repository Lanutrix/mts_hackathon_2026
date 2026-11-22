> Историческая редакция 20.11.2026. Объём MVP уточнён по официальному кейсу: [новая редакция](../../../requirements/incident-coordinator/official-case-revision.md). IN/ANL/OUT и ACK не являются обязательным ядром дашборда. Исходный текст сохранён ниже.

# 06. OUT, Human-in-the-loop, уведомления и доказательство результата

**Граница ответственности:** OUT управляет двусторонними сообщениями и доказуемыми переходами, но не «чинит» сервис за команду. Такова [позиция участников встречи](../../../meetings/2026-11-20/summary.md); формат ниже — **предложение для MVP**. Различение ACK и resolution демонстрирует [PagerDuty, S06](sources.md#s06).

## 1. Независимые состояния доставки, назначения и работы

| Контур | Состояние | Критерий/событие |
|---|---|---|
| Транспорт | `QUEUED` | Намерение доставки записано в outbox |
| Транспорт | `SENT` | Адаптер сделал попытку; подтверждение доставки ещё неизвестно |
| Транспорт | `DELIVERED` | Внешний канал ответил доверенным receipt; не означает, что человек прочёл |
| Транспорт | `FAILED_RETRYABLE` / `FAILED_FINAL` | Ограниченные ретраи / DLQ |
| Назначение | `OFFERED` | Команде предложена ответственность |
| Назначение | `ACKED` | Авторизованный responder **принял** `assignment_id` |
| Назначение | `REJECTED` / `TIMED_OUT` / `SUPERSEDED` | Причина отклонения, возврат маршрута |
| Работа | `IN_PROGRESS` | Ответственная команда заявила начало |
| Работа | `RESOLUTION_PROPOSED` | Команда сообщает результат и evidence |
| Проверка | `VERIFICATION_REQUESTED` → `PASSED` / `FAILED` / `UNKNOWN` | Инициатор или доверенный сигнал подтверждает |
| Incident | `CLOSED` | `PASSED` с evidence + разрешённый actor |

**Инвариант:** `SENT != DELIVERED != ACKED != RESOLUTION_PROPOSED != VERIFIED`. Не сводить в один status.

## 2. Двунаправленный протокол MVP (синтетический)

```json
{
  "schema_version": "outbound-action.v0.1",
  "message_id": "out-demo-007",
  "event_type": "assignment.offer",
  "incident_id": "inc-demo-007",
  "assignment_id": "asgn-007-2",
  "incident_version": 8,
  "target": {"kind": "team", "id": "team-platform", "channel": "demo-web"},
  "idempotency_key": "inc-demo-007:asgn-007-2:offer:v1",
  "deadline_at": "2026-11-20T10:17:00Z",
  "payload": {
    "title_redacted": "Деградация balance-api",
    "priority": "P2",
    "service_id": "balance-api",
    "reason_codes": ["service_owner_match", "verified_history"],
    "action_urls": ["demo://assignments/asgn-007-2"]
  },
  "created_at": "2026-11-20T10:02:00Z",
  "source": "SYNTHETIC"
}
```

```json
{
  "schema_version": "outbound-reply.v0.1",
  "event_type": "assignment.ack",
  "message_id": "reply-demo-008",
  "incident_id": "inc-demo-007",
  "assignment_id": "asgn-007-2",
  "expected_incident_version": 8,
  "actor": {"id": "team-platform-responder-1", "role": "responder"},
  "action": "ACK",
  "reason": "Taking ownership",
  "evidence_refs": [],
  "occurred_at": "2026-11-20T10:03:05Z",
  "source": "SYNTHETIC"
}
```

Контракт `assignment.reject`: обязательно `reason_code = NOT_OWNER|NO_ACCESS|NOT_ON_CALL|INSUFFICIENT_INFO|OTHER` и комментарий для OTHER; `resolution.propose`: обязательно `evidence_refs[]`, `scope`, `proposed_at`; `verification.result`: `PASSED|FAILED|UNKNOWN`, `verifier_kind`, `verifier_id`, `evidence_ref` и timestamp. `UNKNOWN` не конвертируется в `PASSED`.

## 3. Надёжность и идемпотентность

**[Рекомендация]** Транзакционно записывать `assignment_attempt`, смену версии инцидента, `event_log` и `outbox` в одной DB-транзакции. Асинхронный publisher отправляет по `idempotency_key` с `at-least-once delivery`. При повторе потребитель проверяет уникальность ключа и `assignment_id` — нет второго ACK/второй задачи. Входящие callbacks аутентифицировать и подписывать где возможно. `DELIVERED` в mock = сервер mock adapter подтвердил delivery; это не proof участия сотрудника.

Отказы: timeout/5xx/429 => ограниченный backoff + jitter; 400 schema/403 auth => **не** ретраить без правки конфигурации; 409 version conflict => повторное чтение инцидента, **не** слепая попытка снова изменить; retry exhausted => DLQ + alert coordinator. AWS рекомендует bounded exponential backoff+jitter и предупреждает о retry storm [S17](sources.md#s17); GitHub webhook best practices документируют подписи, повторные delivery и подтверждения [S16](sources.md#s16) — применяем как общие инженерные паттерны, не данные МТС.

**Иллюстративный конфиг, не реальный регламент:**
```yaml
outbox:
  attempts_max: 4
  backoff_seconds: [2, 5, 15, 45]
  jitter_ratio: 0.2
  dead_letter_on_exhaustion: true
ack:
  timeout_minutes: 15 # ONLY_DEMO
  reminder_at_fraction_of_budget: 0.6
  escalation_at_fraction_of_budget: 1.0
notifications:
  max_duplicate_per_transition: 1
  merge_window_minutes: 5
  quiet_hours_override: "critical_only" # demo, needs approval
```

## 4. Режим «дятел» как policy-controlled escalation

**[Участники]** Напоминание каждые 30 минут — **пример** [запись 154](../../../meetings/2026-11-20/transcripts/recording-154.md), не утверждённая частота. Не использовать без ограничений.

| Триггер | Получатель | Частота / stop condition | Приоритет |
|---|---|---|---|
| New proposed assignment | Primary responder/on-call | 1 раз на attempt; повтор только при транспортном fail | Нормальный |
| ACK not seen at `0.6×ack_budget` | Primary responder | 1 reminder на этап | Только после доставки |
| ACK deadline exceeded | Lead + coordinator | 1 escalation event; повтор ограничен policy | Высокий |
| Priority raised / breached | Coordinator + lead | При каждой **реальной** смене, дедуп по incident version | Высокий |
| Rejected / reassigned | Coordinator и актуальный team owner | По одному уведомлению на новое состояние | Высокий |
| Resolution proposed | Инициатор / verifier | Один запрос, затем review по deadline | Нормальный |
| Verified closed | Инициатор, owner | Итоговый outcome без подробных PII | Информационный |

Реализовать `cooldown`, per-team budget, aggregation by incident/master, escalation cap, acknowledgment/snooze with audit, suppression во время maintenance, opt-in channels; один критичный блок не забивать 30 одинаковыми push. Измерять `notifications_per_incident`, `unacknowledged_pages`, `noise_ratio`; важнее довести до ACK, чем количество отправленных напоминаний. Alertmanager поддерживает grouping/inhibition/silencing [S07](sources.md#s07); Google SRE описывает снижение false positives [S03](sources.md#s03).

## 5. Verification по происхождению

| Источник | Что считать evidence | Что НЕ считать proof |
|---|---|---|
| Пользователь/сотрудник | Explicit confirm из того же авторизованного ticket thread | «Команда сказала готово» |
| Monitoring | `resolved` коррелированного alert generation + стабильность метрики/SLI через проверяемое окно | Один случайный sample, устаревший resolved |
| Жалобы агрегатора | Снижение/прекращение подтверждённых жалоб с учётом задержки и репрезентативности, возможно HIL | Тишина канала при outage агрегатора |
| Телефон/ASR | Доверенный human callback/ответ инициатора | ASR предположил «решено» |
| Источник недоступен | `UNKNOWN`, ответственный reviewer/ручное решение с причиной | Автозакрытие от таймаута |

**[Гипотеза]** 5 минут стабильности SLI перед confirm для демо; не нормативное условие МТС. Resolver не может подтвердить собственную работу как independent verifier без отдельной авторизации.

## 6. Human-in-the-loop и права

- Coordinator: принять/переопределить команду, приоритет и owner с причиной; не может незаметно менять логи.
- Responder: ACK/reject, updates, evidence, propose resolved; не может переписать вход или изменить approved SLA-policy.
- Initiator: видеть свои обращения; подтвердить/отклонить результат; не видит чужие записи.
- Auditor: read-only timeline/export по правилам доступа.
- System: только safe allowlist + deadlines/escalation; вне allowlist — предложить, не действовать.
- Policy admin (вне MVP): версионирование catalog/policy; не retroactively править таймеры.

**Failure-safe:** если ML/OUT/monitoring не отвечает, UI показывает «нужен человек», сохраняется raw+audit, не появляется ложное ACK/verified. Prompt injection из входа — не инструкции для webhook/agent [OWASP S15](sources.md#s15).

## 7. Тесты

`OUT-01` delivered без ACK не останавливает таймер; `OUT-02` два callback ACK с одним ID → одно состояние; `OUT-03` 503→retry→success → одна assignment; `OUT-04` постоянный 403→DLQ и сообщение без бесконечного retry; `OUT-05` reject reason missing→422; `OUT-06` старый callback по `assignment_id` отвергнут после reassign; `OUT-07` source outage→verification UNKNOWN; `OUT-08` 100 алертов master incident→bounded notification budget; `OUT-09` параллельные координаторы не могут оба override одной версии; `OUT-10` запись `resolution.propose` без `verification.PASSED` не закрывает инцидент.

[Lifecycle](04-sla-priority-lifecycle.md) · [UX](07-ux-and-user-flows.md) · [Risk/tests](09-quality-evaluation-and-risks.md).
