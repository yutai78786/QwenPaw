import { describe, expect, it } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { BUILTIN_ROUTES } from "./builtinRoutes";
import { BUILTIN_MENU } from "./builtinMenu";
import { routeRegistry } from "../../plugins/registry/store";
import type { Route } from "../../plugins/registry/types";

/**
 * builtinRoutes.tsx is a data module with one import-time side effect: it
 * registers every built-in route into the shared route registry and exposes
 * the same array as BUILTIN_ROUTES. Two of its entries are eager redirect
 * components; the remaining ones are lazy pages produced by
 * lazyImportWithRetry.
 *
 * These tests pin three things and nothing else:
 *   1. the registration side effect (ids, paths, source, uniqueness);
 *   2. the navigation behaviour of the two eager redirect components;
 *   3. the cross-file invariant that every non-group menu entry has a route.
 *
 * Lazy page components are deliberately never mounted here: resolving them
 * would pull whole feature pages into this unit and turn it into an
 * integration test. Their resolution is covered by utils/lazyWithRetry.
 */

/** Reads back the router location so a redirect becomes observable. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

/** Mounts one route entry at `initial` and reports where the router ended up. */
function landOn(route: Route, initial: string): string {
  const view = render(
    <MemoryRouter initialEntries={[initial]}>
      <route.component />
      <LocationProbe />
    </MemoryRouter>,
  );
  const pathname = view.getByTestId("loc").textContent ?? "";
  view.unmount();
  return pathname;
}

function byId(id: string): Route {
  const found = BUILTIN_ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(`route ${id} is not registered`);
  return found;
}

/** Flattens the menu tree; group headers expose children via __children. */
function menuIds(items: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const item = raw as { id?: string; __children?: unknown[] };
    if (item.id) out.push(item.id);
    if (item.__children) out.push(...menuIds(item.__children));
  }
  return out;
}

/** Renders only the eager root redirect, resolved from the registry by id. */
function RootRedirect() {
  const route = byId("core.root");
  return <route.component />;
}

describe("builtinRoutes module side effect", () => {
  it("registers every exported route into the shared registry", () => {
    const snapshot = routeRegistry.snapshot();

    expect(snapshot).toHaveLength(BUILTIN_ROUTES.length);
    expect(snapshot.map((r) => r.id)).toEqual(BUILTIN_ROUTES.map((r) => r.id));
  });

  it("attributes all built-in routes to the core source", () => {
    const sources = new Set(routeRegistry.snapshot().map((r) => r.source));

    expect([...sources]).toEqual(["core"]);
  });

  it("hands the registry the very same component objects it exports", () => {
    for (const resolved of routeRegistry.snapshot()) {
      expect(resolved.Component).toBe(byId(resolved.id).component);
    }
  });

  it("gives every entry a non-empty id, a root-relative path and a component", () => {
    for (const route of BUILTIN_ROUTES) {
      expect(typeof route.id).toBe("string");
      expect(route.id.length).toBeGreaterThan(0);
      expect(route.path.startsWith("/")).toBe(true);
      expect(route.component).toBeTruthy();
    }
  });

  it("keeps ids unique so a duplicate registration cannot shadow a route", () => {
    const ids = BUILTIN_ROUTES.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps paths unique so the router never has to pick between two entries", () => {
    const paths = BUILTIN_ROUTES.map((r) => r.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it("follows the documented core.<key> naming convention", () => {
    for (const route of BUILTIN_ROUTES) {
      expect(route.id.startsWith("core.")).toBe(true);
    }
  });

  it("re-registering the built-ins is a no-op instead of a duplicate", () => {
    const before = routeRegistry.snapshot().length;

    routeRegistry.addBuiltin(BUILTIN_ROUTES);
    const after = routeRegistry.snapshot();

    // A registry that silently accepted duplicates would grow here, and every
    // consumer of useRoutes() would start rendering each page twice.
    expect(after).toHaveLength(before);
  });
});

describe("route shape contracts", () => {
  it("keeps exactly two eager redirect components among the lazy pages", () => {
    const eager = BUILTIN_ROUTES.filter(
      (r) => typeof r.component === "function",
    ).map((r) => r.id);

    expect(eager).toEqual(["core.root", "core.acp-alias"]);
    expect(BUILTIN_ROUTES.length - eager.length).toBeGreaterThan(0);
  });

  it("declares the two wildcard roots that own their own sub-navigation", () => {
    const splat = BUILTIN_ROUTES.filter((r) => r.path.endsWith("/*")).map(
      (r) => r.path,
    );

    expect(splat).toEqual(["/chat/*", "/settings/*"]);
  });

  it("declares the app deep-link route that takes an app id parameter", () => {
    const parametrized = BUILTIN_ROUTES.filter((r) => r.path.includes(":")).map(
      (r) => [r.id, r.path],
    );

    expect(parametrized).toEqual([["core.app-center.embed", "/apps/:appId"]]);
  });
});

describe("core.root redirect", () => {
  it("sends the bare root path to the chat workspace", () => {
    expect(landOn(byId("core.root"), "/")).toBe("/chat");
  });

  it("does not send the bare root path to the ACP alias target", () => {
    // Falsification guard: without it the assertion above would also pass for
    // any Navigate that merely moved the router off "/".
    expect(landOn(byId("core.root"), "/")).not.toBe("/acp");
  });

  it("replaces rather than pushes, so back leaves the bare root behind", async () => {
    const view = render(<BackFromRootHarness />);

    expect(view.getByTestId("loc").textContent).toBe("/chat");

    fireEvent.click(view.getByTestId("back"));
    // With `replace` the stack is ["/inbox", "/chat"] so back lands on /inbox.
    // With `push` it would be ["/inbox", "/", "/chat"] and back would land on
    // the bare root again, which this route would immediately redirect back to
    // /chat, so the observed location would stay "/chat".
    await waitFor(() =>
      expect(view.getByTestId("loc").textContent).toBe("/inbox"),
    );
    view.unmount();
  });
});

/**
 * Harness for the history-semantics case above.
 *
 * The redirect has to live inside <Routes> so it unmounts once the router has
 * moved off "/". Rendering it unconditionally would make it fire again on
 * every render and fight the back navigation.
 */
function BackFromRootHarness() {
  return (
    <MemoryRouter initialEntries={["/inbox", "/"]}>
      <LocationProbe />
      <BackButton />
      <Routes>
        <RouterRoute path="/" element={<RootRedirect />} />
        <RouterRoute path="/inbox" element={null} />
        <RouterRoute path="/chat" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

/** A history-back trigger; must render inside the router to use useNavigate. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="back" onClick={() => navigate(-1)}>
      back
    </button>
  );
}

describe("core.acp-alias redirect", () => {
  it("lower-cases the uppercase ACP synonym", () => {
    expect(landOn(byId("core.acp-alias"), "/ACP")).toBe("/acp");
  });

  it("does not reuse the root redirect target", () => {
    expect(landOn(byId("core.acp-alias"), "/ACP")).not.toBe("/chat");
  });

  it("is registered as its own entry rather than overwriting core.acp", () => {
    const alias = byId("core.acp-alias");
    const canonical = byId("core.acp");

    expect(alias.path).toBe("/ACP");
    expect(canonical.path).toBe("/acp");
    expect(alias.id).not.toBe(canonical.id);
    expect(alias.component).not.toBe(canonical.component);
  });
});

describe("menu and route cross-reference", () => {
  it("gives every non-group menu entry a route to navigate to", () => {
    const routeIds = new Set(BUILTIN_ROUTES.map((r) => r.id));
    const unreachable = menuIds(BUILTIN_MENU as unknown as unknown[]).filter(
      (id) => !routeIds.has(id),
    );

    // Group headers are layout-only entries and the sole allowed exception:
    // anything else listed here would be a sidebar item navigating nowhere.
    expect(unreachable).toEqual([
      "core.control-group",
      "core.workspace-group",
      "core.settings-group",
    ]);
  });

  it("keeps the route-only entries that must not appear in the sidebar", () => {
    const menuIdSet = new Set(menuIds(BUILTIN_MENU as unknown as unknown[]));
    const routeOnly = BUILTIN_ROUTES.map((r) => r.id).filter(
      (id) => !menuIdSet.has(id),
    );

    expect(routeOnly).toEqual([
      "core.root",
      "core.chat",
      "core.settings-center",
      "core.acp-alias",
      "core.app-center.embed",
    ]);
  });
});
