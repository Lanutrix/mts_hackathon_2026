export const insightDefinitions = {
  "age-median": {
    title: "Медианный возраст открытых заявок",
    kind: "median",
    source: "age",
  },
  "age-tail": {
    title: "Возраст самых долгих 10% заявок",
    kind: "p90",
    source: "age",
  },
  "age-oldest": {
    title: "Старейшая открытая заявка",
    kind: "max",
    source: "age",
  },
  "age-bands": { title: "Возраст очереди", kind: "bands", source: "age" },
  "delay-max": { title: "Самая долгая просрочка", kind: "max", source: "late" },
  "delay-median": {
    title: "Типичная длительность просрочки",
    kind: "median",
    source: "late",
  },
  "delay-sum": {
    title: "Суммарное время просрочки",
    kind: "sum",
    source: "late",
  },
  "delay-bands": { title: "Глубина просрочки", kind: "bands", source: "late" },
  "remaining-min": {
    title: "Ближайший срок",
    kind: "minimum",
    source: "remaining",
  },
  "remaining-median": {
    title: "Медианный запас времени",
    kind: "median",
    source: "remaining",
  },
  "remaining-bands": {
    title: "Окна предстоящих сроков",
    kind: "bands",
    source: "remaining",
  },
  "assignment-median": {
    title: "Время от регистрации до текущего назначения",
    kind: "median",
    source: "assignmentLag",
  },
  "assignment-tail": {
    title: "Длинные задержки назначения",
    kind: "p90",
    source: "assignmentLag",
  },
  "team-age-max": {
    title: "Самое длительное текущее назначение",
    kind: "max",
    source: "teamAge",
  },
  "team-age-bands": {
    title: "Давность назначения команде",
    kind: "bands",
    source: "teamAge",
  },
  "resolve-median": {
    title: "Медианное время решения",
    kind: "median",
    source: "resolution",
  },
  "resolve-mean": {
    title: "Среднее время решения",
    kind: "mean",
    source: "resolution",
  },
  "resolve-tail": {
    title: "90-й перцентиль времени решения",
    kind: "p90",
    source: "resolution",
  },
  "resolve-bands": {
    title: "Распределение времени решения",
    kind: "bands",
    source: "resolution",
  },
  "budget-median": {
    title: "Плановое окно решения",
    kind: "median",
    source: "budget",
  },
  "missed-max": {
    title: "Самое позднее завершение относительно срока",
    kind: "max",
    source: "finishedLate",
  },
  "reserve-median": {
    title: "Запас до срока при завершении",
    kind: "median",
    source: "finishedEarly",
  },
  "waiting-min": {
    title: "Ближайший выход из ожидания",
    kind: "minimum",
    source: "waiting",
  },
  "by-channel": {
    title: "Каналы поступления",
    kind: "distribution",
    source: "receivingChannel",
  },
  "by-impact": {
    title: "Масштаб влияния",
    kind: "distribution",
    source: "impact",
  },
  "by-urgency": {
    title: "Срочность по источнику",
    kind: "distribution",
    source: "urgency",
  },
  "by-type": {
    title: "Типы инцидентов",
    kind: "distribution",
    source: "incType",
  },
  "by-service": {
    title: "Сервисы с обращениями",
    kind: "distribution",
    source: "service",
  },
  "by-service-class": {
    title: "Классы сервисов",
    kind: "distribution",
    source: "serviceType",
  },
  "by-scenario": {
    title: "Сценарии обращений",
    kind: "distribution",
    source: "scenarioName",
  },
  "by-state-reason": {
    title: "Причины текущего статуса",
    kind: "distribution",
    source: "stateReason",
  },
  "by-fix": {
    title: "Способы устранения",
    kind: "distribution",
    source: "eliminationType",
  },
  "by-owner": {
    title: "Нагрузка по исполнителям",
    kind: "distribution",
    source: "assignedEmployee",
  },
  "by-team-overdue": {
    title: "Нагрузка команд с просрочками",
    kind: "distribution",
    source: "lateTeams",
  },
  "by-product-raised": {
    title: "Продукты с отмеченными последствиями",
    kind: "distribution",
    source: "raisedProducts",
  },
  "by-owner-critical": {
    title: "Кому назначены критические",
    kind: "distribution",
    source: "criticalOwners",
  },
  "channel-team": {
    title: "Пути от канала к команде",
    kind: "relation",
    source: "receivingChannel,assignedGroupName",
  },
  "product-team": {
    title: "Связи продуктов и команд",
    kind: "relation",
    source: "productName,assignedGroupName",
  },
  "service-product": {
    title: "Связи сервисов и продуктов",
    kind: "relation",
    source: "service,productName",
  },
  "priority-impact": {
    title: "Приоритет и влияние",
    kind: "relation",
    source: "priority,impact",
  },
  "urgency-impact": {
    title: "Срочность и влияние",
    kind: "relation",
    source: "urgency,impact",
  },
  "team-state": {
    title: "Статусы внутри команд",
    kind: "relation",
    source: "assignedGroupName,state",
  },
  "intake-priority": {
    title: "Приоритет по каналам поступления",
    kind: "relation",
    source: "receivingChannel,priority",
  },
  "product-scenario": {
    title: "Сценарии по продуктам",
    kind: "relation",
    source: "productName,scenarioName",
  },
  unowned: {
    title: "Заявки без исполнителя",
    kind: "subset",
    source: "unowned",
  },
  unteamed: { title: "Заявки без команды", kind: "subset", source: "unteamed" },
  "no-deadline": {
    title: "Открытые заявки без срока",
    kind: "subset",
    source: "noDeadline",
  },
  "no-description": {
    title: "Заявки без описания",
    kind: "subset",
    source: "noDescription",
  },
  "no-product": {
    title: "Заявки без продукта",
    kind: "subset",
    source: "noProduct",
  },
  "no-service": {
    title: "Заявки без сервиса",
    kind: "subset",
    source: "noService",
  },
  "late-low": {
    title: "Просроченные низкого приоритета",
    kind: "subset",
    source: "lowLate",
  },
  "no-channel": {
    title: "Неизвестный канал поступления",
    kind: "subset",
    source: "noChannel",
  },
  "no-impact": {
    title: "Влияние требует уточнения",
    kind: "subset",
    source: "noImpact",
  },
  "no-urgency": {
    title: "Заявки без оценки срочности",
    kind: "subset",
    source: "noUrgency",
  },
  "no-completion": {
    title: "Завершённые без даты решения",
    kind: "subset",
    source: "noCompletion",
  },
  "no-solution": {
    title: "Завершённые без текста решения",
    kind: "subset",
    source: "noSolution",
  },
  "quality-issues": {
    title: "Обращения с замечаниями к данным",
    kind: "subset",
    source: "issues",
  },
  "invalid-order": {
    title: "Нарушен порядок дат",
    kind: "subset",
    source: "dateOrder",
  },
  duplicates: {
    title: "Заявки с признаком дубля",
    kind: "subset",
    source: "isDouble",
  },
  masters: { title: "Головные заявки", kind: "subset", source: "isMaster" },
  roots: {
    title: "Корневые инциденты",
    kind: "subset",
    source: "isRootIncident",
  },
  effects: { title: "Дочерние инциденты", kind: "subset", source: "isReason" },
  causes: { title: "Инциденты-причины", kind: "subset", source: "isEffect" },
  "unknown-escalation": {
    title: "Отметка об устранении последствий не заполнена",
    kind: "subset",
    source: "unknownEscalation",
  },
  "late-escalated": {
    title: "Просроченные с последствиями",
    kind: "subset",
    source: "lateEscalated",
  },
  "critical-unowned": {
    title: "Критические без исполнителя",
    kind: "subset",
    source: "criticalUnowned",
  },
  "late-unowned": {
    title: "Просроченные без исполнителя",
    kind: "subset",
    source: "lateUnowned",
  },
  "research-late": {
    title: "Исследования с просрочкой",
    kind: "subset",
    source: "researchLate",
  },
  "pending-assign": {
    title: "Назначены и ожидают работы",
    kind: "subset",
    source: "assigned",
  },
  "reused-solution": {
    title: "Открытые с прежним решением",
    kind: "subset",
    source: "reusedSolution",
  },
  "finished-on-time": {
    title: "Решения в срок",
    kind: "ratio",
    source: "finishedOnTime",
  },
  "has-owner": {
    title: "Заполненность исполнителя",
    kind: "ratio",
    source: "hasOwner",
  },
  "has-deadline": {
    title: "Заполненность срока",
    kind: "ratio",
    source: "hasDeadline",
  },
  "escalation-known": {
    title: "Полнота отметки об устранении последствий",
    kind: "ratio",
    source: "knownEscalation",
  },
  "intake-hours": {
    title: "Время поступления в течение суток",
    kind: "timeBuckets",
    source: "registrationHour",
  },
  "intake-days": {
    title: "Поступления за семь дней",
    kind: "timeBuckets",
    source: "registrationDays",
  },
  "done-days": {
    title: "Завершения за семь дней",
    kind: "timeBuckets",
    source: "completionDays",
  },
  "due-days": {
    title: "Сроки на ближайшие семь дней",
    kind: "timeBuckets",
    source: "dueDays",
  },
  "weekday-intake": {
    title: "Поступления по дням недели",
    kind: "timeBuckets",
    source: "weekdays",
  },
  "workday-intake": {
    title: "Дневные и ночные поступления",
    kind: "timeBuckets",
    source: "shifts",
  },
  "unassigned-critical-path": {
    title: "Кто ведёт инциденты с последствиями",
    kind: "distribution",
    source: "raisedTeams",
  },
} as const;
export type AnswerInsightId = keyof typeof insightDefinitions;
export const answerInsightIds = Object.keys(
  insightDefinitions,
) as AnswerInsightId[];
export interface InsightPoint {
  label: string;
  value: number;
  ticket?: string;
}
export interface AnswerInsight {
  id: AnswerInsightId;
  value: string;
  note: string;
  points: InsightPoint[];
  evidence?: string;
}
