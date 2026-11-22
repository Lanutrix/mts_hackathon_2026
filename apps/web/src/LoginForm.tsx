import { useId, useState, type FormEvent } from "react";
import { Mark } from "./Brand";
import AccessIcon from "./AccessIcon";
import Loader from "./Loader";
import "./loginForm.css";

export default function LoginForm({
  onSubmit,
}: {
  onSubmit: (username: string, password: string) => Promise<void>;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      await onSubmit(
        String(fields.get("username")),
        String(fields.get("password")),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }
  const visibilityLabel = shown ? "Скрыть пароль" : "Показать пароль";
  return (
    <form onSubmit={submit} className="srez-login" aria-busy={busy}>
      <div className="srez-login-heading">
        <div className="srez-login-emblem" aria-hidden="true">
          <Mark />
        </div>
        <h1 id="access-title">Вход в Срез</h1>
      </div>
      <div className="srez-login-field">
        <label htmlFor={id + "-user"}>Имя пользователя</label>
        <div className="srez-login-input">
          <AccessIcon name="user" />
          <input
            id={id + "-user"}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
      </div>
      <div className="srez-login-field">
        <label htmlFor={id + "-password"}>Пароль</label>
        <div className="srez-login-input">
          <AccessIcon name="lock" />
          <input
            id={id + "-password"}
            name="password"
            type={shown ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            className="srez-login-eye"
            type="button"
            aria-label={shown ? "Скрыть символы" : "Показать символы"}
            aria-controls={id + "-password"}
            aria-pressed={shown}
            data-hint={visibilityLabel}
            onClick={() => setShown(!shown)}
          >
            <AccessIcon name={shown ? "hide" : "show"} />
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="srez-login-submit" disabled={busy}>
        {busy ? (
          <Loader label="Вход…" />
        ) : (
          <>
            <span>Войти</span>
            <AccessIcon name="enter" />
          </>
        )}
      </button>
    </form>
  );
}
