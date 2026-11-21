const paths = {
  more: "M4 12h1m6.5 0h1m6.5 0h1",
  live: "M3 7h18a9 9 0 0 1-18 0Zm4 2.5 1.3 2m3.7-1.4v2.7m4.6-3.2-1.2 2",
  queue: "M8 6.5h12M8 12h12M8 17.5h12M4.6 5l-1 2m1 3.5-1 2m1 3.5-1 2",
  bell: "M5 15c2-2 2-3 2-6a5 5 0 0 1 10 0c0 3 0 4 2 6l1 2H4l1-2ZM10 20a3 3 0 0 0 4 0",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2",
  quality: "M12 2 3 6v6c0 5 6 9 9 10 3-1 9-5 9-10V6l-9-4Zm-4 10 3 3 5-6",
  expand: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5",
  research: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-2 5 7 7",
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Mark() {
  return (
    <svg width="44" height="31" viewBox="0 0 48 34" aria-hidden="true">
      <path d="M2 5h44a22 22 0 0 1-44 0Z" fill="#165843" />
      <path d="M5 5h38a19 19 0 0 1-38 0Z" fill="#d8f48f" />
      <path d="M8 5h32a16 16 0 0 1-32 0Z" fill="#f48aa3" />
      <path
        d="m16 9 2 3m6-2v4m8-5-2 3"
        stroke="#25362b"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
