import { useId, useState, type CSSProperties } from "react";
import type {
  CanvasGroup,
  CanvasResult,
} from "../../../packages/contracts/canvas";
import { CanvasTicketLink } from "./CanvasTickets";

const colors = ["#fe83a5", "#bda4ff", "#8ae4c7", "#98c8ff", "#f0a5e3"];
const shades = ["#ac204b", "#714ac4", "#1b8f79", "#4283c2", "#97519e"];
const lensPositions: Record<number, number[][]> = {
  1: [[302, 130]],
  2: [
    [224, 133],
    [383, 101],
  ],
  3: [
    [169, 127],
    [308, 103],
    [443, 119],
  ],
  4: [
    [121, 127],
    [251, 96],
    [375, 137],
    [486, 100],
  ],
  5: [
    [104, 133],
    [211, 93],
    [310, 133],
    [413, 91],
    [504, 131],
  ],
};
const tone = (index: number) =>
  ({ "--tone": colors[index % colors.length] }) as CSSProperties;
const number = (value: number) => value.toLocaleString("ru-RU");

function OpticalAtlas({
  groups,
  choose,
}: {
  groups: CanvasGroup[];
  choose: (group: CanvasGroup) => void;
}) {
  const id = useId().replace(/[^a-z0-9_-]/gi, "");
  const [hovered, setHovered] = useState<string | null>(null);
  const [shown, setShown] = useState(5);
  const visible = groups.slice(0, 5);
  const max = Math.max(1, ...visible.map((group) => group.count));
  const positions = lensPositions[visible.length];
  return (
    <>
      <div className="cx-atlas" data-testid="symptom-atlas">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 600 236"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern
              id={id + "grid"}
              width="26"
              height="26"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M26 0H0V26"
                fill="none"
                stroke="#e2d7ff"
                strokeOpacity=".13"
                strokeWidth=".6"
              />
              <circle r="1" fill="#d9caff" opacity=".2" />
            </pattern>
            <linearGradient
              id={id + "shine"}
              x1=".1"
              x2=".9"
              y1="0"
              y2="1"
              gradientUnits="objectBoundingBox"
            >
              <stop stopColor="#fff" stopOpacity=".7" />
              <stop offset=".4" stopColor="#fff" stopOpacity=".03" />
              <stop offset=".74" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#fff" stopOpacity=".44" />
            </linearGradient>
            {visible.map((group, i) => (
              <g key={group.key}>
                <radialGradient id={id + "face" + i} cx="25%" cy="12%" r="100%">
                  <stop stopColor={colors[i]} stopOpacity=".95" />
                  <stop offset=".43" stopColor={shades[i]} stopOpacity=".68" />
                  <stop offset=".75" stopColor={shades[i]} stopOpacity=".54" />
                  <stop offset="1" stopColor={colors[i]} stopOpacity=".86" />
                </radialGradient>
                <linearGradient
                  id={id + "edge" + i}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2=".8"
                >
                  <stop stopColor={colors[i]} stopOpacity=".98" />
                  <stop offset=".17" stopColor={shades[i]} />
                  <stop offset=".48" stopColor={shades[i]} stopOpacity=".42" />
                  <stop offset=".8" stopColor={colors[i]} />
                  <stop offset="1" stopColor={shades[i]} />
                </linearGradient>
              </g>
            ))}
          </defs>
          <rect width="600" height="236" fill={`url(#${id}grid)`} />
          <g className="cx-orbits" fill="none" stroke="#b6a0dc">
            <ellipse
              cx="300"
              cy="131"
              rx="268"
              ry="70"
              transform="rotate(-7 300 131)"
            />
            <ellipse
              cx="300"
              cy="131"
              rx="222"
              ry="47"
              transform="rotate(-7 300 131)"
              strokeDasharray="3 7"
            />
            <path d="M22 179 579 71" strokeDasharray="2 6" />
            <path d="m24 25 0 9m-4-4h8m542 170v9m-4-4h8" />
          </g>
          {visible.map((group, i) => {
            const [x, y] = positions[i];
            const factor = Math.min(1.08, 3.3 / Math.max(3, visible.length));
            const rx = factor * 104 * Math.sqrt(group.count / max);
            const ry = rx * 0.55;
            const depth = rx * 0.19;
            return (
              <g
                key={group.key}
                className="cx-lens-point"
                transform={`translate(${x} ${y})`}
                style={{ "--enter-delay": i * 45 + "ms" } as CSSProperties}
                data-dim={
                  visible.some((item) => item.key === hovered) &&
                  hovered !== group.key
                }
                data-pointed={hovered === group.key}
                onClick={() => choose(group)}
                onMouseEnter={() => setHovered(group.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>
                  {group.label} · {group.count}
                </title>
                <g className="cx-glass" transform="rotate(-35)">
                  <path
                    d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0 L ${rx} ${depth} A ${rx} ${ry} 0 0 1 ${-rx} ${depth} Z`}
                    fill={`url(#${id}edge${i})`}
                    stroke={colors[i]}
                    strokeWidth=".9"
                  />
                  {[0.22, 0.65, 0.9].map((fraction) => (
                    <path
                      key={fraction}
                      d={`M ${-rx} ${fraction * depth} a ${rx} ${ry} 0 0 0 ${2 * rx} 0`}
                      fill="none"
                      stroke={colors[i]}
                      strokeOpacity=".57"
                      strokeWidth=".65"
                    />
                  ))}
                  <ellipse
                    rx={rx}
                    ry={ry}
                    fill={`url(#${id}face${i})`}
                    stroke={colors[i]}
                    strokeWidth="2"
                  />
                  <ellipse
                    rx={rx * 0.97}
                    ry={ry * 0.94}
                    fill="none"
                    stroke={`url(#${id}shine)`}
                    strokeWidth="2"
                  />
                  <ellipse
                    rx={rx * 0.88}
                    ry={ry * 0.79}
                    fill="none"
                    stroke={colors[i]}
                    strokeOpacity=".53"
                    strokeWidth=".8"
                  />
                  <path
                    d={`M ${-0.92 * rx} ${-0.11 * ry} Q ${-0.75 * rx} ${-0.94 * ry} ${0.14 * rx} ${-0.97 * ry} Q ${-0.48 * rx} ${-0.72 * ry} ${-0.92 * rx} ${-0.11 * ry} Z`}
                    fill="white"
                    opacity=".48"
                  />
                  <ellipse
                    rx={rx * 0.14}
                    ry={ry * 0.15}
                    fill="#1b142c"
                    fillOpacity=".3"
                    stroke={colors[i]}
                    strokeOpacity=".85"
                  />
                  <path
                    d={`M ${-0.22 * rx} 0 H ${0.22 * rx} M 0 ${-0.21 * ry} V ${0.21 * ry}`}
                    stroke="#fff"
                    strokeWidth=".8"
                    opacity=".76"
                  />
                </g>
                <g
                  transform={`translate(${rx * 0.55} ${-ry * 0.83})`}
                  className="cx-lens-tag"
                >
                  <rect
                    x="-14"
                    y="-9"
                    width="28"
                    height="18"
                    rx="6"
                    fill="#252035"
                    stroke={colors[i]}
                    strokeWidth=".8"
                  />
                  <text y="3.5" fill={colors[i]} textAnchor="middle">
                    {String(i + 1).padStart(2, "0")}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
        <p className="cx-scale">
          Площадь линзы показывает число заявок
          {groups.length > 5 ? " · 5 крупнейших групп" : ""}
        </p>
      </div>
      <div className="cx-atlas-key">
        {groups.slice(0, shown).map((group, index) => (
          <button
            type="button"
            style={tone(index)}
            key={group.key}
            onMouseEnter={() => setHovered(group.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(group.key)}
            onBlur={() => setHovered(null)}
            onClick={() => choose(group)}
            title={"Открыть инциденты · " + group.label}
          >
            <span className="cx-key-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{group.label}</span>
            <b>{number(group.count)}</b>
            <span className="cx-key-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </div>
      {groups.length > shown && (
        <button className="cx-figure-more" onClick={() => setShown(shown + 10)}>
          Показать ещё · {shown} из {groups.length}
        </button>
      )}
    </>
  );
}

function Comparison({
  groups,
  choose,
}: {
  groups: CanvasGroup[];
  choose: (g: CanvasGroup) => void;
}) {
  const max = Math.max(1, ...groups.map((group) => group.count));
  return (
    <div className="cx-comparison" data-testid="group-comparison">
      <table>
        <thead>
          <tr>
            <th scope="col">Группа</th>
            <th scope="col">Всего</th>
            <th scope="col">Просрочено</th>
            <th scope="col">Эскалации</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <th scope="row">
                <button type="button" onClick={() => choose(g)}>
                  {g.label} <span aria-hidden="true">↗</span>
                </button>
              </th>
              {[g.count, g.overdue, g.escalated].map((value, i) => (
                <td key={i}>
                  <b>{number(value)}</b>
                  <i
                    style={{
                      ...tone([1, 0, 2][i]),
                      width: (100 * value) / max + "%",
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ranked({
  groups,
  choose,
}: {
  groups: CanvasGroup[];
  choose: (g: CanvasGroup) => void;
}) {
  const max = Math.max(1, ...groups.map((group) => group.count));
  return (
    <div className="cx-ranked" data-testid="group-ranking">
      {groups.map((group, index) => (
        <button
          key={group.key}
          type="button"
          onClick={() => choose(group)}
          style={tone(index)}
        >
          <span>{group.label}</span>
          <b>
            {number(group.count)} <small aria-hidden="true">↗</small>
          </b>
          <i>
            <i style={{ width: (group.count / max) * 100 + "%" }} />
          </i>
        </button>
      ))}
    </div>
  );
}

function TimeWindows({
  groups,
  choose,
}: {
  groups: CanvasGroup[];
  choose: (g: CanvasGroup) => void;
}) {
  const slots = ["overdue", "soon", "normal", "unset"];
  const ordered = [...groups].sort(
    (a, b) => slots.indexOf(a.key) - slots.indexOf(b.key),
  );
  return (
    <div className="cx-windows" data-testid="deadline-windows">
      {ordered.map((group) => (
        <button
          type="button"
          key={group.key}
          style={tone(slots.indexOf(group.key))}
          onClick={() => choose(group)}
        >
          <span className="cx-time-node" aria-hidden="true" />
          <span>{group.label}</span>
          <b>{number(group.count)}</b>
          <small aria-hidden="true">↗</small>
        </button>
      ))}
    </div>
  );
}

export function CanvasFigure({
  result,
  choose,
  ns,
  open,
  zone,
}: {
  result: CanvasResult;
  choose: (g: CanvasGroup | null) => void;
  ns: string;
  open: (id: string) => void;
  zone: string;
}) {
  const { groups, intent, tickets, total } = result;
  const [shown, setShown] = useState(8);
  if (!total)
    return (
      <div className="cx-no-matches">
        <span aria-hidden="true">∅</span>
        <h3>
          {result.sourceTotal ? "Инцидентов не найдено" : "Источник пока пуст"}
        </h3>
        <p>
          {result.sourceTotal
            ? "Измените условие или начните новый диалог."
            : "Когда поступят заявки, их можно будет разобрать на холсте."}
        </p>
      </div>
    );
  if (intent.layout === "list" || intent.groupBy === "ticket")
    return (
      <div className="cx-register" data-testid="ticket-register">
        {tickets.slice(0, 4).map((ticket) => (
          <CanvasTicketLink key={ticket.id} {...{ ns, open, zone, ticket }} />
        ))}
        {total > Math.min(4, tickets.length) && (
          <button className="cx-figure-more" onClick={() => choose(null)}>
            Все инциденты · {number(total)} ↗
          </button>
        )}
      </div>
    );
  if (intent.groupBy === "symptom" && intent.layout !== "comparison")
    return <OpticalAtlas {...{ groups, choose }} />;
  if (intent.groupBy === "deadline" && intent.layout !== "comparison")
    return <TimeWindows {...{ groups, choose }} />;
  const visible = groups.slice(0, shown);
  return (
    <>
      {intent.layout === "comparison" ? (
        <Comparison groups={visible} choose={choose} />
      ) : (
        <Ranked groups={visible} choose={choose} />
      )}
      {groups.length > shown && (
        <button className="cx-figure-more" onClick={() => setShown(shown + 10)}>
          Показать ещё · {shown} из {groups.length}
        </button>
      )}
    </>
  );
}
