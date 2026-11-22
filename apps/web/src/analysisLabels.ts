// Existing saved conversations and cached analyses can still carry legacy display text.
export function analysisText(text: string) {
  return text.replace(/план VseLLM/giu, "План разбора").replace(/VseLLM/giu, "Сервис ИИ");
}

export function analysisSource(provider: string) {
  return provider === "VseLLM" ? "Помощник" : provider;
}
