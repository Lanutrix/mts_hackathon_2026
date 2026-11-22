# Проверка дизайна

Инструменты: Figma MCP use_figma (дерево, boundVariables, componentProperties, text styles), get_screenshot + локальный просмотр PNG; Playwright screenshots пяти viewport; axe; Impeccable explicit detect. Платные design-audit plugins не запускались.

Semantic text contrast на белом (расчёт WCAG relative luminance): {'text': 16.22, 'muted': 6.42, 'critical': 6.57, 'warning': 6.85, 'resolved': 7.13, 'accent': 8.42, 'control-border': 3.65}. Текст ≥4.5:1; accent focus/интерактивные границы ≥3:1. Светлый border — декоративные разделители/card outline; input/checkbox используют отдельный #7B8796. Critical/error/due/research обозначены также словами. Эффект elevation flat=0 — намеренно без декоративчных теней.

Сравнение одинаковой синтетики `data/demo/design.json`: шесть identity, группы 2/3/2/2, фиксированные часы 12:04:08 МСК. Исправлены coordinator Research, employee spacing, источник/фильтры/sort, выравнивание counters, mobile clipping, label «Исследование ситуации» и overdue. Текущий timestamp acceptedAt и revision динамические; pixel-identical сравнение этих значений не заявляется. Макеты auxiliary panels показывают action/error variants, production использует нативные select/checkbox/file input; они намеренно сохраняют стандартное браузерное поведение.

Foundations, desktop, mobile, wallboard и States визуально осмотрены. Фокус/reading order/zoom/reduced motion проверяются в браузере. Ошибки переполнения mobile исправлены HUG; desktop высота 900 — scroll viewport, продолжение списка ниже fold не является потерей записей. Основные card instances не detached, шрифты Golos Text, palette/spacing/radius связаны с переменными.

Для повторения: `npx tsx scripts/visual.ts`. Безопасные снимки содержат только синтетику. Экраны auth снимаются только как пустые макеты; реальные сессии и пароль не попадают в Figma/screenshots.
