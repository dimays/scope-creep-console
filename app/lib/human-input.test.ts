import { describe, expect, it } from "vitest";
import { truncate } from "./human-input";

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
