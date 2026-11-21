# coordinator-workspace

## ADDED Requirements

### Requirement: Рабочие сценарии
Приложение SHALL выполнять обязательные F01–F36 из workflows.md с клавиатуры и на адаптивных экранах.

#### Scenario: Файл на демонстрации
- **WHEN** внешний процесс создаёт critical и затем решает его
- **THEN** UI обновляется без reload; заметное событие и постоянная история; ITSM mock подписан

### Requirement: Роли
Сервер SHALL запрещать mutations viewer и требовать авторизацию/CSRF для demo-admin.

#### Scenario: Неавторизованный импорт
- **WHEN** viewer отправляет импорт или reset
- **THEN** отказ сервера, файл и incident state неизменны

### Requirement: ИИ с доказательствами
Система SHALL выполнять реальный inference с evidence/model/inputRevision и отделять fallback/stale от свежего результата.

#### Scenario: Отказ анализа
- **WHEN** модель вернула timeout/invalid output либо revision изменилась
- **THEN** нет side effects, понятная ошибка или stale; основной dashboard работает

### Requirement: Release gate
Release SHALL содержать фактическую F01–F40 coverage, проверки 46 полей, enum combinations, E2E/visual/a11y/load и backup/rollback.

#### Scenario: Неполная проверка
- **WHEN** обязательный acceptance blocked или not_run
- **THEN** результат обозначен частично готовым, acceptance сохранён в tasks
