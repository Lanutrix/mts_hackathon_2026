export default function Loader({
  label,
  stage = false,
}: {
  label: string;
  stage?: boolean;
}) {
  return (
    <span
      role="status"
      aria-atomic="true"
      className={stage ? "wm-loader wm-loader-stage" : "wm-loader"}
    >
      <i className="wm-loader-optic" aria-hidden="true">
        <i />
      </i>
      <span>{label}</span>
    </span>
  );
}
