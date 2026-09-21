/**
 * chat.ts - request contract layer for the chat/session REST surface.
 *
 * Sibling coverage note: ./chat.test.ts already pins filePreviewUrl,
 * uploadFile happy paths, listChats query building and the chatApi CRUD
 * subset. This file deliberately covers what that file leaves out, so the two
 * do not duplicate each other:
 *   - the `sessionApi` export (listSessions / getSession / deleteSession /
 *     createSession / updateSession / batchDeleteSessions), which had no test
 *     at all. Note it is unrelated to pages/Chat/sessionApi/index.ts despite
 *     sharing the name: this one is a thin REST wrapper.
 *   - the archive family (archiveChat / unarchiveChat / batchArchiveChats /
 *     batchUnarchiveChats), createChat, listGroups and deleteGroup.
 *   - the uploadFile failure arm where response.text() *rejects*: the existing
 *     tests stub text() with a resolved empty string, which takes the
 *     `text ? ... : ""` falsy branch and leaves the `.catch(() => "")` arrow
 *     body uncovered. Only a rejected body stream reaches it.
 *
 * Assertions are on path / method / body - the frontend contract - never on
 * backend behaviour.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { chatApi, sessionApi } from "./chat";

vi.mock("../request", () => ({ request: vi.fn() }));
vi.mock("../config", () => ({
  getApiUrl: (path: string) => `/api${path}`,
  getApiToken: vi.fn(() => ""),
}));
vi.mock("../authHeaders", () => ({
  buildAuthHeaders: vi.fn(() => ({ Authorization: "Bearer t" })),
}));

import { request } from "../request";
import { buildAuthHeaders } from "../authHeaders";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(request).mockReset();
});

/** Reject-safe helper: resolves with the thrown error, throws if it resolved. */
async function mustReject<T = Error>(run: () => Promise<unknown>): Promise<T> {
  try {
    await run();
  } catch (e) {
    return e as T;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

describe("chatApi.uploadFile - rejected response body", () => {
  it("falls back to an empty detail when reading the error body itself fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.reject(new Error("body stream aborted")),
    } as unknown as Response);

    const err = await mustReject(() =>
      chatApi.uploadFile(new File([""], "broken.bin")),
    );
    expect(err.message).toBe("Upload failed: 502 Bad Gateway");
  });

  it("still reports status and statusText when the body stream rejects mid-read", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: () => Promise.reject(new TypeError("network gone")),
    } as unknown as Response);

    const err = await mustReject(() =>
      chatApi.uploadFile(
        new File([""], "bad.json", { type: "application/json" }),
      ),
    );
    expect(err.message).toContain("422");
    expect(err.message).toContain("Unprocessable Entity");
    expect(err.message).not.toContain(" - ");
  });

  it("attaches auth headers and the multipart body to the upload request", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "a.png", file_name: "a.png" }),
    } as unknown as Response);
    const file = new File(["data"], "a.png", { type: "image/png" });

    await chatApi.uploadFile(file);

    expect(buildAuthHeaders).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/console/upload");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer t" });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
  });
});

describe("chatApi.createChat", () => {
  it("POSTs the partial chat as a JSON body", async () => {
    vi.mocked(request).mockResolvedValue({ id: "c1" });
    const payload = { name: "New Chat", meta: { source: "console" } };

    await chatApi.createChat(payload);

    expect(request).toHaveBeenCalledWith("/chats", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  });

  it("serialises an empty object rather than omitting the body", async () => {
    vi.mocked(request).mockResolvedValue({ id: "c2" });

    await chatApi.createChat({});

    expect(request).toHaveBeenCalledWith("/chats", {
      method: "POST",
      body: "{}",
    });
  });
});

describe("chatApi archive family", () => {
  it("archives a chat by POSTing to the archive sub-resource", async () => {
    vi.mocked(request).mockResolvedValue({ id: "a b/c" });

    await chatApi.archiveChat("a b/c");

    expect(request).toHaveBeenCalledWith("/chats/a%20b%2Fc/archive", {
      method: "POST",
    });
  });

  it("unarchives a chat by POSTing to the unarchive sub-resource", async () => {
    vi.mocked(request).mockResolvedValue({ id: "x" });

    await chatApi.unarchiveChat("x");

    expect(request).toHaveBeenCalledWith("/chats/x/unarchive", {
      method: "POST",
    });
  });

  it("sends the archive ids wrapped in a chat_ids object, not a bare array", async () => {
    vi.mocked(request).mockResolvedValue({ archived: 2 });

    await chatApi.batchArchiveChats(["c1", "c2"]);

    expect(request).toHaveBeenCalledWith("/chats/actions/batch-archive", {
      method: "POST",
      body: JSON.stringify({ chat_ids: ["c1", "c2"] }),
    });
  });

  it("sends the unarchive ids wrapped in a chat_ids object", async () => {
    vi.mocked(request).mockResolvedValue({ unarchived: 1 });

    await chatApi.batchUnarchiveChats(["c3"]);

    expect(request).toHaveBeenCalledWith("/chats/actions/batch-unarchive", {
      method: "POST",
      body: JSON.stringify({ chat_ids: ["c3"] }),
    });
  });

  it("keeps an empty archive batch as an empty array instead of dropping the field", async () => {
    vi.mocked(request).mockResolvedValue({ archived: 0 });

    await chatApi.batchArchiveChats([]);

    expect(request).toHaveBeenCalledWith("/chats/actions/batch-archive", {
      method: "POST",
      body: '{"chat_ids":[]}',
    });
  });
});

describe("chatApi group endpoints left uncovered by the sibling test", () => {
  it("lists groups with a bare GET and no options object", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await chatApi.listGroups();

    expect(request).toHaveBeenCalledWith("/chats/groups");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("deletes a group by id with percent-encoding applied", async () => {
    vi.mocked(request).mockResolvedValue({ success: true, group_id: "g/1" });

    await chatApi.deleteGroup("g/1");

    expect(request).toHaveBeenCalledWith("/chats/groups/g%2F1", {
      method: "DELETE",
    });
  });

  it("deletes a group whose id contains spaces and CJK characters", async () => {
    vi.mocked(request).mockResolvedValue({ success: true, group_id: "分组 a" });

    await chatApi.deleteGroup("分组 a");

    const path = vi.mocked(request).mock.calls[0][0] as string;
    expect(path.startsWith("/chats/groups/")).toBe(true);
    expect(path).not.toContain(" ");
    expect(path).toBe(`/chats/groups/${encodeURIComponent("分组 a")}`);
  });
});

describe("sessionApi.listSessions - query construction", () => {
  it("hits /chats with no query string when called without params", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions();

    expect(request).toHaveBeenCalledWith("/chats");
  });

  it("omits the question mark entirely when the params object is empty", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({});

    expect(request).toHaveBeenCalledWith("/chats");
  });

  it("appends user_id when provided", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({ user_id: "alice" });

    expect(request).toHaveBeenCalledWith("/chats?user_id=alice");
  });

  it("appends channel when provided", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({ channel: "console" });

    expect(request).toHaveBeenCalledWith("/chats?channel=console");
  });

  it("keeps both params in declaration order when both are provided", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({ user_id: "bob", channel: "dingtalk" });

    expect(request).toHaveBeenCalledWith("/chats?user_id=bob&channel=dingtalk");
  });

  it("drops falsy param values instead of emitting empty query keys", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({ user_id: "", channel: "" });

    expect(request).toHaveBeenCalledWith("/chats");
  });

  it("percent-encodes a user id containing reserved characters", async () => {
    vi.mocked(request).mockResolvedValue([]);

    await sessionApi.listSessions({ user_id: "a b&c" });

    expect(request).toHaveBeenCalledWith("/chats?user_id=a+b%26c");
  });
});

describe("sessionApi single-session endpoints", () => {
  it("gets a session history by encoded id", async () => {
    vi.mocked(request).mockResolvedValue({ messages: [] });

    await sessionApi.getSession("chat/1");

    expect(request).toHaveBeenCalledWith("/chats/chat%2F1");
  });

  it("gets a session with a CJK id without mangling it", async () => {
    vi.mocked(request).mockResolvedValue({ messages: [] });

    await sessionApi.getSession("会话 一");

    expect(request).toHaveBeenCalledWith(
      `/chats/${encodeURIComponent("会话 一")}`,
    );
  });

  it("deletes a session with an explicit DELETE method", async () => {
    vi.mocked(request).mockResolvedValue({ success: true });

    await sessionApi.deleteSession("s-1");

    expect(request).toHaveBeenCalledWith("/chats/s-1", { method: "DELETE" });
  });

  it("creates a session by POSTing the partial payload as JSON", async () => {
    vi.mocked(request).mockResolvedValue({ id: "s-2" });
    const payload = { name: "新建会话", meta: {} };

    await sessionApi.createSession(payload);

    expect(request).toHaveBeenCalledWith("/chats", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  });

  it("updates a session by PUT to the encoded id", async () => {
    vi.mocked(request).mockResolvedValue({ id: "s/3" });
    const payload = { name: "renamed" };

    await sessionApi.updateSession("s/3", payload);

    expect(request).toHaveBeenCalledWith("/chats/s%2F3", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  });
});

describe("sessionApi.batchDeleteSessions", () => {
  it("POSTs the raw id array as the body", async () => {
    vi.mocked(request).mockResolvedValue({ success: true, deleted_count: 2 });

    await sessionApi.batchDeleteSessions(["a", "b"]);

    expect(request).toHaveBeenCalledWith("/chats/batch-delete", {
      method: "POST",
      body: JSON.stringify(["a", "b"]),
    });
  });

  it("keeps an empty id list as an empty JSON array", async () => {
    vi.mocked(request).mockResolvedValue({ success: true, deleted_count: 0 });

    await sessionApi.batchDeleteSessions([]);

    expect(request).toHaveBeenCalledWith("/chats/batch-delete", {
      method: "POST",
      body: "[]",
    });
  });

  it("uses the same endpoint shape as chatApi.batchDeleteChats", async () => {
    vi.mocked(request).mockResolvedValue({ success: true, deleted_count: 1 });

    await sessionApi.batchDeleteSessions(["x"]);
    await chatApi.batchDeleteChats(["x"]);

    const calls = vi.mocked(request).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
  });
});

describe("sessionApi return values are passed through untouched", () => {
  it("resolves with whatever the request layer resolved for listSessions", async () => {
    const payload = [{ id: "s1" }, { id: "s2" }];
    vi.mocked(request).mockResolvedValue(payload);

    await expect(sessionApi.listSessions()).resolves.toBe(payload);
  });

  it("rejects with the request layer error without wrapping it", async () => {
    const boom = new Error("500 Internal Server Error");
    vi.mocked(request).mockRejectedValue(boom);

    await expect(sessionApi.getSession("s1")).rejects.toBe(boom);
  });
});
