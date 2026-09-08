import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_URL, isRemoteUrl, resolveDbConfig, toHttpTransportUrl } from "./config";

describe("isRemoteUrl (work-065, ADR-024)", () => {
  it("treats file / in-memory / bare paths as local", () => {
    expect(isRemoteUrl("file:./data/app.db")).toBe(false);
    expect(isRemoteUrl(":memory:")).toBe(false);
    expect(isRemoteUrl("./data/app.db")).toBe(false);
  });

  it("treats libsql:// and http(s)/ws(s) endpoints as remote", () => {
    expect(isRemoteUrl("libsql://scope-creep-console.turso.io")).toBe(true);
    expect(isRemoteUrl("https://scope-creep-console.turso.io")).toBe(true);
    expect(isRemoteUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isRemoteUrl("wss://scope-creep-console.turso.io")).toBe(true);
  });
});

describe("toHttpTransportUrl (work-065, ADR-024 — HTTP transport behind the egress proxy)", () => {
  it("rewrites WebSocket-selecting schemes to HTTP", () => {
    // libsql:// and wss:// both open a WebSocket → force https (hrana-over-HTTP)
    expect(toHttpTransportUrl("libsql://scope-creep-console.turso.io")).toBe(
      "https://scope-creep-console.turso.io",
    );
    expect(toHttpTransportUrl("wss://scope-creep-console.turso.io")).toBe(
      "https://scope-creep-console.turso.io",
    );
    // plaintext ws:// → http://
    expect(toHttpTransportUrl("ws://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("preserves the host, port, path and query while swapping only the scheme", () => {
    expect(toHttpTransportUrl("libsql://db.turso.io:443/foo?authToken=x")).toBe(
      "https://db.turso.io:443/foo?authToken=x",
    );
  });

  it("leaves urls already on the HTTP transport unchanged", () => {
    expect(toHttpTransportUrl("https://scope-creep-console.turso.io")).toBe(
      "https://scope-creep-console.turso.io",
    );
    expect(toHttpTransportUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("leaves local (file: / in-memory / bare path) urls untouched", () => {
    expect(toHttpTransportUrl("file:./data/app.db")).toBe("file:./data/app.db");
    expect(toHttpTransportUrl(":memory:")).toBe(":memory:");
    expect(toHttpTransportUrl("./data/app.db")).toBe("./data/app.db");
  });
});

describe("resolveDbConfig (work-065, ADR-024)", () => {
  it("defaults to the local file db when DATABASE_URL is unset (INVARIANTS §9)", () => {
    const cfg = resolveDbConfig({});
    expect(cfg.url).toBe(DEFAULT_DATABASE_URL);
    expect(cfg.remote).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  it("keeps local dev on a file db and ignores a stray token", () => {
    const cfg = resolveDbConfig({ DATABASE_URL: "file:./data/app.db", DATABASE_AUTH_TOKEN: "x" });
    expect(cfg.remote).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  it("carries the scoped token for a remote endpoint and forces the HTTP transport", () => {
    // Turso hands out a libsql:// URL; resolveDbConfig normalizes it to https:// so the
    // client uses hrana-over-HTTP (the WebSocket transport is dropped by the egress proxy).
    const cfg = resolveDbConfig({
      DATABASE_URL: "libsql://scope-creep-console.turso.io",
      DATABASE_AUTH_TOKEN: "tok_abc",
    });
    expect(cfg.remote).toBe(true);
    expect(cfg.url).toBe("https://scope-creep-console.turso.io");
    expect(cfg.authToken).toBe("tok_abc");
  });

  it("normalizes a wss:// remote to https:// and still attaches the token", () => {
    const cfg = resolveDbConfig({
      DATABASE_URL: "wss://scope-creep-console.turso.io",
      DATABASE_AUTH_TOKEN: "tok_abc",
    });
    expect(cfg.remote).toBe(true);
    expect(cfg.url).toBe("https://scope-creep-console.turso.io");
    expect(cfg.authToken).toBe("tok_abc");
  });

  it("leaves an already-https remote url as-is", () => {
    const cfg = resolveDbConfig({
      DATABASE_URL: "https://scope-creep-console.turso.io",
      DATABASE_AUTH_TOKEN: "tok_abc",
    });
    expect(cfg.remote).toBe(true);
    expect(cfg.url).toBe("https://scope-creep-console.turso.io");
    expect(cfg.authToken).toBe("tok_abc");
  });

  it("leaves the local file url untouched (no scheme rewrite for file:)", () => {
    const cfg = resolveDbConfig({ DATABASE_URL: "file:./data/app.db" });
    expect(cfg.remote).toBe(false);
    expect(cfg.url).toBe("file:./data/app.db");
  });

  it("REFUSES a remote endpoint with no token — never a silent tokenless connect or local fallback", () => {
    expect(() =>
      resolveDbConfig({ DATABASE_URL: "libsql://scope-creep-console.turso.io" }),
    ).toThrow(/DATABASE_AUTH_TOKEN/);
  });

  it("treats a blank/whitespace token as missing for a remote endpoint", () => {
    expect(() =>
      resolveDbConfig({ DATABASE_URL: "libsql://x.turso.io", DATABASE_AUTH_TOKEN: "   " }),
    ).toThrow(/DATABASE_AUTH_TOKEN/);
  });
});
