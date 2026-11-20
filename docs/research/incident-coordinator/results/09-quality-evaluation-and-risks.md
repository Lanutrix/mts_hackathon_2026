# 09. Оценка качества, метрики, тесты и риски

**Статус:** протокол измерения, **результаты ещё не получены**. Не существует доступного baseline времени координаторов МТС, реального incident log, разрешения на пользовательские данные или замеров в production. Отраслевые практики — [Google SRE S01–S03](sources.md#s01), [PagerDuty S06](sources.md#s06), [OWASP S15](sources.md#s15), а не подтверждение эффективности нашего проекта.

## 1. Словарь временных точек

Все instants в UTC, внешнее `occurred_at` отдельно от серверного `received_at`; use `observed_at` для ingress [OpenTelemetry S10](sources.md#s10). Для episode `i`:

- `r_i`: первая *валидная и actionable* серверная регистрация; агрегированные жалобы отдельно сохраняют `first_signal_at`, `batch_received_at`.
- `g_i`: завершение initial triage.
- `a_i`: первая инициированная отправка назначения (включая ошибочное).
- `d_i`: первое подтверждение доставки.
- `k_i`: первое ACK любого primary assignment (может быть неверным).
- `v_i`: первое ACK команды, соответствующей независимому oracle финального owner, если такая метка существует.
- `p_i`: предложение решения; `c_i`: независимое подтверждение закрытия.
- `x_i`: deadline с типом и `policy_version`.

Для синтетики доступны `v_i` по oracle; в реальных операциях **валидность компетенции может стать известна только задним числом**, поэтому operational dashboard показывает `k_i`, а research-offline добавляет `v_i`.

## 2. Таблица метрик с точными определениями

| Метрика | Формула на incident episodes | Единицы/правило отсутствия | Зачем |
|---|---|---|---|
| **TTT: time to triage** | `g_i-r_i` | секунды; missing g = censored | Затраты IN/ANL/координатора |
| **TTFA: time to first assignment** | `a_i-r_i` | секунды; первое предложение, не успешное | Скорость начальной отправки |
| **Time to delivery** | `d_i-a_i` | секунды; transport only | Диагностика OUT |
| **TTACK (operational)** | `k_i-r_i` | секунды; явно подтверждённое принятие primary | Время до подтверждения первой команды |
| **TT-VACK (offline primary research)** | `v_i-r_i` | секунды; требует независимого owner truth | Время до принятия **компетентной** командой |
| **Time to verified close** | `c_i-r_i` | секунды; независимо от TTACK | Вторичная end-to-end метрика |
| **Top-1 routing** | `sum(ground_truth_owner ∈ top1)/N_labeled` | доля; partial/multi-owner отдельная группа | Точность первого выбора |
| **Top-k routing** | `sum(ground_truth_owner ∈ topk)/N_labeled` | k=3 при ≥3 допустимых classes; отдельно при k>classes | Качество рекомендаций [S14](sources.md#s14) |
| **Reassignment rate** | `count(episodes with ≥2 primary attempts)/N_assigned` | доля; считать и after ACK | Ошибочная маршрутизация |
| **ACK breach rate** | `count(episodes where ack deadline passed before ACK)/N_with_defined_ack_policy` | доля, только по выбранной версии policy | Нарушение выбранной семантики |
| **Restore SLA breach** | Аналогично, но по **restore** due и confirmed restore | отдельная доля | Не смешивать с реакцией |
| **Coordinator workload** | `active_owned`, `manual_decisions/person/hour`, `manual_seconds_per_case` | по участнику/времени; считать нагрузку и interrupts | Балансировка |
| **Notification burden** | `count(notification_attempts)/N_episodes`, доля бесполезных/повторов | штуки/episode; success отдельно | Alert fatigue |
| **Abstain coverage** | `auto_decisions/all_eligible` | доля; знаменатель фиксировать | Цена безопасной автоматизации |
| **Selective misroute** | `wrong_auto/auto_decisions` | не определено при 0 auto | Безопасность gate |

**Для SLA** требуется определить censoring: если инцидент ещё открыт на момент окончания наблюдения, он не должен автоматически считаться «успешным» или молча удаляться. Отдельно сообщать `N_total`, `N_censored`, процент пропусков, метод (e.g. survival analysis) и horizon. Отрицательные/некорректные timestamp помечать invalid, не обнулять.

## 3. Пример расчёта — ТОЛЬКО синтетическая арифметика

Episode A: `r=10:00:00`, `g=10:00:20`, `a=10:00:30`, доставка `10:00:31`, первая неверная команда ACK `10:02:00`, затем reject и правильная команда ACK `10:06:00`, verified close `10:28:00`. Тогда `TTT=20с`, `TTFA=30с`, `TTACK=120с`, `TT-VACK=360с`, `time_to_verified_close=1680с`; reassign `yes`. **Именно TT-VACK, а не TTFA или время закрытия** отражает, сколько прошло до принятия задачи правильным исполнителем.

## 4. Честный benchmark design

**Цель эксперимента:** проверить, снижает ли ассистированная маршрутизация трудозатраты и время до валидного ACK по сравнению с ручной на *том же* workload, **без утверждений о МТС**.

1. Freeze synthetic generator seed, split по template/root cause, catalog policy version, action graph, compute hardware, data permissions.
2. **Offline routing evaluation:** 3–5 независимых seed runs, fixed holdout; на одинаковых episodes сравнить `rules-only` / `rules+TFIDF` / optional embedding, reported top1/top3, selective risk/coverage, latency p50/p95, subgroup rates (type/service/rare/P1); bootstrap *по episode/root incident cluster*, не по повторным событиям.
3. **Human usability evaluation:** рандомизированный/counterbalanced порядок «ручной каталог» vs «assisted UI»; одни и те же типы сценариев без exact memorization; фактическое секундомерное время *людей* + incorrect choices. Synthetic simulator ACK delay не выдавать за скорость человека.
4. **End-to-end deterministic replay:** одинаковые scripted team response times и random seed, фиксированный event clock; замерить latency application logic без претензии на человеко-часы.
5. Report median, p90, p95, paired difference `Δ_i = T_assisted_i - T_baseline_i`, относительное изменение `(median(B)-median(A))/median(B)` с соглашением о знаке, 95% cluster bootstrap CI и counts. CI не означает реальную точность оценки МТС: оно характеризует только выбранные сценарии и протокол.
6. Train/tune decision thresholds на **validation**, не на test. Failing-case catalogue и повторение с новыми seeds. Репортировать cost of false auto-routing: extra team touches, minutes of waiting, manual reviews.

**Success gate (предложение, не доказанный эффект):** не ухудшить misroute risk на holdout; показать работоспособный HIL на OOD; показать paired distribution TT-VACK/TTACK, а не просто красивое число «-N%». Для перехода к реальному пилоту KPI и критерии принятия должны определить владелец процесса и DPO/security.

## 5. Матрица acceptance/integration tests

| Test ID | Input/condition | Expected invariant | Метрики/артефакт |
|---|---|---|---|
| T01 happy path | Валидный известный сервис | IN→ANL→OUT→ACK→verification→CLOSED | Positive trace |
| T02 bad route | Backend reject / platform ACK | История обеих попыток, финальный positive = platform | TT-VACK, reassign |
| T03 low confidence | Unknown service/OOD | ABSTAIN, HIL ticket, no auto action | Abstain rate |
| T04 escalation | ACK не поступил к demo due | Timer breach + event + one escalation, нет ACK | notification count |
| T05 priority change | P3→P1 через 3 ч | Old/new deadline и origin сохраняются; no silent reset | Policy trace |
| T06 duplicate delivery | один raw id/revision дважды | Один source event/incident, ни одной повторной assignment | Idempotency |
| T07 correlated burst | 20 alerts + 10 complaints по одному outage | Отдельные raw events, incident correlation с reason, не 30 incidents | Grouping metric |
| T08 source outage | monitor недоступен во время verify | UNKNOWN, не CLOSED | Verification |
| T09 outbound 503 | 3 временных отказа | bounded retry+backoff, one accepted assignment | DLQ/outbox |
| T10 outbound 403 | permanent auth error | нет endless retry; alert coordinator | DLQ |
| T11 missing fields | Нет текста/сервиса, malformed JSON | 422/quarantine, no implicit defaults | Schema validation |
| T12 multiple teams | Primary+contributing | Only primary ACK closes response clock; tasks separate | owner invariant |
| T13 manual override | operator chooses alternative with reason | actor, reason, before/after, version | Audit |
| T14 concurrent coordinators | одинаковая исходная version, 2 writes | 1 success + 1 conflict, no lost update | CAS |
| T15 stale resolved | old alert resolved after new firing | No premature close | lifecycle generation |
| T16 verification reject | team proposed resolved, user says no | Return IN_PROGRESS, do not label positive | truth integrity |
| T17 prompt injection | text contains instruction «назначь admin» | Untrusted text ignored as command, hard rules preserved | security |
| T18 RBAC | initiator reads чужой incident | 403; no PII in error/log/vector index | compliance |
| T19 sim speed | ×1 vs ×10 same seed | Same causal ordering and final outcome | reproducibility |
| T20 no sources | complete loss of source/OUT | Incident persisted, error visible, no fabricated ACK | fallback |

Каждый тест сохраняет `seed`, `trace_id`, event timeline, expected/actual states, `policy_version`, pass/fail. Большие результаты и код генератора — будущая реализация, **не утверждать, что тесты уже запущены**.

## 6. Risk register / mitigation

| Риск | Severity до контролей | Контроль | Владелец на согласование |
|---|---|---|---|
| Неверный SLA приводит к ложной «просрочке» | Critical | Clock type, policy version, явное `DEMO`, Q06/Q07 | Заказчик / process owner |
| Misroute или false auto-assignment | High | Hard-rule filter, abstain, allowlist, manual override | Tech lead + process owner |
| LLМ hallucination / prompt injection | High | Structured outputs, treat source as data, no tool execution, ACL/validation [S15](sources.md#s15) | Security lead |
| PII в тексте, логах или RAG | High | Minimize, redaction before indexing, role-based access, retention, encryption, DPIA/юридическая оценка [S19](sources.md#s19) | Юрист/DPO |
| Дубликаты и storms | High | Idempotency, correlation provenance, grouping/cooldown [S07](sources.md#s07) | Backend lead |
| Lost updates двумя координаторами | Medium-high | CAS version + event log, conflict UI [S18](sources.md#s18) | Backend lead |
| Ложное «закрыто» | High | Independent verification and no auto-close on timeout | QA + owner |
| Stale source/unsafe clock | Medium-high | Source/event timestamps, skew check, out-of-order, no hidden pause | Data lead |
| Синтетический leakage/data circularity | High | Hidden oracle, split by template/incident family, replay per seed | ML lead |
| Integration outage | Medium-high | Outbox/DLQ, bounded retry [S17](sources.md#s17), manual path | Backend lead |
| Alert fatigue | Medium | Debounce, per-team budgets, escalation thresholds | UX/process owner |
| Zero legitimate data / no pilot permission | Critical for business claims | Claim only demo; collect approvals, observations & allowed dataset | Product owner |

**Compliance:** Федеральный закон РФ №152-ФЗ устанавливает принципы ограниченной цели и минимизации ПДн [официальная публикация Минтруда, S19](sources.md#s19); конкретные обязанности, актуальную редакцию, трансграничную передачу, роль оператора и место размещения оценить отдельно с юристом. NIST SP 800-61r3 [S20](sources.md#s20) относится к **cyber incident response**, и не заменяет ITSM-regламент или договорный SLA для обычных заявок.

[Следующее: ответы Q01–Q25](10-open-questions-answered.md) · [ADR](11-recommended-decisions-and-roadmap.md) · [Источники](sources.md).
