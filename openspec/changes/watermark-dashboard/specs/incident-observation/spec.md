# incident-observation

## ADDED Requirements

### Requirement: Четыре независимые группы
Система SHALL классифицировать исходные stateId/priorityId/team по domain-spec, сохраняя все raw-поля.

#### Scenario: Исходный контроль
- **WHEN** загружены исходные 44 записи
- **THEN** счётчики critical/coordinators/high/research равны 0/2/1/5; critical+coordinator присутствует в обеих группах

### Requirement: Неизвестные и исторические данные
Система SHALL показывать конфликты и пропажу источника без ложного решения.

#### Scenario: Исчезновение записи
- **WHEN** в принятом файле запись отсутствует
- **THEN** последний state сохранён, sourcePresent=false, заметна сверка

### Requirement: Срок и lifecycle
Система SHALL сохранять deadline независимо от приоритета и запрещать демо-reopen Closed.

#### Scenario: Повышение приоритета
- **WHEN** priority 3 изменился на 4 без deadline
- **THEN** deadline неизменён; solution не решает инцидент; Research не active
