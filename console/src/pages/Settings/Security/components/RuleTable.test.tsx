/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RuleTable - the grouped tool-guard rule list of the Security page: the
 * category grouping (including the "other" bucket for a rule with no
 * category), the collapse panel label with its enabled/total counter and its
 * translated-or-derived category name, the six column renderers (id, severity
 * tag with the unknown-severity fallback, description with the i18n fallback,
 * builtin/custom source tag, the auto-deny switch, and the action cluster),
 * the disabled dimming, the way `enabled=false` disables every control, the
 * dark-theme button style, and the five callbacks handed up to the parent.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub exports neither Table nor Collapse (measured:
 *   HAS_DESIGN_Table=false HAS_DESIGN_Collapse=false, keys are IconButton,
 *   Dropdown, Button, Input, Switch, Modal, Tag, Tooltip, Form, InputNumber,
 *   Spin, Tabs), so `@agentscope-ai/design` is overridden here, which
 *   src/test/design-mock.ts:4 authorises.
 * - The three icons come from lucide-react, not from @ant-design/icons
 *   (measured: Eye / Pencil / Trash2 are objects there, 5729 keys, with
 *   NotARealIconName undefined as the negative control). They are stubbed as
 *   spans carrying data-icon, which is what tells the three action buttons
 *   apart, since the product gives the preview button no `icon` prop at all
 *   and passes Pencil / Trash2 through `icon`.
 * - `Space` comes from antd and is left as the real component (measured:
 *   antd.Space is an object), so antd is never mocked as a whole here.
 * - `useTheme` is mocked after the established pattern of the sibling tests
 *   (pages/Login/index.test.tsx:33), and `isDark` is switchable so that both
 *   arms of the dark button style really execute.
 * - No assertion reads a class name: the CSS module hashes them (measured:
 *   styles.ruleTable is "_ruleTable_cfb928", styles.ruleCollapse is
 *   "_ruleCollapse_cfb928", styles.collapseCategoryLabel is
 *   "_collapseCategoryLabel_cfb928").
 * - The stub Table invokes every column `render(value, record, index)` and
 *   keys rows through the `rowKey` the product passes ("id"), so the product
 *   cell logic really executes. It mirrors pagination / size / className as
 *   data attributes, which asserts what the product handed to Table rather
 *   than anything about the stub.
 * - The stub Collapse renders both the panel label and the panel children and
 *   mirrors defaultActiveKey, so the grouping result is observable.
 * - Translation is a switchable stub: keys listed in `tMissing` answer with
 *   the caller's defaultValue, every other key answers with itself. That is
 *   what makes both arms of `translated || record.description` and of the
 *   category label fallback reachable.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  isDark: false,
  tMissing: new Set<string>(),
  stableI18n: {
    language: "en",
    resolvedLanguage: "en",
    changeLanguage: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      h.tMissing.has(key) ? opts?.defaultValue ?? "" : key,
    i18n: h.stableI18n,
  }),
}));

vi.mock("../../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: h.isDark }),
}));

vi.mock("lucide-react", () => {
  const icon = (name: string) => () =>
    React.createElement("span", { "data-icon": name });
  return {
    Eye: icon("eye"),
    Pencil: icon("pencil"),
    Trash2: icon("trash"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Tag = ({ children, color, style }: any) =>
    React.createElement(
      "span",
      { "data-testid": "tag", "data-color": color, style },
      children,
    );
  const Switch = ({ checked, onChange, disabled, size }: any) =>
    React.createElement("button", {
      type: "button",
      role: "switch",
      "data-checked": String(Boolean(checked)),
      "data-size": String(size),
      "data-disabled": String(Boolean(disabled)),
      disabled: Boolean(disabled),
      onClick: () => onChange?.(!checked),
    });
  const Button = ({ children, onClick, disabled, icon, danger, style }: any) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "action-button",
        "data-danger": String(Boolean(danger)),
        "data-disabled": String(Boolean(disabled)),
        disabled: Boolean(disabled),
        onClick,
        // Passed through so that the dark-theme style the product computes is
        // observable as an inline colour.
        style,
      },
      icon,
      children,
    );
  const Tooltip = ({ title, children }: any) =>
    React.createElement(
      "span",
      {
        "data-testid": "tooltip",
        "data-title": typeof title === "string" ? title : "",
      },
      // The title is carried as data-title only, so that a text query finds the
      // cell content exactly once.
      children,
    );
  const Table = ({
    dataSource = [],
    columns = [],
    rowKey,
    pagination,
    size,
    className,
  }: any) => {
    const rows = dataSource as any[];
    const keyOf = (record: any, index: number) => {
      const k =
        typeof rowKey === "function" ? rowKey(record) : record?.[rowKey];
      return String(k ?? index);
    };
    return React.createElement(
      "div",
      {
        "data-testid": "rule-table",
        "data-pagination": String(pagination),
        "data-size": String(size),
        "data-class": String(className),
        "data-row-count": String(rows.length),
      },
      React.createElement(
        "div",
        { "data-testid": "table-header" },
        (columns as any[]).map((col, ci) =>
          React.createElement(
            "div",
            {
              key: String(col.key ?? col.dataIndex ?? ci),
              "data-col-key": String(col.key ?? col.dataIndex ?? ci),
            },
            col.title,
          ),
        ),
      ),
      rows.map((record, index) =>
        React.createElement(
          "div",
          { key: keyOf(record, index), "data-testid": "table-row" },
          (columns as any[]).map((col, ci) =>
            React.createElement(
              "div",
              { key: String(col.key ?? col.dataIndex ?? ci) },
              col.render
                ? col.render(
                    col.dataIndex ? record[col.dataIndex] : undefined,
                    record,
                    index,
                  )
                : null,
            ),
          ),
        ),
      ),
    );
  };
  const Collapse = ({ items = [], defaultActiveKey, className }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "rule-collapse",
        "data-default-active-key": JSON.stringify(defaultActiveKey ?? null),
        "data-panel-count": String((items as any[]).length),
        "data-class": String(className),
      },
      (items as any[]).map((panel) =>
        React.createElement(
          "div",
          { key: String(panel.key), "data-testid": "collapse-panel" },
          React.createElement(
            "div",
            {
              "data-testid": "collapse-label",
              "data-panel-key": String(panel.key),
            },
            panel.label,
          ),
          React.createElement(
            "div",
            { "data-testid": "collapse-children" },
            panel.children,
          ),
        ),
      ),
    );
  return { Table, Tag, Switch, Button, Tooltip, Collapse };
});

import { RuleTable } from "./RuleTable";
import type { MergedRule } from "../useToolGuard";

function rule(overrides: Partial<MergedRule> = {}): MergedRule {
  return {
    id: "TOOL_CMD_RM",
    tools: ["execute_shell_command"],
    params: ["command"],
    category: "command_injection",
    severity: "CRITICAL",
    patterns: ["\\brm\\b"],
    exclude_patterns: [],
    description: "Blocks rm",
    remediation: "Use trash",
    source: "builtin",
    disabled: false,
    autoDeny: false,
    ...overrides,
  };
}

type Handlers = {
  onToggleRule: ReturnType<
    typeof vi.fn<(ruleId: string, currentlyDisabled: boolean) => void>
  >;
  onToggleAutoDeny: ReturnType<
    typeof vi.fn<(ruleId: string, currentlyAutoDeny: boolean) => void>
  >;
  onPreviewRule: ReturnType<typeof vi.fn<(rule: MergedRule) => void>>;
  onEditRule: ReturnType<typeof vi.fn<(rule: MergedRule) => void>>;
  onDeleteRule: ReturnType<typeof vi.fn<(ruleId: string) => void>>;
};

function makeHandlers(): Handlers {
  return {
    onToggleRule: vi.fn(),
    onToggleAutoDeny: vi.fn(),
    onPreviewRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onEditRule: vi.fn(),
  };
}

function renderTable(
  rules: MergedRule[],
  enabled = true,
  handlers = makeHandlers(),
) {
  const view = render(
    <RuleTable
      rules={rules}
      enabled={enabled}
      onToggleRule={handlers.onToggleRule}
      onToggleAutoDeny={handlers.onToggleAutoDeny}
      onPreviewRule={handlers.onPreviewRule}
      onEditRule={handlers.onEditRule}
      onDeleteRule={handlers.onDeleteRule}
    />,
  );
  return { ...view, handlers };
}

function panels() {
  return screen.queryAllByTestId("collapse-panel");
}

function rowById(id: string) {
  const row = screen
    .queryAllByTestId("table-row")
    .find((r) => within(r).queryByText(id) !== null);
  if (!row) throw new Error(`row not found for ${id}`);
  return row;
}

function switchesIn(row: HTMLElement) {
  // The product renders the auto-deny switch before the enable switch.
  return within(row).queryAllByRole("switch");
}

function buttonsWithIcon(row: HTMLElement, iconName: string) {
  return within(row)
    .queryAllByTestId("action-button")
    .filter((b) => b.querySelector(`[data-icon="${iconName}"]`) !== null);
}

beforeEach(() => {
  h.isDark = false;
  h.tMissing = new Set<string>();
});

describe("grouping and the collapse panel", () => {
  it("renders no panel at all for an empty rule list", () => {
    renderTable([]);
    const collapse = screen.getByTestId("rule-collapse");
    expect(collapse.getAttribute("data-panel-count")).toBe("0");
    expect(collapse.getAttribute("data-default-active-key")).toBe("[]");
    expect(panels()).toEqual([]);
    expect(screen.queryByTestId("rule-table")).toBeNull();
  });

  it("renders exactly one panel for a single rule and opens it by default", () => {
    renderTable([rule({ id: "ONLY_ONE", category: "network_abuse" })]);
    expect(panels()).toHaveLength(1);
    expect(
      screen
        .getByTestId("rule-collapse")
        .getAttribute("data-default-active-key"),
    ).toBe('["network_abuse"]');
    expect(
      screen.getByTestId("rule-table").getAttribute("data-row-count"),
    ).toBe("1");
  });

  it("puts two rules of the same category into one panel counted 2/2", () => {
    renderTable([
      rule({ id: "A_ONE", category: "path_traversal" }),
      rule({ id: "A_TWO", category: "path_traversal" }),
    ]);
    expect(panels()).toHaveLength(1);
    expect(
      screen.getByTestId("rule-table").getAttribute("data-row-count"),
    ).toBe("2");
    expect(screen.getByTestId("collapse-label").textContent).toContain("2/2");
  });

  it("splits two categories into two panels, each with its own table", () => {
    renderTable([
      rule({ id: "B_ONE", category: "path_traversal" }),
      rule({ id: "B_TWO", category: "credential_exposure" }),
    ]);
    expect(panels()).toHaveLength(2);
    expect(
      screen
        .getByTestId("rule-collapse")
        .getAttribute("data-default-active-key"),
    ).toBe('["path_traversal","credential_exposure"]');
    const tables = screen.getAllByTestId("rule-table");
    expect(tables).toHaveLength(2);
    expect(tables[0].getAttribute("data-row-count")).toBe("1");
    expect(tables[1].getAttribute("data-row-count")).toBe("1");
  });

  it("counts only the enabled rules in the panel counter", () => {
    renderTable([
      rule({ id: "C_ONE", category: "resource_abuse" }),
      rule({ id: "C_TWO", category: "resource_abuse", disabled: true }),
      rule({ id: "C_THREE", category: "resource_abuse", disabled: true }),
    ]);
    expect(screen.getByTestId("collapse-label").textContent).toContain("1/3");
  });

  it("buckets a rule with an empty category under other", () => {
    renderTable([rule({ id: "D_ONE", category: "" })]);
    expect(
      screen.getByTestId("collapse-label").getAttribute("data-panel-key"),
    ).toBe("other");
    expect(
      screen
        .getByTestId("rule-collapse")
        .getAttribute("data-default-active-key"),
    ).toBe('["other"]');
  });

  it("derives a human readable label when the catalogue has no category name", () => {
    h.tMissing.add("security.rules.categories.sensitive_file_access");
    renderTable([rule({ id: "E_ONE", category: "sensitive_file_access" })]);
    expect(screen.getByTestId("collapse-label").textContent).toContain(
      "Sensitive File Access",
    );
  });

  it("prefers the translated category name over the derived one", () => {
    renderTable([rule({ id: "F_ONE", category: "prompt_injection" })]);
    expect(screen.getByTestId("collapse-label").textContent).toContain(
      "security.rules.categories.prompt_injection",
    );
  });

  it("passes the product class names and the small size through to Table and Collapse", () => {
    renderTable([rule({ id: "G_ONE" })]);
    const table = screen.getByTestId("rule-table");
    expect(table.getAttribute("data-pagination")).toBe("false");
    expect(table.getAttribute("data-size")).toBe("small");
    expect(table.getAttribute("data-class")).toMatch(/ruleTable/);
    expect(
      screen.getByTestId("rule-collapse").getAttribute("data-class"),
    ).toMatch(/ruleCollapse/);
  });
});

describe("column headers", () => {
  it("renders the six column titles the product asks for", () => {
    renderTable([rule({ id: "H_ONE" })]);
    const header = screen.getByTestId("table-header");
    // The stub renders one child per column, carrying the column key.
    const keys = Array.from(header.children).map((c) =>
      c.getAttribute("data-col-key"),
    );
    expect(keys).toEqual([
      "id",
      "severity",
      "description",
      "source",
      "autoDeny",
      "actions",
    ]);
    expect(header.textContent).toContain("security.rules.id");
    expect(header.textContent).toContain("security.rules.severity");
    expect(header.textContent).toContain("security.rules.descriptionCol");
    expect(header.textContent).toContain("security.rules.source");
    expect(header.textContent).toContain("security.rules.actions");
    // The auto-deny header is wrapped in a tooltip carrying the explanation.
    const headerTooltips = within(header).queryAllByTestId("tooltip");
    expect(headerTooltips.map((t) => t.getAttribute("data-title"))).toContain(
      "security.rules.autoDenyTooltip",
    );
  });
});

describe("id, severity and description cells", () => {
  it("shows the rule id at full opacity when the rule is enabled", () => {
    renderTable([rule({ id: "TOOL_CMD_ENABLED" })]);
    const cell = within(rowById("TOOL_CMD_ENABLED")).getByText(
      "TOOL_CMD_ENABLED",
    );
    expect(cell.style.opacity).toBe("1");
  });

  it("dims the rule id to 0.4 when the rule is disabled", () => {
    renderTable([rule({ id: "TOOL_CMD_DISABLED", disabled: true })]);
    const cell = within(rowById("TOOL_CMD_DISABLED")).getByText(
      "TOOL_CMD_DISABLED",
    );
    expect(cell.style.opacity).toBe("0.4");
  });

  it.each([
    ["CRITICAL", "red"],
    ["HIGH", "orange"],
    ["MEDIUM", "gold"],
    ["LOW", "blue"],
    ["INFO", "default"],
  ])("maps the %s severity onto the %s tag colour", (severity, color) => {
    renderTable([rule({ id: `SEV_${severity}`, severity })]);
    const row = rowById(`SEV_${severity}`);
    const tag = within(row).getAllByTestId("tag")[0];
    expect(tag.getAttribute("data-color")).toBe(color);
    expect(tag.textContent).toBe(severity);
  });

  it("falls back to the default colour for a severity outside the map", () => {
    renderTable([rule({ id: "SEV_UNKNOWN", severity: "SOMETHING_ELSE" })]);
    const tag = within(rowById("SEV_UNKNOWN")).getAllByTestId("tag")[0];
    expect(tag.getAttribute("data-color")).toBe("default");
    expect(tag.textContent).toBe("SOMETHING_ELSE");
  });

  it("dims the severity tag for a disabled rule", () => {
    renderTable([rule({ id: "SEV_DIM", severity: "LOW", disabled: true })]);
    const tag = within(rowById("SEV_DIM")).getAllByTestId("tag")[0];
    expect(tag.style.opacity).toBe("0.4");
  });

  it("prefers the translated description when the catalogue has one", () => {
    renderTable([rule({ id: "DESC_TRANSLATED", description: "raw text" })]);
    const row = rowById("DESC_TRANSLATED");
    expect(
      within(row).getByText("security.rules.descriptions.DESC_TRANSLATED"),
    ).toBeTruthy();
    expect(within(row).queryByText("raw text")).toBeNull();
    expect(
      within(row)
        .queryAllByTestId("tooltip")
        .map((t) => t.getAttribute("data-title")),
    ).toContain("security.rules.descriptions.DESC_TRANSLATED");
  });

  it("falls back to the description carried by the rule itself", () => {
    h.tMissing.add("security.rules.descriptions.DESC_RAW");
    renderTable([
      rule({ id: "DESC_RAW", description: "raw text from the rule" }),
    ]);
    const row = rowById("DESC_RAW");
    expect(within(row).getByText("raw text from the rule")).toBeTruthy();
    expect(row.textContent).not.toContain(
      "security.rules.descriptions.DESC_RAW",
    );
  });

  it("dims the description cell for a disabled rule and keeps it a block", () => {
    h.tMissing.add("security.rules.descriptions.DESC_DIM");
    renderTable([
      rule({ id: "DESC_DIM", description: "dimmed", disabled: true }),
    ]);
    const cell = within(rowById("DESC_DIM")).getByText("dimmed");
    expect(cell.style.opacity).toBe("0.4");
    expect(cell.style.display).toBe("block");
    expect(cell.style.whiteSpace).toBe("nowrap");
  });
});

describe("source cell", () => {
  it("labels a builtin rule with the grey builtin tag", () => {
    renderTable([rule({ id: "SRC_BUILTIN", source: "builtin" })]);
    const tags = within(rowById("SRC_BUILTIN")).getAllByTestId("tag");
    // A row carries two tags: the severity one and the source one.
    const sourceTag = tags.find(
      (t) => t.textContent === "security.rules.builtin",
    );
    expect(sourceTag).toBeTruthy();
    expect(sourceTag?.getAttribute("data-color")).toBe(
      "rgba(142, 140, 153, 1)",
    );
  });

  it("labels a custom rule with the green custom tag", () => {
    renderTable([rule({ id: "SRC_CUSTOM", source: "custom" })]);
    const tags = within(rowById("SRC_CUSTOM")).getAllByTestId("tag");
    const sourceTag = tags.find(
      (t) => t.textContent === "security.rules.custom",
    );
    expect(sourceTag?.getAttribute("data-color")).toBe("green");
  });

  it("dims the source tag for a disabled rule", () => {
    renderTable([rule({ id: "SRC_DIM", source: "custom", disabled: true })]);
    const tags = within(rowById("SRC_DIM")).getAllByTestId("tag");
    const sourceTag = tags.find(
      (t) => t.textContent === "security.rules.custom",
    );
    expect(sourceTag?.style.opacity).toBe("0.4");
  });
});

describe("auto-deny cell", () => {
  it("shows an off switch with the enable tooltip when auto-deny is off", () => {
    renderTable([rule({ id: "AD_OFF", autoDeny: false })]);
    const row = rowById("AD_OFF");
    const autoDenySwitch = switchesIn(row)[0];
    expect(autoDenySwitch.getAttribute("data-checked")).toBe("false");
    expect(autoDenySwitch.getAttribute("data-size")).toBe("small");
    expect(
      within(row)
        .queryAllByTestId("tooltip")
        .map((t) => t.getAttribute("data-title")),
    ).toContain("security.rules.autoDenyEnable");
  });

  it("shows an on switch with the disable tooltip when auto-deny is on", () => {
    renderTable([rule({ id: "AD_ON", autoDeny: true })]);
    const row = rowById("AD_ON");
    expect(switchesIn(row)[0].getAttribute("data-checked")).toBe("true");
    expect(
      within(row)
        .queryAllByTestId("tooltip")
        .map((t) => t.getAttribute("data-title")),
    ).toContain("security.rules.autoDenyDisable");
  });

  it("reports the rule id and the current auto-deny value when toggled", () => {
    const { handlers } = renderTable([
      rule({ id: "AD_TOGGLE", autoDeny: true }),
    ]);
    fireEvent.click(switchesIn(rowById("AD_TOGGLE"))[0]);
    expect(handlers.onToggleAutoDeny).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleAutoDeny).toHaveBeenCalledWith("AD_TOGGLE", true);
  });

  it("reports false as the current value when auto-deny was off", () => {
    const { handlers } = renderTable([
      rule({ id: "AD_TOGGLE_OFF", autoDeny: false }),
    ]);
    fireEvent.click(switchesIn(rowById("AD_TOGGLE_OFF"))[0]);
    expect(handlers.onToggleAutoDeny).toHaveBeenCalledWith(
      "AD_TOGGLE_OFF",
      false,
    );
  });

  it("disables the auto-deny switch when the whole guard is off", () => {
    renderTable([rule({ id: "AD_GUARD_OFF" })], false);
    expect(
      switchesIn(rowById("AD_GUARD_OFF"))[0].hasAttribute("disabled"),
    ).toBe(true);
  });

  it("disables the auto-deny switch for a disabled rule even while the guard is on", () => {
    renderTable([rule({ id: "AD_RULE_OFF", disabled: true })], true);
    expect(switchesIn(rowById("AD_RULE_OFF"))[0].hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("leaves the auto-deny switch usable for an enabled rule under an enabled guard", () => {
    renderTable([rule({ id: "AD_USABLE", disabled: false })], true);
    expect(switchesIn(rowById("AD_USABLE"))[0].hasAttribute("disabled")).toBe(
      false,
    );
  });
});

describe("action cell", () => {
  it("offers the disable tooltip and an on switch for an enabled rule", () => {
    renderTable([rule({ id: "ACT_ENABLED", disabled: false })]);
    const row = rowById("ACT_ENABLED");
    expect(switchesIn(row)[1].getAttribute("data-checked")).toBe("true");
    expect(
      within(row)
        .queryAllByTestId("tooltip")
        .map((t) => t.getAttribute("data-title")),
    ).toContain("security.rules.disable");
  });

  it("offers the enable tooltip and an off switch for a disabled rule", () => {
    renderTable([rule({ id: "ACT_DISABLED", disabled: true })]);
    const row = rowById("ACT_DISABLED");
    expect(switchesIn(row)[1].getAttribute("data-checked")).toBe("false");
    expect(
      within(row)
        .queryAllByTestId("tooltip")
        .map((t) => t.getAttribute("data-title")),
    ).toContain("security.rules.enable");
  });

  it("reports the rule id and the current disabled value when toggled", () => {
    const { handlers } = renderTable([
      rule({ id: "ACT_TOGGLE", disabled: true }),
    ]);
    fireEvent.click(switchesIn(rowById("ACT_TOGGLE"))[1]);
    expect(handlers.onToggleRule).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleRule).toHaveBeenCalledWith("ACT_TOGGLE", true);
  });

  it("disables the enable switch when the whole guard is off", () => {
    renderTable([rule({ id: "ACT_GUARD_OFF" })], false);
    expect(
      switchesIn(rowById("ACT_GUARD_OFF"))[1].hasAttribute("disabled"),
    ).toBe(true);
  });

  it("gives a builtin rule only the preview button", () => {
    renderTable([rule({ id: "ACT_BUILTIN", source: "builtin" })]);
    const row = rowById("ACT_BUILTIN");
    const buttons = within(row).queryAllByTestId("action-button");
    expect(buttons).toHaveLength(1);
    expect(buttonsWithIcon(row, "eye")).toHaveLength(1);
    expect(buttonsWithIcon(row, "pencil")).toHaveLength(0);
    expect(buttonsWithIcon(row, "trash")).toHaveLength(0);
  });

  it("hands the whole rule object up when preview is clicked", () => {
    const target = rule({ id: "ACT_PREVIEW", source: "builtin" });
    const { handlers } = renderTable([target]);
    fireEvent.click(buttonsWithIcon(rowById("ACT_PREVIEW"), "eye")[0]);
    expect(handlers.onPreviewRule).toHaveBeenCalledTimes(1);
    expect(handlers.onPreviewRule.mock.calls[0][0]).toMatchObject({
      id: "ACT_PREVIEW",
    });
    expect(handlers.onEditRule).not.toHaveBeenCalled();
  });

  it("gives a custom rule the edit and delete buttons but no preview", () => {
    renderTable([rule({ id: "ACT_CUSTOM", source: "custom" })]);
    const row = rowById("ACT_CUSTOM");
    const buttons = within(row).queryAllByTestId("action-button");
    expect(buttons).toHaveLength(2);
    expect(buttonsWithIcon(row, "eye")).toHaveLength(0);
    expect(buttonsWithIcon(row, "pencil")).toHaveLength(1);
    expect(buttonsWithIcon(row, "trash")).toHaveLength(1);
  });

  it("marks only the delete button as dangerous", () => {
    renderTable([rule({ id: "ACT_DANGER", source: "custom" })]);
    const row = rowById("ACT_DANGER");
    expect(buttonsWithIcon(row, "pencil")[0].getAttribute("data-danger")).toBe(
      "false",
    );
    expect(buttonsWithIcon(row, "trash")[0].getAttribute("data-danger")).toBe(
      "true",
    );
  });

  it("wraps the edit and delete buttons in their own tooltips", () => {
    renderTable([rule({ id: "ACT_TIPS", source: "custom" })]);
    const titles = within(rowById("ACT_TIPS"))
      .queryAllByTestId("tooltip")
      .map((t) => t.getAttribute("data-title"));
    expect(titles).toContain("security.rules.edit");
    expect(titles).toContain("security.rules.delete");
  });

  it("hands the whole rule object up when edit is clicked", () => {
    const { handlers } = renderTable([
      rule({ id: "ACT_EDIT", source: "custom" }),
    ]);
    fireEvent.click(buttonsWithIcon(rowById("ACT_EDIT"), "pencil")[0]);
    expect(handlers.onEditRule).toHaveBeenCalledTimes(1);
    expect(handlers.onEditRule.mock.calls[0][0]).toMatchObject({
      id: "ACT_EDIT",
    });
    expect(handlers.onDeleteRule).not.toHaveBeenCalled();
  });

  it("hands only the rule id up when delete is clicked", () => {
    const { handlers } = renderTable([
      rule({ id: "ACT_DELETE", source: "custom" }),
    ]);
    fireEvent.click(buttonsWithIcon(rowById("ACT_DELETE"), "trash")[0]);
    expect(handlers.onDeleteRule).toHaveBeenCalledTimes(1);
    expect(handlers.onDeleteRule).toHaveBeenCalledWith("ACT_DELETE");
    expect(handlers.onEditRule).not.toHaveBeenCalled();
  });

  it("disables all three action buttons when the whole guard is off", () => {
    renderTable(
      [
        rule({ id: "ACT_OFF_BUILTIN", source: "builtin" }),
        rule({ id: "ACT_OFF_CUSTOM", source: "custom" }),
      ],
      false,
    );
    for (const id of ["ACT_OFF_BUILTIN", "ACT_OFF_CUSTOM"]) {
      const buttons = within(rowById(id)).queryAllByTestId("action-button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(b.hasAttribute("disabled")).toBe(true);
    }
  });

  it("keeps the action buttons usable while the guard is on", () => {
    renderTable([rule({ id: "ACT_ON_CUSTOM", source: "custom" })], true);
    const buttons = within(rowById("ACT_ON_CUSTOM")).queryAllByTestId(
      "action-button",
    );
    for (const b of buttons) expect(b.hasAttribute("disabled")).toBe(false);
  });
});

describe("dark theme", () => {
  // The source writes the colour without spaces ("rgba(255,255,255,0.75)"), and
  // jsdom normalises a parsed CSS colour back with spaces, so the expected
  // string below is the normalised form. It still pins the product behaviour:
  // in dark mode the button receives a colour, in light mode it receives none.
  const DARK_COLOR = "rgba(255, 255, 255, 0.75)";

  it("leaves the button style untouched in light mode", () => {
    h.isDark = false;
    renderTable([rule({ id: "THEME_LIGHT", source: "builtin" })]);
    const button = buttonsWithIcon(rowById("THEME_LIGHT"), "eye")[0];
    expect(button.style.color).toBe("");
  });

  it("tints the preview button in dark mode", () => {
    h.isDark = true;
    renderTable([rule({ id: "THEME_DARK", source: "builtin" })]);
    const button = buttonsWithIcon(rowById("THEME_DARK"), "eye")[0];
    expect(button.style.color).toBe(DARK_COLOR);
  });

  it("tints the custom edit button in dark mode and leaves delete alone", () => {
    h.isDark = true;
    renderTable([rule({ id: "THEME_DARK_CUSTOM", source: "custom" })]);
    const row = rowById("THEME_DARK_CUSTOM");
    expect(buttonsWithIcon(row, "pencil")[0].style.color).toBe(DARK_COLOR);
    // The delete button receives no style prop from the product at all.
    expect(buttonsWithIcon(row, "trash")[0].style.color).toBe("");
  });
});

describe("mixed lists", () => {
  it("renders one row per rule across three categories and keeps the counters", () => {
    renderTable([
      rule({ id: "MIX_A1", category: "command_injection" }),
      rule({ id: "MIX_A2", category: "command_injection", disabled: true }),
      rule({ id: "MIX_B1", category: "code_execution", source: "custom" }),
      rule({ id: "MIX_C1", category: "", autoDeny: true }),
    ]);
    expect(panels()).toHaveLength(3);
    expect(screen.getAllByTestId("table-row")).toHaveLength(4);
    const labels = panels().map(
      (p) => within(p).getByTestId("collapse-label").textContent,
    );
    expect(labels[0]).toContain("1/2");
    expect(labels[1]).toContain("1/1");
    expect(labels[2]).toContain("1/1");
  });

  it("keeps every row of a category inside that category's own table", () => {
    renderTable([
      rule({ id: "SPLIT_IN_1", category: "network_abuse" }),
      rule({ id: "SPLIT_OUT", category: "resource_abuse" }),
      rule({ id: "SPLIT_IN_2", category: "network_abuse" }),
    ]);
    const networkPanel = panels().find(
      (p) =>
        within(p)
          .getByTestId("collapse-label")
          .getAttribute("data-panel-key") === "network_abuse",
    );
    expect(networkPanel).toBeTruthy();
    const rows = within(networkPanel as HTMLElement).queryAllByTestId(
      "table-row",
    );
    expect(rows).toHaveLength(2);
    // Exact ids only: the description cell also contains the id as part of its
    // translation key, so a substring match would hit twice.
    const ids = rows.map((r) =>
      within(r)
        .queryAllByText(/^SPLIT_(IN_1|IN_2|OUT)$/)
        .map((n) => n.textContent),
    );
    expect(ids).toEqual([["SPLIT_IN_1"], ["SPLIT_IN_2"]]);
    expect(
      within(networkPanel as HTMLElement).queryByText("SPLIT_OUT"),
    ).toBeNull();
  });

  it("groups by insertion order of the categories", () => {
    renderTable([
      rule({ id: "ORD_1", category: "data_exfiltration" }),
      rule({ id: "ORD_2", category: "code_execution" }),
      rule({ id: "ORD_3", category: "data_exfiltration" }),
    ]);
    expect(
      screen
        .getByTestId("rule-collapse")
        .getAttribute("data-default-active-key"),
    ).toBe('["data_exfiltration","code_execution"]');
  });
});
