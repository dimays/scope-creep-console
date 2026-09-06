import { Form, useNavigation } from "react-router";
import { isValidModelId } from "~/lib/models";
import { CHAT_MODEL_SETTING, readModelCatalog, resolveChatModel } from "~/lib/models.server";
import { setSetting } from "~/lib/settings.server";
import type { Route } from "./+types/settings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Settings · Scope Creep" }];
}

/** Where the effective chat model came from, in Owner-readable words. */
const SOURCE_LABEL: Record<string, string> = {
  persisted: "your saved pick",
  env: "the CHAT_MODEL env default",
  "catalog-default": "the catalog default",
  hardcoded: "the built-in fallback",
};

export async function loader(_: Route.LoaderArgs) {
  const resolved = await resolveChatModel();
  return {
    models: resolved.catalog.models,
    defaults: resolved.catalog.defaults,
    catalogAvailable: resolved.catalog.available,
    catalogSource: resolved.catalog.source,
    effective: resolved.id,
    effectiveSource: resolved.source,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const picked = String(form.get("chatModel") ?? "").trim();

  // Reset to default (env/catalog) — clear the persisted pick.
  if (picked === "__default__") {
    await setSetting(CHAT_MODEL_SETTING, "");
    return { ok: true, message: "Chat model reset to the default." };
  }

  // Validate against the live catalog — never persist an id that isn't in it.
  const catalog = await readModelCatalog();
  if (!isValidModelId(picked, catalog)) {
    return { ok: false, message: `"${picked}" is not a model in the catalog.` };
  }
  await setSetting(CHAT_MODEL_SETTING, picked);
  return { ok: true, message: `Chat model set to ${picked}.` };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { models, defaults, catalogAvailable, catalogSource, effective, effectiveSource } =
    loaderData;
  const nav = useNavigation();
  const saving = nav.state !== "idle";

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Settings</h1>
        </div>
        <p className="console__meta">model selection · work-018</p>
      </header>

      {!catalogAvailable && (
        <p className="console__notice">
          Model catalog not found at <code>{catalogSource}</code>. Using the built-in fallback list.
          Set <code>SCOPE_CREEP_HOME</code> to the control plane to pick from the live catalog.
        </p>
      )}

      {actionData?.message && (
        <p className={actionData.ok ? "console__notice" : "console__notice console__notice--error"}>
          {actionData.message}
        </p>
      )}

      <section className="doc-group">
        <h2 className="doc-group__title">Chat model</h2>
        <p className="console__meta">
          In use: <strong>{effective}</strong> (from{" "}
          {SOURCE_LABEL[effectiveSource] ?? effectiveSource}
          ). This drives the Console assistant's replies.
        </p>

        <Form method="post" className="req-form">
          <select name="chatModel" className="req-input" defaultValue={effective}>
            <option value="__default__">Default (env / catalog)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} — {m.tier}
                {m.id === defaults.chat ? " (catalog default)" : ""}
              </option>
            ))}
          </select>
          <div className="req-actions">
            <button type="submit" className="req-submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </Form>
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Agent model policy</h2>
        <p className="console__meta">
          Agents pick a model per task from the same catalog (validated against it):
        </p>
        <ul className="console__list">
          <li className="console__item">
            <span className="console__item-name">routine</span>
            <span className="tag">{defaults.routine}</span>
          </li>
          <li className="console__item">
            <span className="console__item-name">chat</span>
            <span className="tag">{defaults.chat}</span>
          </li>
          <li className="console__item">
            <span className="console__item-name">agentic</span>
            <span className="tag">{defaults.agentic}</span>
          </li>
        </ul>
      </section>
    </main>
  );
}
