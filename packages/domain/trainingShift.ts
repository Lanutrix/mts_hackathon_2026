import { FIELDS, PRIORITIES, STATES, TEAM, type Raw } from "./index.ts";
import { FIXED_CLOCK } from "./generator.ts";
import { trainingCatalog } from "./trainingCatalog.ts";

const cities = ["Москва", "Казань", "Екатеринбург", "Самара", "Пермь", "Омск", "Ижевск", "Тула", "Уфа", "Киров", "Тверь", "Томск"];
const channels = [
  ["Мониторинг", "Контрольная точка", "probe", "Отклонение зарегистрировано контрольной точкой."],
  ["Сервис-деск", "Первая линия", "desk", "Первая линия сопоставила обращения за один интервал."],
  ["Обращение филиала", "Региональная поддержка", "branch", "Филиал приложил результаты повторной проверки."],
  ["Плановая проверка", "Приёмка сервиса", "acceptance", "Расхождение замечено при проверке доступности сервиса."],
  ["Эксплуатация", "Смена эксплуатации", "operations", "Дежурная смена сравнила наблюдение с предыдущей сменой."],
  ["ИТ-поддержка", "Вторая линия", "support", "Вторая линия воспроизвела проявление на контрольном примере."],
];
const typeName = { 10: "Клиентский", 20: "Пользовательский", 30: "Технологический" };
const shifts = ["А", "Б", "В"];
const empty = Object.fromEntries(FIELDS.map(field => [field, null]));
const fixedLifecycle = ["stateId", "state", "stateEnum", "priorityId", "priority", "submitDate", "deadline", "completionDate", "lastAssignmentToTeamDateTime", "isEffect", "isReason", "isDouble", "isMaster", "isRootIncident", "isNeedUp", "urgencyId", "urgency", "impactId", "impact"];

// Interleave domains and failure modes so an excerpt covers many service desks.
// Higher-volume desks receive more reports and more sites over the same shift.
const records: { team: number; kind: number; visit: number }[] = [];
for (let visit = 0; visit < cities.length && records.length < 800; visit++) {
  for (let kind = 0; kind < 4; kind++) {
    for (let k = 0; k < trainingCatalog.length; k++) {
      const team = (k + 7 * kind + 5 * visit) % trainingCatalog.length;
      if (visit < 6 + team % 5 + kind % 3 && records.length < 800)
        records.push({ team, kind, visit });
    }
  }
}
if (records.length !== 800) throw new Error("Учебный каталог должен формировать ровно 800 записей.");
const minute = 60_000;
const priorities = [2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 3, 4, 2];
const states = [0, 2, 2, 20, 7, 2, 10, 0, 2, 7, 0];
const severity = ["", "Низкая", "Средняя", "Высокая", "Высокая"];
const impact = ["", "Низкое", "Среднее", "Высокое", "Высокое"];

export function trainingRows(clock = FIXED_CLOCK, previous = new Map<string, Raw>()): Raw[] {
  const base = Date.parse(clock);
  const date = (offset: number) => new Date(base + offset * minute).toISOString();
  return records.map(({ team, kind, visit }, i) => {
    const service = trainingCatalog[team];
    const [title, observation, check, recovery] = service.cases[kind];
    const id = "DEMO-42-" + String(i + 1).padStart(5, "0");
    const prior = previous.get(id);
    const state = prior ? Number(prior.stateId) : states[(i + visit + team) % states.length];
    const priority = prior ? Number(prior.priorityId) : priorities[(i * 3 + visit) % priorities.length];
    const finished = state === 7 || state === 10;
    const desk = prior ? prior.assignedGroupName === TEAM : !finished && [3, 4].includes((i + visit) % 9);
    const member = (kind + team + visit) % shifts.length;
    const city = cities[(visit + team + 2 * kind) % cities.length];
    const channel = channels[(visit + kind + team) % channels.length];
    const sample = observation.replace("#", String(5 + (visit * 7 + team + kind) % 15));
    const diagnosis = finished ? "Проверка при разборе" : "Следующая проверка";
    const productIndex = trainingCatalog.findIndex(item => item.product === service.product) + 1;
    const age = finished ? 180 + (i * 137) % (7 * 1440) : 12 + (i * 37) % (12 * 60);
    const urgencyId = Math.min(3, priority);
    const impactId = priority === 4 ? 3 : Math.max(1, priority - (kind % 2));
    const row: Raw = {
      ...empty, id, sysId: "900042" + String(i + 1).padStart(12, "0"),
      header: title + " · " + city, shortDescription: title,
      description: "Регион наблюдения — " + city + ". " + sample + " " + channel[3] + " " + diagnosis + " — " + check.charAt(0).toLowerCase() + check.slice(1),
      stateId: state, state: STATES[state].label, stateEnum: STATES[state].enum,
      priorityId: priority, priority: PRIORITIES[priority],
      urgencyId, urgency: severity[urgencyId], impactId, impact: impact[impactId],
      assignedGroupName: desk ? TEAM : service.team,
      assignedEmployee: (desk ? "Дежурный координатор" : service.role) + ", смена " + shifts[member],
      assignedEmployeeLogin: (desk ? "demo-coord" : "demo-team-" + (team + 1)) + "-" + (member + 1),
      initiatorName: channel[1] + " (" + city + ")", initiatorLogin: "demo-" + channel[2] + "-" + (cities.indexOf(city) + 1),
      receivingChannel: channel[0], serviceTypeId: service.type, serviceType: typeName[service.type],
      productName: service.product, productId: "DEMO-P-" + productIndex, productMasterId: "DEMO-M-" + productIndex,
      service: service.service, serviceId: "DEMO-S-" + (team + 1),
      incType: "Массовый инцидент", scenarioName: "Учебная смена · " + service.service,
      submitDate: date(-age), lastAssignmentToTeamDateTime: date(-age + 2 + i % 8),
      deadline: i % 15 === 0 ? null : date(-age + [0, 1440, 720, 240, 60][priority]),
      completionDate: finished ? date(-age + 12 + i % 120) : null,
      solution: finished ? recovery : null, eliminationType: finished ? "Восстановление" : null,
      isEffect: i % 11 === 3, isReason: i % 11 === 1, isMaster: i % 17 === 2,
      isDouble: i % 19 === 4 && i % 17 !== 2, isRootIncident: i % 11 === 1,
      isNeedUp: i % 13 === 0 ? null : i % 7 < 2,
    };
    if (prior) for (const field of fixedLifecycle) row[field] = prior[field];
    return row;
  });
}
