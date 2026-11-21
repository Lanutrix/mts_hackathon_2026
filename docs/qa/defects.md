# Дефекты и регрессии

| ID | Наблюдение / причина | Исправление | Регрессия |
|---|---|---|---|
| Q01 | Login UI показывал пользователя до завершения me; навигация гонялась с redirect | Commit user после me | auth E2E |
| Q02 | Сохранённая timezone игнорировалась useState при async load | Синхронизация prefs effect | reload → UTC |
| Q03 | WebKit пустая страница на HTTP localhost; CSP upgrade-insecure-requests пытался HTTPS | Upgrade directive отключён, HTTPS redirect выполняет Caddy | все WebKit E2E; публичный debug screenshot |
| Q04 | WebKit Tab пропускал skip link, default native tab policy | Явный tabindex=0 для ссылки/действий | keyboard navigation |
| Q05 | Windows EPERM при rename во время чтения файла | Source exclusive queue + bounded retry; temp cleanup | recovery.test.ts + import и external mutate |
| Q06 | Dashboard cards и revision могли разойтись при await notifications | Capture revision/status + revision-bounded query | concurrent commit regression |
| Q07 | Старая detail могла мелькнуть при новом ID | Identity guard и cache по namespace/id/revision | live detail + ITSM navigation |
| Q08 | WebKit resource error при уходе с незавершённого запроса | AbortController/pagehide + reuse detail result; persistence test ждёт видимый read acknowledgement | pageerror assertion во всех E2E |
| Q09 | Mobile Figma фиксированная высота обрезала нижние группы | HUG/вертикальный layout всех групп | post-fix 390 screenshot |
| Q10 | Research-копия в coordinator column была подписана «Выполняется» | Override статуса во всех экземплярах; одинаковая fixture | Figma read audit + 0/2/20 grouping |
| Q11 | Demo повтор цикла пытался использовать Closed identity | Новый episode ID после девятого шага | terminal/repeat test |
| Q12 | Тестовая completionDate была раньше synthetic submitDate | Фикстура соблюдает chronology; валидатор не ослаблен | critical resolve E2E |

Секретные traces не снимались: пользователь запрещает cookies/password в артефактах. Сохранены безопасные симптомы/команды/assertions; публичные синтетические screenshots в evidence. Финальный статус конкретного теста проверяется в test-report.md, а не выводится из факта правки.
