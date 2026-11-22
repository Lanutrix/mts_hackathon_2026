import { useLayoutEffect, useState } from "react";
import type { CanvasResult } from "../../../packages/contracts/canvas";
import { PageControls, useBox } from "./CanvasControls";
import { TicketMentions } from "./IncidentSources";
import "./conversationAnswer.css";

export default function ConversationAnswer({ answer, canAsk, ask, ids, ns, open }: {
  answer: NonNullable<CanvasResult["conversation"]>;
  ids: string[];
  ns: string;
  open: (id: string) => void;
  canAsk: boolean;
  ask: (question: string) => void;
}) {
  const { ref, width, height } = useBox();
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body || !width || !height) return;
    let mounted = true;
    const measure = () => {
      if (mounted) setPages(Math.max(1, Math.round(body.scrollWidth / width)));
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { mounted = false; };
  }, [answer.text, ref, width, height]);
  const current = Math.min(page, pages - 1);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollLeft = current * width;
  }, [current, width, ref]);
  const followUp = answer.followUp;
  return (
    <div className="cx-prose" data-testid="conversation-answer">
      <div className="cx-prose-sheet" ref={ref}>
        <p><TicketMentions text={answer.text} {...{ ids, ns, open }} /></p>
      </div>
      <div className="cx-prose-actions">
        {followUp && (
          <button type="button" className="cx-prose-question" disabled={!canAsk}
            onClick={() => ask(followUp)}>
            {followUp}<span aria-hidden="true">↗</span>
          </button>
        )}
        <PageControls page={current} pages={pages} goto={setPage} label="Страницы ответа" />
      </div>
    </div>
  );
}
