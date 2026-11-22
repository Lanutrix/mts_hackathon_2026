import Select from "./Select";
import { useRef, useState, type FormEvent } from "react";
import { intakeByteLimit, intakeRecordLimit, type IntakeReceipt } from "../../../packages/contracts/intake";
import { Icon } from "./Brand";
import {
  FIELDS,
  PRIORITIES,
  STATES,
} from "../../../packages/domain/incidentFields";
import { screenLink } from "./routes";
import "./incidentIntake.css";

const sourceNames: Record<string, string> = {
  workspace: "Рабочая копия",
  demo: "Демоисточник",
};
const nowUtc = () => new Date().toISOString().slice(0, 19);

async function readIncidentFiles(files: File[]) {
  if (files.reduce((bytes, file) => bytes + file.size, 0) > intakeByteLimit)
    throw new Error("Общий размер выбранных файлов превышает 20 МиБ.");
  const records: unknown[] = [];
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse((await file.text()).trim());
    } catch {
      throw new Error("Не удалось прочитать JSON в файле «" + file.name + "».");
    }
    const batch = Array.isArray(data) ? data : [data];
    if (!batch.length || batch.some(row => !row || typeof row !== "object" || Array.isArray(row)))
      throw new Error("В файле «" + file.name + "» нужен объект инцидента или непустой массив объектов.");
    if (records.length + batch.length > intakeRecordLimit)
      throw new Error("За один раз можно добавить до 20 000 записей.");
    for (const row of batch) records.push(row);
  }
  return records;
}

function formRecord(form: HTMLFormElement) {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const utc = (name: string) =>
    field(name) ? new Date(field(name) + "Z").toISOString() : null;
  const stateId = Number(field("stateId"));
  const priorityId = Number(field("priorityId"));
  return {
    ...Object.fromEntries(FIELDS.map((f) => [f, null])),
    id: field("id"),
    header: field("header"),
    stateId,
    stateEnum: STATES[stateId].enum,
    state: STATES[stateId].label,
    priorityId,
    priority: PRIORITIES[priorityId],
    description: field("description") || null,
    assignedGroupName: field("team") || null,
    productName: field("product") || null,
    sysId: field("sysId") || null,
    submitDate: utc("submitDate"),
    deadline: utc("deadline"),
    completionDate: utc("completionDate"),
    solution: field("solution") || null,
  };
}

function receiptLink(id: string, ns: string) {
  // The ticket router accepts path segments of up to 100 characters.
  if (id.length > 100 || id === "." || id === "..") return id;
  return (
    <a href={screenLink("/incident/" + encodeURIComponent(id), ns)}>{id}</a>
  );
}

export function IncidentIntake({
  ns,
  publicDemo,
  sources = [],
  post,
}: {
  ns: string;
  publicDemo: boolean;
  sources?: string[];
  post: (url: string, body: unknown) => Promise<IntakeReceipt>;
}) {
  const [mode, setMode] = useState<"single" | "json">("single");
  const [json, setJson] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<IntakeReceipt | null>(null);
  const [registration, setRegistration] = useState(nowUtc);
  const [stateId, setStateId] = useState(0);
  const numberInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const sampleId = ns === "demo" && publicDemo ? "DEMO-1001" : "INC-1001";
  const sample = JSON.stringify(
    [
      {
        id: sampleId,
        header: "Ошибка оплаты",
        stateId: 0,
        stateEnum: "Assigned",
        priorityId: 3,
        priority: "Высокий",
      },
    ],
    null,
    2,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const form = event.currentTarget;
    setError("");
    setReceipt(null);
    sending.current = true;
    setBusy(true);
    try {
      let payload: unknown;
      if (mode === "single") payload = formRecord(form);
      else if (files.length) payload = await readIncidentFiles(files);
      else {
        try { payload = JSON.parse(json.trim()); }
        catch { throw new Error("Ошибка синтаксиса JSON. Проверьте кавычки, запятые и скобки."); }
      }
      const accepted = await post("/intake", payload);
      setReceipt(accepted);
      if (mode === "single") {
        form.reset();
        setStateId(0);
        setRegistration(nowUtc());
        requestAnimationFrame(() => numberInput.current?.focus());
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось подтвердить приём.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const visibleIds = receipt
    ? [...new Set([...receipt.added, ...receipt.existing])].slice(0, 10)
    : [];
  return (
    <section className="intake-page" aria-labelledby="intake-title">
      <header className="intake-heading">
        <h1 id="intake-title">Приём инцидентов</h1>
        <p>Заполните карточку или отправьте несколько записей одним пакетом.</p>
      </header>
      <div className="intake-source">
        <div>
          <span>Источник</span>
          <strong>{sourceNames[ns]}</strong>
        </div>
        {sources
          .filter((s) => s !== ns && Object.hasOwn(sourceNames, s))
          .map((s) => (
            <a key={s} href={screenLink("/intake", s)}>
              Перейти в {s === "workspace" ? "рабочую копию" : "демоисточник"}
            </a>
          ))}
      </div>
      {publicDemo && ns === "demo" && (
        <p className="intake-hint">
          Для демо используйте синтетические данные и ID с префиксом DEMO-.
        </p>
      )}
      <div className="intake-modes" role="group" aria-label="Способ добавления">
        {(
          [
            ["single", "Один инцидент"],
            ["json", "Пакет JSON"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={value === mode}
            onClick={() => {
              setMode(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="intake-form"
        hidden={mode !== "single"}
        onSubmit={submit}
      >
        <fieldset disabled={busy}>
          <div className="intake-fields">
            <label>
              ID инцидента
              <input
                name="id"
                ref={numberInput}
                maxLength={200}
                required
                pattern={ns === "demo" && publicDemo ? "DEMO-.+" : ".*\\S.*"}
                placeholder={sampleId}
              />
            </label>
            <label>
              Тема
              <input
                name="header"
                required
                pattern=".*\S.*"
                placeholder="Коротко о сбое"
              />
            </label>
            <label>
              Статус
              <Select
                name="stateId"
                value={stateId}
                onChange={(e) => setStateId(Number(e.target.value))}
              >
                {Object.entries(STATES).map(([value, s]) => (
                  <option value={value} key={value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Приоритет
              <Select name="priorityId" defaultValue="2">
                {Object.entries(PRIORITIES).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="intake-wide">
              Описание
              <textarea name="description" rows={3} />
            </label>
          </div>
          <div className="intake-fields intake-dates">
            <label>
              Регистрация (UTC)
              <input
                type="datetime-local"
                name="submitDate"
                step="1"
                required
                value={registration}
                onChange={(e) => setRegistration(e.target.value)}
              />
            </label>
            <label>
              Срок решения (UTC)
              <input type="datetime-local" name="deadline" step="1" />
            </label>
            {(stateId === 7 || stateId === 10) && (
              <>
                <label>
                  Фактическое время решения (UTC)
                  <input
                    type="datetime-local"
                    name="completionDate"
                    min={registration}
                    step="1"
                  />
                </label>
                <label>
                  Решение
                  <input name="solution" />
                </label>
              </>
            )}
          </div>
          <details className="intake-extra">
            <summary>Команда, продукт и sysId</summary>
            <div className="intake-fields">
              <label>
                Команда назначения
                <input name="team" />
              </label>
              <label>
                Продукт
                <input name="product" />
              </label>
              <label>
                sysId
                <input name="sysId" maxLength={200} />
              </label>
            </div>
          </details>
          <button className="intake-submit" type="submit">
            {busy ? "Отправка…" : "Добавить инцидент"}
          </button>
        </fieldset>
      </form>
      <form className="intake-form" hidden={mode !== "json"} onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="intake-hint" id="intake-format">
            Один объект или массив инцидентов. Все выбранные файлы отправляются одним пакетом до 20 МиБ.
          </p>
          <div className="intake-attachments">
            <label className="intake-file-button">
              <Icon name="file" size={18} />Прикрепить JSON
              <input type="file" multiple accept=".json,application/json" ref={fileInput}
                onChange={e => { setFiles(Array.from(e.target.files ?? [])); setError(""); setReceipt(null); }} />
            </label>
            {files.length > 0 && <>
              <ul aria-label="Прикреплённые файлы">{files.map((file, i) => <li key={i}>{file.name}</li>)}</ul>
              <button type="button" className="intake-clear-files" onClick={() => {
                setFiles([]); setError(""); setReceipt(null);
                if (fileInput.current) fileInput.current.value = "";
                fileInput.current?.focus();
              }}>Убрать файлы</button>
            </>}
          </div>
          {!files.length && <label>
            Записи в формате JSON
            <textarea
              className="intake-json"
              required
              value={json}
              onChange={(e) => setJson(e.target.value)}
              aria-describedby="intake-format"
              spellCheck={false}
              rows={8}
              placeholder={sample}
            />
          </label>}
          <details className="intake-extra">
            <summary>Пример JSON</summary>
            <pre>{sample}</pre>
          </details>
          <button className="intake-submit" type="submit">
            {busy ? "Отправка…" : "Отправить JSON"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
      {receipt && (
        <section
          className="intake-receipt"
          role="status"
          aria-label="Результат приёма"
        >
          <h2>Результат приёма</h2>
          <p>
            <strong>Добавлено {receipt.added.length}</strong>
            <span>Уже в источнике {receipt.existing.length}</span>
          </p>
          <ul aria-label="Первые десять записей отправки">
            {visibleIds.map((id) => (
              <li key={id}>{receiptLink(id, receipt.namespace)}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
