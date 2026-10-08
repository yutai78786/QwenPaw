/**
 * hub.contract.test.ts - hubApi request envelope and endpoint contract.
 *
 * Complements hub.test.ts, which pins pagination serialisation for
 * listRuntimes / listUsers and the settings PUT body. This file covers the
 * shared request() envelope and the endpoints that file leaves out:
 *   - 401 -> clears the token and throws "Authentication expired"
 *   - non-ok -> throws the message resolved from the error payload
 *   - 204 -> resolves to undefined
 *   - listPath: empty params, blank query, empty-string and undefined values
 *   - every remaining hubApi method: path, HTTP verb and body
 *   - deleteCredential percent-encodes both path segments
 *
 * window.location.assign cannot be spied on under jsdom (the property is not
 * configurable), so the 401 case asserts on clearAuthToken and the thrown
 * message instead of on the navigation itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
  clearAuthToken: vi.fn(),
  getApiToken: () => "hub-token",
  getApiUrl: (path: string) => `/api${path}`,
}));

import { clearAuthToken } from "../config";
import { hubApi } from "./hub";

const mockClearAuthToken = vi.mocked(clearAuthToken);

type FetchArgs = [string, RequestInit];

function mockResponse(
  status: number,
  body: unknown,
  ok = status >= 200 && status < 300,
): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Read the url and init that hubApi passed to fetch. */
function lastCall(): FetchArgs {
  const calls = vi.mocked(fetch).mock.calls as FetchArgs[];
  return calls[calls.length - 1];
}

function lastUrl(): string {
  return lastCall()[0];
}

function lastInit(): RequestInit {
  return lastCall()[1];
}

describe("hubApi request envelope", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockResponse(200, { ok: true });
  });

  afterEach(() => vi.clearAllMocks());

  it("always sends the bearer token and a JSON content type", async () => {
    await hubApi.getHealth();

    expect(lastInit().headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer hub-token",
      }),
    );
  });

  it("resolves the parsed body on success", async () => {
    mockResponse(200, { status: "ok" });

    await expect(hubApi.getHealth()).resolves.toEqual({ status: "ok" });
  });

  it("returns undefined for a 204 response without parsing a body", async () => {
    mockResponse(204, undefined);

    await expect(hubApi.deleteRuntime("rt-1")).resolves.toBeUndefined();
  });

  it("clears the token and throws on 401", async () => {
    mockResponse(401, { detail: "expired" }, false);

    await expect(hubApi.me()).rejects.toThrow("Authentication expired");
    expect(mockClearAuthToken).toHaveBeenCalledTimes(1);
  });

  it("does not clear the token for a non-401 failure", async () => {
    mockResponse(500, { detail: "boom" }, false);

    await expect(hubApi.me()).rejects.toThrow("boom");
    expect(mockClearAuthToken).not.toHaveBeenCalled();
  });

  it("surfaces a detail string from the error payload", async () => {
    mockResponse(403, { detail: "forbidden here" }, false);

    await expect(hubApi.getOverview()).rejects.toThrow("forbidden here");
  });

  it("joins validation issue messages from an array detail", async () => {
    mockResponse(
      422,
      {
        detail: [
          { loc: ["body", "username"], msg: "too short" },
          { loc: ["body", "password"], msg: "required" },
        ],
      },
      false,
    );

    await expect(hubApi.createUser("u", "p", "user")).rejects.toThrow(
      "username: too short; password: required",
    );
  });

  it("falls back to the status-derived message when the payload has no detail", async () => {
    mockResponse(503, { message: "ignored field" }, false);

    await expect(hubApi.getSettings()).rejects.toThrow(
      "Request failed with 503",
    );
  });

  it("falls back to the status-derived message when the body is not JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("not json")),
    } as unknown as Response);

    await expect(hubApi.me()).rejects.toThrow("Request failed with 502");
  });

  it("falls back to the status-derived message for an empty body", async () => {
    mockResponse(400, null, false);

    await expect(hubApi.me()).rejects.toThrow("Request failed with 400");
  });
});

describe("hubApi listPath serialisation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockResponse(200, {
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      pages: 1,
    });
  });

  it("omits the query string entirely for default params", async () => {
    await hubApi.listRuntimes();

    expect(lastUrl()).toBe("/api/hub/runtimes");
  });

  it("omits the query string for an explicit empty object", async () => {
    await hubApi.listCredentials({});

    expect(lastUrl()).toBe("/api/hub/credentials");
  });

  it("ignores a whitespace-only search query", async () => {
    await hubApi.listUsers({ query: "   " });

    expect(lastUrl()).toBe("/api/hub/admin/users");
  });

  it("trims a search query", async () => {
    await hubApi.listAuditEvents({ query: "  deploy  " });

    expect(lastUrl()).toBe("/api/hub/admin/audit?q=deploy");
  });

  it("skips undefined filter values", async () => {
    await hubApi.listRuntimes({ state: undefined, provisioner: "local" });

    expect(lastUrl()).toBe("/api/hub/runtimes?provisioner=local");
  });

  it("skips empty-string filter values", async () => {
    await hubApi.listCredentials({ scope: "", query: "" });

    expect(lastUrl()).toBe("/api/hub/credentials");
  });

  it("keeps a false filter value and drops a page of zero", async () => {
    await hubApi.listUsers({ page: 0, disabled: false });

    expect(lastUrl()).toBe("/api/hub/admin/users?disabled=false");
  });

  it("serialises page and pageSize into snake_case params", async () => {
    await hubApi.listCredentials({ page: 3, pageSize: 10 });

    expect(lastUrl()).toBe("/api/hub/credentials?page=3&page_size=10");
  });

  it("serialises an audit action filter", async () => {
    await hubApi.listAuditEvents({ action: "runtime.start" });

    expect(lastUrl()).toBe("/api/hub/admin/audit?action=runtime.start");
  });

  it("serialises a runtime state filter", async () => {
    await hubApi.listRuntimes({ state: "stopped" });

    expect(lastUrl()).toBe("/api/hub/runtimes?state=stopped");
  });

  it("serialises a user role filter", async () => {
    await hubApi.listUsers({ role: "admin" });

    expect(lastUrl()).toBe("/api/hub/admin/users?role=admin");
  });
});

describe("hubApi endpoint contract", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockResponse(200, { items: [] });
  });

  it("getHealth hits the hub health endpoint with GET", async () => {
    await hubApi.getHealth();

    expect(lastUrl()).toBe("/api/hub/healthz");
    expect(lastInit().method).toBeUndefined();
  });

  it("me hits the current-user endpoint with GET", async () => {
    await hubApi.me();

    expect(lastUrl()).toBe("/api/hub/me");
    expect(lastInit().method).toBeUndefined();
  });

  it("changePassword posts the new password only", async () => {
    await hubApi.changePassword("s3cret");

    expect(lastUrl()).toBe("/api/hub/me/password");
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe(JSON.stringify({ new_password: "s3cret" }));
  });

  it("restartOwnRuntime posts without a body", async () => {
    await hubApi.restartOwnRuntime();

    expect(lastUrl()).toBe("/api/hub/me/runtime/restart");
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBeUndefined();
  });

  it("createRuntime posts the runtime id and the auto-start flag", async () => {
    await hubApi.createRuntime("rt-9", true);

    expect(lastUrl()).toBe("/api/hub/runtimes");
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe(
      JSON.stringify({ runtime_id: "rt-9", auto_start: true }),
    );
  });

  it("createRuntime defaults auto-start to false", async () => {
    await hubApi.createRuntime("rt-9");

    expect(lastInit().body).toBe(
      JSON.stringify({ runtime_id: "rt-9", auto_start: false }),
    );
  });

  it.each([
    ["start", "startRuntime"],
    ["stop", "stopRuntime"],
    ["rebuild", "rebuildRuntime"],
    ["disable", "disableRuntime"],
  ])("%s posts to the runtime sub-resource", async (_label, method) => {
    await hubApi[method as "startRuntime"]("rt-1");

    expect(lastUrl()).toBe(`/api/hub/runtimes/rt-1/${_label}`);
    expect(lastInit().method).toBe("POST");
  });

  it("deleteRuntime deletes the runtime resource", async () => {
    await hubApi.deleteRuntime("rt-1");

    expect(lastUrl()).toBe("/api/hub/runtimes/rt-1");
    expect(lastInit().method).toBe("DELETE");
  });

  it("createUser posts username, password and role", async () => {
    await hubApi.createUser("alice", "pw", "admin");

    expect(lastUrl()).toBe("/api/hub/admin/users");
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe(
      JSON.stringify({ username: "alice", password: "pw", role: "admin" }),
    );
  });

  it("updateUser patches the selected fields only", async () => {
    await hubApi.updateUser("u-1", { disabled: true });

    expect(lastUrl()).toBe("/api/hub/admin/users/u-1");
    expect(lastInit().method).toBe("PATCH");
    expect(lastInit().body).toBe(JSON.stringify({ disabled: true }));
  });

  it("updateUser can patch the role alone", async () => {
    await hubApi.updateUser("u-2", { role: "admin" });

    expect(lastInit().body).toBe(JSON.stringify({ role: "admin" }));
  });

  it("getSettings reads the admin settings document", async () => {
    await hubApi.getSettings();

    expect(lastUrl()).toBe("/api/hub/admin/settings");
    expect(lastInit().method).toBeUndefined();
  });

  it("getDockerImages reads the image catalog", async () => {
    await hubApi.getDockerImages();

    expect(lastUrl()).toBe("/api/hub/images");
  });

  it("listDockerImagePulls reads the pull queue", async () => {
    await hubApi.listDockerImagePulls();

    expect(lastUrl()).toBe("/api/hub/images/pulls");
    expect(lastInit().method).toBeUndefined();
  });

  it("pullDockerImage posts the image reference", async () => {
    await hubApi.pullDockerImage("docker.io/agentscope/qwenpaw:latest");

    expect(lastUrl()).toBe("/api/hub/images/pulls");
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe(
      JSON.stringify({
        reference: "docker.io/agentscope/qwenpaw:latest",
      }),
    );
  });

  it("putCredential sends scope, name and value", async () => {
    await hubApi.putCredential("global", "OPENAI_KEY", "sk-1");

    expect(lastUrl()).toBe("/api/hub/credentials");
    expect(lastInit().method).toBe("PUT");
    expect(lastInit().body).toBe(
      JSON.stringify({ scope: "global", name: "OPENAI_KEY", value: "sk-1" }),
    );
  });

  it("deleteCredential builds the path from both segments", async () => {
    await hubApi.deleteCredential("global", "OPENAI_KEY");

    expect(lastUrl()).toBe("/api/hub/credentials/global/OPENAI_KEY");
    expect(lastInit().method).toBe("DELETE");
  });

  it("deleteCredential percent-encodes reserved characters in both segments", async () => {
    await hubApi.deleteCredential("scope/with slash", "name with space");

    expect(lastUrl()).toBe(
      `/api/hub/credentials/${encodeURIComponent(
        "scope/with slash",
      )}/${encodeURIComponent("name with space")}`,
    );
    expect(lastUrl()).toContain("scope%2Fwith%20slash");
    expect(lastUrl()).toContain("name%20with%20space");
  });

  it("getOverview reads the admin overview", async () => {
    await hubApi.getOverview();

    expect(lastUrl()).toBe("/api/hub/admin/overview");
  });

  it("listAuditEvents reads the audit page", async () => {
    await hubApi.listAuditEvents();

    expect(lastUrl()).toBe("/api/hub/admin/audit");
  });
});
