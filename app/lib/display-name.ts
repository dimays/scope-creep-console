/**
 * Client-safe agent display names. Kept out of `explore.server.ts` so both the server
 * (profiles, contributions) and client components (the org view) can import it without
 * pulling node built-ins into the browser bundle.
 */

const DISPLAY_NAMES: Record<string, string> = {
  "chief-of-staff": "Chief of Staff",
  cto: "CTO",
  "chief-designer": "Chief Designer",
  "chief-knowledge-manager": "Chief Knowledge Manager",
  "chief-product-officer": "Chief Product Officer",
  "chief-reality-officer": "Chief Reality Officer",
};

/** A known exec's proper name, or a Title-cased fallback from the slug (e.g. "ada" → "Ada"). */
export function agentDisplayName(name: string): string {
  if (DISPLAY_NAMES[name]) return DISPLAY_NAMES[name];
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export { DISPLAY_NAMES };
