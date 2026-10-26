/**
 * moduleRegistry.ts - runtime module registry behind the plugin monkey-patch
 * layer. The host registers every @patchable module at startup, plugins read
 * and replace exports through window.QwenPaw.modules, and host code reads them
 * back through get()/call() so a plugin-modified export always wins.
 *
 * The registry is a module-level singleton whose internal Map accumulates
 * across registrations, so each test re-imports it after vi.resetModules() to
 * obtain a pristine instance instead of depending on execution order.
 *
 * Three defensive arms are deliberately NOT covered here:
 *  - the `descriptor.enumerable === false` arm is structurally unreachable:
 *    the loop is driven by Object.keys(), which already filters to enumerable
 *    own properties, so getOwnPropertyDescriptor() inside that loop can only
 *    report enumerable: true.
 *  - the `console && console.warn` / `console && console.error` falsy arms
 *    would require stubbing the global console away, which would also silence
 *    the runner's own diagnostics; jsdom always provides console.
 *  - the `typeof window !== "undefined"` false arm is the standard SSR guard
 *    and cannot be reached from a jsdom environment.
 * Writing tests that cannot pass is worse than leaving those arms uncovered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

type RegistryModule = typeof import("./moduleRegistry");

/** Import a brand-new registry instance (the export is a module singleton). */
async function freshRegistry(): Promise<RegistryModule> {
  vi.resetModules();
  return await import("./moduleRegistry");
}

/** Read window.QwenPaw.modules without depending on the host global typing. */
function bridgeModules(): Record<string, Record<string, unknown>> {
  const w = window as unknown as { QwenPaw?: { modules?: unknown } };
  return (w.QwenPaw?.modules ?? {}) as Record<string, Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("moduleRegistry.register - safe-copy semantics", () => {
  it("copies plain enumerable exports under the given key", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:a", { count: 1, label: "x" });

    expect(moduleRegistry.getModule("mod:a")).toEqual({ count: 1, label: "x" });
  });

  it("stores a copy, so mutating the source module afterwards has no effect", async () => {
    const { moduleRegistry } = await freshRegistry();
    const source: Record<string, unknown> = { value: "original" };
    moduleRegistry.register("mod:copy", source);

    source.value = "mutated";
    source.added = true;

    expect(moduleRegistry.get("mod:copy", "value")).toBe("original");
    expect(moduleRegistry.get("mod:copy", "added")).toBeUndefined();
  });

  it("evaluates a getter once at registration time instead of on every read", async () => {
    const { moduleRegistry } = await freshRegistry();
    const read = vi.fn(() => "snapshot");
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, "derived", {
      enumerable: true,
      configurable: true,
      get: read,
    });

    moduleRegistry.register("mod:getter", source);
    const first = moduleRegistry.get("mod:getter", "derived");
    const second = moduleRegistry.get("mod:getter", "derived");

    expect(first).toBe("snapshot");
    expect(second).toBe("snapshot");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("skips an export whose getter throws but keeps the remaining exports", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();
    const source: Record<string, unknown> = { healthy: 42 };
    Object.defineProperty(source, "hostile", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("getter blew up");
      },
    });

    moduleRegistry.register("mod:partial", source);

    expect(moduleRegistry.getModule("mod:partial")).toEqual({ healthy: 42 });
    expect(moduleRegistry.get("mod:partial", "hostile")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Cannot copy property hostile from mod:partial"),
      expect.any(Error),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives a module whose own property enumeration throws and leaves it unregistered", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("hostile ownKeys");
        },
      },
    ) as Record<string, unknown>;

    moduleRegistry.register("mod:hostile", hostile);

    expect(moduleRegistry.keys()).not.toContain("mod:hostile");
    expect(moduleRegistry.getModule("mod:hostile")).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to register module: mod:hostile"),
      expect.any(TypeError),
    );
  });

  it("replaces the previous copy when the same key is registered twice", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:dup", { v: 1 });
    moduleRegistry.register("mod:dup", { v: 2 });

    expect(moduleRegistry.get("mod:dup", "v")).toBe(2);
    expect(moduleRegistry.keys().filter((k) => k === "mod:dup")).toHaveLength(
      1,
    );
  });

  it("registers a module with no exports as an empty object rather than skipping it", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:empty", {});

    expect(moduleRegistry.getModule("mod:empty")).toEqual({});
    expect(moduleRegistry.keys()).toContain("mod:empty");
  });
});

describe("moduleRegistry.get", () => {
  it("returns the stored export value", async () => {
    const { moduleRegistry } = await freshRegistry();
    const fn = () => "called";
    moduleRegistry.register("mod:get", { fn, flag: false });

    expect(moduleRegistry.get("mod:get", "fn")).toBe(fn);
    expect(moduleRegistry.get("mod:get", "flag")).toBe(false);
  });

  it("warns and returns undefined for an unknown module key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();

    expect(moduleRegistry.get("mod:missing", "anything")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[moduleRegistry] Module not found: mod:missing",
    );
  });

  it("returns undefined without warning for an unknown export inside a known module", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:known", { present: 1 });

    expect(moduleRegistry.get("mod:known", "absent")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("preserves falsy export values instead of collapsing them to undefined", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:falsy", { zero: 0, empty: "", nul: null });

    expect(moduleRegistry.get("mod:falsy", "zero")).toBe(0);
    expect(moduleRegistry.get("mod:falsy", "empty")).toBe("");
    expect(moduleRegistry.get("mod:falsy", "nul")).toBeNull();
  });
});

describe("moduleRegistry.call", () => {
  it("invokes the stored function with every argument in order", async () => {
    const { moduleRegistry } = await freshRegistry();
    const fn = vi.fn((...args: unknown[]) => args.join("|"));
    moduleRegistry.register("mod:call", { fn });

    const result = moduleRegistry.call("mod:call", "fn", "a", 2, true, null);

    expect(fn).toHaveBeenCalledWith("a", 2, true, null);
    expect(result).toBe("a|2|true|");
  });

  it("passes no arguments when called with only module and export names", async () => {
    const { moduleRegistry } = await freshRegistry();
    const fn = vi.fn(() => "zero-arg");
    moduleRegistry.register("mod:zero", { fn });

    expect(moduleRegistry.call("mod:zero", "fn")).toBe("zero-arg");
    expect(fn).toHaveBeenCalledWith();
  });

  it("returns the callee's resolved promise untouched", async () => {
    const { moduleRegistry } = await freshRegistry();
    const pending = Promise.resolve("async-value");
    moduleRegistry.register("mod:async", { fn: () => pending });

    expect(moduleRegistry.call("mod:async", "fn")).toBe(pending);
    await expect(moduleRegistry.call("mod:async", "fn")).resolves.toBe(
      "async-value",
    );
  });

  it("propagates an exception thrown by the callee instead of swallowing it", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:throw", {
      fn: () => {
        throw new RangeError("callee exploded");
      },
    });

    expect(() => moduleRegistry.call("mod:throw", "fn")).toThrow(RangeError);
    expect(() => moduleRegistry.call("mod:throw", "fn")).toThrow(
      "callee exploded",
    );
  });

  it("logs an error and returns undefined when the export is not callable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:notfn", { value: 7 });

    expect(moduleRegistry.call("mod:notfn", "value")).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      '[moduleRegistry] Export "value" in "mod:notfn" is not callable',
    );
  });

  it("treats a missing export as non-callable and warns about the module too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:gap", {});

    expect(moduleRegistry.call("mod:gap", "nope")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      '[moduleRegistry] Export "nope" in "mod:gap" is not callable',
    );
  });

  it("reports an unknown module through both the get warning and the call error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { moduleRegistry } = await freshRegistry();

    expect(moduleRegistry.call("mod:ghost", "fn", 1)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[moduleRegistry] Module not found: mod:ghost",
    );
    expect(error).toHaveBeenCalledWith(
      '[moduleRegistry] Export "fn" in "mod:ghost" is not callable',
    );
  });

  it("sees a plugin replacement installed through getModule", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:patch", { greet: () => "host" });

    const exposed = moduleRegistry.getModule("mod:patch");
    expect(exposed).toBeDefined();
    (exposed as Record<string, unknown>).greet = () => "patched-by-plugin";

    expect(moduleRegistry.call("mod:patch", "greet")).toBe("patched-by-plugin");
  });
});

describe("moduleRegistry.keys / getModule / getAllModules", () => {
  it("lists registered keys in insertion order", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:one", { a: 1 });
    moduleRegistry.register("mod:two", { b: 2 });
    moduleRegistry.register("mod:three", { c: 3 });

    expect(moduleRegistry.keys()).toEqual(["mod:one", "mod:two", "mod:three"]);
  });

  it("returns a fresh array from keys() so callers cannot corrupt the registry", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:snap", { a: 1 });

    const snapshot = moduleRegistry.keys();
    snapshot.push("mod:injected");
    snapshot.length = 0;

    expect(moduleRegistry.keys()).toEqual(["mod:snap"]);
  });

  it("returns an empty key list before anything is registered", async () => {
    const { moduleRegistry } = await freshRegistry();

    expect(moduleRegistry.keys()).toEqual([]);
  });

  it("returns undefined from getModule for an unregistered key", async () => {
    const { moduleRegistry } = await freshRegistry();

    expect(moduleRegistry.getModule("mod:never")).toBeUndefined();
  });

  it("returns the same stored object identity from getModule", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:identity", { a: 1 });

    const first = moduleRegistry.getModule("mod:identity");
    const second = moduleRegistry.getModule("mod:identity");

    expect(first).toBe(second);
  });

  it("collects every module into a fresh plain object from getAllModules", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:g1", { a: 1 });
    moduleRegistry.register("mod:g2", { b: 2 });

    const all = moduleRegistry.getAllModules();

    expect(Object.keys(all).sort()).toEqual(["mod:g1", "mod:g2"]);
    expect(all["mod:g1"]).toEqual({ a: 1 });
    expect(all["mod:g2"]).toEqual({ b: 2 });
    expect(moduleRegistry.getAllModules()).not.toBe(all);
  });

  it("returns an empty object from getAllModules when nothing is registered", async () => {
    const { moduleRegistry } = await freshRegistry();

    expect(moduleRegistry.getAllModules()).toEqual({});
  });

  it("exposes the same module objects through getAllModules as through getModule", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:same", { a: 1 });

    expect(moduleRegistry.getAllModules()["mod:same"]).toBe(
      moduleRegistry.getModule("mod:same"),
    );
  });
});

describe("window.QwenPaw.modules bridge", () => {
  it("creates window.QwenPaw when it is absent at load time", async () => {
    delete (window as unknown as { QwenPaw?: unknown }).QwenPaw;
    const { moduleRegistry } = await freshRegistry();

    const w = window as unknown as { QwenPaw?: Record<string, unknown> };
    expect(w.QwenPaw).toBeDefined();
    expect(Object.keys(w.QwenPaw as object)).toEqual(["modules"]);

    moduleRegistry.register("mod:bridge", { v: 1 });
    expect(bridgeModules()["mod:bridge"]).toEqual({ v: 1 });
  });

  it("preserves an existing window.QwenPaw object and only adds the modules accessor", async () => {
    const w = window as unknown as { QwenPaw?: Record<string, unknown> };
    w.QwenPaw = { preset: "keep-me" };
    const { moduleRegistry } = await freshRegistry();

    expect(w.QwenPaw?.preset).toBe("keep-me");
    moduleRegistry.register("mod:keep", { v: 2 });
    expect(bridgeModules()["mod:keep"]).toEqual({ v: 2 });
  });

  it("reflects registrations that happen after load without re-exposing anything", async () => {
    const { moduleRegistry } = await freshRegistry();
    expect(bridgeModules()).toEqual({});

    moduleRegistry.register("mod:late", { v: 3 });
    expect(bridgeModules()).toEqual({ "mod:late": { v: 3 } });

    moduleRegistry.register("mod:later", { v: 4 });
    expect(Object.keys(bridgeModules()).sort()).toEqual([
      "mod:late",
      "mod:later",
    ]);
  });

  it("hands plugins a live view of a patch, which is how monkey-patching reaches host code", async () => {
    const { moduleRegistry } = await freshRegistry();
    moduleRegistry.register("mod:live", { greet: () => "host" });

    const seen = bridgeModules()["mod:live"] as Record<string, unknown>;
    seen.greet = () => "plugin";

    expect(moduleRegistry.call("mod:live", "greet")).toBe("plugin");
  });

  it("defines modules as an enumerable configurable getter with no setter", async () => {
    await freshRegistry();
    const w = window as unknown as { QwenPaw?: object };
    const descriptor = Object.getOwnPropertyDescriptor(
      w.QwenPaw as object,
      "modules",
    );

    expect(descriptor).toBeDefined();
    expect(descriptor?.enumerable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
    expect(typeof descriptor?.get).toBe("function");
    expect(descriptor?.set).toBeUndefined();
  });

  it("returns a new object on every property access so callers cannot cache a stale snapshot", async () => {
    await freshRegistry();
    const w = window as unknown as { QwenPaw?: { modules?: unknown } };

    expect(w.QwenPaw?.modules).not.toBe(w.QwenPaw?.modules);
    expect(bridgeModules()).toEqual(bridgeModules());
  });
});
