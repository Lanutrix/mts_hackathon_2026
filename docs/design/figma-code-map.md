# Figma → код

[Файл команды Лерниум](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe). Все экраны состоят из редактируемых text/component instances/auto-layout. Полноэкранные растры не использованы.

## Два основных экрана

Для [учебного эфира](https://mts-watermelon.ru/simulation) подготовлены [десктоп](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=86-1568) и [телефон](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe/Watermelon?node-id=86-1690). Эфир, очередь, карточка, история, качество данных и журнал используют общие компоненты на рабочих и учебных маршрутах. За полосу отвечает `IncidentNotice`. Он показывает последнее важное изменение по инциденту, пока зритель открывает сведения или скрывает полосу. Все поступившие сигналы можно прочитать в журнале.

Точка входа в продукт находится по адресу `/`. В `Landing.tsx` и `LandingOptic.tsx` заголовок, красный квадрат и сиреневое стекло отсылают к обложке кейса «Инциденты в фокусе». Херо занимает всю стартовую страницу. Арбуз и прозрачная рамка в браузере имеют собственную геометрию. Оба объекта можно вращать. В фильтрах эфира четыре группы связаны со шкалами модели, а в рабочей очереди выбор инцидентов меняет состав среза. [Десктоп](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=72-1209) · [Телефон](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=72-1210)

В эфире все четыре сигнала используют единый реестр. Цвет и форма семечки обозначают причину отбора, выбор фильтра меняет позу трёхмерного среза. В очереди шесть углублений в срезе показывают свободные места в контексте разбора. Для узкого экрана в строке срока и статуса сохраняется правая колонка, а переход к контексту закреплён у нижнего края.

На масштаб чисел и работу с акцентом повлияли Lerno и Silv студии Halo Lab. Табличное представление и приоритет информации в строке опираются на Incident Management и обновление интерфейса Linear. [Lerno](https://dribbble.com/shots/26982241-Dashboard-for-Edtech-Product-Lerno) · [Silv](https://dribbble.com/shots/27341855-Dashboard-for-an-IoT-Product-Silv) · [Incident Management](https://dribbble.com/shots/23970269-Incident-Management-Web) · [Linear](https://linear.app/changelog/2026-03-12-ui-refresh)

| Экран | Макет | Реализация | Проверка |
|---|---|---|---|
| Эфир смены | [51:2](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=51-2) | `LiveBoard.tsx`, `TriageCases.tsx`, `/live`, `/wallboard` | Кейсы по четырём признакам, разбор с основаниями, отслеживание ID на модели, постраничный реестр и поток событий в `tests/e2e/workflows.spec.ts`. |
| Рабочая очередь | [51:160](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=51-160) | `Workspace.tsx`, `operationalAnalysis.ts`, `/workspace` | Выборка, поиск, группировка, пересечения и обновление источника в `tests/e2e/workspace.spec.ts`. |

Мобильные прототипы актуальной версии собраны в ширине 390 px. [Эфир](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=62-246) · [Очередь](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=63-498) · [Открытый контекст](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=68-1742)

## Ранние макеты и вспомогательные сценарии

| Экран | Узел | Компонент / route | Состояния / tests |
|---|---|---|---|
| S01 | [7:3](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=7-3) | apps/web/src/main.tsx · App / | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S02 | [7:139](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=7-139) | apps/web/src/main.tsx · Detail /incident/:id | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S03 | [7:151](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=7-151) | apps/web/src/main.tsx · /notifications | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S04 | [7:158](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=7-158) | apps/web/src/main.tsx · /history | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S05 | [9:3](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=9-3) | apps/web/src/main.tsx · App /wallboard | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S06 | [8:98](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-98) | apps/web/src/main.tsx · Import /import | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S07 | [8:106](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-106) | apps/web/src/main.tsx · /quality | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S08 | [8:114](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-114) | apps/web/src/main.tsx · Detail AI panel | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S09 | [8:122](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-122) | apps/web/src/main.tsx · /demo | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S10 | [8:130](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-130) | apps/web/src/main.tsx · Login/Denied /login | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S11 | [8:138](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-138) | apps/web/src/main.tsx · Preferences /preferences | loading/empty/error/live; tests/e2e/workflows.spec.ts |
| S12 | [8:146](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-146) | apps/web/src/main.tsx · Detail /itsm/:id | loading/empty/error/live; tests/e2e/workflows.spec.ts |

Responsive: [390](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-196), [1024](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-239), [1920](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=8-282). 1440 — S01, 2560 — S05. Components: button6:5, card6:16, badge6:3, input6:62, source6:64, empty6:66, notification6:69, checkbox19:2. Semantic variables/scopes/code syntax + text styles Golos. Tokens: packages/ui/tokens.json и apps/web/src/style.css.

Code Connect discovery выполнен; публикация недоступна для текущего Pro/file setup без опубликованных компонентов. Платный тариф не приобретался; автоматический Code Connect publish не заявляется. Эта ручная карта — проверяемый handoff. Прототип внутри Desktop использует NAVIGATE; между страницами — ссылки на точные узлы Figma (платформа запрещает межстраничный NODE navigate).
