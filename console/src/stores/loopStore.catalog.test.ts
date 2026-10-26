/**
 * loopStore.catalog.test.ts - loop-mode catalog and session-status sync paths.
 *
 * Complements loopStore.test.ts, which pins the A#85096690 indicator state
 * machine. This file covers the parts that file leaves out:
 *   - setAvailableModes / normalizeModes: default-mode injection, empty-id and
 *     duplicate-id dropping, selection retention vs. reset
 *   - catalogLoading / catalogError flags
 *   - markLoopModeRunning and its "starting + activeMode" guard
 *   - applyLoopModeCommand / prepareLoopModeMessage early returns
 *   - fetchAvailableLoopModes: success, abort, failure, stale response,
 *     nullish payload
 *   - fetchActiveLoopMode: query building, idle / running / awaiting_user,
 *     null mode, request failure, stale response
 *
 * catalogRequestId and statusRequestId are module-level and monotonically
 * increasing, so every staleness case fires a newer request before settling
 * the older one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/api/request", () => ({
  request: vi.fn(),
}));

import { request } from "@/api/request";
import {
  useLoopStore,
  DEFAULT_LOOP_MODE,
  applyLoopModeCommand,
  beginLoopModeSubmission,
  fetchActiveLoopMode,
  fetchAvailableLoopModes,
  getSelectedLoopMode,
  markLoopModeRunning,
  prepareLoopModeMessage,
  type LoopModeInfo,
} from "./loopStore";

const mockRequest = vi.mocked(request);

const goalMode: LoopModeInfo = {
  id: "goal",
  name: "Goal Mode",
  slash_command: "goal",
  description: "Run until goal is met",
  source: "builtin",
};

const customMode: LoopModeInfo = {
  id: "custom:review",
  name: "Code Review",
  slash_command: "review",
  description: "Iterative code review loop",
  source: "custom",
};

const pluginMode: LoopModeInfo = {
  id: "plugin:triage",
  name: "Triage",
  slash_command: "triage",
  description: "Plugin-owned loop",
  source: "plugin",
  name_i18n: { "zh-CN": "分诊" },
  description_i18n: null,
};

function resetStore(): void {
  useLoopStore.setState({
    selectedModeId: DEFAULT_LOOP_MODE.id,
    availableModes: [DEFAULT_LOOP_MODE],
    sessionState: "idle",
    activeMode: null,
    catalogLoading: false,
    catalogError: false,
  });
}

/** A promise whose settlement the test controls. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

describe("loopStore catalog normalization", () => {
  beforeEach(resetStore);
  afterEach(() => vi.clearAllMocks());

  it("injects the default mode when the incoming catalog omits it", () => {
    useLoopStore.getState().setAvailableModes([goalMode, customMode]);

    expect(useLoopStore.getState().availableModes).toEqual([
      DEFAULT_LOOP_MODE,
      goalMode,
      customMode,
    ]);
  });

  it("keeps the incoming order when the catalog already contains the default mode", () => {
    useLoopStore.getState().setAvailableModes([goalMode, DEFAULT_LOOP_MODE]);

    expect(useLoopStore.getState().availableModes).toEqual([
      goalMode,
      DEFAULT_LOOP_MODE,
    ]);
  });

  it("reduces an empty catalog to the default mode only", () => {
    useLoopStore.getState().setAvailableModes([]);

    expect(useLoopStore.getState().availableModes).toEqual([DEFAULT_LOOP_MODE]);
  });

  it("drops entries without an id", () => {
    const idless = { ...goalMode, id: "" };

    useLoopStore.getState().setAvailableModes([idless, customMode]);

    expect(useLoopStore.getState().availableModes).toEqual([
      DEFAULT_LOOP_MODE,
      customMode,
    ]);
  });

  it("keeps the first entry when ids repeat", () => {
    const first = { ...goalMode, name: "First" };
    const second = { ...goalMode, name: "Second" };

    useLoopStore.getState().setAvailableModes([first, second, customMode]);

    expect(useLoopStore.getState().availableModes).toEqual([
      DEFAULT_LOOP_MODE,
      first,
      customMode,
    ]);
  });

  it("preserves plugin-owned i18n fields verbatim", () => {
    useLoopStore.getState().setAvailableModes([pluginMode]);

    expect(useLoopStore.getState().availableModes).toContainEqual(pluginMode);
  });

  it("keeps the current selection when it survives normalization", () => {
    useLoopStore.getState().setSelectedMode("custom:review");

    useLoopStore.getState().setAvailableModes([goalMode, customMode]);

    expect(useLoopStore.getState().selectedModeId).toBe("custom:review");
    expect(getSelectedLoopMode()).toEqual(customMode);
  });

  it("falls back to the default selection when the selected mode disappears", () => {
    useLoopStore.getState().setSelectedMode("custom:review");

    useLoopStore.getState().setAvailableModes([goalMode]);

    expect(useLoopStore.getState().selectedModeId).toBe(DEFAULT_LOOP_MODE.id);
    expect(getSelectedLoopMode()).toEqual(DEFAULT_LOOP_MODE);
  });

  it("returns the default mode when the selection matches nothing", () => {
    useLoopStore.setState({
      selectedModeId: "ghost",
      availableModes: [DEFAULT_LOOP_MODE, goalMode],
    });

    expect(getSelectedLoopMode()).toEqual(DEFAULT_LOOP_MODE);
  });
});

describe("loopStore catalog flags", () => {
  beforeEach(resetStore);

  it("toggles catalogLoading", () => {
    useLoopStore.getState().setCatalogLoading(true);
    expect(useLoopStore.getState().catalogLoading).toBe(true);

    useLoopStore.getState().setCatalogLoading(false);
    expect(useLoopStore.getState().catalogLoading).toBe(false);
  });

  it("toggles catalogError", () => {
    useLoopStore.getState().setCatalogError(true);
    expect(useLoopStore.getState().catalogError).toBe(true);

    useLoopStore.getState().setCatalogError(false);
    expect(useLoopStore.getState().catalogError).toBe(false);
  });

  it("tracks the selected mode id", () => {
    useLoopStore.getState().setSelectedMode("goal");

    expect(useLoopStore.getState().selectedModeId).toBe("goal");
  });
});

describe("markLoopModeRunning guard", () => {
  beforeEach(resetStore);

  it("promotes starting to running", () => {
    useLoopStore.getState().setStartingMode(goalMode);

    markLoopModeRunning();

    expect(useLoopStore.getState().sessionState).toBe("running");
    expect(useLoopStore.getState().activeMode).toEqual(goalMode);
  });

  it("does nothing while idle", () => {
    markLoopModeRunning();

    expect(useLoopStore.getState().sessionState).toBe("idle");
    expect(useLoopStore.getState().activeMode).toBeNull();
  });

  it("does nothing while starting without an active mode", () => {
    useLoopStore.setState({ sessionState: "starting", activeMode: null });

    markLoopModeRunning();

    expect(useLoopStore.getState().sessionState).toBe("starting");
    expect(useLoopStore.getState().activeMode).toBeNull();
  });

  it("does nothing once a loop already runs", () => {
    useLoopStore.getState().setSessionMode(customMode, "running");

    markLoopModeRunning();

    expect(useLoopStore.getState().sessionState).toBe("running");
  });
});

describe("applyLoopModeCommand", () => {
  it("returns the text untouched for a mode without a slash command", () => {
    expect(applyLoopModeCommand("hello", DEFAULT_LOOP_MODE)).toBe("hello");
  });

  it("returns the text untouched for a whitespace-only slash command", () => {
    const blank = { ...goalMode, slash_command: "   " };

    expect(applyLoopModeCommand("hello", blank)).toBe("hello");
  });

  it("prefixes the slash command", () => {
    expect(applyLoopModeCommand("ship it", goalMode)).toBe("/goal ship it");
  });

  it("keeps the original text when the prefix is already present", () => {
    expect(applyLoopModeCommand("/goal ship it", goalMode)).toBe(
      "/goal ship it",
    );
  });

  it("matches an existing prefix case-insensitively and keeps the casing", () => {
    expect(applyLoopModeCommand("/GOAL ship it", goalMode)).toBe(
      "/GOAL ship it",
    );
  });

  it("ignores leading whitespace when detecting an existing prefix", () => {
    expect(applyLoopModeCommand("   /goal ship it", goalMode)).toBe(
      "   /goal ship it",
    );
  });

  it("prefixes when only part of the command matches", () => {
    expect(applyLoopModeCommand("/goalkeeper hi", goalMode)).toBe(
      "/goal /goalkeeper hi",
    );
  });

  it("prefixes empty text with a trailing space", () => {
    expect(applyLoopModeCommand("", goalMode)).toBe("/goal ");
  });
});

describe("prepareLoopModeMessage", () => {
  beforeEach(() => {
    resetStore();
    useLoopStore.getState().setAvailableModes([goalMode, customMode]);
  });

  it("returns the text untouched while a loop is active", () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");
    useLoopStore.getState().setSelectedMode("goal");

    expect(prepareLoopModeMessage("do work")).toBe("do work");
  });

  it("returns the text untouched while awaiting the user", () => {
    useLoopStore.getState().setSessionMode(goalMode, "awaiting_user");
    useLoopStore.getState().setSelectedMode("goal");

    expect(prepareLoopModeMessage("do work")).toBe("do work");
  });

  it("leaves an unmatched slash command alone", () => {
    useLoopStore.getState().setSelectedMode("goal");

    expect(prepareLoopModeMessage("/clear history")).toBe("/clear history");
  });

  it("leaves an unmatched slash command alone after leading whitespace", () => {
    useLoopStore.getState().setSelectedMode("goal");

    expect(prepareLoopModeMessage("   /clear history")).toBe(
      "   /clear history",
    );
  });

  it("applies the selected mode", () => {
    useLoopStore.getState().setSelectedMode("custom:review");

    expect(prepareLoopModeMessage("review this")).toBe("/review review this");
  });

  it("prefers a manually typed command over the selected mode", () => {
    useLoopStore.getState().setSelectedMode("custom:review");

    expect(prepareLoopModeMessage("/goal ship it")).toBe("/goal ship it");
  });

  it("leaves plain text alone while the default mode is selected", () => {
    expect(prepareLoopModeMessage("hello")).toBe("hello");
  });
});

describe("beginLoopModeSubmission", () => {
  beforeEach(() => {
    resetStore();
    useLoopStore.getState().setAvailableModes([goalMode, customMode]);
  });

  it("starts the selected mode and returns the prepared text", () => {
    useLoopStore.getState().setSelectedMode("goal");

    expect(beginLoopModeSubmission("ship it")).toBe("/goal ship it");

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("starting");
    expect(state.activeMode).toEqual(goalMode);
  });

  it("starts the manually typed mode", () => {
    expect(beginLoopModeSubmission("/review look at this")).toBe(
      "/review look at this",
    );

    expect(useLoopStore.getState().activeMode).toEqual(customMode);
  });

  it("does not start anything for the default mode", () => {
    expect(beginLoopModeSubmission("hello")).toBe("hello");

    expect(useLoopStore.getState().sessionState).toBe("idle");
    expect(useLoopStore.getState().activeMode).toBeNull();
  });

  it("re-arms the active mode on a follow-up message", () => {
    useLoopStore.getState().setSessionMode(goalMode, "awaiting_user");

    expect(beginLoopModeSubmission("continue")).toBe("continue");

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("starting");
    expect(state.activeMode).toEqual(goalMode);
  });

  it("leaves an unmatched slash command alone while a loop runs", () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");

    expect(beginLoopModeSubmission("/clear")).toBe("/clear");

    expect(useLoopStore.getState().sessionState).toBe("running");
  });
});

describe("fetchAvailableLoopModes", () => {
  beforeEach(resetStore);
  afterEach(() => vi.clearAllMocks());

  it("stores the catalog and clears both flags", async () => {
    mockRequest.mockResolvedValue([goalMode, customMode]);

    await fetchAvailableLoopModes();

    expect(mockRequest).toHaveBeenCalledWith("/loops", { signal: undefined });
    const state = useLoopStore.getState();
    expect(state.catalogLoading).toBe(false);
    expect(state.catalogError).toBe(false);
    expect(state.availableModes).toEqual([
      DEFAULT_LOOP_MODE,
      goalMode,
      customMode,
    ]);
  });

  it("raises the loading flag while the catalog request is in flight", async () => {
    const gate = deferred<LoopModeInfo[]>();
    mockRequest.mockReturnValue(gate.promise);

    const pending = fetchAvailableLoopModes();
    expect(useLoopStore.getState().catalogLoading).toBe(true);

    gate.resolve([goalMode]);
    await pending;
    expect(useLoopStore.getState().catalogLoading).toBe(false);
  });

  it("clears a previous catalog error before retrying", async () => {
    useLoopStore.setState({ catalogError: true });
    mockRequest.mockResolvedValue([goalMode]);

    await fetchAvailableLoopModes();

    expect(useLoopStore.getState().catalogError).toBe(false);
  });

  it("forwards the caller abort signal", async () => {
    const controller = new AbortController();
    mockRequest.mockResolvedValue([goalMode]);

    await fetchAvailableLoopModes(controller.signal);

    expect(mockRequest).toHaveBeenCalledWith("/loops", {
      signal: controller.signal,
    });
  });

  it("falls back to the default mode when the payload is nullish", async () => {
    mockRequest.mockResolvedValue(undefined);

    await fetchAvailableLoopModes();

    expect(useLoopStore.getState().availableModes).toEqual([DEFAULT_LOOP_MODE]);
    expect(useLoopStore.getState().catalogError).toBe(false);
  });

  it("flags a catalog error when the request fails", async () => {
    mockRequest.mockRejectedValue(new Error("network down"));

    await fetchAvailableLoopModes();

    const state = useLoopStore.getState();
    expect(state.catalogError).toBe(true);
    expect(state.catalogLoading).toBe(false);
  });

  it("does not flag an error when the caller aborted", async () => {
    mockRequest.mockRejectedValue(abortError());

    await fetchAvailableLoopModes();

    const state = useLoopStore.getState();
    expect(state.catalogError).toBe(false);
    expect(state.catalogLoading).toBe(false);
  });

  it("ignores a catalog response superseded by a newer request", async () => {
    const stale = deferred<LoopModeInfo[]>();
    mockRequest.mockReturnValueOnce(stale.promise);
    mockRequest.mockResolvedValue([customMode]);

    const older = fetchAvailableLoopModes();
    const newer = fetchAvailableLoopModes();
    await newer;

    expect(useLoopStore.getState().availableModes).toEqual([
      DEFAULT_LOOP_MODE,
      customMode,
    ]);

    // Raise the flag again so the stale call would be visible if it wrote.
    useLoopStore.getState().setCatalogLoading(true);
    stale.resolve([goalMode]);
    await older;

    const state = useLoopStore.getState();
    expect(state.availableModes).toEqual([DEFAULT_LOOP_MODE, customMode]);
    expect(state.catalogLoading).toBe(true);
  });

  it("ignores a stale failure and keeps the newer catalog error state", async () => {
    const stale = deferred<LoopModeInfo[]>();
    mockRequest.mockReturnValueOnce(stale.promise);
    mockRequest.mockResolvedValue([goalMode]);

    const older = fetchAvailableLoopModes();
    await fetchAvailableLoopModes();

    stale.reject(new Error("late failure"));
    await older;

    expect(useLoopStore.getState().catalogError).toBe(false);
    expect(useLoopStore.getState().catalogLoading).toBe(false);
  });
});

describe("fetchActiveLoopMode", () => {
  beforeEach(resetStore);
  afterEach(() => vi.clearAllMocks());

  it("resets the session and skips the request when no target is given", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");

    await fetchActiveLoopMode({});

    expect(mockRequest).not.toHaveBeenCalled();
    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("idle");
    expect(state.activeMode).toBeNull();
  });

  it("treats empty-string identifiers as no target", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");

    await fetchActiveLoopMode({ chatId: "", sessionId: "" });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(useLoopStore.getState().sessionState).toBe("idle");
  });

  it("treats null identifiers as no target", async () => {
    await fetchActiveLoopMode({ chatId: null, sessionId: null });

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("queries by chat id only", async () => {
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    await fetchActiveLoopMode({ chatId: "chat-1" });

    expect(mockRequest).toHaveBeenCalledWith("/loops/status?chat_id=chat-1", {
      signal: undefined,
    });
  });

  it("queries by session id only", async () => {
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    await fetchActiveLoopMode({ sessionId: "sess-9" });

    expect(mockRequest).toHaveBeenCalledWith(
      "/loops/status?session_id=sess-9",
      { signal: undefined },
    );
  });

  it("queries with both identifiers and forwards the signal", async () => {
    const controller = new AbortController();
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    await fetchActiveLoopMode({
      chatId: "chat-1",
      sessionId: "sess-9",
      signal: controller.signal,
    });

    expect(mockRequest).toHaveBeenCalledWith(
      "/loops/status?chat_id=chat-1&session_id=sess-9",
      { signal: controller.signal },
    );
  });

  it("url-encodes identifiers", async () => {
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    await fetchActiveLoopMode({ chatId: "chat/1 2" });

    expect(mockRequest).toHaveBeenCalledWith(
      "/loops/status?chat_id=chat%2F1+2",
      { signal: undefined },
    );
  });

  it("resets the session when the backend reports idle", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    await fetchActiveLoopMode({ chatId: "chat-1" });

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("idle");
    expect(state.activeMode).toBeNull();
    expect(state.selectedModeId).toBe(DEFAULT_LOOP_MODE.id);
  });

  it("adopts a running loop reported by the backend", async () => {
    mockRequest.mockResolvedValue({ state: "running", mode: customMode });

    await fetchActiveLoopMode({ sessionId: "sess-9" });

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("running");
    expect(state.activeMode).toEqual(customMode);
    expect(state.selectedModeId).toBe(DEFAULT_LOOP_MODE.id);
  });

  it("adopts an awaiting_user loop reported by the backend", async () => {
    mockRequest.mockResolvedValue({ state: "awaiting_user", mode: goalMode });

    await fetchActiveLoopMode({ chatId: "chat-1" });

    expect(useLoopStore.getState().sessionState).toBe("awaiting_user");
    expect(useLoopStore.getState().activeMode).toEqual(goalMode);
  });

  it("keeps the current state when a non-idle status carries no mode", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");
    mockRequest.mockResolvedValue({ state: "running", mode: null });

    await fetchActiveLoopMode({ chatId: "chat-1" });

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("running");
    expect(state.activeMode).toEqual(goalMode);
  });

  it("preserves the last known state when the request fails", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "awaiting_user");
    mockRequest.mockRejectedValue(new Error("offline"));

    await fetchActiveLoopMode({ chatId: "chat-1" });

    const state = useLoopStore.getState();
    expect(state.sessionState).toBe("awaiting_user");
    expect(state.activeMode).toEqual(goalMode);
  });

  it("preserves the last known state when the caller aborted", async () => {
    useLoopStore.getState().setSessionMode(goalMode, "running");
    mockRequest.mockRejectedValue(abortError());

    await fetchActiveLoopMode({ chatId: "chat-1" });

    expect(useLoopStore.getState().sessionState).toBe("running");
  });

  it("ignores a status response superseded by a newer poll", async () => {
    const stale = deferred<{ state: "running"; mode: LoopModeInfo }>();
    mockRequest.mockReturnValueOnce(stale.promise);
    mockRequest.mockResolvedValue({ state: "idle", mode: null });

    const older = fetchActiveLoopMode({ chatId: "chat-1" });
    await fetchActiveLoopMode({ chatId: "chat-1" });

    expect(useLoopStore.getState().sessionState).toBe("idle");

    stale.resolve({ state: "running", mode: goalMode });
    await older;

    expect(useLoopStore.getState().sessionState).toBe("idle");
    expect(useLoopStore.getState().activeMode).toBeNull();
  });
});
