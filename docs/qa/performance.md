# Производительность

Измерено локально: {'os': 'win32', 'node': 'v24.18.0', 'browser': '159.0.8154.6'}. 20 записей файла на каждый объём, seed 92831, Chromium 1920×1080. Source всегда реальный файл, writer — отдельный процесс. DOM ограничен 120 карточками (30×4); полный count сохраняется.

| Записей | p50, мс | p95, мс | max, мс | DOM |
|---|---:|---:|---:|---:|
| 2000 | 216 | 249 | 266 | 120 |
| 10000 | 610 | 693 | 738 | 120 |

Цель проекта p95 ≤2000 мс на 2000 записей достигнута в этой среде. Это не SLA МТС и не VDS-измерение. Первый блок 2000 частично выполнялся рядом с кратким WebKit regression run; значения не представлены как лабораторно изолированный benchmark.

Отсчёт начинается после успешного atomic rename. UI конец — второй requestAnimationFrame после React commit соответствующей revision; это приближение к показанному кадру, не аппаратный scanout. Отдельно записаны watcherDelayMs, readMs (включая 60ms stability check), validationMs, commitMs, streamDeliveryMs и apiAndRenderMs. Значения доступны в [сырых samples](evidence/performance.json). Разница Date.now/performance resolution может дать небольшое отрицательное межстадийное значение; исходные samples не исправляются ради красивого отчёта.

Общий экран: 600 секунд, 20 samples, browser errors=0. [Heap/nodes/listeners](evidence/soak.json). Число DOM cards стабильно 120. Heap и detached listeners колеблются между GC, сам по себе пик не доказывает утечку. Финальный settled sample после collectGarbage: [{'Documents': 1, 'JSEventListeners': 301, 'Nodes': 2601, 'JSHeapUsedSize': 5629916}].

VDS: 1 CPU/889 MiB без исходного swap. Фактические throughput/AI memory/latency остаются blocked до установки. Скрипт предусматривает 1 GiB swap и resource limits, но это ещё не доказательство достаточности ресурсов.
