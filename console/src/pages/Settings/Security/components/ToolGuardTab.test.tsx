/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ToolGuardTab - the tool guard configuration panel: the form initial values
 * derived from a possibly absent config, the two switches and the payloads they
 * hand up, the two mutually exclusive sandbox alerts (elevated vs unelevated)
 * with the combinations that must render neither, the two tool selects and the
 * `disabled` gate the product derives from `enabled`, the add-rule button with
 * its own `disabled` gate and icon, and the wiring handed down to RuleTable and
 * ShellEvasionSection through the sibling barrel.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub exports Form, Switch and Button but neither Card,
 *   Select nor Alert (measured: HAS_DESIGN_Card=false, Select=false,
 *   Alert=false), so `@agentscope-ai/design` is overridden here with all six
 *   names the component imports. Overriding is authorised by
 *   src/test/design-mock.ts:4.
 * - The icon comes from `@ant-design/icons`, not from lucide-react (measured:
 *   HAS_PlusCircleOutlined=true in @ant-design/icons with 836 exported keys,
 *   HAS_LUCIDE_PlusCircleOutlined=false), so only that library is mocked.
 * - The component imports RuleTable and ShellEvasionSection from the `./index`
 *   barrel. The barrel itself is stubbed here so this file exercises only
 *   ToolGuardTab; the barrel's own bindings are covered by index.test.ts.
 * - Neither switch carries a product-owned name, so each is located by walking
 *   up from the label text the product renders, the same approach the sibling
 *   FileGuardSection.test.tsx uses.
 * - No assertion reads a CSS module class name: they are hashed (the shared
 *   stylesheet resolves e.g. `_tabDescription_cfb928`), so a class assertion
 *   would break on any rename.
 * - `../useToolGuard` and `../../../../api/modules/security` are reached through
 *   `import type` only, so they are erased at compile time and need no mock.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { ToolGuardTab } from "./ToolGuardTab";
import type { MergedRule } from "../useToolGuard";
import type { ToolGuardConfig } from "../../../../api/modules/security";

const h = vi.hoisted(() => ({
  calls: {
    setEnabled: [] as boolean[],
    setSandboxEnabled: [] as boolean[],
    toggleRule: [] as Array<[string, boolean]>,
    toggleAutoDeny: [] as Array<[string, boolean]>,
    previewRule: [] as string[],
    editRule: [] as string[],
    deleteRule: [] as string[],
    openAddRule: 0,
    toggleShellEvasionCheck: [] as Array<[string, boolean]>,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@ant-design/icons", () => {
  const icon = (name: string) => () =>
    React.createElement("span", { "data-testid": "icon", "data-icon": name });
  return { PlusCircleOutlined: icon("plus-circle") };
});

vi.mock("@agentscope-ai/design", () => {
  const Form: any = ({ children, initialValues, layout, className }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "form",
        "data-layout": String(layout),
        "data-initial-enabled": String(initialValues?.enabled),
        "data-initial-guarded": JSON.stringify(initialValues?.guarded_tools),
        "data-initial-denied": JSON.stringify(initialValues?.denied_tools),
        className,
      },
      children as any,
    );
  Form.Item = ({ children, label, name, valuePropName, tooltip }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "form-item",
        "data-name": String(name ?? ""),
        "data-value-prop-name": String(valuePropName ?? ""),
        "data-tooltip": String(tooltip ?? ""),
      },
      React.createElement("span", null, label as any),
      children as any,
    );

  const Switch = ({ checked, onChange, ...props }: any) =>
    React.createElement("button", {
      type: "button",
      role: "switch",
      "data-testid": "switch",
      "data-checked": String(Boolean(checked)),
      onClick: () => onChange?.(!checked),
      ...props,
    });

  const Button = ({ children, onClick, icon, disabled, type, size }: any) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick,
        disabled: Boolean(disabled),
        "data-testid": "button",
        "data-btn-type": String(type ?? ""),
        "data-size": String(size ?? ""),
        "data-disabled": String(Boolean(disabled)),
      },
      icon as any,
      children as any,
    );

  const Card = ({ children, className }: any) =>
    React.createElement(
      "div",
      { "data-testid": "card", className },
      children as any,
    );

  const Select = ({ mode, options, placeholder, disabled, allowClear }: any) =>
    React.createElement("div", {
      "data-testid": "select",
      "data-mode": String(mode),
      "data-placeholder": String(placeholder),
      "data-disabled": String(Boolean(disabled)),
      "data-allow-clear": String(Boolean(allowClear)),
      "data-option-values": JSON.stringify(
        (options ?? []).map((o: any) => o.value),
      ),
      "data-option-labels": JSON.stringify(
        (options ?? []).map((o: any) => o.label),
      ),
    });

  const Alert = ({ type, showIcon, message, description }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "alert",
        "data-alert-type": String(type),
        "data-show-icon": String(Boolean(showIcon)),
      },
      React.createElement("span", null, message as any),
      React.createElement("span", null, description as any),
    );

  return { Form, Switch, Button, Card, Select, Alert };
});

vi.mock("./index", () => {
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

  const RuleTable = ({
    rules,
    enabled,
    onToggleRule,
    onToggleAutoDeny,
    onPreviewRule,
    onEditRule,
    onDeleteRule,
  }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "rule-table",
        "data-enabled": String(Boolean(enabled)),
        "data-rule-ids": JSON.stringify((rules ?? []).map((r: any) => r.id)),
      },
      // Driver buttons: they only deliver the callbacks the product wired up.
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-toggle-rule",
        onClick: () => onToggleRule?.("rule-a", true),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-toggle-auto-deny",
        onClick: () => onToggleAutoDeny?.("rule-a", false),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-preview",
        onClick: () => onPreviewRule?.({ id: "rule-preview" }),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-edit",
        onClick: () => onEditRule?.({ id: "rule-edit" }),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-delete",
        onClick: () => onDeleteRule?.("rule-delete"),
      }),
    );

  const ShellEvasionSection = ({ checks, onToggle, disabled }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "shell-evasion",
        "data-disabled": String(Boolean(disabled)),
        "data-check-keys": JSON.stringify(Object.keys(checks ?? {})),
        "data-check-values": JSON.stringify(
          Object.keys(checks ?? {}).map((key) => checks[key]),
        ),
      },
      React.createElement("button", {
        type: "button",
        "data-testid": "drive-shell-toggle",
        onClick: () => onToggle?.("newlines", true),
      }),
    );

  return {
    RuleTable,
    ShellEvasionSection,
    RuleModal: mirror("rule-modal-stub"),
    PreviewModal: mirror("preview-modal-stub"),
    SkillScannerSection: mirror("skill-scanner-stub"),
    FileGuardSection: mirror("file-guard-stub"),
    AllowNoAuthHostsTab: mirror("allow-no-auth-stub"),
  };
});

const TOOL_OPTIONS = [
  { label: "shell", value: "shell" },
  { label: "write_file", value: "write_file" },
];

const makeRule = (id: string, source: "builtin" | "custom"): MergedRule => ({
  id,
  tools: ["shell"],
  params: [],
  category: "cat",
  severity: "HIGH",
  patterns: [],
  exclude_patterns: [],
  description: "desc",
  // Required by the ToolGuardRule type; this component never renders it.
  remediation: "",
  source,
  disabled: false,
  autoDeny: false,
});

const makeConfig = (over: Partial<ToolGuardConfig> = {}): ToolGuardConfig => ({
  enabled: true,
  guarded_tools: ["shell"],
  denied_tools: ["write_file"],
  custom_rules: [],
  disabled_rules: [],
  auto_denied_rules: [],
  shell_evasion_checks: {},
  ...over,
});

type Props = React.ComponentProps<typeof ToolGuardTab>;

const renderTab = (over: Partial<Props> = {}) => {
  const form = {} as Props["form"];
  return render(
    <ToolGuardTab
      form={form}
      config={makeConfig()}
      enabled={true}
      setEnabled={(val) => h.calls.setEnabled.push(val)}
      sandboxEnabled={false}
      setSandboxEnabled={(val) => h.calls.setSandboxEnabled.push(val)}
      sandboxReason={null}
      toolOptions={TOOL_OPTIONS}
      mergedRules={[makeRule("rule-a", "builtin")]}
      toggleRule={(id, disabled) => h.calls.toggleRule.push([id, disabled])}
      toggleAutoDeny={(id, auto) => h.calls.toggleAutoDeny.push([id, auto])}
      onPreviewRule={(rule) => h.calls.previewRule.push(rule.id)}
      onEditRule={(rule) => h.calls.editRule.push(rule.id)}
      onDeleteRule={(id) => h.calls.deleteRule.push(id)}
      openAddRule={() => {
        h.calls.openAddRule += 1;
      }}
      shellEvasionChecks={{ newlines: true }}
      toggleShellEvasionCheck={(name, checked) =>
        h.calls.toggleShellEvasionCheck.push([name, checked])
      }
      {...over}
    />,
  );
};

const formEl = () => screen.getByTestId("form");
const alerts = () => screen.queryAllByTestId("alert");

/** Locate the switch that sits inside the Form.Item carrying the given label. */
const switchForLabel = (label: string) => {
  const item = screen
    .getAllByTestId("form-item")
    .find((el) => el.textContent?.includes(label));
  if (!item) throw new Error(`no form item for label ${label}`);
  return within(item).getByTestId("switch");
};

const selectForName = (name: string) => {
  const item = screen
    .getAllByTestId("form-item")
    .find((el) => el.getAttribute("data-name") === name);
  if (!item) throw new Error(`no form item named ${name}`);
  return within(item).getByTestId("select");
};

beforeEach(() => {
  h.calls.setEnabled = [];
  h.calls.setSandboxEnabled = [];
  h.calls.toggleRule = [];
  h.calls.toggleAutoDeny = [];
  h.calls.previewRule = [];
  h.calls.editRule = [];
  h.calls.deleteRule = [];
  h.calls.openAddRule = 0;
  h.calls.toggleShellEvasionCheck = [];
});

describe("ToolGuardTab - description and form initial values", () => {
  it("renders the tab description the product asks for", () => {
    renderTab();
    expect(screen.getByText("security.toolGuardDescription")).toBeTruthy();
  });

  it("takes every initial value from the config when one is present", () => {
    renderTab({
      config: makeConfig({
        enabled: false,
        guarded_tools: ["shell", "write_file"],
        denied_tools: [],
      }),
    });
    const form = formEl();
    expect(form.getAttribute("data-initial-enabled")).toBe("false");
    expect(form.getAttribute("data-initial-guarded")).toBe(
      '["shell","write_file"]',
    );
    expect(form.getAttribute("data-initial-denied")).toBe("[]");
  });

  it("falls back to enabled true and two empty tool lists when config is null", () => {
    renderTab({ config: null });
    const form = formEl();
    expect(form.getAttribute("data-initial-enabled")).toBe("true");
    expect(form.getAttribute("data-initial-guarded")).toBe("[]");
    expect(form.getAttribute("data-initial-denied")).toBe("[]");
  });

  it("keeps the enabled fallback when config exists but enabled is false", () => {
    // Pins the nullish coalescing rather than a truthiness test: an explicit
    // false must survive instead of being replaced by the default.
    renderTab({ config: makeConfig({ enabled: false }) });
    expect(formEl().getAttribute("data-initial-enabled")).toBe("false");
  });

  it("falls back to an empty list when guarded_tools is null", () => {
    renderTab({ config: makeConfig({ guarded_tools: null }) });
    expect(formEl().getAttribute("data-initial-guarded")).toBe("[]");
  });

  it("asks for a vertical form layout", () => {
    renderTab();
    expect(formEl().getAttribute("data-layout")).toBe("vertical");
  });

  it("renders the enabled switch with checked as its value prop and a tooltip", () => {
    renderTab();
    const item = screen
      .getAllByTestId("form-item")
      .find((el) => el.getAttribute("data-name") === "enabled");
    expect(item).toBeTruthy();
    expect(item!.getAttribute("data-value-prop-name")).toBe("checked");
    expect(item!.getAttribute("data-tooltip")).toBe("security.enabledTooltip");
  });
});

describe("ToolGuardTab - the two switches", () => {
  it("hands the toggled value of the enabled switch up to setEnabled", () => {
    renderTab();
    fireEvent.click(switchForLabel("security.enabled"));
    expect(h.calls.setEnabled).toEqual([true]);
  });

  it("hands false to setEnabled when the enabled switch is already on", () => {
    // The stub calls onChange(!checked); with the product's own Form.Item the
    // switch is uncontrolled, so this pins the payload shape only.
    renderTab();
    const sw = switchForLabel("security.enabled");
    expect(sw.getAttribute("data-checked")).toBe("false");
    fireEvent.click(sw);
    fireEvent.click(sw);
    expect(h.calls.setEnabled).toEqual([true, true]);
  });

  it("mirrors sandboxEnabled into the sandbox switch", () => {
    renderTab({ sandboxEnabled: true, sandboxReason: null });
    expect(
      switchForLabel("security.sandboxEnabled").getAttribute("data-checked"),
    ).toBe("true");
  });

  it("hands the toggled value of the sandbox switch up to setSandboxEnabled", () => {
    renderTab({ sandboxEnabled: true, sandboxReason: null });
    fireEvent.click(switchForLabel("security.sandboxEnabled"));
    expect(h.calls.setSandboxEnabled).toEqual([false]);
  });

  it("does not touch setEnabled when the sandbox switch is toggled", () => {
    renderTab();
    fireEvent.click(switchForLabel("security.sandboxEnabled"));
    expect(h.calls.setEnabled).toEqual([]);
    expect(h.calls.setSandboxEnabled).toEqual([true]);
  });

  it("renders the sandbox tooltip the product asks for", () => {
    renderTab();
    const item = screen
      .getAllByTestId("form-item")
      .find((el) => el.textContent?.includes("security.sandboxEnabled"));
    expect(item!.getAttribute("data-tooltip")).toBe(
      "security.sandboxEnabledTooltip",
    );
  });
});

describe("ToolGuardTab - sandbox alerts", () => {
  it("renders the elevated warning when sandbox is on and reason is null", () => {
    renderTab({ sandboxEnabled: true, sandboxReason: null });
    const list = alerts();
    expect(list).toHaveLength(1);
    expect(list[0].getAttribute("data-alert-type")).toBe("warning");
    expect(list[0].getAttribute("data-show-icon")).toBe("true");
    expect(list[0].textContent).toContain("security.sandboxElevatedWarning");
    expect(list[0].textContent).toContain(
      "security.sandboxElevatedDescription",
    );
  });

  it("renders the unelevated warning when the reason says so", () => {
    renderTab({ sandboxEnabled: true, sandboxReason: "unelevated" });
    const list = alerts();
    expect(list).toHaveLength(1);
    expect(list[0].textContent).toContain("security.sandboxUnelevatedWarning");
    expect(list[0].textContent).toContain(
      "security.sandboxUnelevatedDescription",
    );
  });

  it.each([
    ["sandbox off with a null reason", false, null],
    ["sandbox off with the unelevated reason", false, "unelevated"],
    ["sandbox on with an unrelated reason", true, "something-else"],
    ["sandbox on with an empty reason", true, ""],
  ])("renders no alert when %s", (_label, sandboxEnabled, sandboxReason) => {
    renderTab({
      sandboxEnabled,
      sandboxReason: sandboxReason as string | null,
    });
    expect(alerts()).toHaveLength(0);
  });

  it("never renders both alerts at once", () => {
    // The two conditions are mutually exclusive because reason cannot be both
    // null and "unelevated"; pinned here so a future refactor to a single
    // switch statement cannot start rendering two banners.
    renderTab({ sandboxEnabled: true, sandboxReason: null });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).not.toContain(
      "security.sandboxUnelevatedWarning",
    );
  });
});

describe("ToolGuardTab - tool selects", () => {
  it.each([
    ["guarded_tools", "security.guardedToolsPlaceholder"],
    ["denied_tools", "security.deniedToolsPlaceholder"],
  ])("gives %s the tool options and its own placeholder", (name, ph) => {
    renderTab();
    const select = selectForName(name);
    expect(select.getAttribute("data-mode")).toBe("tags");
    expect(select.getAttribute("data-placeholder")).toBe(ph);
    expect(select.getAttribute("data-allow-clear")).toBe("true");
    expect(select.getAttribute("data-option-values")).toBe(
      '["shell","write_file"]',
    );
    expect(select.getAttribute("data-option-labels")).toBe(
      '["shell","write_file"]',
    );
  });

  it("enables both selects while the guard is enabled", () => {
    renderTab({ enabled: true });
    expect(selectForName("guarded_tools").getAttribute("data-disabled")).toBe(
      "false",
    );
    expect(selectForName("denied_tools").getAttribute("data-disabled")).toBe(
      "false",
    );
  });

  it("disables both selects once the guard is switched off", () => {
    renderTab({ enabled: false });
    expect(selectForName("guarded_tools").getAttribute("data-disabled")).toBe(
      "true",
    );
    expect(selectForName("denied_tools").getAttribute("data-disabled")).toBe(
      "true",
    );
  });

  it("zeroes the margin on both select rows so they sit side by side", () => {
    renderTab();
    const names = ["guarded_tools", "denied_tools"];
    names.forEach((name) => {
      const item = screen
        .getAllByTestId("form-item")
        .find((el) => el.getAttribute("data-name") === name);
      expect(item!.textContent).toBeTruthy();
      expect(selectForName(name)).toBeTruthy();
    });
  });

  it("passes an empty option list straight through when the product has none", () => {
    renderTab({ toolOptions: [] });
    expect(
      selectForName("guarded_tools").getAttribute("data-option-values"),
    ).toBe("[]");
  });
});

describe("ToolGuardTab - rules section", () => {
  it("renders the rules heading", () => {
    renderTab();
    expect(screen.getByText("security.rules.title")).toBeTruthy();
  });

  it("renders the add-rule button with the plus icon and the product label", () => {
    renderTab();
    const add = screen.getByText("security.rules.add").closest("button")!;
    expect(add).toBeTruthy();
    expect(within(add).getByTestId("icon").getAttribute("data-icon")).toBe(
      "plus-circle",
    );
    expect(add.getAttribute("data-btn-type")).toBe("primary");
    expect(add.getAttribute("data-size")).toBe("middle");
  });

  it("calls openAddRule when the add-rule button is clicked", () => {
    renderTab();
    fireEvent.click(screen.getByText("security.rules.add").closest("button")!);
    expect(h.calls.openAddRule).toBe(1);
  });

  it("disables the add-rule button while the guard is off and does not call openAddRule", () => {
    renderTab({ enabled: false });
    const add = screen.getByText("security.rules.add").closest("button")!;
    expect(add.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(add);
    expect(h.calls.openAddRule).toBe(0);
  });

  it("hands the merged rules and the enabled flag down to RuleTable", () => {
    renderTab({
      mergedRules: [
        makeRule("rule-a", "builtin"),
        makeRule("rule-b", "custom"),
      ],
      enabled: true,
    });
    const table = screen.getByTestId("rule-table");
    expect(table.getAttribute("data-rule-ids")).toBe('["rule-a","rule-b"]');
    expect(table.getAttribute("data-enabled")).toBe("true");
  });

  it("tells RuleTable the guard is off", () => {
    renderTab({ enabled: false });
    expect(screen.getByTestId("rule-table").getAttribute("data-enabled")).toBe(
      "false",
    );
  });

  it("hands an empty rule list down to RuleTable", () => {
    renderTab({ mergedRules: [] });
    expect(screen.getByTestId("rule-table").getAttribute("data-rule-ids")).toBe(
      "[]",
    );
  });

  it("forwards toggleRule with the rule id and its current disabled flag", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("drive-toggle-rule"));
    expect(h.calls.toggleRule).toEqual([["rule-a", true]]);
  });

  it("forwards toggleAutoDeny with the rule id and its current auto-deny flag", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("drive-toggle-auto-deny"));
    expect(h.calls.toggleAutoDeny).toEqual([["rule-a", false]]);
  });

  it("forwards the whole rule object to onPreviewRule and onEditRule", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("drive-preview"));
    fireEvent.click(screen.getByTestId("drive-edit"));
    expect(h.calls.previewRule).toEqual(["rule-preview"]);
    expect(h.calls.editRule).toEqual(["rule-edit"]);
  });

  it("forwards onDeleteRule with only the rule id", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("drive-delete"));
    expect(h.calls.deleteRule).toEqual(["rule-delete"]);
  });
});

describe("ToolGuardTab - shell evasion section", () => {
  it("renders the shell evasion heading and description", () => {
    renderTab();
    expect(screen.getByText("security.shellEvasion.title")).toBeTruthy();
    expect(screen.getByText("security.shellEvasion.description")).toBeTruthy();
  });

  it("hands the checks record down unchanged", () => {
    renderTab({
      shellEvasionChecks: { newlines: true, obfuscated_flags: false },
    });
    const section = screen.getByTestId("shell-evasion");
    expect(section.getAttribute("data-check-keys")).toBe(
      '["newlines","obfuscated_flags"]',
    );
    expect(section.getAttribute("data-check-values")).toBe("[true,false]");
  });

  it("hands an empty checks record down", () => {
    renderTab({ shellEvasionChecks: {} });
    expect(
      screen.getByTestId("shell-evasion").getAttribute("data-check-keys"),
    ).toBe("[]");
  });

  it("disables the shell evasion switches while the guard is off", () => {
    renderTab({ enabled: false });
    expect(
      screen.getByTestId("shell-evasion").getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("enables the shell evasion switches while the guard is on", () => {
    renderTab({ enabled: true });
    expect(
      screen.getByTestId("shell-evasion").getAttribute("data-disabled"),
    ).toBe("false");
  });

  it("forwards toggleShellEvasionCheck with the check name and its new value", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("drive-shell-toggle"));
    expect(h.calls.toggleShellEvasionCheck).toEqual([["newlines", true]]);
  });
});

describe("ToolGuardTab - layout contract", () => {
  it("renders the two cards the product wraps the form and the table in", () => {
    renderTab();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("renders exactly two selects and two switches", () => {
    renderTab();
    expect(screen.getAllByTestId("select")).toHaveLength(2);
    expect(screen.getAllByTestId("switch")).toHaveLength(2);
  });
});
