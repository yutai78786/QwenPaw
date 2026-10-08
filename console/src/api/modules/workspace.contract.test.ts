/**
 * Contract tests for api/modules/workspace.ts - the surface the existing
 * `workspace.test.ts` does not reach.
 *
 * Scope:
 *   - `loadFileText` retry/guard arms: a chunk read that fails on the first and
 *     on the second attempt, an ETag that changes mid-read, and a reader that
 *     stops advancing
 *   - `loadCodeFile` / `saveCodeFile` cache interaction (a cache hit
 *     short-circuits the network; a fetch failure keeps its status on the
 *     error; a save invalidates the entry)
 *   - `uploadFiles` 409 handling: an unreadable conflict payload, a payload
 *     that is not a conflict, and the conflict list itself
 *   - `saveFileContent` failure arm and the URL builders
 *   - `getSelectedAgentId` storage precedence, observed through the fallback
 *     download filename
 *   - the sectioned memory / code-file listing transforms
 *
 * NOTE on `workspace.ts:190`: that trailing `throw` is structurally unreachable.
 * Leaving the inner loop on attempt 0 always sets `versionChanged`, so the
 * attempt-0 guard cannot fire; on attempt 1 the guard always fires (line 187).
 * It exists only to satisfy the declared return type, so no test targets it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  buildAuthHeaders: vi.fn(() => ({ Authorization: "Bearer tok" })),
  downloadFileFromUrl: vi.fn(),
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../request", () => ({ request: mocks.request }));
vi.mock("../config", () => ({ getApiUrl: (path: string) => `/api${path}` }));
vi.mock("../authHeaders", () => ({ buildAuthHeaders: mocks.buildAuthHeaders }));
vi.mock("../../stores/codeFileCacheStore", () => ({
  useCodeFileCacheStore: { getState: () => mocks.cache },
}));
vi.mock("../../utils/downloadFileFromUrl", () => ({
  downloadFileFromUrl: mocks.downloadFileFromUrl,
}));

import { request } from "../request";
import { workspaceApi, UploadConflictError } from "./workspace";
import { downloadFileFromUrl } from "../../utils/downloadFileFromUrl";

interface FetchInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: unknown;
}

function lastFetch(): { url: string; init: FetchInit } {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } })
    .mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), init: (init ?? {}) as FetchInit };
}

function okJson(payload: unknown, headers?: Record<string, string>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => "",
    headers: new Headers(headers ?? {}),
  } as unknown as Response;
}

function failResponse(status: number, text = ""): Response {
  return {
    ok: false,
    status,
    statusText: "",
    json: async () => ({}),
    text: async () => text,
    headers: new Headers(),
  } as unknown as Response;
}

/** A Response whose json() rejects - the only route into `.catch(() => null)`. */
function failJsonRejects(status: number): Response {
  return {
    ok: false,
    status,
    statusText: "",
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
    text: async () => "",
    headers: new Headers(),
  } as unknown as Response;
}

/** A non-ok Response with a readable JSON payload, for the conflict arms. */
function failWithJson(status: number, payload: unknown): Response {
  return {
    ok: false,
    status,
    statusText: "",
    json: async () => payload,
    text: async () => "",
    headers: new Headers(),
  } as unknown as Response;
}

function chunk(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    path: "a.md",
    content: "hello",
    offset: 0,
    limit: 262144,
    next_offset: 5,
    eof: true,
    truncated: false,
    encoding: "utf-8",
    etag: "e1",
    ...overrides,
  };
}

/** Spy on the module's own chunk reader, which `loadFileText` calls by property. */
function spyChunk() {
  return vi.spyOn(workspaceApi, "loadFileChunk");
}

/**
 * Run a promise expected to reject and hand back the thrown value typed.
 * Using a helper (rather than `.catch((e) => e as T)`) keeps the assertion
 * honest: if the call unexpectedly resolves, this throws instead of letting a
 * non-error value flow into the expectations below.
 */
async function mustReject<T>(run: () => Promise<unknown>): Promise<T> {
  try {
    await run();
  } catch (e) {
    return e as T;
  }
  throw new Error("expected the call to reject, but it resolved");
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockResolvedValue(undefined);
  mocks.buildAuthHeaders.mockClear();
  mocks.downloadFileFromUrl.mockReset();
  mocks.downloadFileFromUrl.mockResolvedValue(undefined);
  mocks.cache.get.mockReset();
  mocks.cache.get.mockReturnValue(null);
  mocks.cache.set.mockReset();
  mocks.cache.invalidate.mockReset();
  sessionStorage.clear();
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("workspaceApi.loadFileText guard arms", () => {
  it("retries once and succeeds when the first chunk read fails", async () => {
    const spy = spyChunk();
    spy.mockRejectedValueOnce(new Error("etag moved"));
    spy.mockResolvedValueOnce(
      chunk({ content: "recovered", eof: true, etag: "e2" }) as never,
    );

    await expect(workspaceApi.loadFileText("a.md")).resolves.toEqual({
      content: "recovered",
      etag: "e2",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-reads from offset 0 on the retry rather than resuming mid-file", async () => {
    const spy = spyChunk();
    spy.mockRejectedValueOnce(new Error("boom"));
    spy.mockResolvedValueOnce(chunk({ eof: true }) as never);

    await workspaceApi.loadFileText("a.md");

    expect(spy.mock.calls[0][1]).toBe(0);
    expect(spy.mock.calls[1][1]).toBe(0);
  });

  it("surfaces the original error when the second attempt also fails", async () => {
    const spy = spyChunk();
    spy.mockRejectedValue(new Error("server down"));

    await expect(workspaceApi.loadFileText("a.md")).rejects.toThrow(
      "server down",
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reports a version change when the ETag differs between chunks", async () => {
    const spy = spyChunk();
    spy.mockResolvedValueOnce(
      chunk({
        content: "part1",
        eof: false,
        next_offset: 5,
        etag: "e1",
      }) as never,
    );
    spy.mockResolvedValueOnce(
      chunk({ content: "part2", eof: true, etag: "e2" }) as never,
    );
    // Second attempt after the detected change.
    spy.mockResolvedValueOnce(
      chunk({ content: "stable", eof: true, etag: "e3" }) as never,
    );

    await expect(workspaceApi.loadFileText("a.md")).resolves.toEqual({
      content: "stable",
      etag: "e3",
    });
  });

  it("gives up when the file keeps changing across both attempts", async () => {
    const spy = spyChunk();
    spy.mockResolvedValueOnce(
      chunk({ eof: false, next_offset: 5, etag: "e1" }) as never,
    );
    spy.mockResolvedValueOnce(chunk({ eof: true, etag: "e2" }) as never);
    spy.mockResolvedValueOnce(
      chunk({ eof: false, next_offset: 5, etag: "e3" }) as never,
    );
    spy.mockResolvedValueOnce(chunk({ eof: true, etag: "e4" }) as never);

    await expect(workspaceApi.loadFileText("a.md")).rejects.toThrow(
      "Workspace file changed while it was being read",
    );
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("rejects a reader that reports no forward progress", async () => {
    const spy = spyChunk();
    spy.mockResolvedValue(
      chunk({ eof: false, offset: 0, next_offset: 0 }) as never,
    );

    await expect(workspaceApi.loadFileText("a.md")).rejects.toThrow(
      "Workspace file reader did not advance",
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects a reader whose next offset stops advancing on a later frame", async () => {
    const spy = spyChunk();
    // Frame 1 moves the reader from 0 to 50 (allowed); the next frame reports
    // the same next_offset again, so the guard must fire instead of looping.
    spy.mockResolvedValue(
      chunk({ eof: false, offset: 50, next_offset: 50, etag: "e1" }) as never,
    );

    await expect(workspaceApi.loadFileText("a.md")).rejects.toThrow(
      "Workspace file reader did not advance",
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("concatenates multi-chunk content in arrival order", async () => {
    const spy = spyChunk();
    spy.mockResolvedValueOnce(
      chunk({
        content: "one",
        eof: false,
        next_offset: 3,
        etag: "e1",
      }) as never,
    );
    spy.mockResolvedValueOnce(
      chunk({
        content: "two",
        offset: 3,
        eof: false,
        next_offset: 6,
        etag: "e1",
      }) as never,
    );
    spy.mockResolvedValueOnce(
      chunk({ content: "three", offset: 6, eof: true, etag: "e1" }) as never,
    );

    await expect(workspaceApi.loadFileText("a.md")).resolves.toEqual({
      content: "onetwothree",
      etag: "e1",
    });
  });

  it("requests the default chunk size on every read", async () => {
    const spy = spyChunk();
    spy.mockResolvedValueOnce(chunk({ eof: false, next_offset: 10 }) as never);
    spy.mockResolvedValueOnce(chunk({ eof: true }) as never);

    await workspaceApi.loadFileText("a.md");

    for (const call of spy.mock.calls) {
      expect(call[2]).toBe(256 * 1024);
    }
  });
});

describe("workspaceApi.saveFileContent failure", () => {
  it("reports the HTTP status when the save is rejected", async () => {
    global.fetch = vi.fn().mockResolvedValue(failResponse(412));

    await expect(
      workspaceApi.saveFileContent("a.md", "x", "e1"),
    ).rejects.toThrow("Workspace save failed: 412");
  });

  it("does not attempt to parse the body of a failed save", async () => {
    const json = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json,
      headers: new Headers(),
    } as unknown as Response);

    await expect(workspaceApi.saveFileContent("a.md", "x")).rejects.toThrow(
      "Workspace save failed: 500",
    );
    expect(json).not.toHaveBeenCalled();
  });

  it("sends PUT with the JSON content body when no ETag is supplied", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "a.md", size: 1, etag: "e2" }));

    await workspaceApi.saveFileContent("a.md", "new");

    const { init } = lastFetch();
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ content: "new" });
    const headers = init.headers as Record<string, string>;
    expect(headers["If-Match"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("returns the server metadata on success", async () => {
    const payload = { path: "a.md", size: 3, etag: "e9" };
    global.fetch = vi.fn().mockResolvedValue(okJson(payload));

    await expect(
      workspaceApi.saveFileContent("a.md", "abc", "e8"),
    ).resolves.toEqual(payload);
  });
});

describe("workspaceApi URL builders", () => {
  it("builds the download URL for the project root by default", () => {
    expect(workspaceApi.getFileDownloadUrl("docs/a.md")).toBe(
      "/api/workspace/file-download?path=docs%2Fa.md&root=project",
    );
  });

  it("builds the download URL for another root", () => {
    expect(workspaceApi.getFileDownloadUrl("a.md", "agent" as never)).toBe(
      "/api/workspace/file-download?path=a.md&root=agent",
    );
  });

  it("builds the html preview URI", () => {
    expect(workspaceApi.getHtmlFileUriUrl("site/index.html")).toBe(
      "/api/workspace/html-file-uri?path=site%2Findex.html&root=project",
    );
  });

  it("percent-encodes each path segment of a binary file URL separately", () => {
    expect(workspaceApi.getBinaryFileUrl("img/a b/图.png")).toBe(
      "/api/workspace/binary-files/img/a%20b/%E5%9B%BE.png",
    );
  });

  it("keeps the directory separators intact in a binary file URL", () => {
    expect(workspaceApi.getBinaryFileUrl("a/b/c.png")).toBe(
      "/api/workspace/binary-files/a/b/c.png",
    );
  });

  it("encodes a path containing a question mark without breaking the query", () => {
    expect(workspaceApi.getFileDownloadUrl("weird?name.md")).toContain(
      "weird%3Fname.md",
    );
  });

  it("builds the watch URL with an encoded root", () => {
    expect(workspaceApi.getWatchUrl("project")).toBe(
      "/api/workspace/watch?root=project",
    );
  });
});

describe("workspaceApi.uploadFiles conflict handling", () => {
  it("falls through to the generic upload error when the 409 payload is unreadable", async () => {
    global.fetch = vi.fn().mockResolvedValue(failJsonRejects(409));

    const err = await mustReject<Error>(() =>
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    );

    expect(err).not.toBeInstanceOf(UploadConflictError);
    expect(err.message).toBe("File upload failed: 409");
  });

  it("reports the generic upload error for a 409 whose payload is not a conflict", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      failWithJson(409, {
        detail: { code: "something_else", files: ["a.txt"] },
      }),
    );

    const err = await mustReject<Error>(() =>
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    );

    expect(err).not.toBeInstanceOf(UploadConflictError);
    expect(err.message).toBe("File upload failed: 409");
  });

  it("reports an empty conflict list when the payload omits the files array", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        failWithJson(409, { detail: { code: "upload_conflict" } }),
      );

    const err = await mustReject<UploadConflictError>(() =>
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    );

    expect(err).toBeInstanceOf(UploadConflictError);
    expect(err.files).toEqual([]);
  });

  it("reports the conflicting filenames when the payload carries them", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      failWithJson(409, {
        detail: { code: "upload_conflict", files: ["a.txt", "b.txt"] },
      }),
    );

    const err = await mustReject<UploadConflictError>(() =>
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    );

    expect(err).toBeInstanceOf(UploadConflictError);
    expect(err.files).toEqual(["a.txt", "b.txt"]);
  });

  it("reports the generic upload error for a non-409 failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(failResponse(413));

    await expect(
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    ).rejects.toThrow("File upload failed: 413");
  });

  it("returns the per-file upload report on success", async () => {
    const report = {
      files: [{ name: "a.txt", path: "a.txt", status: "uploaded" }],
    };
    global.fetch = vi.fn().mockResolvedValue(okJson(report));

    await expect(
      workspaceApi.uploadFiles([new File(["a"], "a.txt")]),
    ).resolves.toEqual(report);
  });

  it("appends every file under the same multipart field name", async () => {
    global.fetch = vi.fn().mockResolvedValue(okJson({ files: [] }));

    await workspaceApi.uploadFiles([
      new File(["a"], "a.txt"),
      new File(["b"], "b 名.md"),
    ]);

    const sent = (lastFetch().init.body as FormData).getAll("files") as File[];
    expect(sent).toHaveLength(2);
    expect(sent[0].name).toBe("a.txt");
    expect(sent[1].name).toBe("b 名.md");
  });

  it("accepts an empty file list and still posts", async () => {
    global.fetch = vi.fn().mockResolvedValue(okJson({ files: [] }));

    await workspaceApi.uploadFiles([]);

    expect((lastFetch().init.body as FormData).getAll("files")).toHaveLength(0);
    expect(lastFetch().init.method).toBe("POST");
  });

  it("omits the conflict policy from the query when none is given", async () => {
    global.fetch = vi.fn().mockResolvedValue(okJson({ files: [] }));

    await workspaceApi.uploadFiles([new File(["a"], "a.txt")], "sub/dir");

    expect(lastFetch().url).toContain("path=sub%2Fdir");
    expect(lastFetch().url).not.toContain("conflict");
  });

  it("sends the chosen conflict policy on the retry", async () => {
    global.fetch = vi.fn().mockResolvedValue(okJson({ files: [] }));

    await workspaceApi.uploadFiles([new File(["a"], "a.txt")], "", "rename");

    expect(lastFetch().url).toContain("conflict=rename");
  });
});

describe("workspaceApi.loadCodeFile cache behaviour", () => {
  it("returns cached content without touching the network", async () => {
    mocks.cache.get.mockReturnValue({ content: "cached body", etag: "e1" });
    global.fetch = vi.fn();

    await expect(workspaceApi.loadCodeFile("src/a.ts")).resolves.toEqual({
      path: "src/a.ts",
      content: "cached body",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.cache.get).toHaveBeenCalledWith("src/a.ts");
  });

  it("does not populate the cache again on a cache hit", async () => {
    mocks.cache.get.mockReturnValue({ content: "cached", etag: null });
    global.fetch = vi.fn();

    await workspaceApi.loadCodeFile("src/a.ts");

    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("fetches, caches with the response ETag and returns the payload on a miss", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        okJson({ path: "src/a.ts", content: "export {}" }, { ETag: '"e7"' }),
      );

    await expect(workspaceApi.loadCodeFile("src/a.ts")).resolves.toEqual({
      path: "src/a.ts",
      content: "export {}",
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "src/a.ts",
      "export {}",
      '"e7"',
    );
  });

  it("caches a null ETag when the server sends none", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "src/a.ts", content: "x" }));

    await workspaceApi.loadCodeFile("src/a.ts");

    expect(mocks.cache.set).toHaveBeenCalledWith("src/a.ts", "x", null);
  });

  it("encodes each path segment of the code-file URL", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "p", content: "c" }));

    await workspaceApi.loadCodeFile("src/a b/文件.ts");

    expect(lastFetch().url).toBe(
      "/api/workspace/code-files/src/a%20b/%E6%96%87%E4%BB%B6.ts",
    );
  });

  it("sends the auth headers through a Headers instance", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "p", content: "c" }));

    await workspaceApi.loadCodeFile("src/a.ts");

    const headers = lastFetch().init.headers as Headers;
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("does not send a method so the request stays a GET", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "p", content: "c" }));

    await workspaceApi.loadCodeFile("src/a.ts");

    expect(lastFetch().init.method).toBeUndefined();
  });

  it("keeps the HTTP status on the thrown error and uses the body text", async () => {
    global.fetch = vi.fn().mockResolvedValue(failResponse(404, "no such file"));

    const err = await mustReject<Error & { status?: number }>(() =>
      workspaceApi.loadCodeFile("src/missing.ts"),
    );

    expect(err.message).toBe("no such file");
    expect(err.status).toBe(404);
    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("falls back to a status message when the failed body is empty", async () => {
    global.fetch = vi.fn().mockResolvedValue(failResponse(500));

    const err = await mustReject<Error & { status?: number }>(() =>
      workspaceApi.loadCodeFile("src/a.ts"),
    );

    expect(err.message).toBe("Request failed: 500");
    expect(err.status).toBe(500);
  });

  it("still reports the status when reading the failed body throws", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers(),
      text: async () => {
        throw new TypeError("body stream already read");
      },
    } as unknown as Response);

    const err = await mustReject<Error & { status?: number }>(() =>
      workspaceApi.loadCodeFile("src/a.ts"),
    );

    expect(err.message).toBe("Request failed: 502");
    expect(err.status).toBe(502);
  });

  it("propagates a network rejection unchanged", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(workspaceApi.loadCodeFile("src/a.ts")).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

describe("workspaceApi.saveCodeFile", () => {
  it("puts the content to the encoded path and returns the server result", async () => {
    mocks.request.mockResolvedValue({ path: "src/a.ts", size: 12 });

    await expect(
      workspaceApi.saveCodeFile("src/a.ts", "export const a=1"),
    ).resolves.toEqual({
      path: "src/a.ts",
      size: 12,
    });
    expect(request).toHaveBeenCalledWith("/workspace/code-files/src/a.ts", {
      method: "PUT",
      body: JSON.stringify({ content: "export const a=1" }),
    });
  });

  it("invalidates the cached entry after a successful save", async () => {
    mocks.request.mockResolvedValue({ path: "src/a.ts", size: 1 });

    await workspaceApi.saveCodeFile("src/a.ts", "x");

    expect(mocks.cache.invalidate).toHaveBeenCalledWith("src/a.ts");
    expect(mocks.cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not write the new content into the cache itself", async () => {
    mocks.request.mockResolvedValue({ path: "src/a.ts", size: 1 });

    await workspaceApi.saveCodeFile("src/a.ts", "x");

    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("leaves the cache untouched when the save fails", async () => {
    mocks.request.mockRejectedValue(new Error("conflict"));

    await expect(workspaceApi.saveCodeFile("src/a.ts", "x")).rejects.toThrow(
      "conflict",
    );
    expect(mocks.cache.invalidate).not.toHaveBeenCalled();
  });

  it("encodes each path segment of the saved file", async () => {
    mocks.request.mockResolvedValue({ path: "p", size: 1 });

    await workspaceApi.saveCodeFile("src/a b/文件.ts", "x");

    expect(request).toHaveBeenCalledWith(
      "/workspace/code-files/src/a%20b/%E6%96%87%E4%BB%B6.ts",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});

describe("workspaceApi code and memory listing transforms", () => {
  it("adds a numeric updated_at to every code file", async () => {
    mocks.request.mockResolvedValue([
      { filename: "src/a.ts", modified_time: "2026-09-20T10:00:00Z" },
      { filename: "src/b.ts", modified_time: "2026-09-21T00:00:00Z" },
    ]);

    const files = await workspaceApi.listCodeFiles();

    expect(files).toHaveLength(2);
    expect(files[0].updated_at).toBe(
      new Date("2026-09-20T10:00:00Z").getTime(),
    );
    expect(files[1].updated_at).toBe(
      new Date("2026-09-21T00:00:00Z").getTime(),
    );
    expect(mocks.request).toHaveBeenCalledWith("/workspace/code-files");
  });

  it("keeps the original fields alongside the derived timestamp", async () => {
    mocks.request.mockResolvedValue([
      { filename: "src/a.ts", modified_time: "2026-09-20T10:00:00Z" },
    ]);

    const [file] = await workspaceApi.listCodeFiles();

    expect(file.filename).toBe("src/a.ts");
    expect(file.modified_time).toBe("2026-09-20T10:00:00Z");
  });

  it("returns an empty list when the workspace has no code files", async () => {
    mocks.request.mockResolvedValue([]);

    await expect(workspaceApi.listCodeFiles()).resolves.toEqual([]);
  });

  it("maps an unparseable modified_time to NaN instead of throwing", async () => {
    mocks.request.mockResolvedValue([
      { filename: "a.ts", modified_time: "not-a-date" },
    ]);

    const [file] = await workspaceApi.listCodeFiles();

    expect(Number.isNaN(file.updated_at)).toBe(true);
  });

  it("lists workspace files with the same timestamp transform", async () => {
    mocks.request.mockResolvedValue([
      { filename: "MEMORY.md", modified_time: "2026-09-20T10:00:00Z" },
    ]);

    const [file] = await workspaceApi.listFiles();

    expect(file.updated_at).toBe(new Date("2026-09-20T10:00:00Z").getTime());
    expect(mocks.request).toHaveBeenCalledWith("/workspace/files");
  });

  it("lists the daily memory files and derives the date from the basename", async () => {
    mocks.request.mockResolvedValue([
      {
        filename: "memory/2026-09-20.md",
        modified_time: "2026-09-20T10:00:00Z",
      },
    ]);

    const [file] = await workspaceApi.listDailyMemory();

    expect(file.date).toBe("2026-09-20");
    expect(file.updated_at).toBe(new Date("2026-09-20T10:00:00Z").getTime());
    expect(mocks.request).toHaveBeenCalledWith("/workspace/memory");
  });

  it("uses the whole filename as the date when it has no directory part", async () => {
    mocks.request.mockResolvedValue([
      { filename: "2026-09-21.md", modified_time: "2026-09-21T00:00:00Z" },
    ]);

    const [file] = await workspaceApi.listDailyMemory();

    expect(file.date).toBe("2026-09-21");
  });

  it("keeps a filename with no .md suffix intact as the date", async () => {
    mocks.request.mockResolvedValue([
      { filename: "memory/notes.txt", modified_time: "2026-09-21T00:00:00Z" },
    ]);

    const [file] = await workspaceApi.listDailyMemory();

    expect(file.date).toBe("notes.txt");
  });

  it("returns an empty daily memory list unchanged", async () => {
    mocks.request.mockResolvedValue([]);

    await expect(workspaceApi.listDailyMemory()).resolves.toEqual([]);
  });

  it("encodes nested memory paths segment by segment when loading", async () => {
    mocks.request.mockResolvedValue({ content: "body" });

    await workspaceApi.loadDailyMemory("memory/2026 目录/a b.md");

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/memory/memory/2026%20%E7%9B%AE%E5%BD%95/a%20b.md",
    );
  });

  it("encodes nested memory paths segment by segment when saving", async () => {
    mocks.request.mockResolvedValue({});

    await workspaceApi.saveDailyMemory("memory/a b.md", "new body");

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/memory/memory/a%20b.md",
      {
        method: "PUT",
        body: JSON.stringify({ content: "new body" }),
      },
    );
  });

  it("encodes the filename when loading a single workspace file", async () => {
    mocks.request.mockResolvedValue({ content: "c" });

    await workspaceApi.loadFile("SOUL 档案.md");

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/files/SOUL%20%E6%A1%A3%E6%A1%88.md",
    );
  });
});

describe("workspaceApi.downloadWorkspace fallback filename", () => {
  it("derives the agent id from sessionStorage when it is present", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T06:15:30.123Z"));
    sessionStorage.setItem(
      "qwenpaw-agent-storage",
      JSON.stringify({ state: { selectedAgent: "agent-tab" } }),
    );
    localStorage.setItem(
      "qwenpaw-agent-storage",
      JSON.stringify({ state: { selectedAgent: "agent-global" } }),
    );

    await workspaceApi.downloadWorkspace();

    expect(downloadFileFromUrl).toHaveBeenCalledWith(
      "/api/workspace/download",
      "qwenpaw_workspace_agent-tab_20260921_061530.zip",
      expect.objectContaining({ preferResponseFilename: true }),
    );
  });

  it("falls back to localStorage when sessionStorage holds nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T06:15:30.000Z"));
    localStorage.setItem(
      "qwenpaw-agent-storage",
      JSON.stringify({ state: { selectedAgent: "agent-global" } }),
    );

    await workspaceApi.downloadWorkspace();

    expect(downloadFileFromUrl).toHaveBeenCalledWith(
      "/api/workspace/download",
      "qwenpaw_workspace_agent-global_20260921_061530.zip",
      expect.anything(),
    );
  });

  it("uses the default agent id when no storage entry exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));

    await workspaceApi.downloadWorkspace();

    expect(downloadFileFromUrl).toHaveBeenCalledWith(
      "/api/workspace/download",
      "qwenpaw_workspace_default_20260102_030405.zip",
      expect.anything(),
    );
  });

  it("uses the default agent id when the stored entry has no selectedAgent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    sessionStorage.setItem(
      "qwenpaw-agent-storage",
      JSON.stringify({ state: {} }),
    );

    await workspaceApi.downloadWorkspace();

    expect(downloadFileFromUrl).toHaveBeenCalledWith(
      "/api/workspace/download",
      "qwenpaw_workspace_default_20260102_030405.zip",
      expect.anything(),
    );
  });

  it("recovers with a warning when the stored JSON is malformed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    sessionStorage.setItem("qwenpaw-agent-storage", "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await workspaceApi.downloadWorkspace();

    expect(warn).toHaveBeenCalledWith(
      "Failed to get selected agent from storage:",
      expect.any(Error),
    );
    expect(downloadFileFromUrl).toHaveBeenCalledWith(
      "/api/workspace/download",
      "qwenpaw_workspace_default_20260102_030405.zip",
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("asks for a zip extension and an error message the UI can show", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));

    await workspaceApi.downloadWorkspace();

    const [, filename, options] = mocks.downloadFileFromUrl.mock.calls[0];
    expect(String(filename).endsWith(".zip")).toBe(true);
    expect(options).toEqual({
      headers: { Authorization: "Bearer tok" },
      errorMessage: "Workspace download failed",
      preferResponseFilename: true,
    });
  });

  it("truncates the timestamp to second precision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));

    await workspaceApi.downloadWorkspace();

    const [, filename] = mocks.downloadFileFromUrl.mock.calls[0];
    expect(filename).toContain("20261231_235959");
    expect(filename).not.toContain("999");
  });
});

describe("workspaceApi project header precedence", () => {
  it("sends only the project directory header when there is no chat id", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory(
      "",
      undefined,
      200,
      undefined,
      "project",
      "/tmp/pending",
    );

    const init = mocks.request.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers["X-Session-Project-Dir"]).toBe("/tmp/pending");
    expect(init.headers["X-Chat-Id"]).toBeUndefined();
  });

  it("prefers the chat id and drops the project directory header", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory(
      "",
      undefined,
      200,
      "chat-1",
      "project",
      "/tmp/pending",
    );

    const init = mocks.request.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers["X-Chat-Id"]).toBe("chat-1");
    expect(init.headers["X-Session-Project-Dir"]).toBeUndefined();
  });

  it("sends neither project header when both are absent", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory();

    const init = mocks.request.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("queries the tree with defaults for path, limit and root", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory();

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/tree?path=&limit=200&root=project",
      expect.anything(),
    );
  });

  it("omits the cursor from the query when it is not supplied", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory("docs");

    expect(String(mocks.request.mock.calls[0][0])).not.toContain("cursor");
  });

  it("includes the cursor when paging", async () => {
    mocks.request.mockResolvedValue({ entries: [] });

    await workspaceApi.listDirectory(
      "docs",
      "cur-9",
      50,
      undefined,
      "agent" as never,
    );

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/tree?path=docs&cursor=cur-9&limit=50&root=agent",
      expect.anything(),
    );
  });

  it("queries file metadata with the path and root only", async () => {
    mocks.request.mockResolvedValue({ path: "a.md" });

    await workspaceApi.getFileMetadata("dir/a b.md");

    // The query builder goes through URLSearchParams, which form-encodes a
    // space as "+". The path-building helpers use encodeURIComponent ("%20").
    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/file-metadata?path=dir%2Fa+b.md&root=project",
      expect.anything(),
    );
  });

  it("encodes a query value differently from an equivalent path value", async () => {
    mocks.request.mockResolvedValue({ path: "p", content: "c" });
    global.fetch = vi
      .fn()
      .mockResolvedValue(okJson({ path: "p", content: "c" }));

    await workspaceApi.loadFileChunk("a b.md");
    await workspaceApi.loadCodeFile("a b.md");

    const queryUrl = String(mocks.request.mock.calls[0][0]);
    expect(queryUrl).toBe(
      "/workspace/file-content?path=a+b.md&offset=0&limit=262144&root=project",
    );
    expect(lastFetch().url).toBe("/api/workspace/code-files/a%20b.md");
  });

  it("queries a file chunk with offset and limit defaults", async () => {
    mocks.request.mockResolvedValue(chunk());

    await workspaceApi.loadFileChunk("a.md");

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/file-content?path=a.md&offset=0&limit=262144&root=project",
      expect.anything(),
    );
  });

  it("queries the sectioned memory list with the section param", async () => {
    mocks.request.mockResolvedValue([]);

    await workspaceApi.listMemoryFiles("daily" as never);

    expect(mocks.request).toHaveBeenCalledWith(
      "/workspace/memory?section=daily",
    );
  });
});

describe("UploadConflictError", () => {
  it("carries the conflicting filenames for the resolution dialog", () => {
    const err = new UploadConflictError(["a.txt", "b.txt"]);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UploadConflictError");
    expect(err.files).toEqual(["a.txt", "b.txt"]);
    expect(err.message).toBe("Upload contains conflicting filenames");
  });

  it("accepts an empty conflict list", () => {
    expect(new UploadConflictError([]).files).toEqual([]);
  });
});
