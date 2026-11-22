async function signIn() {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const status = document.querySelector('[role="status"]');
  if (!token) {
    status.textContent = "Отсканируйте QR-код, чтобы войти по ссылке.";
    return;
  }
  try {
    const response = await fetch("/api/login/qr", {
      headers: { Authorization: "Bearer " + token },
      mode: "same-origin",
      cache: "no-store",
    });
    if (response.status === 204) {
      location.replace("/");
      return;
    }
    status.textContent = response.status === 401
      ? "Ссылка недействительна или срок её действия истёк."
      : "Вход временно недоступен. Попробуйте отсканировать код снова.";
  } catch {
    status.textContent = "Не удалось подключиться. Проверьте связь и отсканируйте код снова.";
  }
}

void signIn();
