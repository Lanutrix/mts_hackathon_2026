# snapshot-ingestion

## ADDED Requirements

### Requirement: Приём массива
Система SHALL принимать оригинальный массив атомарно с bounded read и стабильностью файла.

#### Scenario: Повреждённый snapshot
- **WHEN** файл записан частично или содержит конфликтующие дубли
- **THEN** невалидный snapshot отклонён, последний хороший показан устаревшим

### Requirement: Идемпотентность
Система SHALL игнорировать formatting/order/repeat и принимать A→B→A.

#### Scenario: Возврат содержимого
- **WHEN** после A принят B и снова A
- **THEN** принята новая revision A; уведомления не повторяются при простом повторе

### Requirement: Восстановление и поток
Система SHALL хранить projection/events/watermark в одной транзакции и выдавать ordered cursor SSE с resync.

#### Scenario: Два клиента и restart
- **WHEN** после commit сервер перезапущен и клиенты восстановили соединение
- **THEN** одинаковая revision и notifications без потерь и дублей
