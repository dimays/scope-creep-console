import { describe, expect, it } from "vitest";
import { isExpandable, truncate } from "./human-input";

describe("truncate", () => {
  it("leaves short strings intact (trimmed)", () => {
    expect(truncate("  hello  ")).toBe("hello");
  });

  it("truncates long strings with an ellipsis", () => {
    const out = truncate("x".repeat(200), 10);
    expect(out).toBe(`${"x".repeat(10)}…`);
    expect(out.length).toBe(11);
  });
});

describe("isExpandable", () => {
  it("is expandable when the full excerpt is longer than the preview", () => {
    const full = "x".repeat(200);
    expect(isExpandable(truncate(full), full)).toBe(true);
  });

  it("is not expandable when there is no excerpt", () => {
    expect(isExpandable("a short line")).toBe(false);
  });

  it("is not expandable when the excerpt is no longer than the summary", () => {
    // e.g. feedback: summary "Feedback 👍: nice" is longer than the "nice" comment.
    expect(isExpandable("Feedback 👍: nice", "nice")).toBe(false);
  });
});
