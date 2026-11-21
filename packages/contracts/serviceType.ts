// Earlier synthetic snapshots and saved links used 1/2/3. The source export
// uses 10=Клиентский, 20=Пользовательский, 30=Технологический.
export function serviceFilterId(value: unknown): string {
  const id = String(value ?? "");
  switch (id) {
    case "1":
      return "30";
    case "2":
      return "10";
    case "3":
      return "20";
    default:
      return id;
  }
}

export function sourceServiceTypeId(id: unknown, label: unknown): string {
  const legacy =
    (id === 1 && label === "Технический") ||
    (id === 2 && label === "Клиентский") ||
    (id === 3 && label === "Внутренний");
  return legacy ? serviceFilterId(id) : String(id ?? "");
}
