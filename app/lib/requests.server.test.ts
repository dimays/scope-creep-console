import { describe, expect, it } from "vitest";
import { addMessage, createRequest, getRequest, listRequests } from "./requests.server";

describe("requests data layer", () => {
  it("creates a request with an initial owner message", async () => {
    const req = await createRequest("Add dark mode", "Please add a dark mode toggle.");
    expect(req.status).toBe("open");

    const got = await getRequest(req.id);
    expect(got?.request.title).toBe("Add dark mode");
    expect(got?.messages).toHaveLength(1);
    expect(got?.messages[0].author).toBe("owner");
    expect(got?.messages[0].body).toBe("Please add a dark mode toggle.");
  });

  it("addMessage appends a message and can update status", async () => {
    const req = await createRequest("Second request", "body");
    await addMessage(req.id, "operator", "On it — need a detail", "needs-info");

    const got = await getRequest(req.id);
    expect(got?.messages).toHaveLength(2);
    expect(got?.messages[1].author).toBe("operator");
    expect(got?.request.status).toBe("needs-info");
  });

  it("getRequest returns null for an unknown id", async () => {
    expect(await getRequest(999_999)).toBeNull();
  });

  it("listRequests returns rows newest-updated first", async () => {
    const all = await listRequests();
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].updatedAt >= all[i].updatedAt).toBe(true);
    }
  });
});
