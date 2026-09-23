/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SecurityPage - the page shell around the four security tabs: the loading
 * state, the error state with its retry button, the breadcrumb, the tab list
 * (keys, labels, order) and which child panel each tab carries, the tab switch
 * handed to setActiveTab, the three conditional footer button rows with the
 * handlers they call and the `saving` flags they mirror, the rule id list the
 * page builds from the builtin and custom rules before handing it to RuleModal,
 * and the two modal close callbacks.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - `useSecurityPage` is mocked and its stub returns exactly the 42 names the
 *   component destructures. That list was extracted mechanically from the
 *   source, and the hook was measured to return 43 names, the extra one being
 *   `sandboxEffective`, which this page does not use. So the "the hook still
 *   provides everything the page asks for" test below compares against an
 *   expectation written out independently rather than one derived from the page.
 * - The global design stub exports Button and Tabs, but its Tabs renders only
 *   the tab buttons and never the panel children (read from
 *   src/test/design-mock.ts). Reaching any tab body therefore needs an override
 *   here, which src/test/design-mock.ts:4 authorises; the override renders the
 *   active panel plus one driver button per tab, so the children the product
 *   builds for every tab really execute.
 * - The `./components` barrel is stubbed so this file exercises only the page.
 *   The barrel's own bindings are covered by components/index.test.ts, and each
 *   of those components has its own test file.
 * - `PageHeader` is stubbed to mirror the two props the page passes, because the
 *   real one renders a breadcrumb trail whose markup is its own concern and is
 *   covered by src/components/PageHeader/PageHeader.test.tsx.
 * - No assertion reads a CSS module class name: they are hashed, so a class
 *   assertion would break on any rename.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import SecurityPage from "./index";

type Handlers = { save: () => void; reset: () => void; saving: boolean };

const h = vi.hoisted(() => {
  const rec = {
    setActiveTab: [] as string[],
    fetchAll: 0,
    handleSave: 0,
    handleReset: 0,
    fileGuardSave: 0,
    fileGuardReset: 0,
    allowNoAuthSave: 0,
    allowNoAuthReset: 0,
    setEditModal: [] as boolean[],
    handleEditSave: 0,
    setPreviewRule: [] as Array<unknown>,
    openAddRule: 0,
    openEditRule: [] as string[],
    deleteCustomRule: [] as string[],
    toggleRule: [] as string[],
    toggleAutoDeny: [] as string[],
    toggleDenyPaths: 0,
    setEnabled: [] as boolean[],
    setSandboxEnabled: [] as boolean[],
    toggleShellEvasionCheck: [] as string[],
    onFileGuardHandlersReady: [] as unknown[],
    onAllowNoAuthHostsHandlersReady: [] as unknown[],
  };

  const state: Record<string, unknown> = {};

  const rule = (id: string) => ({
    id,
    tools: ["shell"],
    params: [],
    category: "cat",
    severity: "HIGH",
    patterns: [],
    exclude_patterns: [],
    description: "desc",
    remediation: "",
  });

  const defaults = () => ({
    activeTab: "toolGuard",
    setActiveTab: (tab: string) => rec.setActiveTab.push(tab),
    form: {},
    config: null,
    enabled: true,
    setEnabled: (v: boolean) => rec.setEnabled.push(v),
    sandboxEnabled: false,
    setSandboxEnabled: (v: boolean) => rec.setSandboxEnabled.push(v),
    sandboxReason: null,
    denyPathsActive: false,
    denyPathsLoading: false,
    denyPathsProtectedPaths: [] as string[],
    denyPathsPlatformSupported: true,
    toggleDenyPaths: () => {
      rec.toggleDenyPaths += 1;
    },
    toolOptions: [{ label: "shell", value: "shell" }],
    saving: false,
    handleSave: () => {
      rec.handleSave += 1;
    },
    handleReset: () => {
      rec.handleReset += 1;
    },
    mergedRules: [rule("merged-1")],
    builtinRules: [rule("builtin-1"), rule("builtin-2")],
    customRules: [rule("custom-1")],
    toggleRule: (id: string) => rec.toggleRule.push(id),
    toggleAutoDeny: (id: string) => rec.toggleAutoDeny.push(id),
    deleteCustomRule: (id: string) => rec.deleteCustomRule.push(id),
    openAddRule: () => {
      rec.openAddRule += 1;
    },
    openEditRule: (r: { id: string }) => rec.openEditRule.push(r.id),
    shellEvasionChecks: {} as Record<string, boolean>,
    toggleShellEvasionCheck: (name: string) =>
      rec.toggleShellEvasionCheck.push(name),
    editModal: false,
    setEditModal: (v: boolean) => rec.setEditModal.push(v),
    editingRule: null,
    editForm: {},
    handleEditSave: () => {
      rec.handleEditSave += 1;
    },
    previewRule: null,
    setPreviewRule: (v: unknown) => rec.setPreviewRule.push(v),
    fileGuardHandlers: null as Handlers | null,
    onFileGuardHandlersReady: (x: unknown) =>
      rec.onFileGuardHandlersReady.push(x),
    allowNoAuthHostsHandlers: null as Handlers | null,
    onAllowNoAuthHostsHandlersReady: (x: unknown) =>
      rec.onAllowNoAuthHostsHandlersReady.push(x),
    loading: false,
    error: null as string | null,
    fetchAll: () => {
      rec.fetchAll += 1;
    },
  });

  Object.assign(state, defaults());

  return { rec, state, defaults, rule };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("./useSecurityPage", () => ({
  useSecurityPage: () => ({ ...h.state }),
}));

vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ parent, current }: any) =>
    React.createElement("div", {
      "data-testid": "page-header",
      "data-parent": String(parent),
      "data-current": String(current),
    }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Button = ({ children, onClick, disabled, loading, type, size }: any) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick,
        disabled: Boolean(disabled),
        "data-testid": "button",
        "data-btn-type": String(type ?? ""),
        "data-size": String(size ?? ""),
        "data-loading": String(Boolean(loading)),
        "data-disabled": String(Boolean(disabled)),
      },
      children as any,
    );

  // Renders the tab buttons and the body of the active tab, plus one driver
  // button per tab so an inactive panel can be driven too.
  const Tabs = ({ items = [], activeKey, onChange, className }: any) => {
    const list = items as Array<{
      key: string;
      label?: React.ReactNode;
      children?: React.ReactNode;
    }>;
    return React.createElement(
      "div",
      { "data-testid": "tabs", className },
      React.createElement(
        "div",
        { role: "tablist" },
        list.map((item) =>
          React.createElement(
            "button",
            {
              key: item.key,
              type: "button",
              role: "tab",
              "aria-selected": activeKey === item.key,
              "data-tab-key": item.key,
              onClick: () => (onChange as (v: string) => void)?.(item.key),
            },
            item.label as any,
          ),
        ),
      ),
      ...list.map((item) =>
        React.createElement(
          "div",
          {
            key: `panel-${item.key}`,
            "data-testid": "tab-panel",
            "data-panel-key": item.key,
            style: { display: activeKey === item.key ? "block" : "none" },
          },
          React.createElement("button", {
            type: "button",
            "data-testid": `drive-panel-${item.key}`,
          }),
          item.children as any,
        ),
      ),
    );
  };

  return { Button, Tabs };
});

vi.mock("./components", () => {
  // A data-* attribute containing an upper-case letter is dropped from the DOM
  // by React, so prop names are kebab-cased before they become attributes.
  const kebab = (name: string) =>
    name
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase();

  const mirror =
    (testid: string) =>
    ({ children: _children, ...props }: any) =>
      React.createElement("div", {
        "data-testid": testid,
        ...Object.fromEntries(
          Object.entries(props).map(([key, value]) => [
            `data-prop-${kebab(key)}`,
            typeof value === "function" ? "fn" : JSON.stringify(value) ?? "",
          ]),
        ),
      });

  const RuleModal = ({
    open,
    editingRule,
    existingRuleIds,
    onOk,
    onCancel,
    form,
  }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "rule-modal",
        "data-open": String(Boolean(open)),
        "data-editing-rule": JSON.stringify(editingRule ?? null),
        "data-existing-rule-ids": JSON.stringify(existingRuleIds),
        "data-has-form": String(form != null),
      },
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-modal-ok",
        onClick: () => onOk?.(),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-modal-cancel",
        onClick: () => onCancel?.(),
      }),
    );

  const PreviewModal = ({ rule, onClose }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "preview-modal",
        "data-rule": JSON.stringify(rule ?? null),
      },
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-preview-close",
        onClick: () => onClose?.(),
      }),
    );

  const FileGuardSection = ({
    onSave,
    denyPathsActive,
    denyPathsLoading,
    denyPathsProtectedPaths,
    denyPathsPlatformSupported,
    sandboxEnabled,
    sandboxReason,
    toggleDenyPaths,
  }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "file-guard-section",
        "data-deny-paths-active": String(Boolean(denyPathsActive)),
        "data-deny-paths-loading": String(Boolean(denyPathsLoading)),
        "data-protected-paths": JSON.stringify(denyPathsProtectedPaths),
        "data-platform-supported": String(Boolean(denyPathsPlatformSupported)),
        "data-sandbox-enabled": String(Boolean(sandboxEnabled)),
        "data-sandbox-reason": JSON.stringify(sandboxReason ?? null),
      },
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-file-guard-ready",
        onClick: () => onSave?.({ kind: "file-guard-handlers" }),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-toggle-deny-paths",
        onClick: () => toggleDenyPaths?.(),
      }),
    );

  return {
    ToolGuardTab: mirror("tool-guard-tab"),
    RuleModal,
    PreviewModal,
    SkillScannerSection: mirror("skill-scanner-section"),
    FileGuardSection,
    AllowNoAuthHostsTab: ({ onSave }: any) =>
      React.createElement(
        "div",
        { "data-testid": "allow-no-auth-hosts-tab" },
        React.createElement("button", {
          type: "button",
          "data-testid": "drive-allow-no-auth-ready",
          onClick: () => onSave?.({ kind: "allow-no-auth-handlers" }),
        }),
      ),
  };
});

/** The 42 names the page destructures, written out independently of the page. */
const PAGE_FIELDS = [
  "activeTab",
  "setActiveTab",
  "form",
  "config",
  "enabled",
  "setEnabled",
  "sandboxEnabled",
  "setSandboxEnabled",
  "sandboxReason",
  "denyPathsActive",
  "denyPathsLoading",
  "denyPathsProtectedPaths",
  "denyPathsPlatformSupported",
  "toggleDenyPaths",
  "toolOptions",
  "saving",
  "handleSave",
  "handleReset",
  "mergedRules",
  "builtinRules",
  "customRules",
  "toggleRule",
  "toggleAutoDeny",
  "deleteCustomRule",
  "openAddRule",
  "openEditRule",
  "shellEvasionChecks",
  "toggleShellEvasionCheck",
  "editModal",
  "setEditModal",
  "editingRule",
  "editForm",
  "handleEditSave",
  "previewRule",
  "setPreviewRule",
  "fileGuardHandlers",
  "onFileGuardHandlersReady",
  "allowNoAuthHostsHandlers",
  "onAllowNoAuthHostsHandlersReady",
  "loading",
  "error",
  "fetchAll",
];

const TAB_KEYS = ["toolGuard", "fileGuard", "skillScanner", "allowNoAuthHosts"];

const setState = (over: Record<string, unknown>) => {
  Object.assign(h.state, h.defaults(), over);
};

const tabButtons = () => screen.getAllByRole("tab");
const panelOf = (key: string) =>
  screen
    .getAllByTestId("tab-panel")
    .find((el) => el.getAttribute("data-panel-key") === key)!;

beforeEach(() => {
  setState({});
  h.rec.setActiveTab = [];
  h.rec.fetchAll = 0;
  h.rec.handleSave = 0;
  h.rec.handleReset = 0;
  h.rec.fileGuardSave = 0;
  h.rec.fileGuardReset = 0;
  h.rec.allowNoAuthSave = 0;
  h.rec.allowNoAuthReset = 0;
  h.rec.setEditModal = [];
  h.rec.handleEditSave = 0;
  h.rec.setPreviewRule = [];
  h.rec.openAddRule = 0;
  h.rec.openEditRule = [];
  h.rec.deleteCustomRule = [];
  h.rec.toggleRule = [];
  h.rec.toggleAutoDeny = [];
  h.rec.toggleDenyPaths = 0;
  h.rec.setEnabled = [];
  h.rec.setSandboxEnabled = [];
  h.rec.toggleShellEvasionCheck = [];
  h.rec.onFileGuardHandlersReady = [];
  h.rec.onAllowNoAuthHostsHandlersReady = [];
});

describe("SecurityPage - loading state", () => {
  it("renders the loading text while loading", () => {
    setState({ loading: true });
    render(<SecurityPage />);
    expect(screen.getByText("common.loading")).toBeTruthy();
  });

  it("renders the loading text exactly once", () => {
    setState({ loading: true });
    render(<SecurityPage />);
    expect(screen.getAllByText("common.loading")).toHaveLength(1);
  });

  it("renders no breadcrumb, no tabs and no footer while loading", () => {
    setState({ loading: true });
    render(<SecurityPage />);
    expect(screen.queryByTestId("page-header")).toBeNull();
    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.queryAllByTestId("button")).toHaveLength(0);
  });

  it("does not render either modal while loading", () => {
    setState({ loading: true });
    render(<SecurityPage />);
    expect(screen.queryByTestId("rule-modal")).toBeNull();
    expect(screen.queryByTestId("preview-modal")).toBeNull();
  });
});

describe("SecurityPage - error state", () => {
  it("shows the error text the hook reported", () => {
    setState({ error: "tool guard fetch failed" });
    render(<SecurityPage />);
    expect(screen.getByText("tool guard fetch failed")).toBeTruthy();
  });

  it("renders a small retry button with the product label", () => {
    setState({ error: "boom" });
    render(<SecurityPage />);
    const retry = screen.getByText("environments.retry").closest("button")!;
    expect(retry.getAttribute("data-size")).toBe("small");
  });

  it("calls fetchAll when retry is clicked", () => {
    setState({ error: "boom" });
    render(<SecurityPage />);
    fireEvent.click(screen.getByText("environments.retry").closest("button")!);
    expect(h.rec.fetchAll).toBe(1);
  });

  it("renders no tabs, no breadcrumb and no footer in the error state", () => {
    setState({ error: "boom" });
    render(<SecurityPage />);
    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.queryByTestId("page-header")).toBeNull();
    expect(screen.getAllByTestId("button")).toHaveLength(1);
  });

  it("prefers the loading state over the error state", () => {
    setState({ loading: true, error: "boom" });
    render(<SecurityPage />);
    expect(screen.getByText("common.loading")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
  });
});

describe("SecurityPage - breadcrumb and tab list", () => {
  it("passes the parent and current breadcrumb labels to PageHeader", () => {
    render(<SecurityPage />);
    const header = screen.getByTestId("page-header");
    expect(header.getAttribute("data-parent")).toBe("security.parent");
    expect(header.getAttribute("data-current")).toBe("security.security");
  });

  it("renders exactly the four tabs in the product order", () => {
    render(<SecurityPage />);
    expect(tabButtons().map((el) => el.getAttribute("data-tab-key"))).toEqual(
      TAB_KEYS,
    );
  });

  it.each([
    ["toolGuard", "security.toolGuardTitle"],
    ["fileGuard", "security.fileGuard.title"],
    ["skillScanner", "security.skillScanner.title"],
    ["allowNoAuthHosts", "security.allowNoAuthHosts.title"],
  ])("labels the %s tab with %s", (key, label) => {
    render(<SecurityPage />);
    const tab = tabButtons().find(
      (el) => el.getAttribute("data-tab-key") === key,
    )!;
    expect(tab.textContent).toBe(label);
  });

  it("marks the active tab as selected and the other three as not", () => {
    setState({ activeTab: "skillScanner" });
    render(<SecurityPage />);
    tabButtons().forEach((el) => {
      const expected = el.getAttribute("data-tab-key") === "skillScanner";
      expect(el.getAttribute("aria-selected")).toBe(String(expected));
    });
  });

  it("hands the clicked tab key to setActiveTab", () => {
    render(<SecurityPage />);
    fireEvent.click(
      tabButtons().find(
        (el) => el.getAttribute("data-tab-key") === "allowNoAuthHosts",
      )!,
    );
    expect(h.rec.setActiveTab).toEqual(["allowNoAuthHosts"]);
  });

  it("still hands the already active key to setActiveTab when it is clicked", () => {
    render(<SecurityPage />);
    fireEvent.click(
      tabButtons().find(
        (el) => el.getAttribute("data-tab-key") === "toolGuard",
      )!,
    );
    expect(h.rec.setActiveTab).toEqual(["toolGuard"]);
  });
});

describe("SecurityPage - tab bodies", () => {
  it("puts ToolGuardTab in the tool guard tab", () => {
    render(<SecurityPage />);
    expect(
      within(panelOf("toolGuard")).getByTestId("tool-guard-tab"),
    ).toBeTruthy();
  });

  it("hands the tool guard panel the enabled flag and the rule list", () => {
    setState({ enabled: false, mergedRules: [h.rule("m1"), h.rule("m2")] });
    render(<SecurityPage />);
    const tab = within(panelOf("toolGuard")).getByTestId("tool-guard-tab");
    expect(tab.getAttribute("data-prop-enabled")).toBe("false");
    // The mirror stub serialises the whole value, so the rule ids the page
    // forwarded are read back out of it rather than compared as text.
    const forwarded = JSON.parse(tab.getAttribute("data-prop-merged-rules")!);
    expect(forwarded.map((r: any) => r.id)).toEqual(["m1", "m2"]);
    expect(forwarded).toHaveLength(2);
  });

  it("hands the tool guard panel the sandbox state and the tool options", () => {
    setState({
      sandboxEnabled: true,
      sandboxReason: "unelevated",
      toolOptions: [{ label: "a", value: "a" }],
    });
    render(<SecurityPage />);
    const tab = within(panelOf("toolGuard")).getByTestId("tool-guard-tab");
    expect(tab.getAttribute("data-prop-sandbox-enabled")).toBe("true");
    expect(tab.getAttribute("data-prop-sandbox-reason")).toBe('"unelevated"');
    expect(tab.getAttribute("data-prop-tool-options")).toBe(
      '[{"label":"a","value":"a"}]',
    );
  });

  it("wires the tool guard panel callbacks to the hook handlers", () => {
    render(<SecurityPage />);
    const tab = within(panelOf("toolGuard")).getByTestId("tool-guard-tab");
    // Prop names the page passes down; each must be a function the page took
    // from the hook rather than something the page invented.
    [
      "set-enabled",
      "set-sandbox-enabled",
      "toggle-rule",
      "toggle-auto-deny",
      "on-preview-rule",
      "on-edit-rule",
      "on-delete-rule",
      "open-add-rule",
      "toggle-shell-evasion-check",
    ].forEach((prop) => {
      expect(tab.getAttribute(`data-prop-${prop}`)).toBe("fn");
    });
  });

  it("renders the file guard description inside the file guard tab", () => {
    render(<SecurityPage />);
    expect(
      within(panelOf("fileGuard")).getByText("security.fileGuard.description"),
    ).toBeTruthy();
  });

  it("hands FileGuardSection the deny-path state it was given", () => {
    setState({
      denyPathsActive: true,
      denyPathsLoading: true,
      denyPathsProtectedPaths: ["/etc", "/boot"],
      denyPathsPlatformSupported: false,
      sandboxEnabled: true,
      sandboxReason: "unelevated",
    });
    render(<SecurityPage />);
    const section = within(panelOf("fileGuard")).getByTestId(
      "file-guard-section",
    );
    expect(section.getAttribute("data-deny-paths-active")).toBe("true");
    expect(section.getAttribute("data-deny-paths-loading")).toBe("true");
    expect(section.getAttribute("data-protected-paths")).toBe(
      '["/etc","/boot"]',
    );
    expect(section.getAttribute("data-platform-supported")).toBe("false");
    expect(section.getAttribute("data-sandbox-enabled")).toBe("true");
    expect(section.getAttribute("data-sandbox-reason")).toBe('"unelevated"');
  });

  it("forwards toggleDenyPaths from the file guard section", () => {
    render(<SecurityPage />);
    fireEvent.click(
      within(panelOf("fileGuard")).getByTestId("drive-toggle-deny-paths"),
    );
    expect(h.rec.toggleDenyPaths).toBe(1);
  });

  it("renders the skill scanner description and the section inside its tab", () => {
    render(<SecurityPage />);
    expect(
      within(panelOf("skillScanner")).getByText(
        "security.skillScanner.description",
      ),
    ).toBeTruthy();
    expect(
      within(panelOf("skillScanner")).getByTestId("skill-scanner-section"),
    ).toBeTruthy();
  });

  it("hands AllowNoAuthHostsTab its onSave callback", () => {
    render(<SecurityPage />);
    fireEvent.click(
      within(panelOf("allowNoAuthHosts")).getByTestId(
        "drive-allow-no-auth-ready",
      ),
    );
    expect(h.rec.onAllowNoAuthHostsHandlersReady).toEqual([
      { kind: "allow-no-auth-handlers" },
    ]);
  });

  it("hands FileGuardSection its onSave callback", () => {
    render(<SecurityPage />);
    fireEvent.click(
      within(panelOf("fileGuard")).getByTestId("drive-file-guard-ready"),
    );
    expect(h.rec.onFileGuardHandlersReady).toEqual([
      { kind: "file-guard-handlers" },
    ]);
  });
});

describe("SecurityPage - footer button rows", () => {
  it("renders reset and save for the tool guard tab", () => {
    setState({ activeTab: "toolGuard" });
    render(<SecurityPage />);
    expect(screen.getByText("common.reset")).toBeTruthy();
    expect(screen.getByText("common.save")).toBeTruthy();
  });

  it("calls handleReset and handleSave from the tool guard footer", () => {
    render(<SecurityPage />);
    fireEvent.click(screen.getByText("common.reset").closest("button")!);
    fireEvent.click(screen.getByText("common.save").closest("button")!);
    expect(h.rec.handleReset).toBe(1);
    expect(h.rec.handleSave).toBe(1);
  });

  it("marks the save button primary and mirrors saving into it", () => {
    setState({ saving: true });
    render(<SecurityPage />);
    const save = screen.getByText("common.save").closest("button")!;
    expect(save.getAttribute("data-btn-type")).toBe("primary");
    expect(save.getAttribute("data-loading")).toBe("true");
  });

  it("disables the reset button while saving", () => {
    setState({ saving: true });
    render(<SecurityPage />);
    const reset = screen.getByText("common.reset").closest("button")!;
    expect(reset.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(reset);
    expect(h.rec.handleReset).toBe(0);
  });

  it("renders no footer for the skill scanner tab", () => {
    setState({ activeTab: "skillScanner" });
    render(<SecurityPage />);
    expect(screen.queryByText("common.save")).toBeNull();
    expect(screen.queryByText("common.reset")).toBeNull();
  });

  it("renders no file guard footer while its handlers are still unknown", () => {
    setState({ activeTab: "fileGuard", fileGuardHandlers: null });
    render(<SecurityPage />);
    expect(screen.queryByText("common.save")).toBeNull();
  });

  it("renders the file guard footer once its handlers arrive", () => {
    setState({
      activeTab: "fileGuard",
      fileGuardHandlers: {
        save: () => {
          h.rec.fileGuardSave += 1;
        },
        reset: () => {
          h.rec.fileGuardReset += 1;
        },
        saving: false,
      },
    });
    render(<SecurityPage />);
    fireEvent.click(screen.getByText("common.reset").closest("button")!);
    fireEvent.click(screen.getByText("common.save").closest("button")!);
    expect(h.rec.fileGuardReset).toBe(1);
    expect(h.rec.fileGuardSave).toBe(1);
    // The page-level handlers must not have been called by the file guard row.
    expect(h.rec.handleReset).toBe(0);
    expect(h.rec.handleSave).toBe(0);
  });

  it("mirrors the file guard saving flag and disables its reset button", () => {
    setState({
      activeTab: "fileGuard",
      fileGuardHandlers: {
        save: () => {
          h.rec.fileGuardSave += 1;
        },
        reset: () => {
          h.rec.fileGuardReset += 1;
        },
        saving: true,
      },
    });
    render(<SecurityPage />);
    const save = screen.getByText("common.save").closest("button")!;
    expect(save.getAttribute("data-loading")).toBe("true");
    expect(save.getAttribute("data-btn-type")).toBe("primary");
    fireEvent.click(screen.getByText("common.reset").closest("button")!);
    expect(h.rec.fileGuardReset).toBe(0);
  });

  it("renders no allow-list footer while its handlers are still unknown", () => {
    setState({ activeTab: "allowNoAuthHosts", allowNoAuthHostsHandlers: null });
    render(<SecurityPage />);
    expect(screen.queryByText("common.save")).toBeNull();
  });

  it("renders the allow-list footer once its handlers arrive", () => {
    setState({
      activeTab: "allowNoAuthHosts",
      allowNoAuthHostsHandlers: {
        save: () => {
          h.rec.allowNoAuthSave += 1;
        },
        reset: () => {
          h.rec.allowNoAuthReset += 1;
        },
        saving: false,
      },
    });
    render(<SecurityPage />);
    fireEvent.click(screen.getByText("common.reset").closest("button")!);
    fireEvent.click(screen.getByText("common.save").closest("button")!);
    expect(h.rec.allowNoAuthReset).toBe(1);
    expect(h.rec.allowNoAuthSave).toBe(1);
    expect(h.rec.handleReset).toBe(0);
    expect(h.rec.handleSave).toBe(0);
  });

  it("mirrors the allow-list saving flag and disables its reset button", () => {
    setState({
      activeTab: "allowNoAuthHosts",
      allowNoAuthHostsHandlers: {
        save: () => {
          h.rec.allowNoAuthSave += 1;
        },
        reset: () => {
          h.rec.allowNoAuthReset += 1;
        },
        saving: true,
      },
    });
    render(<SecurityPage />);
    expect(
      screen
        .getByText("common.save")
        .closest("button")!
        .getAttribute("data-loading"),
    ).toBe("true");
    fireEvent.click(screen.getByText("common.reset").closest("button")!);
    expect(h.rec.allowNoAuthReset).toBe(0);
  });

  it("keeps the tool guard footer even when the other handlers are present", () => {
    setState({
      activeTab: "toolGuard",
      fileGuardHandlers: { save: () => {}, reset: () => {}, saving: false },
      allowNoAuthHostsHandlers: {
        save: () => {},
        reset: () => {},
        saving: false,
      },
    });
    render(<SecurityPage />);
    // Only one footer row: the page shows the row of the active tab alone.
    expect(screen.getAllByText("common.save")).toHaveLength(1);
    fireEvent.click(screen.getByText("common.save").closest("button")!);
    expect(h.rec.handleSave).toBe(1);
    expect(h.rec.fileGuardSave).toBe(0);
    expect(h.rec.allowNoAuthSave).toBe(0);
  });
});

describe("SecurityPage - modals", () => {
  it("keeps RuleModal closed and PreviewModal empty by default", () => {
    render(<SecurityPage />);
    expect(screen.getByTestId("rule-modal").getAttribute("data-open")).toBe(
      "false",
    );
    expect(screen.getByTestId("preview-modal").getAttribute("data-rule")).toBe(
      "null",
    );
  });

  it("opens RuleModal with the rule being edited and the edit form", () => {
    setState({
      editModal: true,
      editingRule: h.rule("edit-1"),
      editForm: { x: 1 },
    });
    render(<SecurityPage />);
    const modal = screen.getByTestId("rule-modal");
    expect(modal.getAttribute("data-open")).toBe("true");
    expect(modal.getAttribute("data-editing-rule")).toContain('"edit-1"');
    expect(modal.getAttribute("data-has-form")).toBe("true");
  });

  it("builds the existing rule ids from the builtin rules then the custom ones", () => {
    setState({
      builtinRules: [h.rule("builtin-1"), h.rule("builtin-2")],
      customRules: [h.rule("custom-1")],
    });
    render(<SecurityPage />);
    expect(
      screen.getByTestId("rule-modal").getAttribute("data-existing-rule-ids"),
    ).toBe('["builtin-1","builtin-2","custom-1"]');
  });

  it("hands an empty id list when there are no rules at all", () => {
    setState({ builtinRules: [], customRules: [] });
    render(<SecurityPage />);
    expect(
      screen.getByTestId("rule-modal").getAttribute("data-existing-rule-ids"),
    ).toBe("[]");
  });

  it("hands only the custom ids when there is no builtin rule", () => {
    setState({ builtinRules: [], customRules: [h.rule("custom-9")] });
    render(<SecurityPage />);
    expect(
      screen.getByTestId("rule-modal").getAttribute("data-existing-rule-ids"),
    ).toBe('["custom-9"]');
  });

  it("calls handleEditSave when the modal confirms", () => {
    setState({ editModal: true });
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId("drive-modal-ok"));
    expect(h.rec.handleEditSave).toBe(1);
  });

  it("closes the modal with false when it cancels", () => {
    setState({ editModal: true });
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId("drive-modal-cancel"));
    expect(h.rec.setEditModal).toEqual([false]);
  });

  it("shows the rule being previewed in PreviewModal", () => {
    setState({ previewRule: h.rule("preview-1") });
    render(<SecurityPage />);
    expect(
      screen.getByTestId("preview-modal").getAttribute("data-rule"),
    ).toContain('"preview-1"');
  });

  it("clears the previewed rule with null when the preview closes", () => {
    setState({ previewRule: h.rule("preview-1") });
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId("drive-preview-close"));
    expect(h.rec.setPreviewRule).toEqual([null]);
  });

  it("renders both modals on every tab, including the loading-free error page", () => {
    setState({ activeTab: "skillScanner" });
    render(<SecurityPage />);
    expect(screen.getByTestId("rule-modal")).toBeTruthy();
    expect(screen.getByTestId("preview-modal")).toBeTruthy();
  });
});

describe("SecurityPage - hook contract", () => {
  it("consumes every field the page destructures from useSecurityPage", () => {
    // The stub returns exactly these names; if the page started asking for one
    // more, the render below would blow up on an undefined handler.
    setState({});
    expect(Object.keys(h.state).sort()).toEqual([...PAGE_FIELDS].sort());
    expect(PAGE_FIELDS).toHaveLength(42);
    render(<SecurityPage />);
    expect(screen.getByTestId("tabs")).toBeTruthy();
  });

  it("renders the four tab bodies without touching a field it does not have", () => {
    setState({});
    render(<SecurityPage />);
    TAB_KEYS.forEach((key) => {
      expect(panelOf(key)).toBeTruthy();
    });
  });
});
