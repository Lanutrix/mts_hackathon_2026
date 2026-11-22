import { useState } from "react";
import type { Incident } from "../../../packages/domain/index";
import { Icon } from "./Brand";
import Select from "./Select";

type Action = "edit" | "route" | "resolve";
export default function TrainingTicket({
  incident,
  teams,
  runId,
  csrf,
  refresh,
}: {
  incident: Incident;
  teams: string[];
  runId: string;
  csrf: string;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    action: Action;
    version: number;
    header: string;
    description: string;
    team: string;
    solution: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const begin = (action: Action) => {
    setMessage("");
    setDraft({
      action,
      version: incident.revision,
      header: String(incident.raw.header ?? ""),
      description: String(incident.raw.description ?? incident.raw.shortDescription ?? ""),
      team: incident.team ?? "",
      solution: "",
    });
  };
  async function save() {
    if (!draft || busy || draft.version !== incident.revision) return;
    setBusy(true);
    setMessage("");
    try {
      const fields =
        draft.action === "edit"
          ? { header: draft.header.trim(), description: draft.description.trim() }
          : draft.action === "route"
            ? { team: draft.team }
            : { solution: draft.solution.trim() || undefined };
      const res = await fetch(
        "/api/simulation/incidents/" + encodeURIComponent(incident.id) + "?ns=simulation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ runId, expectedRevision: draft.version, action: draft.action, ...fields }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409) await refresh();
        throw new Error(body.message || "Не удалось сохранить изменения.");
      }
      setDraft(null);
      setMessage(
        draft.action === "resolve"
          ? "Учебная заявка решена."
          : draft.action === "route"
            ? "Направлено команде «" + draft.team + "»."
            : "Изменения сохранены.",
      );
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось сохранить изменения.");
    } finally {
      setBusy(false);
    }
  }
  const stale = draft && draft.version !== incident.revision;
  const closed = incident.stateId === 7 || incident.stateId === 10;
  return (
    <section className="shift-training" aria-label="Работа с учебной заявкой">
      <h3>
        <Icon name="queue" size={19} />
        Учебная заявка
      </h3>
      {!draft && !closed && (
        <div className="shift-actions">
          <button type="button" onClick={() => begin("edit")}>
            Изменить
          </button>
          <button type="button" onClick={() => begin("route")}>
            Направить
          </button>
          <button type="button" onClick={() => begin("resolve")}>
            Решить
          </button>
        </div>
      )}
      {closed && !draft && <p>{String(incident.raw.solution || "Заявка завершена.")}</p>}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || !!stale}>
            {draft.action === "edit" && (
              <>
                <label>
                  Заголовок
                  <input
                    required
                    maxLength={300}
                    value={draft.header}
                    onChange={(e) => setDraft({ ...draft, header: e.target.value })}
                  />
                </label>
                <label>
                  Описание
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
              </>
            )}
            {draft.action === "route" && (
              <label>
                Команда решения
                <Select
                  required
                  value={draft.team}
                  onChange={(e) => setDraft({ ...draft, team: e.target.value })}
                >
                  <option value="">Выберите команду</option>
                  {teams.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </label>
            )}
            {draft.action === "resolve" && (
              <label>
                Результат решения
                <textarea
                  maxLength={2000}
                  rows={2}
                  value={draft.solution}
                  onChange={(e) => setDraft({ ...draft, solution: e.target.value })}
                />
              </label>
            )}
            <button
              type="submit"
              disabled={
                (draft.action === "route" && draft.team === incident.team) ||
                (draft.action === "edit" && !draft.header.trim())
              }
            >
              {busy
                ? "Сохраняем…"
                : draft.action === "edit"
                  ? "Сохранить изменения"
                  : draft.action === "route"
                    ? "Передать команде"
                    : "Подтвердить решение"}
            </button>
          </fieldset>
          {stale && (
            <p role="status">
              Карточка изменилась.{" "}
              <button type="button" onClick={() => (closed ? setDraft(null) : begin(draft.action))}>
                Обновить форму
              </button>
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            className="link"
            onClick={() => {
              setDraft(null);
              setMessage("");
            }}
          >
            Отмена
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
