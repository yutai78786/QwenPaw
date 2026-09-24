/**
 * MCPAccessRuleRows: the rule editor rows shared by the MCP access policy
 * modal (client overrides and tool overrides both render it). Covers the
 * empty state, the four selects per row (source type, source value, subject
 * type, effect), the two subject value editors (disabled input for "all",
 * autocomplete for "user"), the two warning rows that the real accessPolicy
 * helpers drive, the delete button, the channel label fallback table and the
 * draft re-sync of both controlled text inputs.
 *
 * The design package has no Select export in the shared stub, so this file
 * overrides the module with a factory (the sanctioned usage documented at the
 * top of src/test/design-mock.ts). The override renders one button per option
 * so a change can be driven without depending on any dropdown implementation.
 * antd AutoComplete, @ant-design/icons and ../accessPolicy are all left real:
 * the warnings and the recent-user options are product logic worth asserting.
 *
 * Plain render is used (not renderWithProviders): the rows need no router, no
 * antd App context and no approval context, matching the sibling suite
 * MCPAccessModal.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

// Honour the defaultValue option so the channel label fallback table inside
// the component is observable; keys without a defaultValue resolve to the key
// itself, which keeps label assertions readable.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts && typeof opts.defaultValue === "string" ? opts.defaultValue : key,
    i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
  }),
}));

vi.mock("@agentscope-ai/design", () => {
  // Minimal stand-in for the design Select: a container exposing the current
  // value plus one clickable button per option.
  const Select = ({
    value,
    options,
    onChange,
  }: {
    value?: unknown;
    options?: { label?: React.ReactNode; value?: unknown }[];
    onChange?: (next: unknown) => void;
  }) =>
    React.createElement(
      "div",
      { "data-select-value": String(value) },
      (options || []).map((option, index) =>
        React.createElement(
          "button",
          {
            key: `${String(option.value ?? index)}`,
            type: "button",
            onClick: () => onChange?.(option.value),
          },
          String(option.label),
        ),
      ),
    );

  // The shared stub spreads every prop onto the host input, which would leak
  // onPressEnter into the DOM; route it through keydown instead.
  const Input = ({
    onPressEnter,
    ...rest
  }: {
    onPressEnter?: () => void;
    [key: string]: unknown;
  }) =>
    React.createElement("input", {
      ...(rest as object),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          onPressEnter?.();
        }
      },
    } as never);

  const Button = ({
    children,
    icon,
    onClick,
    title,
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    title?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick, title },
      icon as never,
      children as never,
    );

  return { Select, Input, Button };
});

import { MCPAccessRuleRows } from "./MCPAccessRuleRows";
import type {
  MCPAccessPrincipalOption,
  MCPAccessRule,
} from "../../../../api/types";

const LABEL_SOURCE_TYPE = "mcp.access.sourceType";
const LABEL_SOURCE_VALUE = "mcp.access.sourceValue";
const LABEL_SUBJECT_TYPE = "mcp.access.subjectType";
const LABEL_SUBJECT_VALUE = "mcp.access.subjectValue";
const LABEL_EFFECT = "mcp.access.effectLabel";
const LABEL_ALL_CHANNELS = "mcp.access.sourceValueAllChannels";
const LABEL_CHANNEL_SOURCE = "mcp.access.source.channel";
const LABEL_SUBJECT_ALL = "mcp.access.subjectTypeOption.all";
const LABEL_SUBJECT_USER = "mcp.access.subjectTypeOption.user";
const LABEL_SUBJECT_VALUE_ALL = "mcp.access.subjectValueAll";
const LABEL_DELETE = "mcp.access.deleteRule";
const LABEL_RECENT_USER_PLACEHOLDER = "mcp.access.recentUserPlaceholder";
const LABEL_NO_RECENT_USERS = "mcp.access.noRecentUsers";
const LABEL_SOURCE_VALUE_PLACEHOLDER =
  "mcp.access.sourceValuePlaceholder.channel";
const WARN_AMBIGUOUS = "mcp.access.ambiguousUserSourceWarning";
const WARN_UNKNOWN_USER = "mcp.access.unknownUserValueWarning";

function makeRule(overrides: Partial<MCPAccessRule> = {}): MCPAccessRule {
  return {
    source_type: "channel",
    source_value: "console",
    subject_type: "all",
    subject_value: "",
    effect: "allow",
    ...overrides,
  };
}

function makePrincipal(
  overrides: Partial<MCPAccessPrincipalOption> = {},
): MCPAccessPrincipalOption {
  return {
    source_type: "channel",
    source_value: "console",
    subject_type: "user",
    subject_value: "alice",
    label: "Alice",
    chat_id: "chat-1",
    chat_name: "Chat one",
    ...overrides,
  } as MCPAccessPrincipalOption;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    channelSourceValues: ["console", "dingtalk"] as readonly string[],
    getKey: (rule: MCPAccessRule) => `${rule.source_type}:${rule.source_value}`,
    updateRule: vi.fn(),
    setRuleEffect: vi.fn(),
    deleteRule: vi.fn(),
    emptyText: "no rules yet",
    effectLabel: (effect: string) => `effect-${effect}`,
    ...overrides,
  };
}

/** Field container of a label; index selects the row when several are rendered. */
function fieldOf(labelKey: string, index = 0): HTMLElement {
  const label = screen.getAllByText(labelKey)[index];
  const field = label?.parentElement;
  if (!field) {
    throw new Error(`no field container for ${labelKey} at index ${index}`);
  }
  return field;
}

function selectedValueOf(labelKey: string, index = 0): string | null {
  return (
    fieldOf(labelKey, index)
      .querySelector("[data-select-value]")
      ?.getAttribute("data-select-value") ?? null
  );
}

function optionLabelsOf(labelKey: string, index = 0): string[] {
  return within(fieldOf(labelKey, index))
    .getAllByRole("button")
    .map((node) => node.textContent ?? "");
}

function pickOption(labelKey: string, optionLabel: string, index = 0): void {
  fireEvent.click(
    within(fieldOf(labelKey, index)).getByRole("button", { name: optionLabel }),
  );
}

/**
 * The source value text editor of a row. Scoped through its field label: a
 * user-subject row has a second enabled input (the autocomplete), so a
 * document wide index would pick the wrong one.
 */
function sourceValueTextInput(index = 0): HTMLInputElement {
  const node = fieldOf(LABEL_SOURCE_VALUE, index).querySelector("input");
  if (!node) {
    throw new Error("no text input in the source value field");
  }
  return node as HTMLInputElement;
}

function combobox(): HTMLInputElement {
  const node = document.querySelector(
    'input[role="combobox"]',
  ) as HTMLInputElement | null;
  if (!node) {
    throw new Error("no autocomplete combobox rendered");
  }
  return node;
}

/**
 * Open the autocomplete dropdown. antd opens it on mousedown: focus alone
 * leaves it closed (measured 0 options after focus, 1 after mousedown), so
 * asserting an empty option list without this would be a vacuous check.
 */
function openCombobox(): HTMLInputElement {
  const node = combobox();
  fireEvent.mouseDown(node);
  return node;
}

function placeholderText(): string | null {
  return (
    document.querySelector(".ant-select-selection-placeholder")?.textContent ??
    null
  );
}

function dropdownOptionTexts(): string[] {
  return Array.from(document.querySelectorAll(".ant-select-item-option")).map(
    (node) => node.textContent ?? "",
  );
}

function deleteButtons(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(`button[title="${LABEL_DELETE}"]`),
  ) as HTMLElement[];
}

describe("MCPAccessRuleRows empty state", () => {
  it("renders the empty text and no row controls when there are no rules", () => {
    render(<MCPAccessRuleRows {...makeProps()} rules={[]} />);

    expect(screen.getByText("no rules yet")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-select-value]")).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(0);
  });

  it("does not call getKey when the rule list is empty", () => {
    const getKey = vi.fn(() => "k");
    render(<MCPAccessRuleRows {...makeProps({ getKey })} rules={[]} />);

    expect(getKey).not.toHaveBeenCalled();
  });
});

describe("MCPAccessRuleRows source type field", () => {
  it("shows only the channel option for a channel rule", () => {
    render(<MCPAccessRuleRows {...makeProps()} rules={[makeRule()]} />);

    expect(selectedValueOf(LABEL_SOURCE_TYPE)).toBe("channel");
    expect(optionLabelsOf(LABEL_SOURCE_TYPE)).toEqual([LABEL_CHANNEL_SOURCE]);
  });

  it("keeps a non-channel source type selectable alongside channel", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_type: "plugin" })]}
      />,
    );

    expect(selectedValueOf(LABEL_SOURCE_TYPE)).toBe("plugin");
    expect(optionLabelsOf(LABEL_SOURCE_TYPE)).toEqual([
      LABEL_CHANNEL_SOURCE,
      "plugin",
    ]);
  });

  it("falls back to channel when the stored source type is empty", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_type: "" })]}
      />,
    );

    expect(selectedValueOf(LABEL_SOURCE_TYPE)).toBe("channel");
    expect(optionLabelsOf(LABEL_SOURCE_TYPE)).toEqual([LABEL_CHANNEL_SOURCE]);
  });

  it("normalises an empty source value to the wildcard when switching to channel", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule })}
        rules={[makeRule({ source_type: "plugin", source_value: "" })]}
      />,
    );

    pickOption(LABEL_SOURCE_TYPE, LABEL_CHANNEL_SOURCE);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({
      source_type: "channel",
      source_value: "*",
    });
  });

  it("keeps a concrete source value when switching to channel", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule })}
        rules={[makeRule({ source_type: "plugin", source_value: "console" })]}
      />,
    );

    pickOption(LABEL_SOURCE_TYPE, LABEL_CHANNEL_SOURCE);

    expect(updateRule.mock.calls[0][1]).toEqual({
      source_type: "channel",
      source_value: "console",
    });
  });

  it("keeps a concrete source value when switching away from channel", () => {
    const updateRule = vi.fn();
    const rule = makeRule({ source_type: "plugin", source_value: "my-plugin" });
    render(<MCPAccessRuleRows {...makeProps({ updateRule })} rules={[rule]} />);

    // "plugin" is its own option here, so picking it drives the non-channel
    // arm of the source_value ternary (the value must pass through unchanged).
    pickOption(LABEL_SOURCE_TYPE, "plugin");

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][0]).toBe(rule);
    expect(updateRule.mock.calls[0][1]).toEqual({
      source_type: "plugin",
      source_value: "my-plugin",
    });
  });
});

describe("MCPAccessRuleRows source value field", () => {
  it("offers all channels first then every configured channel for a channel rule", () => {
    render(<MCPAccessRuleRows {...makeProps()} rules={[makeRule()]} />);

    expect(selectedValueOf(LABEL_SOURCE_VALUE)).toBe("console");
    expect(optionLabelsOf(LABEL_SOURCE_VALUE)).toEqual([
      LABEL_ALL_CHANNELS,
      "Console",
      "DingTalk",
    ]);
  });

  it("selects the wildcard when the stored source value is empty", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_value: "" })]}
      />,
    );

    expect(selectedValueOf(LABEL_SOURCE_VALUE)).toBe("*");
  });

  it("commits the picked channel", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows {...makeProps({ updateRule })} rules={[makeRule()]} />,
    );

    pickOption(LABEL_SOURCE_VALUE, "DingTalk");

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ source_value: "dingtalk" });
  });

  it("commits the all-channels wildcard", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows {...makeProps({ updateRule })} rules={[makeRule()]} />,
    );

    pickOption(LABEL_SOURCE_VALUE, LABEL_ALL_CHANNELS);

    expect(updateRule.mock.calls[0][1]).toEqual({ source_value: "*" });
  });

  it("renders a free text editor instead of a select for a non-channel source", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_type: "plugin", source_value: "my-plugin" })]}
      />,
    );

    expect(
      fieldOf(LABEL_SOURCE_VALUE).querySelector("[data-select-value]"),
    ).toBeNull();
    const input = sourceValueTextInput();
    expect(input.value).toBe("my-plugin");
    expect(input.placeholder).toBe(LABEL_SOURCE_VALUE_PLACEHOLDER);
  });

  it("commits the typed source value on blur without trimming it", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule })}
        rules={[makeRule({ source_type: "plugin", source_value: "a" })]}
      />,
    );

    const input = sourceValueTextInput();
    fireEvent.change(input, { target: { value: "  padded  " } });
    expect(updateRule).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(updateRule).toHaveBeenCalledTimes(1);
    // Observed behaviour: this editor commits the raw text, unlike the
    // subject value editor which trims before committing.
    expect(updateRule.mock.calls[0][1]).toEqual({ source_value: "  padded  " });
  });

  it("commits the typed source value on Enter", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule })}
        rules={[makeRule({ source_type: "plugin", source_value: "a" })]}
      />,
    );

    const input = sourceValueTextInput();
    fireEvent.change(input, { target: { value: "entered" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ source_value: "entered" });
  });

  it("takes the typed source value back from the rule when the value changes", () => {
    const { rerender } = render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_type: "plugin", source_value: "first" })]}
      />,
    );

    const input = sourceValueTextInput();
    fireEvent.change(input, { target: { value: "typed but never committed" } });
    expect(input.value).toBe("typed but never committed");

    rerender(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ source_type: "plugin", source_value: "second" })]}
      />,
    );

    expect(sourceValueTextInput().value).toBe("second");
  });
});

describe("MCPAccessRuleRows channel labels", () => {
  it.each([
    ["console", "Console"],
    ["dingtalk", "DingTalk"],
    ["wecom", "WeCom"],
  ])(
    "uses the fallback label table for the known channel %s",
    (value, label) => {
      render(
        <MCPAccessRuleRows
          {...makeProps({ channelSourceValues: [value] as readonly string[] })}
          rules={[makeRule()]}
        />,
      );

      expect(optionLabelsOf(LABEL_SOURCE_VALUE)).toEqual([
        LABEL_ALL_CHANNELS,
        label,
      ]);
    },
  );

  it("falls back to the raw value for a channel missing from the table", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          channelSourceValues: ["custom_channel"] as readonly string[],
        })}
        rules={[makeRule()]}
      />,
    );

    expect(optionLabelsOf(LABEL_SOURCE_VALUE)).toEqual([
      LABEL_ALL_CHANNELS,
      "custom_channel",
    ]);
  });

  it("offers only the all-channels entry when no channel is configured", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ channelSourceValues: [] as readonly string[] })}
        rules={[makeRule()]}
      />,
    );

    expect(optionLabelsOf(LABEL_SOURCE_VALUE)).toEqual([LABEL_ALL_CHANNELS]);
  });
});

describe("MCPAccessRuleRows subject type field", () => {
  it("offers all and user with the stored selection", () => {
    render(<MCPAccessRuleRows {...makeProps()} rules={[makeRule()]} />);

    expect(selectedValueOf(LABEL_SUBJECT_TYPE)).toBe("all");
    expect(optionLabelsOf(LABEL_SUBJECT_TYPE)).toEqual([
      LABEL_SUBJECT_ALL,
      LABEL_SUBJECT_USER,
    ]);
  });

  it("commits the picked subject type", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows {...makeProps({ updateRule })} rules={[makeRule()]} />,
    );

    pickOption(LABEL_SUBJECT_TYPE, LABEL_SUBJECT_USER);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_type: "user" });
  });
});

describe("MCPAccessRuleRows subject value field for subject type all", () => {
  it("shows a disabled summary input instead of an editor", () => {
    render(<MCPAccessRuleRows {...makeProps()} rules={[makeRule()]} />);

    const input = fieldOf(LABEL_SUBJECT_VALUE).querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe(LABEL_SUBJECT_VALUE_ALL);
    expect(input?.disabled).toBe(true);
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
  });

  it("shows no warning rows for an all-subject rule", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [makePrincipal()],
        })}
        rules={[makeRule({ source_value: "*", subject_value: "ghost" })]}
      />,
    );

    expect(screen.queryByText(WARN_AMBIGUOUS)).toBeNull();
    expect(screen.queryByText(WARN_UNKNOWN_USER)).toBeNull();
  });
});

describe("MCPAccessRuleRows subject value field for subject type user", () => {
  it("renders the recent-user autocomplete with the stored value", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "alice" })]}
      />,
    );

    expect(combobox().value).toBe("alice");
    // A filled value hides the placeholder row entirely.
    expect(placeholderText()).toBeNull();
  });

  it("uses the recent-user placeholder when there are options", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    expect(placeholderText()).toBe(LABEL_RECENT_USER_PLACEHOLDER);
  });

  it("uses the no-recent-users placeholder when there is no option", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    expect(placeholderText()).toBe(LABEL_NO_RECENT_USERS);
  });

  it("defaults the principal list to empty when the prop is omitted", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    expect(placeholderText()).toBe(LABEL_NO_RECENT_USERS);
  });

  it("offers only the recent users of the selected source", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [
            makePrincipal({ subject_value: "alice" }),
            makePrincipal({ source_value: "dingtalk", subject_value: "bob" }),
          ],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    openCombobox();

    expect(dropdownOptionTexts()).toEqual(["alice"]);
  });

  it("offers no recent user when the source is all channels", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[
          makeRule({
            source_value: "*",
            subject_type: "user",
            subject_value: "",
          }),
        ]}
      />,
    );

    openCombobox();

    // Wildcard sources carry no scoped recent users, so the empty content
    // stands in for the option list.
    expect(dropdownOptionTexts()).toEqual([]);
    expect(
      document.querySelector(".ant-select-item-empty")?.textContent ?? null,
    ).toBe(LABEL_NO_RECENT_USERS);
    expect(placeholderText()).toBe(LABEL_NO_RECENT_USERS);
  });

  it.each([
    ["an empty user id", ""],
    ["a whitespace only user id", "   "],
    ["a tab and newline user id", "\t\n"],
  ])("does not offer a recent user with %s", (_label, subjectValue) => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          // Blank user ids are dropped before they can become options, which
          // is also why the value fallback inside filterOption never sees a
          // falsy option value. Positive control: a real id is offered below.
          principalOptions: [makePrincipal({ subject_value: subjectValue })],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    openCombobox();

    expect(dropdownOptionTexts()).toEqual([]);
  });

  it("offers a recent user whose id is a zero like string", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [makePrincipal({ subject_value: "0" })],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    openCombobox();

    expect(dropdownOptionTexts()).toEqual(["0"]);
  });

  it("filters the recent users case insensitively", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [makePrincipal({ subject_value: "alice" })],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    fireEvent.change(combobox(), { target: { value: "ALICE" } });
    expect(dropdownOptionTexts()).toEqual(["alice"]);
  });

  it("shows the no-recent-users text when nothing matches", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    const input = openCombobox();
    expect(dropdownOptionTexts()).toEqual(["alice"]);
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(dropdownOptionTexts()).toEqual([]);
    expect(
      document.querySelector(".ant-select-item-empty")?.textContent ?? null,
    ).toBe(LABEL_NO_RECENT_USERS);
  });

  it("commits the picked recent user", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({
          updateRule,
          principalOptions: [
            makePrincipal({ subject_value: "alice" }),
            makePrincipal({ subject_value: "bob" }),
          ],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    fireEvent.change(combobox(), { target: { value: "bo" } });
    fireEvent.click(document.querySelectorAll(".ant-select-item-option")[0]);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_value: "bob" });
  });

  it("trims the typed subject value before committing on blur", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule, principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    const input = combobox();
    fireEvent.change(input, { target: { value: "  padded  " } });
    expect(updateRule).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_value: "padded" });
    expect(input.value).toBe("padded");
  });

  it("trims a padded recent-user option when it is selected", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({
          updateRule,
          // The option list keeps the raw principal value, so the editor is
          // what removes the padding.
          principalOptions: [makePrincipal({ subject_value: "  spaced  " })],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    openCombobox();
    const options = document.querySelectorAll(".ant-select-item-option");
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_value: "spaced" });
  });

  it("commits the typed subject value on Enter", () => {
    const updateRule = vi.fn();
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule, principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    const input = combobox();
    fireEvent.change(input, { target: { value: "carol" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_value: "carol" });
  });

  it("takes the typed subject value back from the rule when the value changes", () => {
    const { rerender } = render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "alice" })]}
      />,
    );

    fireEvent.change(combobox(), { target: { value: "typed" } });
    expect(combobox().value).toBe("typed");

    rerender(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "bob" })]}
      />,
    );

    expect(combobox().value).toBe("bob");
  });
});

describe("MCPAccessRuleRows warning rows", () => {
  it("warns about an ambiguous user when the source is all channels", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[
          makeRule({
            source_value: "*",
            subject_type: "user",
            subject_value: "bob",
          }),
        ]}
      />,
    );

    expect(screen.getByText(WARN_AMBIGUOUS)).toBeInTheDocument();
  });

  it("warns about an unknown user when no recent user matches", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "ghost" })]}
      />,
    );

    expect(screen.getByText(WARN_UNKNOWN_USER)).toBeInTheDocument();
    expect(screen.queryByText(WARN_AMBIGUOUS)).toBeNull();
  });

  it("shows no warning for a known recent user", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "alice" })]}
      />,
    );

    expect(screen.queryByText(WARN_UNKNOWN_USER)).toBeNull();
    expect(screen.queryByText(WARN_AMBIGUOUS)).toBeNull();
  });

  it("shows no warning when the subject value is empty", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[makeRule({ subject_type: "user", subject_value: "" })]}
      />,
    );

    expect(screen.queryByText(WARN_UNKNOWN_USER)).toBeNull();
    expect(screen.queryByText(WARN_AMBIGUOUS)).toBeNull();
  });

  it("shows no unknown-user warning when no principal covers the source type", () => {
    // accessPolicy.principalOptionsCoverSourceType treats "channel" as always
    // covered (it is DEFAULT_ACCESS_SOURCE_TYPE), so suppression needs a
    // non-channel rule against channel-only principals. Measured both ways:
    // a channel rule with a foreign principal still warns.
    render(
      <MCPAccessRuleRows
        {...makeProps({ principalOptions: [makePrincipal()] })}
        rules={[
          makeRule({
            source_type: "plugin",
            source_value: "my-plugin",
            subject_type: "user",
            subject_value: "ghost",
          }),
        ]}
      />,
    );

    expect(screen.queryByText(WARN_UNKNOWN_USER)).toBeNull();
  });

  it("still warns about an unknown user for a channel rule whatever the principals are", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [makePrincipal({ source_type: "plugin" })],
        })}
        rules={[makeRule({ subject_type: "user", subject_value: "ghost" })]}
      />,
    );

    expect(screen.getByText(WARN_UNKNOWN_USER)).toBeInTheDocument();
  });

  it("never pairs the ambiguous warning with the unknown-user warning", () => {
    // ruleHasUnknownUserValue excludes ambiguous rules, so the two rows are
    // mutually exclusive; the ambiguous case is the one that can be built.
    render(
      <MCPAccessRuleRows
        {...makeProps({
          principalOptions: [makePrincipal({ subject_value: "ghost" })],
        })}
        rules={[
          makeRule({
            source_value: "*",
            subject_type: "user",
            subject_value: "ghost",
          }),
        ]}
      />,
    );

    expect(screen.getByText(WARN_AMBIGUOUS)).toBeInTheDocument();
    expect(screen.queryByText(WARN_UNKNOWN_USER)).toBeNull();
  });
});

describe("MCPAccessRuleRows effect field", () => {
  it("offers allow, ask and deny through the caller supplied labels", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule({ effect: "ask" })]}
      />,
    );

    expect(selectedValueOf(LABEL_EFFECT)).toBe("ask");
    expect(optionLabelsOf(LABEL_EFFECT)).toEqual([
      "effect-allow",
      "effect-ask",
      "effect-deny",
    ]);
  });

  it("hands the rule and the picked effect to setRuleEffect", () => {
    const setRuleEffect = vi.fn();
    const rule = makeRule();
    render(
      <MCPAccessRuleRows {...makeProps({ setRuleEffect })} rules={[rule]} />,
    );

    pickOption(LABEL_EFFECT, "effect-deny");

    expect(setRuleEffect).toHaveBeenCalledTimes(1);
    expect(setRuleEffect.mock.calls[0][0]).toBe(rule);
    expect(setRuleEffect.mock.calls[0][1]).toBe("deny");
  });
});

describe("MCPAccessRuleRows delete button", () => {
  it("renders one titled delete button per row with the delete icon", () => {
    render(
      <MCPAccessRuleRows
        {...makeProps()}
        rules={[makeRule(), makeRule({ source_value: "dingtalk" })]}
      />,
    );

    expect(deleteButtons()).toHaveLength(2);
    expect(document.querySelectorAll(".anticon-delete")).toHaveLength(2);
  });

  it("hands the row own rule to deleteRule", () => {
    const deleteRule = vi.fn();
    const first = makeRule();
    const second = makeRule({ source_value: "dingtalk" });
    render(
      <MCPAccessRuleRows
        {...makeProps({ deleteRule })}
        rules={[first, second]}
      />,
    );

    fireEvent.click(deleteButtons()[1]);

    expect(deleteRule).toHaveBeenCalledTimes(1);
    expect(deleteRule.mock.calls[0][0]).toBe(second);
  });
});

describe("MCPAccessRuleRows with several rules", () => {
  it("renders one row per rule and keys them through getKey", () => {
    const getKey = vi.fn((rule: MCPAccessRule) => rule.source_value);
    const first = makeRule({ source_value: "console", effect: "allow" });
    const second = makeRule({
      source_value: "dingtalk",
      subject_type: "user",
      subject_value: "alice",
      effect: "deny",
    });
    render(
      <MCPAccessRuleRows
        {...makeProps({ getKey, principalOptions: [makePrincipal()] })}
        rules={[first, second]}
      />,
    );

    expect(getKey).toHaveBeenCalledWith(first);
    expect(getKey).toHaveBeenCalledWith(second);
    expect(document.querySelectorAll("[data-select-value]")).toHaveLength(8);
    expect(selectedValueOf(LABEL_SOURCE_VALUE, 0)).toBe("console");
    expect(selectedValueOf(LABEL_SOURCE_VALUE, 1)).toBe("dingtalk");
    expect(selectedValueOf(LABEL_EFFECT, 1)).toBe("deny");
    expect(
      fieldOf(LABEL_SUBJECT_VALUE, 1).querySelector('input[role="combobox"]'),
    ).not.toBeNull();
  });

  it("routes each row edit to that row rule", () => {
    const updateRule = vi.fn();
    const first = makeRule({ source_value: "console" });
    const second = makeRule({ source_value: "dingtalk" });
    render(
      <MCPAccessRuleRows
        {...makeProps({ updateRule })}
        rules={[first, second]}
      />,
    );

    pickOption(LABEL_SUBJECT_TYPE, LABEL_SUBJECT_USER, 1);

    expect(updateRule).toHaveBeenCalledTimes(1);
    expect(updateRule.mock.calls[0][0]).toBe(second);
    expect(updateRule.mock.calls[0][1]).toEqual({ subject_type: "user" });
  });
});
