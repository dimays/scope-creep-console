import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

/**
 * The live reply box for a thread (ADR-013). Streams the Chief of Staff's reply
 * token-by-token into an optimistic bubble with a working indicator — no browser
 * refresh — then revalidates so the persisted timeline takes over. Also polls for
 * out-of-band updates (an async operator reply from another process) while the org
 * holds the turn. Degrades to a plain POST to the route action without JS.
 */
type Phase = "idle" | "working" | "streaming";

export function ThreadReply({ threadId, status }: { threadId: number; status: string }) {
  const revalidator = useRevalidator();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [sentOwner, setSentOwner] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const pendingClear = useRef(false);

  // Once the persisted timeline has been revalidated, drop the optimistic bubbles.
  useEffect(() => {
    if (pendingClear.current && revalidator.state === "idle") {
      pendingClear.current = false;
      setSentOwner(null);
      setReply("");
      setPhase("idle");
    }
  }, [revalidator.state]);

  // Poll for out-of-band updates while the org holds the turn and we're not mid-send.
  useEffect(() => {
    if (phase !== "idle" || status !== "working") return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(t);
  }, [phase, status, revalidator]);

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (!body || phase !== "idle") return;
    setText("");
    setSentOwner(body);
    setReply("");
    setPhase("working");
    try {
      const res = await fetch("/thread/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, text: body }),
      });
      if (!res.ok || !res.body) throw new Error("send failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let got = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        got += decoder.decode(value, { stream: true });
        setReply(got);
        setPhase("streaming");
      }
    } catch {
      // The persisted thread is the source of truth; fall through and revalidate.
    } finally {
      pendingClear.current = true;
      revalidator.revalidate();
    }
  }

  return (
    <>
      {sentOwner ? (
        <div className="thread thread--live">
          <div className="msg msg--owner">
            <span className="msg__author">you</span>
            <p className="msg__body">{sentOwner}</p>
          </div>
          <div className="msg msg--agent">
            <span className="msg__author">chief-of-staff</span>
            {phase === "working" ? <WorkingIndicator /> : <p className="msg__body">{reply}</p>}
          </div>
        </div>
      ) : null}

      <form method="post" onSubmit={send} className="req-form">
        <textarea
          name="body"
          className="req-textarea"
          placeholder="Message the Chief of Staff…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={phase !== "idle"}
          required
        />
        <div className="req-actions">
          <button type="submit" className="req-submit" disabled={phase !== "idle"}>
            {phase === "idle" ? "Send" : "Working…"}
          </button>
        </div>
      </form>
    </>
  );
}

const LABELS = ["Chief of Staff is thinking…", "reading the thread…", "composing a reply…"];

function WorkingIndicator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % LABELS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="working" role="status" aria-label="Chief of Staff is working">
      <span className="working__dots" aria-hidden="true">
        <span className="working__dot" />
        <span className="working__dot" />
        <span className="working__dot" />
      </span>
      <span className="working__label">{LABELS[i]}</span>
    </span>
  );
}
