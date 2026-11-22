import { FIELDS, STATES, PRIORITIES, TEAM, hash, type Raw } from "./index.ts";
export const GENERATOR_VERSION = "1.1.0";
export const FIXED_CLOCK = "2026-11-21T09:00:00.000Z";
export function generate(count = 600, seed = 42, clock = FIXED_CLOCK) {
  let s = seed >>> 0;
  const random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const products = [
    "Личный кабинет",
    "Платёжный шлюз",
    "Мобильная связь",
    "Домашний интернет",
    "МТС Медиа",
    "Корпоративная сеть",
  ];
  const rows: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const state = [0, 2, 7, 10, 20][Math.floor(i / 24) % 5],
      priority = (Math.floor(i / 6) % 4) + 1,
      coordinator = Math.floor(i / 3) % 2 === 1,
      service = i % 3;
    const base = Date.parse(clock),
      product = products[Math.floor(random() * products.length)];
    const r: Raw = Object.fromEntries(FIELDS.map((f) => [f, null]));
    Object.assign(r, {
      sysId: `9${String(seed).padStart(5, "0")}${String(i + 1).padStart(12, "0")}`,
      id: `DEMO-${seed}-${String(i + 1).padStart(5, "0")}`,
      state: STATES[state].label,
      stateId: state,
      stateEnum: STATES[state].enum,
      submitDate: new Date(
        base - (30 + Math.floor(random() * 720)) * 60_000,
      ).toISOString(),
      deadline:
        i % 6 === 0
          ? null
          : new Date(
              base + [-60_000, 0, 1000, 600_000, 86_400_000][i % 5],
            ).toISOString(),
      completionDate:
        state === 7 || state === 10
          ? new Date(base - 60_000).toISOString()
          : null,
      lastAssignmentToTeamDateTime: new Date(base - 300_000).toISOString(),
      header: `${product}: ${["ошибки авторизации", "рост времени ответа", "недоступность операции"][service]}`,
      description: `Синтетический инцидент ${i + 1}. Пользователи сообщают об ошибках в продукте «${product}». Проверка показала увеличение времени ответа сервиса. Команда проверяет доступность зависимостей. Влияние на клиентов уточняется.`,
      shortDescription: `Нарушена работа: ${product}`,
      assignedGroupName: coordinator
        ? TEAM
        : `Демо-команда ${["платформы", "сети", "приложений"][service]}`,
      assignedEmployee: "Дежурный специалист (демо)",
      assignedEmployeeLogin: `demo-agent-${service}`,
      initiatorName: "Тестовый инициатор",
      initiatorLogin: "demo-origin",
      isEffect: i % 3 === 0,
      isReason: i % 3 === 1,
      isDouble: i % 11 === 0,
      isMaster: i % 13 === 0,
      incType: "Массовый инцидент",
      serviceTypeId: [30, 10, 20][service],
      serviceType: ["Технологический", "Клиентский", "Пользовательский"][service],
      priorityId: priority,
      priority: PRIORITIES[priority],
      urgencyId: 2,
      urgency: "Средняя",
      impactId: 2,
      impact: "Среднее",
      waitingExitDate: "0001-01-01T00:00:00",
      isRootIncident: false,
      productName: product,
      productId: `DEMO-PRODUCT-${service}`,
      productMasterId: `DEMO-MASTER-${service}`,
      productUrl: "https://example.invalid/product",
      service: `Демо-сервис ${service + 1}`,
      serviceId: `DEMO-SERVICE-${service}`,
      scenarioName: "Наблюдение за инцидентами",
      isNeedUp: i % 3 === 0 ? true : i % 3 === 1 ? false : null,
      eliminationType: state === 7 ? "Восстановление" : null,
      receivingChannel: ["Мониторинг", "Жалобы клиентов", "Сотрудник"][service],
      solution:
        state === 7 || state === 10
          ? "Синтетическое восстановление доступности."
          : null,
    });
    rows.push(r);
  }
  return {
    rows,
    manifest: {
      generatorVersion: GENERATOR_VERSION,
      seed,
      fixedClock: clock,
      count,
      sha256: hash(rows),
      expected: expectedGroups(rows),
      scenarios: [
        "5×4×2×3",
        "deadline-null-overdue-exact-now-1s-soon-far",
        "boolean-true-false-null",
        "18-digit-identity",
        "zero-waiting-date",
      ],
    },
  };
}

// Independent enumerative oracle for fixture manifests.
export function expectedGroups(rows: Raw[]) {
  const expected = {
    critical: [] as string[],
    coordinators: [] as string[],
    high: [] as string[],
    research: [] as string[],
  };
  for (const r of rows) {
    const key = String(r.id);
    switch (r.stateEnum) {
      case "Assigned":
      case "WorkInProgress":
        if (r.priorityId === 4) expected.critical.push(key);
        if (r.priorityId === 3) expected.high.push(key);
        if (r.assignedGroupName === TEAM) expected.coordinators.push(key);
        break;
      case "Research":
        expected.research.push(key);
        if (r.assignedGroupName === TEAM) expected.coordinators.push(key);
    }
  }
  return expected;
}
