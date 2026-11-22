const paths = {
  enter:
    "M13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13M3 12h12m-4.5-4.5L15 12l-4.5 4.5",
  user: "M15.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM5 20v-1.3a5.5 5.5 0 0 1 5.5-5.5h3a5.5 5.5 0 0 1 5.5 5.5V20",
  lock: "M8 10V7a4 4 0 0 1 8 0v3M6.5 10h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-7A1.5 1.5 0 0 1 6.5 10ZM12 14v2",
  show: "M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12Zm12.5 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  hide: "m3 3 18 18M9.5 5.8A11 11 0 0 1 12 5.5c6.3 0 10 6.5 10 6.5a16 16 0 0 1-3 3.6M6 7.2A18 18 0 0 0 2 12s3.7 6.5 10 6.5c1.7 0 3.3-.5 4.7-1.2",
};
export const accessLabels: Record<keyof typeof paths, string> = {
  enter: "Войти",
  user: "Имя пользователя",
  lock: "Пароль",
  show: "Показать пароль",
  hide: "Скрыть пароль",
};
export default function AccessIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      data-srez-icon={accessLabels[name]}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
