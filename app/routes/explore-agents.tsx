import { useState } from "react";
import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { agentDisplayName } from "~/lib/display-name";
import { slugify } from "~/lib/employee-scaffold";
import { modelPreset } from "~/lib/models";
import type { OrgEmployee, OrgExec, OrgFunction, OrgTemplate, TicketRef } from "~/lib/org.server";
import { readOrg } from "~/lib/org.server";
import { listWork } from "~/lib/work.server";
import type { Route } from "./+types/explore-agents";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Org · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const org = await readOrg();
  const work = org.available ? await listWork() : [];
  const tickets = work
    .filter((w) => w.status !== "done")
    .map((w) => ({ id: w.id, title: w.title, status: w.status }));
  const execNames = org.tree.execs.map((e) => e.name);
  const templates = org.templates.map((t) => ({ name: t.name, description: t.description }));
  return { org, tickets, execNames, templates };
}

export default function ExploreAgents({ loaderData }: Route.ComponentProps) {
  const { org, tickets, execNames, templates } = loaderData;
  const { tree } = org;
  const employeeTotal =
    tree.execs.reduce((n, e) => n + e.employees.length, 0) + tree.orphans.length;

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Org</h1>
        </div>
        <Link to="/" className="console__meta">
          ← dashboard
        </Link>
      </header>
      <ExploreNav />

      {!org.available && (
        <p className="console__notice">
          Control plane not found at <code>{org.home}</code>. Set <code>SCOPE_CREEP_HOME</code> to
          see the org.
        </p>
      )}

      <p className="doc-path">
        {tree.execs.length} executive{tree.execs.length === 1 ? "" : "s"} · {tree.functions.length}{" "}
        standing function{tree.functions.length === 1 ? "" : "s"} · {employeeTotal} employee
        {employeeTotal === 1 ? "" : "s"} · four tiers per ADR-020; staffing derived from work-item
        assignees (ADR-017).
      </p>

      {/* Tier 1 (executives) + tier 3 (employees) + tier 4 (the summon catalog): the
          reporting tree Owner → execs → employees, each exec carrying what it can summon. */}
      <section className="org">
        <div className="org__owner">
          <span className="org__owner-dot" aria-hidden />
          <span className="org__owner-name">The Owner</span>
          <span className="console__tag">human</span>
        </div>
        <ul className="org__execs">
          {tree.execs.map((exec) => (
            <ExecNode key={exec.name} exec={exec} />
          ))}
        </ul>
        {tree.orphans.length > 0 && (
          <div className="org__orphans">
            <h2 className="doc-group__title">Unassigned employees</h2>
            <p className="console__empty">
              These employees' <code>reports_to</code> matches no known executive:
            </p>
            <ul className="console__list">
              {tree.orphans.map((emp) => (
                <li key={emp.name} className="console__item">
                  <EmployeeName emp={emp} />
                  <EmployeeStatus status={emp.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Tier 2: the standing functions — permanent, cross-org execution. Rendered apart
          from the executive tree and from employees so they read as neither (ADR-020 §B). */}
      <StandingFunctions functions={tree.functions} />

      {/* Gated authoring (ADR-009 / ADR-017): everything opens a PR the Owner merges. */}
      <SpinUpEmployee execNames={execNames} templates={templates} tickets={tickets} />
      <NewTemplate execNames={execNames} />
    </main>
  );
}

function ExecNode({ exec }: { exec: OrgExec }) {
  return (
    <li className="org__exec">
      <div className="org__exec-head">
        <Link to={`/explore/agents/${exec.name}`} className="org__exec-name">
          {agentDisplayName(exec.name)}
        </Link>
        <span className="org__tier-tag org__tier-tag--exec">executive</span>
        <span className="org__counts">
          {exec.employees.length} report{exec.employees.length === 1 ? "" : "s"} ·{" "}
          {exec.ownedTicketCount} owned · {exec.staffedTicketCount} staffed
        </span>
      </div>
      {exec.employees.length === 0 ? (
        <p className="console__empty org__empty">No employees spun up yet.</p>
      ) : (
        <ul className="org__reports">
          {exec.employees.map((emp) => (
            <li key={emp.name} className="org__report">
              <div className="org__report-head">
                <EmployeeName emp={emp} />
                <EmployeeStatus status={emp.status} />
                {emp.template && (
                  <Link to={`/explore/templates/${emp.template}`} className="console__tag org__tpl">
                    {emp.template}
                  </Link>
                )}
                {emp.defaultModel && <ModelBadge id={emp.defaultModel} override />}
              </div>
              <TicketChips tickets={emp.tickets} emptyLabel="available — not staffed" />
            </li>
          ))}
        </ul>
      )}
      <SummonCatalog templates={exec.templates} />
    </li>
  );
}

/** The per-exec summon catalog (ADR-020 §D): "the types of employees I can summon." */
function SummonCatalog({ templates }: { templates: OrgTemplate[] }) {
  if (templates.length === 0) return null;
  return (
    <div className="org__catalog">
      <span className="org__catalog-label">Can summon</span>
      <ul className="org__templates">
        {templates.map((t) => (
          <li key={t.name} className="org__template">
            <Link to={`/explore/templates/${t.name}`} className="org__template-name">
              {t.name}
            </Link>
            <ModelBadge id={t.defaultModel} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A model preset badge — the tier each kind of employee runs (ADR-020 §D / staffing §4). */
function ModelBadge({ id, override = false }: { id?: string; override?: boolean }) {
  const preset = modelPreset(id);
  if (!preset) return null;
  return (
    <span
      className="org__preset"
      title={
        override
          ? `Per-employee model override: ${preset.id} (${preset.tier} tier)`
          : `Model preset: ${preset.id} (${preset.tier} tier)`
      }
    >
      {override && <span className="org__preset-flag">override</span>}
      {preset.short}
      <span className="org__preset-tier">{preset.tier}</span>
    </span>
  );
}

/** Employee lifecycle status pill (ADR-020 §C): active | idle | retired. */
function EmployeeStatus({ status }: { status?: string }) {
  if (!status) return null;
  const kind = status === "retired" || status === "idle" ? status : "active";
  return (
    <span
      className={`org__status org__status--${kind}`}
      title={
        kind === "retired"
          ? "Retired — dissolved; employees are ephemeral (ADR-020 §C)"
          : kind === "idle"
            ? "Idle — summoned, awaiting staffing or between tickets"
            : "Active"
      }
    >
      {status}
    </span>
  );
}

/** The standing-function tier (ADR-020 §B) — permanent cross-org execution. */
function StandingFunctions({ functions }: { functions: OrgFunction[] }) {
  if (functions.length === 0) return null;
  return (
    <section className="org-tier org-tier--functions">
      <div className="org-tier__head">
        <h2 className="doc-group__title">Standing functions</h2>
        <span className="console__count">{functions.length}</span>
      </div>
      <p className="console__empty org-tier__lede">
        Permanent, cross-org functions — they hold <em>execution</em>, not a domain. Not executives,
        not summoned per-ticket like employees: any exec's work routes "prove it" and "land it" here
        (ADR-020 §B).
      </p>
      <ul className="org__functions">
        {functions.map((fn) => (
          <li key={fn.name} className="org__function">
            <div className="org__function-head">
              <Link to={`/explore/agents/${fn.name}`} className="org__function-name">
                {agentDisplayName(fn.name)}
              </Link>
              <span className="org__tier-tag org__tier-tag--function">function</span>
              <EmployeeStatus status={fn.status} />
            </div>
            {fn.description && <p className="org__function-desc">{fn.description}</p>}
            <TicketChips tickets={fn.tickets} emptyLabel="no active tickets" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmployeeName({ emp }: { emp: OrgEmployee }) {
  return (
    <Link to={`/explore/agents/${emp.name}`} className="console__item-name">
      {agentDisplayName(emp.name)}
    </Link>
  );
}

function TicketChips({ tickets, emptyLabel }: { tickets: TicketRef[]; emptyLabel: string }) {
  if (tickets.length === 0) return <span className="org__none">{emptyLabel}</span>;
  return (
    <span className="org__tickets">
      {tickets.map((t) => (
        <Link
          key={t.id}
          to={`/work/${t.id}`}
          className={`org__ticket org__ticket--${t.role}`}
          title={`${t.title} (${t.status})`}
        >
          {t.id}
        </Link>
      ))}
    </span>
  );
}

// --- gated authoring forms ------------------------------------------------

type Phase = "idle" | "previewing" | "previewed" | "landing" | "landed" | "error";
type ProposalState = { phase: Phase; diff?: string; prUrl?: string; error?: string };

/** Shared preview → approve flow against the control-plane authoring routes. */
function useGatedProposal(previewUrl: string, landUrl: string) {
  const [state, setState] = useState<ProposalState>({ phase: "idle" });

  async function post(url: string, spec: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
    return (await res.json()) as {
      ok: boolean;
      diff?: string;
      prUrl?: string;
      error?: string;
    };
  }

  async function preview(spec: unknown) {
    setState({ phase: "previewing" });
    try {
      const data = await post(previewUrl, spec);
      if (data.ok) setState({ phase: "previewed", diff: data.diff });
      else setState({ phase: "error", error: data.error ?? "preview failed" });
    } catch {
      setState({ phase: "error", error: "couldn't reach the authoring runtime" });
    }
  }

  async function approve(spec: unknown) {
    setState((s) => ({ ...s, phase: "landing" }));
    try {
      const data = await post(landUrl, spec);
      if (data.ok) setState({ phase: "landed", prUrl: data.prUrl });
      else setState({ phase: "error", error: data.error ?? "opening the PR failed" });
    } catch {
      setState({ phase: "error", error: "couldn't reach the authoring runtime" });
    }
  }

  return { state, preview, approve, reset: () => setState({ phase: "idle" }) };
}

function ProposalResult({ state }: { state: ProposalState }) {
  if (state.phase === "error")
    return <p className="console__notice console__notice--error">⚠ {state.error}</p>;
  if (state.phase === "landed")
    return (
      <p className="console__notice">
        Gated PR opened —{" "}
        {state.prUrl ? (
          <a href={state.prUrl} target="_blank" rel="noreferrer">
            review &amp; merge to ratify ↗
          </a>
        ) : (
          "review it in the control plane."
        )}
      </p>
    );
  if ((state.phase === "previewed" || state.phase === "landing") && state.diff)
    return (
      <pre className="org__diff">
        <code>{state.diff || "(no changes)"}</code>
      </pre>
    );
  return null;
}

function SpinUpEmployee({
  execNames,
  templates,
  tickets,
}: {
  execNames: string[];
  templates: { name: string; description?: string }[];
  tickets: { id: string; title: string; status: string }[];
}) {
  const { state, preview, approve } = useGatedProposal(
    "/org/employee/preview",
    "/org/employee/land",
  );
  const [template, setTemplate] = useState(templates[0]?.name ?? "");
  const [name, setName] = useState("");
  const [reportsTo, setReportsTo] = useState(execNames[0] ?? "");
  const [description, setDescription] = useState("");
  const [mandate, setMandate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const slug = slugify(name);
  const spec = { name: slug, template, reportsTo, description, mandate, tickets: picked };
  const ready = slug && template && reportsTo && description.trim();
  const busy = state.phase === "previewing" || state.phase === "landing";

  return (
    <details className="org__authoring">
      <summary>Spin up an employee</summary>
      <p className="console__empty">
        Pick a template, name the employee, choose the reporting executive, and staff to tickets.
        This opens a <strong>gated PR</strong> in the control plane — nothing merges automatically.
      </p>
      <div className="org__form">
        <label>
          Template
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.length === 0 && <option value="">(no templates)</option>}
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" />
          {slug && <span className="org__hint">slug: {slug}</span>}
        </label>
        <label>
          Reports to
          <select value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            {execNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="org__form-wide">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line: what this employee is for."
          />
        </label>
        <label className="org__form-wide">
          Mandate (optional)
          <textarea
            value={mandate}
            onChange={(e) => setMandate(e.target.value)}
            rows={2}
            placeholder="Current mandate / specialization."
          />
        </label>
        <fieldset className="org__form-wide">
          <legend>Staff to tickets (optional)</legend>
          <div className="org__tickets-pick">
            {tickets.length === 0 && <span className="console__empty">No open tickets.</span>}
            {tickets.map((t) => (
              <label key={t.id} className="org__check">
                <input
                  type="checkbox"
                  checked={picked.includes(t.id)}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                    )
                  }
                />
                <span>
                  {t.id} — {t.title}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="org__actions">
        <button type="button" disabled={!ready || busy} onClick={() => preview(spec)}>
          {state.phase === "previewing" ? "Building diff…" : "Preview diff"}
        </button>
        <button
          type="button"
          className="org__approve"
          disabled={state.phase !== "previewed" || busy}
          onClick={() => approve(spec)}
        >
          {state.phase === "landing" ? "Opening PR…" : "Approve → open PR"}
        </button>
      </div>
      <ProposalResult state={state} />
    </details>
  );
}

function NewTemplate({ execNames }: { execNames: string[] }) {
  const { state, preview, approve } = useGatedProposal(
    "/org/template/preview",
    "/org/template/land",
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgent, setOwnerAgent] = useState(execNames[0] ?? "");
  const [defaultModel, setDefaultModel] = useState("claude-sonnet-5");
  const [skills, setSkills] = useState("");
  const [manual, setManual] = useState("");

  const slug = slugify(name);
  const spec = { name: slug, description, ownerAgent, defaultModel, skills, manual };
  const ready = slug && description.trim() && ownerAgent;
  const busy = state.phase === "previewing" || state.phase === "landing";

  return (
    <details className="org__authoring">
      <summary>New / modify employee template</summary>
      <p className="console__empty">
        When no role fits, define one. The exec writes the operating manual; this opens a{" "}
        <strong>gated PR</strong> adding <code>agents/templates/&lt;slug&gt;.md</code>. Using an
        existing template's slug modifies it.
      </p>
      <div className="org__form">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Data Analyst"
          />
          {slug && <span className="org__hint">slug: {slug}</span>}
        </label>
        <label>
          Owned by
          <select value={ownerAgent} onChange={(e) => setOwnerAgent(e.target.value)}>
            {execNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Default model
          <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
        </label>
        <label>
          Skills (comma-separated)
          <input
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="sql, dbt, charts"
          />
        </label>
        <label className="org__form-wide">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line: what this role is for."
          />
        </label>
        <label className="org__form-wide">
          Operating manual (optional)
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            rows={4}
            placeholder="Markdown: Read first / Mandate / Good looks like / Default grants…"
          />
        </label>
      </div>
      <div className="org__actions">
        <button type="button" disabled={!ready || busy} onClick={() => preview(spec)}>
          {state.phase === "previewing" ? "Building diff…" : "Preview diff"}
        </button>
        <button
          type="button"
          className="org__approve"
          disabled={state.phase !== "previewed" || busy}
          onClick={() => approve(spec)}
        >
          {state.phase === "landing" ? "Opening PR…" : "Approve → open PR"}
        </button>
      </div>
      <ProposalResult state={state} />
    </details>
  );
}
