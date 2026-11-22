import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Brand";
import "./dispatchReturn.css";

type Receipt = { id: string; team: string; at: number };
const pending = new Map<string, Receipt>();
const storageKey = (user: string, ns: string) => "srez:last-handoff:" + JSON.stringify([user, ns]);

export function rememberHandoff(user: string, ns: string, id: string, team: string) {
  const key = storageKey(user, ns);
  const receipt = { id, team, at: Date.now() };
  pending.set(key, receipt);
  try { sessionStorage.setItem(key, JSON.stringify(receipt)); } catch { /* Memory covers this visit. */ }
}

function readReceipt(key: string): Receipt | null {
  let receipt = pending.get(key);
  if (!receipt) {
    try { receipt = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; }
  }
  return receipt && typeof receipt.id === "string" && typeof receipt.team === "string" &&
    Date.now() - receipt.at < 30 * 60_000 ? receipt : null;
}

export function DispatchReturn({ username, namespace }: { username: string; namespace: string }) {
  const key = storageKey(username, namespace);
  const [receipt, setReceipt] = useState(() => readReceipt(key));
  const marker = useRef<HTMLDivElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const subject = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!receipt) return;
    pending.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* No persistent storage in this browser. */ }
    const timeout = window.setTimeout(() => setReceipt(null), 6200);
    return () => window.clearTimeout(timeout);
  }, [key, receipt]);

  useLayoutEffect(() => {
    const destination = marker.current, copy = flight.current;
    if (!receipt || !destination || !copy || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const board = destination.closest(".broadcast");
    if (!board) return;
    const ticketId = receipt.id;
    let animation: Animation | undefined;
    let observer: MutationObserver | undefined;
    function start(useFallback: boolean) {
      if (!board || !copy || !destination || animation) return;
      const row = board.querySelector('[data-testid="card-' + CSS.escape(ticketId) + '"]');
      if (!row && !useFallback) return;
      observer?.disconnect();
      const rect = row?.getBoundingClientRect();
      const queue = board.querySelector(".triage-register")?.getBoundingClientRect();
      const base = destination.getBoundingClientRect();
      const summary = row?.querySelector(".feed-subject button")?.textContent;
      if (subject.current && summary) subject.current.textContent = summary;
      const y = rect && rect.top >= 0 && rect.bottom <= innerHeight
        ? rect.top : Math.max(88, Math.min(innerHeight * .48, queue?.top ?? innerHeight * .42));
      const x = rect && rect.left >= 0 ? rect.left : Math.max(12, queue?.left ?? base.left);
      const dx = x - base.left, dy = y - base.top;
      const from = "translate(" + dx + "px," + dy + "px) scale(1)";
      const rowWidth = Math.min(rect?.width ?? base.width, innerWidth - x - 8);
      copy.style.visibility = "visible";
      animation = copy.animate([
        { transform: from, width: rowWidth + "px", opacity: 0, offset: 0 },
        { transform: from, width: rowWidth + "px", opacity: 1, offset: .12 },
        { transform: from, width: rowWidth + "px", opacity: 1, offset: .36 },
        { transform: "translate(0,0) scale(.96)", width: base.width + "px", opacity: .8, offset: .90 },
        { transform: "translate(0,0) scale(.86)", width: base.width + "px", opacity: 0 },
      ], { duration: 1050, easing: "cubic-bezier(.22,.7,.22,1)", fill: "forwards" });
    }
    observer = new MutationObserver(() => start(false));
    observer.observe(board, { childList: true, subtree: true });
    start(false);
    const grace = window.setTimeout(() => start(true), 550);
    return () => {
      window.clearTimeout(grace);
      observer?.disconnect();
      animation?.cancel();
      copy.style.visibility = "hidden";
    };
  }, [receipt]);

  if (!receipt) return null;
  return <div className="handoff-receipt" ref={marker}>
    <div className="handoff-receipt-message" role="status">
      <Icon name="history" size={23} />
      <span><small>Решение в журнале</small><strong>{receipt.id}</strong> · {receipt.team}</span>
    </div>
    <div className="handoff-flight" aria-hidden="true" ref={flight}>
      <Icon name="team" size={20} /><span><strong>{receipt.id}</strong><span className="handoff-subject" ref={subject}>{receipt.team}</span></span>
    </div>
  </div>;
}
