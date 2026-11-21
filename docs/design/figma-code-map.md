# Figma → код

[Файл команды Лерниум](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe). Все экраны состоят из редактируемых text/component instances/auto-layout. Полноэкранные растры не использованы.

## Два основных экрана

| Экран | Макет | Реализация | Проверка |
|---|---|---|---|
| Эфир смены | [51:2](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=51-2) | `LiveBoard.tsx`, `/`, `/wallboard` | Поток событий, счётчики, сроки и фильтры в `tests/e2e/workflows.spec.ts`. |
| Рабочая очередь | [51:160](https://www.figma.com/design/m2BesMwHFooNLVqbU9jCDe?node-id=51-160) | `Workspace.tsx`, `contextAnalysis.ts`, `/workspace` | Выборка, поиск, группировка, пересечения и обновление источника в `tests/e2e/workspace.spec.ts`. |

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
