# Входной контракт IN

Внешний контракт — исходный массив, без envelope. Оригинальные вложения неизменны. Metadata и manifest хранятся отдельно.

## 6. IN и INIT без расширения обязательного формата

P0 IN: наблюдаемый файл; upload/reimport того же массива; replay, который реально изменяет файл. Экспорт — исходный массив с сохранением полей. INIT: original 44; детерминированный seed+fixed clock; live demo с относительными сроками; replay/pause/step/reset; recovery последнего снимка; empty/invalid.

P1/P2 расширения, каждое отдельным adapter и feature flag: доставка официального снимка по HTTP; polling экспорта ITSM; Grafana webhook; Alertmanager; generic monitoring/log/APM; агрегированные жалобы; форма сотрудника; email; chat/bot; voice transcript; внешний ITSM webhook; synthetic probes; инфраструктурные события. Для первой итерации реализуй fixtures/локальные bridges для monitoring, complaint aggregate и employee form только после P0. Реальные сторонние аккаунты не подключай автоматически.

Раздели transport, receivingChannel, originClass и serviceType. OriginClass может быть unknown. «Анонимное письмо» не доказывает employee; технологический сервис не доказывает monitoring. Native signal расширения преобразуется отдельным bridge в официальный массив рабочей копии, затем обрабатывается обычным watcher. Raw payload нельзя напрямую смешивать с официальным входом дашборда.

Алгоритм watcher: разрешённая директория → bounded read → стабильность stat/content → parse/validate → canonical row/snapshot hash → сравнение с последним принятым снимком → одна транзакция projection/events/notifications/watermark → SSE. Polling страхует fs watch; поддержи atomic rename и запись по частям. Монтируй директорию данных, а не только один файл. Один writer на namespace.

Повтор того же содержимого, перестановка объектов и форматирование не создают событий. A→B→A — валидный возврат, поэтому нельзя отбрасывать все когда-либо встречавшиеся hashes. Для файлов без source revision порядок — порядок наблюдения; это не гарантия актуальности внешней копии. Синтаксически повреждённый массив/конфликтующие дубли отклоняются атомарно; последний хороший снимок остаётся и явно помечается устаревшим. Мягкие дефекты официального примера не блокируют его импорт.

Исчезновение записи/пустая выписка не означают решение. Сохрани последний state и отметь sourcePresent=false; покажи сверку и явно пометь счётчики, содержащие непроверенные записи. Initial [] — пустое состояние. Очистка demo namespace — отдельная административная операция с аудитом, а не интерпретация пустого файла.

Для webhook bridge раздели dedup доставки `(source,eventId)` и корреляцию инцидентов. Firing/resolved одного fingerprint — разные события; новая startsAt/generation может означать новый сбой. Версии сравнивай только в одном источнике; authority текущего incident state принадлежит файлу/ITSM. Monitoring resolved не закрывает ITSM-инцидент. Нужны auth/signature по источнику, rate/size limits, bounded retry+jitter, DLQ, схема, provenance и нейтральная диагностика. Не логируй секреты/сырой чувствительный текст. Не объединяй разные официальные ID по похожему описанию.
