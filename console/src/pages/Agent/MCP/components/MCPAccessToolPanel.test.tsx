/**
 * MCPAccessToolPanel - the per-tool section of the MCP access policy modal,
 * rendered from MCPAccessModal.tsx:283 with the groups produced by
 * `buildMCPAccessToolGroups`.
 *
 * Why this file exists: the sibling suite MCPAccessModal.test.tsx replaces this
 * whole component with a stub (`vi.mock("./MCPAccessToolPanel", ...)`, its line
 * 154) so that policy mutations can be driven deterministically. That stub is
 * the reason this component had no coverage at all; the wiring below is
 * therefore pinned here instead.
 *
 * Visible contract under test:
 *
 *   1. one group block per tool group, in the order given, each titled with the
 *      tool name inside a Tag;
 *   2. the stale flag drives BOTH the name tag colour ("default" instead of
 *      "blue") and an extra orange tag carrying `mcp.access.stale` - a stale
 *      group is a rule or a default kept for a tool the server no longer lists,
 *      so it must be visibly marked;
 *   3. the collapsible "description & parameters" block appears exactly when
 *      there is something to show: a non-empty description, or an input schema
 *      with at least one key. Each of the two inner parts is independently
 *      gated, so a description-only tool must NOT render the schema `<pre>` and
 *      a schema-only tool must NOT render the description div;
 *   4. the schema `<pre>` holds the pretty-printed JSON of the group's own
 *      inputSchema (two-space indent), not of some other group;
 *   5. the section header, the per-group "default" label and the add-rule
 *      button carry the i18n keys the product asks for;
 *   6. picking an effect in a group's segmented control reports
 *      `setToolDefaultEffect(toolName, effect)` with THAT group's name - the
 *      closure must capture the mapped group, not groups[0];
 *   7. the add-rule button reports `addRule(toolName)` with THAT group's name;
 *   8. the rule rows of each group receive that group's own rules plus the
 *      forwarded principal options and channel source values, the
 *      `mcp.access.noRules` empty text, and `toolRuleIdentityKey` as the key
 *      function - the tool-scoped identity, because two rules that differ only
 *      by tool name must not collide.
 *
 * Harness notes (measured facts, not assumptions):
 *
 * - `MCPAccessRuleRows` is replaced with a recording stub. It has its own suite
 *   (MCPAccessRuleRows.test.tsx) and it needs a `Select` the shared design stub
 *   does not export, so rendering the real one here would only re-test that file
 *   and add stub noise. The stub records the props it is handed, which is what
 *   contract (8) asserts.
 * - `@agentscope-ai/design` is overridden with a factory (the sanctioned usage
 *   documented at the top of src/test/design-mock.ts): the shared stub renders
 *   Tag as a plain div that drops `color`, and the stale marking in contract (2)
 *   is exactly a colour difference. The factory exposes it as a data attribute
 *   so the assertion reads the value the product passed rather than a style.
 * - `MCPAccessPolicySegmented` is left REAL: it is a sibling component with its
 *   own suite, and contract (6) needs a real onChange to drive. antd's real
 *   Segmented renders each option as a radio inside a label.
 * - `../accessPolicy` is left real: `toolRuleIdentityKey` is product logic worth
 *   comparing by identity.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MCPAccessEffect,
  MCPAccessPrincipalOption,
  MCPAccessRule,
  MCPToolAccessOverride,
} from "../../../../api/types";
import type { MCPAccessToolGroup } from "../accessPolicy";
import { toolRuleIdentityKey } from "../accessPolicy";
import styles from "../index.module.less";
import { MCPAccessToolPanel } from "./MCPAccessToolPanel";

const KEY_TOOL_SECTION = "mcp.access.toolSection";
const KEY_STALE = "mcp.access.stale";
const KEY_DEFAULT = "mcp.access.default";
const KEY_ADD_RULE = "mcp.access.addRule";

/**
 * Accessible name of the add-rule button, read from a real render dump rather
 * than guessed: antd's PlusOutlined carries aria-label="plus", and the
 * accessible-name computation prepends it to the button text, so the name is
 * "plus mcp.access.addRule". This is the "name is concatenated" cause the
 * project's role-query rule warns about.
 */
const ADD_RULE_BUTTON_NAME = "plus " + KEY_ADD_RULE;
const KEY_NO_RULES = "mcp.access.noRules";
const KEY_TOOL_SCHEMA = "mcp.toolSchema";

/** Recorded props of every rendered MCPAccessRuleRows stub, in render order. */
const rowsCalls = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));

vi.mock("./MCPAccessRuleRows", () => ({
  MCPAccessRuleRows: (props: Record<string, unknown>) => {
    rowsCalls.list.push(props);
    return React.createElement("div", {
      "data-testid": "rule-rows",
      "data-rules-count": String(((props.rules as unknown[]) ?? []).length),
    });
  },
}));

vi.mock("@agentscope-ai/design", () => {
  const Tag = ({
    children,
    color,
  }: {
    children?: React.ReactNode;
    color?: string;
  }) =>
    React.createElement(
      "span",
      { "data-tag-color": String(color ?? "") },
      children as never,
    );

  const Button = ({
    children,
    icon,
    onClick,
    className,
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick, className },
      icon as never,
      children as never,
    );

  return { Tag, Button };
});

// Stable stub instance so every render sees the same object identity; `t`
// returns the key verbatim so assertions pin the i18n key the product asks for
// rather than a rewordable English sentence. defaultValue is honoured because
// some product call sites rely on it.
const i18nStub = vi.hoisted(() => ({
  t: (key: string, opts?: { defaultValue?: string }) =>
    opts && typeof opts.defaultValue === "string" ? opts.defaultValue : key,
  i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => i18nStub,
}));

/** Effect labels are caller-supplied, so the test picks unambiguous ones. */
function effectLabel(effect: MCPAccessEffect): string {
  return `effect-${effect}`;
}

const PRINCIPALS = [
  {
    source_type: "channel",
    source_value: "console",
    subject_type: "user",
    subject_value: "alice",
    label: "Alice",
    chat_id: "chat-1",
    chat_name: "Chat one",
    session_id: "sess-1",
    updated_at: null,
  },
] as MCPAccessPrincipalOption[];

const CHANNEL_SOURCES = ["console", "dingtalk"] as readonly string[];

function toolRule(
  toolName: string,
  overrides: Partial<MCPAccessRule> = {},
): MCPToolAccessOverride {
  return {
    tool_name: toolName,
    source_type: "channel",
    source_value: "console",
    subject_type: "all",
    subject_value: "",
    effect: "allow",
    ...overrides,
  };
}

function groupOf(overrides: Partial<MCPAccessToolGroup>): MCPAccessToolGroup {
  return {
    toolName: "tool_default",
    description: "",
    inputSchema: {},
    stale: false,
    defaultEffect: "ask",
    hasExplicitDefault: false,
    rules: [],
    ...overrides,
  };
}

function renderPanel(
  groups: MCPAccessToolGroup[],
  overrides: Record<string, unknown> = {},
) {
  const props = {
    groups,
    principalOptions: PRINCIPALS,
    channelSourceValues: CHANNEL_SOURCES,
    setToolDefaultEffect: vi.fn(),
    addRule: vi.fn(),
    updateRule: vi.fn(),
    setRuleEffect: vi.fn(),
    deleteRule: vi.fn(),
    effectLabel,
    ...overrides,
  };
  const utils = render(<MCPAccessToolPanel {...props} />);
  return { props, ...utils };
}

/**
 * The group block of one tool.
 *
 * CSS module class names are hashed, so the block is located structurally:
 * climb from the tool's own name tag to the nearest ancestor that contains a
 * rule-rows stub. Each group renders exactly one such stub, and no two groups
 * share an ancestor that contains only one of them, so this picks the group the
 * name tag belongs to.
 */
function blockOf(toolName: string): HTMLElement {
  const tag = screen.getByText(toolName);
  let node: HTMLElement | null = tag.parentElement;
  while (node && within(node).queryAllByTestId("rule-rows").length === 0) {
    node = node.parentElement;
  }
  expect(node, `group block of ${toolName}`).not.toBeNull();
  // The nearest such ancestor must hold exactly this group's rows, not a
  // parent wrapping every group.
  expect(within(node as HTMLElement).getAllByTestId("rule-rows")).toHaveLength(
    1,
  );
  return node as HTMLElement;
}

/** The single schema <pre> on the page; null when the block is not rendered. */
function schemaPre(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${styles.toolSchemaContent}`);
}

/** Every schema <pre> on the page, in document order. */
function allSchemaPres(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`.${styles.toolSchemaContent}`),
  );
}

/** The radio of one effect inside one group's segmented control. */
function effectRadio(block: HTMLElement, effect: MCPAccessEffect): HTMLElement {
  return within(block).getByRole("radio", { name: effectLabel(effect) });
}

beforeEach(() => {
  rowsCalls.list.length = 0;
});

describe("MCPAccessToolPanel", () => {
  it("renders the section header and no group block when there are no groups", () => {
    renderPanel([]);

    expect(screen.getByText(KEY_TOOL_SECTION)).toBeTruthy();
    expect(screen.queryAllByTestId("rule-rows")).toHaveLength(0);
  });

  it("renders one group block per group, in the given order", () => {
    renderPanel([
      groupOf({ toolName: "tool_alpha" }),
      groupOf({ toolName: "tool_beta" }),
      groupOf({ toolName: "tool_gamma" }),
    ]);

    expect(screen.getAllByTestId("rule-rows")).toHaveLength(3);
    const names = ["tool_alpha", "tool_beta", "tool_gamma"].map((name) =>
      screen.getByText(name),
    );
    // Document order check: each name tag appears after the previous one.
    for (let i = 1; i < names.length; i += 1) {
      expect(
        names[i - 1].compareDocumentPosition(names[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("shows the default label and the add-rule button once per group", () => {
    renderPanel([
      groupOf({ toolName: "tool_alpha" }),
      groupOf({ toolName: "tool_beta" }),
    ]);

    expect(screen.getAllByText(KEY_DEFAULT)).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: ADD_RULE_BUTTON_NAME }),
    ).toHaveLength(2);
  });

  it("marks a live tool with the blue name tag and no stale tag", () => {
    renderPanel([groupOf({ toolName: "tool_live", stale: false })]);

    const tag = screen.getByText("tool_live");
    expect(tag.getAttribute("data-tag-color")).toBe("blue");
    expect(screen.queryByText(KEY_STALE)).toBeNull();
  });

  it("marks a stale tool with the default name tag plus the stale tag", () => {
    renderPanel([groupOf({ toolName: "tool_gone", stale: true })]);

    const tag = screen.getByText("tool_gone");
    expect(tag.getAttribute("data-tag-color")).toBe("default");
    const staleTag = screen.getByText(KEY_STALE);
    expect(staleTag.getAttribute("data-tag-color")).toBe("orange");
  });

  it("shows both the description and the schema for a tool that has them", () => {
    const schema = { type: "object", properties: { path: { type: "string" } } };
    renderPanel([
      groupOf({
        toolName: "tool_both",
        description: "Reads a file from disk.",
        inputSchema: schema,
      }),
    ]);

    expect(screen.getByText(KEY_TOOL_SCHEMA)).toBeTruthy();
    expect(screen.getByText("Reads a file from disk.")).toBeTruthy();
    // Located through the stylesheet class the product puts on the pre: the
    // pretty-printed JSON is multi-line, which the normalising text matcher
    // does not resolve reliably, while the class is unambiguous.
    const pre = schemaPre();
    expect(pre).not.toBeNull();
    expect(pre?.tagName).toBe("PRE");
    expect(pre?.textContent).toBe(JSON.stringify(schema, null, 2));
  });

  it("shows only the schema when the description is empty", () => {
    renderPanel([
      groupOf({
        toolName: "tool_schema_only",
        description: "",
        inputSchema: { type: "object" },
      }),
    ]);

    expect(screen.getByText(KEY_TOOL_SCHEMA)).toBeTruthy();
    expect(schemaPre()?.textContent).toBe(
      JSON.stringify({ type: "object" }, null, 2),
    );
    // The description div is gated on `group.description &&`, so an empty
    // description must leave that element out entirely rather than render it
    // blank. Located through the stylesheet class the product puts on it.
    expect(
      document.querySelector(`.${styles.toolSchemaDescription}`),
    ).toBeNull();
  });

  it("shows only the description when the schema has no keys", () => {
    renderPanel([
      groupOf({
        toolName: "tool_desc_only",
        description: "No parameters.",
        inputSchema: {},
      }),
    ]);

    expect(screen.getByText(KEY_TOOL_SCHEMA)).toBeTruthy();
    expect(screen.getByText("No parameters.")).toBeTruthy();
    // Dual of the case above: the schema pre is gated on
    // `Object.keys(group.inputSchema).length > 0`, so an empty object must not
    // render a pre holding "{}".
    expect(schemaPre()).toBeNull();
    expect(allSchemaPres()).toHaveLength(0);
  });

  it("hides the collapsible block entirely for a group with neither", () => {
    renderPanel([
      groupOf({ toolName: "tool_bare", description: "", inputSchema: {} }),
    ]);

    expect(screen.queryByText(KEY_TOOL_SCHEMA)).toBeNull();
  });

  it("renders the description without a schema pre when inputSchema is missing", () => {
    // Defensive arm the product itself guards (`group.inputSchema && ...`):
    // a server payload may omit the field, and the block must then show the
    // description alone instead of throwing on Object.keys(undefined).
    const bare = groupOf({
      toolName: "tool_no_schema_field",
      description: "Schema omitted by the server.",
    }) as unknown as MCPAccessToolGroup;
    delete (bare as { inputSchema?: unknown }).inputSchema;

    renderPanel([bare]);

    expect(screen.getByText("Schema omitted by the server.")).toBeTruthy();
    expect(screen.queryByText(KEY_TOOL_SCHEMA)).toBeTruthy();
    expect(schemaPre()).toBeNull();
  });

  it("prints each group's own schema, not another group's", () => {
    renderPanel([
      groupOf({
        toolName: "tool_one",
        inputSchema: { marker: "one" },
      }),
      groupOf({
        toolName: "tool_two",
        inputSchema: { marker: "two" },
      }),
    ]);

    const printed = allSchemaPres().map((node) => node.textContent);
    expect(printed).toEqual([
      JSON.stringify({ marker: "one" }, null, 2),
      JSON.stringify({ marker: "two" }, null, 2),
    ]);
    expect(printed).not.toContain(JSON.stringify({ marker: "three" }, null, 2));
  });

  it("reports the picked effect together with the tool name it belongs to", () => {
    const { props } = renderPanel([
      groupOf({ toolName: "tool_alpha", defaultEffect: "ask" }),
      groupOf({ toolName: "tool_beta", defaultEffect: "ask" }),
    ]);

    // Drive the SECOND group: a closure capturing groups[0] would report
    // "tool_alpha" here, which is the regression this case exists to catch.
    const block = blockOf("tool_beta");
    fireEvent.click(effectRadio(block, "deny"));

    expect(props.setToolDefaultEffect).toHaveBeenCalledTimes(1);
    expect(props.setToolDefaultEffect).toHaveBeenCalledWith(
      "tool_beta",
      "deny",
    );
  });

  it("reports every other effect verbatim, and treats the selected one as a no-op", () => {
    const { props } = renderPanel([
      groupOf({ toolName: "tool_alpha", defaultEffect: "ask" }),
    ]);
    const block = blockOf("tool_alpha");

    // Two unselected effects, one after the other.
    fireEvent.click(effectRadio(block, "allow"));
    fireEvent.click(effectRadio(block, "deny"));

    expect(props.setToolDefaultEffect).toHaveBeenCalledTimes(2);
    expect(
      props.setToolDefaultEffect.mock.calls.map((call) => call[1]),
    ).toEqual(["allow", "deny"]);
    expect(
      props.setToolDefaultEffect.mock.calls.every(
        (call) => call[0] === "tool_alpha",
      ),
    ).toBe(true);

    // Then the effect the panel was rendered with. Measured behaviour, traced to
    // the sources rather than assumed: the control is fully controlled, so
    // rc-segmented keeps `checked` on the option matching the `value` prop
    // (Item: `checked: segmentedOption.value === rawValue`, and `rawValue` comes
    // from `useMergedState(..., { value })`, which returns the prop whenever it
    // is defined). A click on an already-checked radio dispatches no change
    // event, so `handleChange` - which itself has no same-value guard - is never
    // reached. Picking the effect that is already in force therefore reports
    // nothing, which is what a controlled editor should do.
    fireEvent.click(effectRadio(block, "ask"));
    expect(props.setToolDefaultEffect).toHaveBeenCalledTimes(2);
  });

  it("reports the tool name when its add-rule button is clicked", () => {
    const { props } = renderPanel([
      groupOf({ toolName: "tool_alpha" }),
      groupOf({ toolName: "tool_beta" }),
    ]);

    const buttons = screen.getAllByRole("button", {
      name: ADD_RULE_BUTTON_NAME,
    });
    fireEvent.click(buttons[1]);

    expect(props.addRule).toHaveBeenCalledTimes(1);
    expect(props.addRule).toHaveBeenCalledWith("tool_beta");
  });

  it("wires each group's rule rows with its own rules and the shared key function", () => {
    const rulesA = [toolRule("tool_alpha", { effect: "allow" })];
    const rulesB = [
      toolRule("tool_beta", { effect: "deny" }),
      toolRule("tool_beta", { subject_type: "user", subject_value: "alice" }),
    ];
    const { props } = renderPanel([
      groupOf({ toolName: "tool_alpha", rules: rulesA }),
      groupOf({ toolName: "tool_beta", rules: rulesB }),
    ]);

    expect(rowsCalls.list).toHaveLength(2);
    expect(rowsCalls.list[0].rules).toBe(rulesA);
    expect(rowsCalls.list[1].rules).toBe(rulesB);
    expect(
      screen.getAllByTestId("rule-rows")[1].getAttribute("data-rules-count"),
    ).toBe("2");

    for (const call of rowsCalls.list) {
      // Tool-scoped identity by reference: swapping in accessRuleIdentityKey
      // would let two rules that differ only by tool name collide.
      expect(call.getKey).toBe(toolRuleIdentityKey);
      expect(call.emptyText).toBe(KEY_NO_RULES);
      expect(call.principalOptions).toBe(PRINCIPALS);
      expect(call.channelSourceValues).toBe(CHANNEL_SOURCES);
      expect(call.updateRule).toBe(props.updateRule);
      expect(call.setRuleEffect).toBe(props.setRuleEffect);
      expect(call.deleteRule).toBe(props.deleteRule);
      expect(call.effectLabel).toBe(effectLabel);
    }
  });

  it("distinguishes tool rules by tool name through the key function it passes down", () => {
    renderPanel([groupOf({ toolName: "tool_alpha" })]);

    const getKey = rowsCalls.list[0].getKey as (
      rule: MCPToolAccessOverride,
    ) => string;
    const alpha = toolRule("tool_alpha");
    const beta = toolRule("tool_beta");
    expect(getKey(alpha)).not.toBe(getKey(beta));
    expect(getKey(toolRule("tool_alpha"))).toBe(getKey(alpha));
  });
});
