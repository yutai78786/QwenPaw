/**
 * MCPAccessClientPanel - the "overall access" half of the MCP access policy
 * modal, rendered from MCPAccessModal.tsx:258. It owns the policy-wide default
 * effect and the client-scoped rule list, and is the sibling of
 * MCPAccessToolPanel (which owns the per-tool half).
 *
 * Why this file exists: MCPAccessModal.test.tsx replaces this component with a
 * stub (`vi.mock("./MCPAccessClientPanel", ...)`, its line 102) to drive policy
 * mutations deterministically, which left the wiring below untested.
 *
 * Visible contract under test:
 *
 *   1. the section title, the "default" label and the add-rule button carry the
 *      i18n keys the product asks for, and the title node carries BOTH title
 *      classes the product puts on it;
 *   2. the segmented control shows `policy.default_effect` and reports any other
 *      effect through `setDefaultEffect` verbatim - note the callback takes the
 *      effect alone, with no tool name, which is exactly how it differs from the
 *      tool panel's `setToolDefaultEffect(toolName, effect)`;
 *   3. picking the effect already in force reports nothing (the control is fully
 *      controlled, so a click on the checked radio dispatches no change event);
 *   4. the add-rule button calls `addClientAccessRule` once and hands it the
 *      click event - because this panel passes the callback straight to onClick,
 *      unlike the tool panel which wraps it to forward a tool name. What matters
 *      here is that no tool name is smuggled in, since a client rule is not
 *      scoped to a tool;
 *   5. the rule rows receive `policy.client_overrides` (the same array instance),
 *      the forwarded principal options and channel source values, the
 *      `mcp.access.noClientRules` empty text, and `accessRuleIdentityKey` as the
 *      key function;
 *   6. the key function is the client-scoped one, not the tool-scoped one: two
 *      rules that differ ONLY by tool name collide under `accessRuleIdentityKey`
 *      (so they cannot both live in one client list) while they stay distinct
 *      under `toolRuleIdentityKey`. Asserting the swap would break this is what
 *      makes contract (5) discriminating rather than decorative.
 *
 * Harness notes (measured facts, not assumptions):
 *
 * - `MCPAccessRuleRows` is replaced with a recording stub: it has its own suite
 *   and needs a `Select` the shared design stub does not export. The stub
 *   records the props it is handed, which is what contracts (5) and (6) assert.
 * - `@agentscope-ai/design` is overridden with a factory (sanctioned at the top
 *   of src/test/design-mock.ts) so Button renders a genuine `<button>`.
 * - `MCPAccessPolicySegmented` is left REAL: contract (2) needs a real onChange.
 * - `../accessPolicy` is left REAL: `accessRuleIdentityKey` is product logic.
 * - The accessible name of the add-rule button is "plus mcp.access.addRule"
 *   because antd's PlusOutlined carries aria-label="plus" and the accessible
 *   name computation prepends it; read from a real render dump of the sibling
 *   MCPAccessToolPanel suite, not guessed.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MCPAccessEffect,
  MCPAccessPolicy,
  MCPAccessPrincipalOption,
  MCPAccessRule,
  MCPToolAccessOverride,
} from "../../../../api/types";
import { accessRuleIdentityKey, toolRuleIdentityKey } from "../accessPolicy";
import styles from "../index.module.less";
import { MCPAccessClientPanel } from "./MCPAccessClientPanel";

const KEY_CLIENT_SECTION = "mcp.access.clientSection";
const KEY_DEFAULT = "mcp.access.default";
const KEY_ADD_RULE = "mcp.access.addRule";
const KEY_NO_CLIENT_RULES = "mcp.access.noClientRules";
const ADD_RULE_BUTTON_NAME = "plus " + KEY_ADD_RULE;

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

  const Tag = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children as never);

  return { Button, Tag };
});

// Stable stub instance so every render sees the same object identity; `t`
// returns the key verbatim so assertions pin the i18n key the product asks for
// rather than a rewordable English sentence.
const i18nStub = vi.hoisted(() => ({
  t: (key: string, opts?: { defaultValue?: string }) =>
    opts && typeof opts.defaultValue === "string" ? opts.defaultValue : key,
  i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => i18nStub,
}));

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

function clientRule(overrides: Partial<MCPAccessRule> = {}): MCPAccessRule {
  return {
    source_type: "channel",
    source_value: "console",
    subject_type: "all",
    subject_value: "",
    effect: "allow",
    ...overrides,
  };
}

function policyOf(overrides: Partial<MCPAccessPolicy> = {}): MCPAccessPolicy {
  return {
    default_effect: "ask",
    client_overrides: [],
    tool_defaults: [],
    tool_overrides: [],
    unmanaged_rules_count: 0,
    ...overrides,
  };
}

function renderPanel(
  policy: MCPAccessPolicy,
  overrides: Record<string, unknown> = {},
) {
  const props = {
    policy,
    principalOptions: PRINCIPALS,
    channelSourceValues: CHANNEL_SOURCES,
    setDefaultEffect: vi.fn(),
    addClientAccessRule: vi.fn(),
    updateClientRule: vi.fn(),
    setClientRuleEffect: vi.fn(),
    deleteClientRule: vi.fn(),
    effectLabel,
    ...overrides,
  };
  const utils = render(<MCPAccessClientPanel {...props} />);
  return { props, ...utils };
}

function effectRadio(effect: MCPAccessEffect): HTMLElement {
  return screen.getByRole("radio", { name: effectLabel(effect) });
}

/** The section title node, located through the stylesheet classes it carries. */
function titleNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.${styles.accessSectionTitle}.${styles.accessClientTitle}`,
  );
}

beforeEach(() => {
  rowsCalls.list.length = 0;
});

describe("MCPAccessClientPanel", () => {
  it("renders the section title with both of its classes and its i18n key", () => {
    renderPanel(policyOf());

    expect(screen.getByText(KEY_CLIENT_SECTION)).toBeTruthy();
    const title = titleNode();
    expect(title, "node carrying both title classes").not.toBeNull();
    expect(title?.textContent).toBe(KEY_CLIENT_SECTION);
  });

  it("renders exactly one default label and one add-rule button", () => {
    renderPanel(policyOf());

    expect(screen.getAllByText(KEY_DEFAULT)).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: ADD_RULE_BUTTON_NAME }),
    ).toHaveLength(1);
  });

  it("shows the policy default effect as the selected option", () => {
    const { unmount } = renderPanel(policyOf({ default_effect: "deny" }));
    expect((effectRadio("deny") as HTMLInputElement).checked).toBe(true);
    expect((effectRadio("ask") as HTMLInputElement).checked).toBe(false);
    unmount();

    renderPanel(policyOf({ default_effect: "allow" }));
    expect((effectRadio("allow") as HTMLInputElement).checked).toBe(true);
    expect((effectRadio("deny") as HTMLInputElement).checked).toBe(false);
  });

  it.each([
    ["ask", "allow"],
    ["ask", "deny"],
    ["deny", "allow"],
  ])(
    "reports the picked effect alone when %s is in force and %s is clicked",
    (current, next) => {
      const { props } = renderPanel(
        policyOf({ default_effect: current as MCPAccessEffect }),
      );

      fireEvent.click(effectRadio(next as MCPAccessEffect));

      expect(props.setDefaultEffect).toHaveBeenCalledTimes(1);
      // Client-scope contract: the effect alone, no tool name - this is the
      // signature difference from the tool panel's two-argument callback.
      expect(props.setDefaultEffect).toHaveBeenCalledWith(next);
      expect(props.setDefaultEffect.mock.calls[0]).toHaveLength(1);
    },
  );

  it("reports nothing when the effect already in force is clicked", () => {
    const { props } = renderPanel(policyOf({ default_effect: "ask" }));

    // Measured behaviour, traced to the sources: the segmented control is fully
    // controlled, rc-segmented keeps `checked` on the option matching the
    // `value` prop, and a click on an already-checked radio dispatches no change
    // event, so the panel's callback is never reached.
    fireEvent.click(effectRadio("ask"));
    fireEvent.click(effectRadio("ask"));

    expect(props.setDefaultEffect).not.toHaveBeenCalled();
  });

  it("calls addClientAccessRule once, passing through the click event instead of a tool name", () => {
    const { props } = renderPanel(policyOf());

    fireEvent.click(screen.getByRole("button", { name: ADD_RULE_BUTTON_NAME }));

    expect(props.addClientAccessRule).toHaveBeenCalledTimes(1);
    const [firstArg] = props.addClientAccessRule.mock.calls[0];
    // Traced to the sources rather than assumed: this panel hands the callback
    // straight to onClick (`onClick={addClientAccessRule}`), so React's
    // synthetic event arrives as the first argument. The tool panel wraps its
    // callback instead (`onClick={() => addRule(group.toolName)}`) and therefore
    // reports a tool name. Both are correct: a client rule is not scoped to a
    // tool, and the real caller in MCPAccessModal.tsx passes a zero-parameter
    // arrow function, so the event is simply ignored.
    expect(firstArg).toBeDefined();
    expect(typeof firstArg).toBe("object");
    // The discriminating half: no tool name (or any other string) is smuggled in.
    expect(typeof firstArg).not.toBe("string");
  });

  it("renders an empty rule list when the policy has no client overrides", () => {
    renderPanel(policyOf({ client_overrides: [] }));

    expect(
      screen.getByTestId("rule-rows").getAttribute("data-rules-count"),
    ).toBe("0");
  });

  it("wires the rule rows with the policy's own client overrides and the client key function", () => {
    const overrides = [
      clientRule({ effect: "deny" }),
      clientRule({
        source_value: "dingtalk",
        subject_type: "user",
        subject_value: "alice",
      }),
    ];
    const policy = policyOf({ client_overrides: overrides });
    const { props } = renderPanel(policy);

    expect(rowsCalls.list).toHaveLength(1);
    const call = rowsCalls.list[0];
    // Same array instance the policy carries: a copy or a filtered list would
    // silently desynchronise the editor from the saved policy.
    expect(call.rules).toBe(overrides);
    expect(
      screen.getByTestId("rule-rows").getAttribute("data-rules-count"),
    ).toBe("2");

    expect(call.getKey).toBe(accessRuleIdentityKey);
    expect(call.emptyText).toBe(KEY_NO_CLIENT_RULES);
    expect(call.principalOptions).toBe(PRINCIPALS);
    expect(call.channelSourceValues).toBe(CHANNEL_SOURCES);
    expect(call.updateRule).toBe(props.updateClientRule);
    expect(call.setRuleEffect).toBe(props.setClientRuleEffect);
    expect(call.deleteRule).toBe(props.deleteClientRule);
    expect(call.effectLabel).toBe(effectLabel);
  });

  it("ignores the tool-scoped parts of the policy", () => {
    // Dual of the case above: only client_overrides may reach the rule rows. A
    // regression that fed tool_overrides here would show tool rules in the
    // overall-access editor.
    renderPanel(
      policyOf({
        client_overrides: [clientRule()],
        tool_overrides: [
          { tool_name: "tool_alpha", ...clientRule() } as MCPToolAccessOverride,
        ],
        tool_defaults: [{ tool_name: "tool_beta", effect: "deny" }],
      }),
    );

    expect(
      screen.getByTestId("rule-rows").getAttribute("data-rules-count"),
    ).toBe("1");
    expect(screen.queryByText("tool_alpha")).toBeNull();
    expect(screen.queryByText("tool_beta")).toBeNull();
  });

  it("uses a client-scoped identity: rules differing only by tool name collide here but not in the tool list", () => {
    renderPanel(policyOf());

    const getKey = rowsCalls.list[0].getKey as (rule: MCPAccessRule) => string;
    const base = clientRule();
    const sameButToolScoped = {
      tool_name: "tool_alpha",
      ...base,
    } as MCPToolAccessOverride;

    // The function handed down is the client one, so the tool name is not part
    // of the identity and the two rules are indistinguishable...
    expect(getKey(base)).toBe(getKey(sameButToolScoped));
    // ...while the tool-scoped key keeps them apart. That asymmetry is the
    // reason the two panels must not share one identity function.
    expect(toolRuleIdentityKey(sameButToolScoped)).not.toBe(
      accessRuleIdentityKey(base),
    );

    // Sanity check that the identity still discriminates real differences.
    expect(getKey(clientRule())).not.toBe(
      getKey(clientRule({ subject_type: "user", subject_value: "alice" })),
    );
    expect(getKey(clientRule({ effect: "deny" }))).toBe(getKey(base));
  });
});
