/**
 * Contract tests for the error-body fallback arms of `api/modules/plugin.ts`
 * that the existing `plugin.test.ts` does not reach.
 *
 * Division of labour (no overlap with the existing file):
 *   - `plugin.test.ts` pins the happy paths plus the failure paths where the
 *     error response still parses as JSON (`json: {}` or `json: { detail }`).
 *   - this file pins the `.catch(() => ({}))` arm of every non-ok branch, i.e.
 *     what happens when the error body itself cannot be parsed (an HTML gateway
 *     page, an empty body, a truncated stream). Those arrow bodies are separate
 *     statements and are only executed when `json()` actually rejects, so a test
 *     that returns `{}` can never reach them.
 *   - it also pins the one success path the existing file omits:
 *     `fetchPluginStatus` resolving its parsed payload.
 *
 * The existing file is left untouched - a second test file for the same module
 * is an established pattern in this repo.
 *
 * Each fallback message embeds the numeric `status`, never `statusText`, so the
 * assertions below use a status whose reason phrase differs from the number to
 * make that distinction observable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAuthHeaders } from "../authHeaders";
import { getApiUrl } from "../config";
import {
  fetchPluginCatalog,
  fetchPluginStatus,
  installPlugin,
  uninstallPlugin,
  uploadPlugin,
} from "./plugin";

vi.mock("../config", () => ({
  getApiUrl: vi.fn((path: string) => `http://test${path}`),
}));
vi.mock("../authHeaders", () => ({
  buildAuthHeaders: vi.fn(() => ({ Authorization: "Bearer t" })),
}));

interface RejectingResponseInit {
  ok: boolean;
  status: number;
  statusText?: string;
  /** Value `json()` resolves with. Ignored when `jsonRejects` is true. */
  json?: unknown;
  /** When true `json()` rejects, which is the only way to reach `.catch(() => ({}))`. */
  jsonRejects?: boolean;
}

function mockResponse(init: RejectingResponseInit): Response {
  const json = init.jsonRejects
    ? () => Promise.reject(new SyntaxError("Unexpected token < in JSON"))
    : () => Promise.resolve(init.json);
  const response = {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? "",
    json,
    // Since #7565 the mutating calls in this module route through
    // requestWithPluginBusyConfirmation, which clones the response to probe for
    // a plugin-busy payload before the error message is read from the original
    // (api/error.ts responseErrorMessage). clone() must therefore hand back a
    // still-readable body exactly as a real Response does, so this stand-in
    // shares the same json() reader across the clone.
    clone: () => ({ ...response, json }),
  };
  return response as unknown as Response;
}

function fetchMock() {
  return global.fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  global.fetch = vi.fn();
  vi.mocked(getApiUrl).mockClear();
  vi.mocked(buildAuthHeaders).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchPluginCatalog - unparsable error body", () => {
  it("falls back to the status-bearing message when json() rejects", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        jsonRejects: true,
      }),
    );

    await expect(fetchPluginCatalog()).rejects.toThrow(
      "Failed to load plugin catalog (502)",
    );
  });

  it("embeds the numeric status and never the reason phrase", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 418,
        statusText: "I am a teapot",
        jsonRejects: true,
      }),
    );

    await expect(fetchPluginCatalog()).rejects.toThrow(
      "Failed to load plugin catalog (418)",
    );
    await expect(fetchPluginCatalog()).rejects.not.toThrow("teapot");
  });

  it("still prefers a parsable detail over the fallback", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        json: { detail: "catalog locked" },
      }),
    );

    await expect(fetchPluginCatalog()).rejects.toThrow("catalog locked");
  });

  it("falls back when detail is a non-string object without a message", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 503, json: { detail: { code: 7 } } }),
    );

    // This case used to pin the opposite behaviour, and it was written as a
    // tripwire: while plugin.ts guarded with `body.detail ?? fallback`, an
    // object detail survived the `??` guard and Error() stringified it to
    // "[object Object]". The comment said switching this module to
    // formatApiError should be a visible change — #7565 made exactly that
    // switch (plugin.ts now routes every non-ok branch through
    // responseErrorMessage → formatApiError), so the tripwire fired on
    // schedule.
    //
    // formatApiError only accepts a non-empty string detail, a validation
    // issue array, or an object carrying msg/message/errors. `{code: 7}`
    // matches none of those, so the status-bearing fallback wins. That is the
    // intended improvement: a machine-only payload no longer leaks
    // "[object Object]" into a user-facing message. Pinned as the new contract.
    await expect(fetchPluginCatalog()).rejects.toThrow(
      "Failed to load plugin catalog (503)",
    );
  });

  it("falls back when detail is an empty string", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 504, json: { detail: "" } }),
    );

    // Same tripwire as above. Under the old `body.detail ?? fallback` guard an
    // empty string is not nullish, so it passed through and produced an Error
    // with an empty message — the user saw no reason at all. formatApiError
    // requires `typeof detail === "string" && detail`, so "" is rejected and
    // the status-bearing fallback is used instead. Pinned as the new contract:
    // an empty detail must never leave the user with a blank error.
    await expect(fetchPluginCatalog()).rejects.toMatchObject({
      message: "Failed to load plugin catalog (504)",
    });
  });

  it("falls back only when detail is null", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 505, json: { detail: null } }),
    );

    await expect(fetchPluginCatalog()).rejects.toThrow(
      "Failed to load plugin catalog (505)",
    );
  });

  it("does not send a body on the catalog GET", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: {} }),
    );

    await fetchPluginCatalog();

    const init = fetchMock().mock.calls[0][1] as Record<string, unknown>;
    expect(init.body).toBeUndefined();
    expect(init.method).toBeUndefined();
  });
});

describe("installPlugin - unparsable error body", () => {
  it("falls back to the install message when json() rejects", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        statusText: "Server Error",
        jsonRejects: true,
      }),
    );

    await expect(
      installPlugin("git+https://example.com/p.git"),
    ).rejects.toThrow("Install failed (500)");
  });

  it("still reports force=true in the outgoing body when the call fails", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 422, jsonRejects: true }),
    );

    await expect(
      installPlugin("/tmp/plugin.zip", { force: true }),
    ).rejects.toThrow("Install failed (422)");

    const init = fetchMock().mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      source: "/tmp/plugin.zip",
      force: true,
    });
  });

  it("sends both auth headers and the JSON content type", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: { id: "p", loaded: true } }),
    );

    await installPlugin("marketplace/p");

    const init = fetchMock().mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      Authorization: "Bearer t",
      "Content-Type": "application/json",
    });
  });
});

describe("uploadPlugin - unparsable error body", () => {
  it("falls back to the upload message when json() rejects", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        jsonRejects: true,
      }),
    );

    const file = new File(["x"], "big-plugin.zip", { type: "application/zip" });

    await expect(uploadPlugin(file)).rejects.toThrow("Upload failed (413)");
  });

  it("keeps the original file in the form data even when the upload fails", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 400, jsonRejects: true }),
    );

    const file = new File(["x"], "插件包 名 with space.zip", {
      type: "application/zip",
    });

    await expect(uploadPlugin(file)).rejects.toThrow("Upload failed (400)");

    const init = fetchMock().mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("does not set a JSON content type on the multipart request", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: { id: "p" } }),
    );

    await uploadPlugin(new File(["x"], "p.zip"));

    const init = fetchMock().mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer t" });
    expect(init.headers).not.toHaveProperty("Content-Type");
  });
});

describe("uninstallPlugin - unparsable error body", () => {
  it("falls back to the uninstall message when json() rejects", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 409,
        statusText: "Conflict",
        jsonRejects: true,
      }),
    );

    await expect(uninstallPlugin("in-use-plugin")).rejects.toThrow(
      "Uninstall failed (409)",
    );
  });

  it("issues DELETE against the plugin id path", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: false, status: 500, jsonRejects: true }),
    );

    await expect(uninstallPlugin("p-1")).rejects.toThrow(
      "Uninstall failed (500)",
    );
    expect(getApiUrl).toHaveBeenCalledWith("/plugins/p-1");
    expect(fetchMock().mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("resolves to undefined on a successful 200 without reading the body", async () => {
    const json = vi.fn(() => Promise.resolve({ ignored: true }));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json,
    } as unknown as Response);

    await expect(uninstallPlugin("p-2")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });
});

describe("fetchPluginStatus", () => {
  it("falls back to the status-fetch message when json() rejects", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        jsonRejects: true,
      }),
    );

    await expect(fetchPluginStatus("flaky")).rejects.toThrow(
      "Status fetch failed (503)",
    );
  });

  it("prefers a parsable detail over the fallback", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        json: { detail: "plugin runtime crashed" },
      }),
    );

    await expect(fetchPluginStatus("crashed")).rejects.toThrow(
      "plugin runtime crashed",
    );
  });

  it("resolves the parsed status payload on success", async () => {
    const status = { id: "p", loaded: true, error: null };
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: status }),
    );

    await expect(fetchPluginStatus("p")).resolves.toEqual(status);
  });

  it("hits the /status sub-path with no method override", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: {} }),
    );

    await fetchPluginStatus("p");

    expect(getApiUrl).toHaveBeenCalledWith("/plugins/p/status");
    const init = fetchMock().mock.calls[0][1] as Record<string, unknown>;
    expect(init.method).toBeUndefined();
  });

  it("propagates the parsed payload even when it is falsy", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: null }),
    );

    await expect(fetchPluginStatus("p")).resolves.toBeNull();
  });
});

describe("plugin module - shared request plumbing", () => {
  it("routes every call through getApiUrl", async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ ok: true, status: 200, json: {} }),
    );

    await fetchPluginCatalog();
    await installPlugin("src");
    await fetchPluginStatus("p");

    expect(vi.mocked(getApiUrl).mock.calls.map((call) => call[0])).toEqual([
      "/plugins/catalog",
      "/plugins/install",
      "/plugins/p/status",
    ]);
  });

  it("propagates a network level fetch rejection untouched", async () => {
    fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchPluginCatalog()).rejects.toThrow("Failed to fetch");
  });
});
