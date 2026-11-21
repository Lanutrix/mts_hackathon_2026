import { useState } from "react";
import { answerElement as el } from "../../../packages/contracts/answerCatalog";
import type {
  CanvasAnswer,
  GuideSection,
} from "../../../packages/domain/assistantGuide";
import { PageControls, useBox } from "./CanvasControls";
import { screenLink } from "./routes";

function HelpLinks({
  answer,
  ns,
  go,
}: {
  answer: CanvasAnswer;
  ns: string;
  go?: (path: string) => void;
}) {
  return (
    <nav {...el("help-links")} className="ar-help-links" aria-label="По теме">
      {answer.links.map((link) => {
        const href = screenLink("/help#" + encodeURIComponent(link.anchor), ns);
        return (
          <a
            key={link.anchor}
            {...el("help-link")}
            href={href}
            onClick={(e) => {
              if (go && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                go(href);
              }
            }}
          >
            {link.label} <span aria-hidden="true">↗</span>
          </a>
        );
      })}
    </nav>
  );
}
function Detail({ section }: { section: GuideSection }) {
  return (
    <article
      className="ar-guide-section"
      data-role={section.role}
      {...el(section.role === "steps" ? "procedure" : section.role)}
    >
      <h3>
        {section.role === "example" && (
          <span aria-hidden="true" {...el("example-sign")}>
            ↳
          </span>
        )}
        {section.heading}
      </h3>
      {section.body && <p>{section.body}</p>}
      {section.items &&
        (section.role === "steps" ? (
          <ol>
            {section.items.map((s, i) => (
              <li {...el("step")} key={i}>
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                {s}
              </li>
            ))}
          </ol>
        ) : (
          <ul>
            {section.items.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ))}
    </article>
  );
}
function splitWords(text: string, limit: number) {
  const chunks: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = chunks.length - 1;
    if (last < 0 || chunks[last].length + 1 + word.length > limit)
      chunks.push(word);
    else chunks[last] += " " + word;
  }
  return chunks;
}
export function GuideAnswer({
  answer,
  ns,
  go,
}: {
  answer: CanvasAnswer;
  ns: string;
  go?: (path: string) => void;
}) {
  const { ref, width, height } = useBox(),
    [requested, setPage] = useState(0);
  const compact = width < 630 || height < 335;
  const chars = Math.max(
    52,
    Math.floor((width - 18) / (compact ? 8.5 : 9)) *
      Math.max(2, Math.floor((height - 108) / 23)),
  );
  const pages: ({ lead: string } | { section: GuideSection })[] = [
    ...(compact
      ? splitWords(answer.lead, chars).map((lead) => ({ lead }))
      : []),
    ...answer.sections.flatMap((section) => {
      if (!compact) return [{ section }];
      if (section.items?.length)
        return section.items.map((s, i) => ({
          section: {
            ...section,
            heading:
              section.heading +
              (section.items!.length > 1 ? " · " + (i + 1) : ""),
            body: s,
            items: undefined,
          },
        }));
      return splitWords(section.body || "", chars).map((body) => ({
        section: { ...section, body },
      }));
    }),
  ];
  const stackedAll = !compact && answer.sections.length <= 2 && height > 420;
  const page = Math.max(0, Math.min(requested, pages.length - 1));
  const current = pages[page];
  return (
    <div
      className="ar-guide"
      ref={ref}
      {...el("definition")}
      data-testid="answer-guide"
      data-compact={compact}
    >
      <div className="ar-guide-body" key={compact ? page : answer.topic}>
        {(!compact || (current && "lead" in current)) && (
          <div className="ar-definition">
            <p {...el("guide-lead")}>
              {compact && current && "lead" in current
                ? current.lead
                : answer.lead}
            </p>
            <HelpLinks {...{ answer, ns, go }} />
          </div>
        )}
        {(!compact || (current && "section" in current)) && (
          <div className="ar-guide-notes" {...el("guide-rail")}>
            {stackedAll ? (
              answer.sections.map((section, i) => (
                <Detail key={i} section={section} />
              ))
            ) : current && "section" in current ? (
              <Detail section={current.section} />
            ) : null}
          </div>
        )}
      </div>
      {!stackedAll && pages.length > 1 && (
        <div className="ar-guide-pagination" {...el("guide-index")}>
          <div {...el("guide-counter")} aria-hidden="true">
            {pages.map((_, i) => (
              <i key={i} data-current={i === page} />
            ))}
          </div>
          <PageControls
            page={page}
            pages={pages.length}
            goto={setPage}
            label="Части объяснения"
          />
        </div>
      )}
    </div>
  );
}
