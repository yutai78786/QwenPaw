// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnsType } from "antd/es/table";

import type { PluginInfo, PluginType } from "@/api/modules/plugin";

// This test supplies its own icons mock (see vi.mock below), so it does not
// depend on the shared stub (src/test/icons-mock.ts). PluginTypeTag renders
// SparkWifiLine for the "channel" type, and without any mock providing it the
// element type resolves to undefined and React throws while rendering.
vi.mock("@agentscope-ai/icons", () => ({
  SparkWifiLine: (props: Record<string, unknown>) => (
    <span data-icon="SparkWifiLine" {...props} />
  ),
}));

const t = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import { usePluginColumns } from "./usePluginColumns";

// The hook returns a plain array whose elements carry different render
// arities, so the inferred union is not callable with the three arguments antd
// passes. Widening it to the antd column type at this boundary keeps every
// render below callable the same way the table calls it.
type Column = ColumnsType<PluginInfo>[number];

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: "plugin-1",
    name: "Alpha",
    version: "1.2.3",
    description: "A useful plugin",
    author: "author-name",
    enabled: true,
    loaded: true,
    plugin_type: "tool",
    ...overrides,
  };
}

function useColumns(options: {
  uninstallingId: string | null;
  onUninstall: (plugin: PluginInfo) => void;
}) {
  const hook = renderHook(() => usePluginColumns(options));
  return hook.result.current as unknown as Column[];
}

function renderColumn(
  columns: Column[],
  key: string,
  value: unknown,
  record: PluginInfo,
) {
  const column = columns.find((candidate) => candidate.key === key);
  if (!column) throw new Error(`expected a column keyed "${key}"`);
  return render(<>{column.render!(value, record, 0)}</>);
}

describe("usePluginColumns", () => {
  beforeEach(() => {
    t.mockReset();
    t.mockImplementation((key: string) => key);
  });

  it("returns one column per plugin attribute plus an actions column", () => {
    const columns = useColumns({ uninstallingId: null, onUninstall: vi.fn() });
    expect(columns.map((column) => column.key)).toEqual([
      "name",
      "plugin_type",
      "version",
      "author",
      "loaded",
      "actions",
    ]);
  });

  it("gives every column a render function", () => {
    const columns = useColumns({ uninstallingId: null, onUninstall: vi.fn() });
    expect(columns.every((column) => typeof column.render === "function")).toBe(
      true,
    );
  });

  it("labels five columns from i18n and leaves the actions column untitled", () => {
    const columns = useColumns({ uninstallingId: null, onUninstall: vi.fn() });
    expect(columns.map((column) => String(column.title))).toEqual([
      "pluginManager.title",
      "pluginManager.type",
      "pluginManager.version",
      "pluginManager.author",
      "Status",
      "",
    ]);
  });

  describe("name column", () => {
    it("shows the name and the description when one is present", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(columns, "name", "Alpha", makePlugin());
      expect(view.container.textContent).toContain("Alpha");
      expect(view.container.textContent).toContain("A useful plugin");
    });

    it("omits the description node when the description is empty", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(
        columns,
        "name",
        "Alpha",
        makePlugin({ description: "" }),
      );
      // Only the name remains: a second Text node would mean the arm ran.
      expect(view.container.querySelectorAll(".ant-typography")).toHaveLength(
        1,
      );
      expect(view.container.textContent).toBe("Alpha");
    });
  });

  describe("type column", () => {
    it("renders the plugin type tag for the declared type", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(
        columns,
        "plugin_type",
        "channel",
        makePlugin({ plugin_type: "channel" }),
      );
      expect(view.container.querySelector(".ant-tag")?.textContent).toBe(
        "Channel",
      );
      expect(
        view.container.querySelector('[data-icon="SparkWifiLine"]'),
      ).not.toBeNull();
    });

    it("falls back to the general tag when the type is missing", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(
        columns,
        "plugin_type",
        undefined as unknown as PluginType,
        makePlugin(),
      );
      expect(view.container.querySelector(".ant-tag")?.textContent).toBe(
        "General",
      );
    });
  });

  it("renders the version as given", () => {
    const columns = useColumns({ uninstallingId: null, onUninstall: vi.fn() });
    const view = renderColumn(columns, "version", "2.0.0", makePlugin());
    expect(view.container.textContent).toBe("2.0.0");
  });

  describe("author column", () => {
    it("renders the author when one is set", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(columns, "author", "author-name", makePlugin());
      expect(view.container.textContent).toBe("author-name");
    });

    it("renders the unknown placeholder when the author is empty", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(
        columns,
        "author",
        "",
        makePlugin({ author: "" }),
      );
      expect(view.container.textContent).toBe("pluginManager.unknown");
      expect(t).toHaveBeenCalledWith("pluginManager.unknown");
    });
  });

  describe("status column", () => {
    it("shows the loaded tag for a loaded plugin", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(columns, "loaded", true, makePlugin());
      const tag = view.container.querySelector(".ant-tag") as HTMLElement;
      expect(tag.textContent).toBe("pluginManager.statusLoaded");
      expect(tag.className).toContain("ant-tag-success");
    });

    it("shows the unloaded tag for a plugin that failed to load", () => {
      const columns = useColumns({
        uninstallingId: null,
        onUninstall: vi.fn(),
      });
      const view = renderColumn(
        columns,
        "loaded",
        false,
        makePlugin({ loaded: false }),
      );
      const tag = view.container.querySelector(".ant-tag") as HTMLElement;
      expect(tag.textContent).toBe("pluginManager.statusUnloaded");
      expect(tag.className).toContain("ant-tag-default");
      expect(tag.className).not.toContain("ant-tag-success");
    });
  });

  describe("actions column", () => {
    it("calls onUninstall with the row record when clicked", () => {
      const onUninstall = vi.fn();
      const columns = useColumns({ uninstallingId: null, onUninstall });
      const plugin = makePlugin({ id: "plugin-9" });
      const view = renderColumn(columns, "actions", null, plugin);
      const button = view.container.querySelector(
        "button",
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.disabled).toBe(false);
      button.click();
      expect(onUninstall).toHaveBeenCalledTimes(1);
      expect(onUninstall).toHaveBeenCalledWith(plugin);
    });

    it("shows a spinner and blocks clicks for the row being uninstalled", () => {
      const onUninstall = vi.fn();
      const columns = useColumns({
        uninstallingId: "plugin-9",
        onUninstall,
      });
      const view = renderColumn(
        columns,
        "actions",
        null,
        makePlugin({ id: "plugin-9" }),
      );
      const button = view.container.querySelector(
        "button",
      ) as HTMLButtonElement;
      expect(button.className).toContain("ant-btn-loading");
      button.click();
      // antd swallows clicks on a loading button, so the handler must not run.
      expect(onUninstall).not.toHaveBeenCalled();
    });

    it("leaves other rows clickable while one row is uninstalling", () => {
      const onUninstall = vi.fn();
      const columns = useColumns({
        uninstallingId: "plugin-9",
        onUninstall,
      });
      const plugin = makePlugin({ id: "plugin-1" });
      const view = renderColumn(columns, "actions", null, plugin);
      const button = view.container.querySelector(
        "button",
      ) as HTMLButtonElement;
      expect(button.className).not.toContain("ant-btn-loading");
      button.click();
      expect(onUninstall).toHaveBeenCalledWith(plugin);
    });
  });
});
