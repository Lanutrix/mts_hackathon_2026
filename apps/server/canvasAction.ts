// Politeness does not turn a request to find or compare records into a
// question about what the assistant is capable of doing.
export function withoutPoliteRequest(question: string) {
  return question.trim()
    .replace(/^(?:а\s+)?(?:ты\s+|вы\s+)?(?:можешь|можете|мог(?:ла)? бы|могли бы)(?:\s+ли)?(?:\s+(?:ты|вы|мне|нам|пожалуйста))*[,\s]+/iu, "")
    .replace(/^(?:помоги(?:те)?|помочь)\s+(?:мне\s+|нам\s+)?(?:разобраться|понять)[,\s]+(?=(?:каки|како|какая|где|у кого|сколько|кто)\p{L}*)/iu, "");
}

const creative = /(?:^|[,\s])(?:хокку|хайку|стих(?:и|ах|отворение|ом)?|двустишие|четверостишие|сказку|шутку)(?!\p{L})|(?:сочини|придумай (?:рассказ|историю)|переформулируй|перепиши)/iu;
const howTo = /^(?:(?:а|и|пожалуйста|подскажи|расскажи|объясни|покажи|поясни|помоги понять)[,\s]+)*(?:как\s+(?:(?:мне|нам|самому|самой|самим|самостоятельно|вручную|можно)\s+)+(?:\p{L}+(?:ть|ти|чь)(?!\p{L})|это сделать)|как\s+(?:настроить|настраивать|пользоваться|построить|создать|открыть|отфильтровать|сгруппировать|посчитать|сравнить)|(?:объясни|покажи) по шагам)/iu;
export function requestsInstructions(question: string) {
  return howTo.test(withoutPoliteRequest(question));
}
export function requestsProse(question: string) {
  return creative.test(question) || requestsInstructions(question);
}

export const requestsRows = /(?:най(?:ди|дите|ти)|оты(?:щи|скать)|подбер(?:и|ите)|подобрать|покажи(?:те)?|выбери(?:те)?|отбери(?:те)?)\s+(?:(?:мне|все|все эти|только|пожалуйста|просроченн\p{L}*|открыт\p{L}*|активн\p{L}*|критич\p{L}*)\s+)*(?:заявк|тикет|инцидент|обращени)/iu;

export function requestsTicketChange(question: string) {
  const request = withoutPoliteRequest(question.trim()).replace(/^(?:(?:помоги|пожалуйста|прошу|тогда|теперь|давай)[,\s]+)+/iu, "");
  const changesTickets = /^(?:закрой(?:те)?|закрыть|переоткрой(?:те)?|переоткрыть|переназнач(?:ь|ьте|ить)|назнач(?:ь|ьте|ить)|удали(?:те|ть)?)(?!\p{L})/iu.test(request) &&
      /заяв[ко]|тикет|инцидент|обращени|\b(?:inc|demo|sim)-/iu.test(request) &&
      !/^(?:удали|удалить|удалите)\s+(?:фильтр|условие|группировку)/iu.test(request);
  const changesField = /^(?:измени(?:те|ть)?|поменя(?:й|йте|ть)|обнови(?:те|ть)?)\s+(?:\p{L}+\s+){0,2}(?:статус|исполнителя|приоритет)\s+(?:у\s+)?(?:заяв|тикет|инцидент|обращени)/iu.test(request);
  return changesTickets || changesField;
}

// A prose answer can make an ambiguous colloquial request actionable on a
// second planning pass. Never forward the failed reply in that packet.
export function delegatesOrPromises(text: string) {
  const tutorial = /(?<!\p{L})(?:откройте|открой|перейдите|перейди|выберите|выбери|введите|нажмите|нажми|воспользуйтесь|отфильтруйте|сгруппируйте|постройте|посчитайте|создайте|установите|вам (?:нужно|необходимо|следует|потребуется)|вы можете|можете (?:сами|открыть|настроить))(?!\p{L})/iu;
  const promise = /(?<!\p{L})(?:подготовлю|соберу|сделаю|построю|покажу|сравню|рассчитаю|посчитаю|проанализирую|приступаю|займусь|занимаюсь|подождите|минутку|секундочку|могу (?:посчитать|подготовить|составить|помочь|показать))(?!\p{L})/iu;
  const announcement = /^(?:готово[.!\s]*$|вот (?:ваш |готовый )?(?:список|результат|сравнение|срез|таблица))/iu;
  return tutorial.test(text) || promise.test(text) || announcement.test(text);
}
