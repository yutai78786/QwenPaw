/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RuleModal - the add/edit dialog for a custom tool-guard rule: what it writes
 * into the antd form when it opens (the six defaults for a new rule versus the
 * rule being edited with its two pattern arrays flattened to newline text),
 * what it leaves alone while closed, the title switch, the dialog props handed
 * to Modal, the disabled id field while editing, the duplicate-id validator
 * with its three escapes, and the nine fields with their options, placeholders
 * and tooltips.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub exports Modal, Form and Input but NOT Select
 *   (measured: HAS_DESIGN_Modal=true HAS_DESIGN_Form=true HAS_DESIGN_Input=true
 *   HAS_DESIGN_Select=false), so `@agentscope-ai/design` is overridden here,
 *   which src/test/design-mock.ts:4 authorises.
 * - No icon is imported by this component at all, so no icon library is mocked.
 * - The form instance is a spy, not a real antd one: the component only calls
 *   `setFieldsValue` and `resetFields` on it, so asserting the payloads is a
 *   contract assertion about what the product hands to the form.
 * - The stub Form.Item records the props the product gave it (name, label,
 *   rules, tooltip) into `h.captured`, so the duplicate-id validator the
 *   product wrote can be invoked directly and its three branches really run.
 * - The stub Modal renders its children only while `open` is true, which is
 *   what the real one does under `destroyOnHidden`, so the closed state is a
 *   real assertion and not a stub artefact. `onOk` / `onCancel` have no DOM
 *   event of their own in a stub, so each is surfaced by an explicit driver
 *   button; no assertion reads the driver buttons themselves.
 * - Translation is a switchable stub: keys listed in `tMissing` answer with the
 *   caller's defaultValue, every other key answers with itself. That is what
 *   makes the category label fallback reachable.
 * - The patterns placeholder holds a literal backslash-n, not a newline
 *   (measured from RuleModal.tsx:158). Whether showing "\brm\b\n\bmv\b"
 *   verbatim in a placeholder is the intended wording is a product decision and
 *   is not judged here; the test only pins what the product currently passes.
 * - BUILTIN_TOOLS is asserted as measured from the product, including that
 *   "browser" appears twice (13 entries, 12 unique): the source marks the
 *   second one as the deprecated browser to be removed together with the
 *   backend deprecated_browser/ directory, so this test documents the list as
 *   it currently stands and passes or fails only when the list changes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  tMissing: new Set<string>(),
  captured: {} as Record<string, any>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      h.tMissing.has(key) ? opts?.defaultValue ?? "" : key,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Modal = ({
    children,
    title,
    open,
    onOk,
    onCancel,
    okText,
    cancelText,
    width,
    destroyOnHidden,
  }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "rule-modal",
        "data-open": String(Boolean(open)),
        "data-width": String(width),
        "data-destroy-on-hidden": String(Boolean(destroyOnHidden)),
        "data-ok-text": String(okText),
        "data-cancel-text": String(cancelText),
      },
      React.createElement("div", { "data-testid": "modal-title" }, title),
      // Driver buttons: Modal.onOk / onCancel belong to the dialog footer,
      // which a stub does not render as real buttons.
      React.createElement("button", {
        type: "button",
        "data-testid": "modal-ok",
        onClick: () => onOk?.(),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "modal-cancel",
        onClick: () => onCancel?.(),
      }),
      // The real Modal unmounts its body while hidden under destroyOnHidden.
      open ? children : null,
    );

  const Item = ({ children, name, label, rules, tooltip }: any) => {
    if (name) {
      h.captured[name] = { name, label, rules, tooltip };
    }
    return React.createElement(
      "div",
      {
        "data-testid": "form-item",
        "data-name": String(name ?? ""),
        "data-label": typeof label === "string" ? label : "",
        "data-tooltip": typeof tooltip === "string" ? tooltip : "",
        "data-required": String(
          Boolean((rules as any[] | undefined)?.some((r) => r?.required)),
        ),
      },
      children,
    );
  };
  const Form = ({ children, form, layout, style }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "rule-form",
        "data-layout": String(layout),
        "data-has-form-instance": String(form !== undefined && form !== null),
        style,
      },
      children,
    );
  Form.Item = Item;

  const InputBase = ({ placeholder, disabled, ...rest }: any) =>
    React.createElement("input", {
      "data-testid": rest["data-testid"] ?? "text-input",
      placeholder,
      disabled,
    });
  const TextArea = ({ placeholder, rows, style }: any) =>
    React.createElement("textarea", {
      "data-testid": "text-area",
      placeholder,
      rows,
      style,
    });
  const Input = InputBase as any;
  Input.TextArea = TextArea;

  const Select = ({ mode, options, placeholder, allowClear }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "select",
        "data-mode": String(mode),
        "data-allow-clear": String(Boolean(allowClear)),
        "data-placeholder": String(placeholder ?? ""),
        "data-has-options": String(options !== undefined && options !== null),
        "data-option-count": String(options ? (options as any[]).length : 0),
      },
      (options as any[] | undefined)?.map((opt, i) =>
        React.createElement(
          "span",
          {
            key: `${String(opt.value)}-${i}`,
            "data-testid": "select-option",
            "data-value": String(opt.value),
          },
          opt.label,
        ),
      ) ?? null,
    );

  return { Modal, Form, Input, Select };
});

import { RuleModal } from "./RuleModal";
import type { ToolGuardRule } from "../../../../api/modules/security";

function editingRule(overrides: Partial<ToolGuardRule> = {}): ToolGuardRule {
  return {
    id: "TOOL_CMD_EXISTING",
    tools: ["execute_shell_command", "browser"],
    params: ["command"],
    category: "command_injection",
    severity: "HIGH",
    patterns: ["\\brm\\b", "\\bmv\\b"],
    exclude_patterns: ["^#", "^//"],
    description: "existing rule",
    remediation: "use trash",
    ...overrides,
  };
}

function makeForm() {
  return {
    setFieldsValue: vi.fn(),
    resetFields: vi.fn(),
    // Present so that a mistaken real-antd usage would surface instead of throwing.
    getFieldsValue: vi.fn(() => ({})),
  } as any;
}

type Rendered = ReturnType<typeof render>;

function renderModal(
  opts: {
    open?: boolean;
    editingRule?: ToolGuardRule | null;
    existingRuleIds?: string[];
    form?: any;
  } = {},
): {
  view: Rendered;
  form: any;
  onOk: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const form = opts.form ?? makeForm();
  const onOk = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <RuleModal
      open={opts.open ?? true}
      editingRule={opts.editingRule ?? null}
      existingRuleIds={opts.existingRuleIds ?? []}
      onOk={onOk}
      onCancel={onCancel}
      form={form}
    />,
  );
  return { view, form, onOk, onCancel };
}

function itemByName(name: string) {
  const found = screen
    .queryAllByTestId("form-item")
    .filter((n) => n.getAttribute("data-name") === name);
  expect(found).toHaveLength(1);
  return found[0];
}

function selectOf(name: string) {
  return within(itemByName(name)).getByTestId("select");
}

function validatorFor(name: string): (a: unknown, b: unknown) => Promise<void> {
  const rules = (h.captured[name]?.rules ?? []) as any[];
  const withValidator = rules.filter((r) => typeof r?.validator === "function");
  expect(withValidator).toHaveLength(1);
  return withValidator[0].validator;
}

beforeEach(() => {
  h.tMissing = new Set<string>();
  h.captured = {};
});

describe("opening the dialog", () => {
  it("leaves the form alone while the dialog is closed", () => {
    const { form } = renderModal({ open: false });
    expect(form.resetFields).not.toHaveBeenCalled();
    expect(form.setFieldsValue).not.toHaveBeenCalled();
  });

  it("renders no field while the dialog is closed", () => {
    renderModal({ open: false });
    expect(screen.getByTestId("rule-modal").getAttribute("data-open")).toBe(
      "false",
    );
    expect(screen.queryAllByTestId("form-item")).toEqual([]);
    expect(screen.queryByTestId("rule-form")).toBeNull();
  });

  it("clears the form and writes the six defaults for a new rule", () => {
    const { form } = renderModal({ open: true, editingRule: null });
    expect(form.resetFields).toHaveBeenCalledTimes(1);
    expect(form.setFieldsValue).toHaveBeenCalledTimes(1);
    expect(form.setFieldsValue).toHaveBeenCalledWith({
      severity: "HIGH",
      category: "command_injection",
      tools: [],
      params: [],
      patterns: "",
      exclude_patterns: "",
    });
  });

  it("writes the edited rule with both pattern arrays flattened to newline text", () => {
    const target = editingRule();
    const { form } = renderModal({ open: true, editingRule: target });
    expect(form.setFieldsValue).toHaveBeenCalledTimes(1);
    const payload = form.setFieldsValue.mock.calls[0][0];
    expect(payload).toMatchObject({
      id: "TOOL_CMD_EXISTING",
      severity: "HIGH",
      category: "command_injection",
      description: "existing rule",
      remediation: "use trash",
      patterns: "\\brm\\b\n\\bmv\\b",
      exclude_patterns: "^#\n^//",
    });
    expect(payload.tools).toEqual(["execute_shell_command", "browser"]);
    expect(payload.params).toEqual(["command"]);
  });

  it("does not clear the form while editing an existing rule", () => {
    const { form } = renderModal({ open: true, editingRule: editingRule() });
    expect(form.resetFields).not.toHaveBeenCalled();
  });

  it("flattens a rule with no patterns at all into two empty strings", () => {
    const { form } = renderModal({
      open: true,
      editingRule: editingRule({ patterns: [], exclude_patterns: [] }),
    });
    expect(form.setFieldsValue.mock.calls[0][0]).toMatchObject({
      patterns: "",
      exclude_patterns: "",
    });
  });

  it("flattens a single pattern without adding a newline", () => {
    const { form } = renderModal({
      open: true,
      editingRule: editingRule({
        patterns: ["only-one"],
        exclude_patterns: ["one-too"],
      }),
    });
    expect(form.setFieldsValue.mock.calls[0][0]).toMatchObject({
      patterns: "only-one",
      exclude_patterns: "one-too",
    });
  });

  it("fills the form when the dialog goes from closed to open", () => {
    const form = makeForm();
    const { view } = renderModal({ open: false, form });
    expect(form.setFieldsValue).not.toHaveBeenCalled();
    view.rerender(
      <RuleModal
        open={true}
        editingRule={null}
        existingRuleIds={[]}
        onOk={vi.fn()}
        onCancel={vi.fn()}
        form={form}
      />,
    );
    expect(form.resetFields).toHaveBeenCalledTimes(1);
    expect(form.setFieldsValue).toHaveBeenCalledTimes(1);
  });

  it("writes the new rule again when the dialog closes and reopens", () => {
    const form = makeForm();
    const { view } = renderModal({ open: true, form });
    expect(form.setFieldsValue).toHaveBeenCalledTimes(1);
    view.rerender(
      <RuleModal
        open={false}
        editingRule={null}
        existingRuleIds={[]}
        onOk={vi.fn()}
        onCancel={vi.fn()}
        form={form}
      />,
    );
    expect(form.setFieldsValue).toHaveBeenCalledTimes(1);
    view.rerender(
      <RuleModal
        open={true}
        editingRule={null}
        existingRuleIds={[]}
        onOk={vi.fn()}
        onCancel={vi.fn()}
        form={form}
      />,
    );
    expect(form.setFieldsValue).toHaveBeenCalledTimes(2);
    expect(form.resetFields).toHaveBeenCalledTimes(2);
  });

  it("switches the payload when a different rule is handed in while open", () => {
    const form = makeForm();
    const first = editingRule({ id: "FIRST" });
    const { view } = renderModal({ open: true, editingRule: first, form });
    expect(form.setFieldsValue.mock.calls[0][0].id).toBe("FIRST");
    view.rerender(
      <RuleModal
        open={true}
        editingRule={editingRule({ id: "SECOND" })}
        existingRuleIds={[]}
        onOk={vi.fn()}
        onCancel={vi.fn()}
        form={form}
      />,
    );
    expect(form.setFieldsValue).toHaveBeenCalledTimes(2);
    expect(form.setFieldsValue.mock.calls[1][0].id).toBe("SECOND");
  });
});

describe("dialog chrome", () => {
  it("titles the dialog for adding when there is no rule to edit", () => {
    renderModal({ open: true, editingRule: null });
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "security.rules.addTitle",
    );
  });

  it("titles the dialog for editing when a rule is handed in", () => {
    renderModal({ open: true, editingRule: editingRule() });
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "security.rules.editTitle",
    );
  });

  it("passes the fixed width, the hidden-destroy flag and both button labels", () => {
    renderModal({ open: true });
    const modal = screen.getByTestId("rule-modal");
    expect(modal.getAttribute("data-width")).toBe("640");
    expect(modal.getAttribute("data-destroy-on-hidden")).toBe("true");
    expect(modal.getAttribute("data-ok-text")).toBe("common.confirm");
    expect(modal.getAttribute("data-cancel-text")).toBe("common.cancel");
  });

  it("hands the parent callbacks straight through to the dialog", () => {
    const { onOk, onCancel } = renderModal({ open: true });
    fireEvent.click(screen.getByTestId("modal-ok"));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("modal-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("passes the given form instance and a vertical layout to the form", () => {
    renderModal({ open: true });
    const form = screen.getByTestId("rule-form");
    expect(form.getAttribute("data-has-form-instance")).toBe("true");
    expect(form.getAttribute("data-layout")).toBe("vertical");
  });
});

describe("the nine fields", () => {
  const NAMES = [
    "id",
    "tools",
    "params",
    "severity",
    "category",
    "patterns",
    "exclude_patterns",
    "description",
    "remediation",
  ];

  it("renders every field once, in the order the product declares them", () => {
    renderModal({ open: true });
    const items = screen.queryAllByTestId("form-item");
    expect(items).toHaveLength(NAMES.length);
    expect(items.map((n) => n.getAttribute("data-name"))).toEqual(NAMES);
  });

  it("labels each field with its own catalogue key", () => {
    renderModal({ open: true });
    const expected: Record<string, string> = {
      id: "security.rules.ruleId",
      tools: "security.rules.tools",
      params: "security.rules.params",
      severity: "security.rules.severityLabel",
      category: "security.rules.categoryLabel",
      patterns: "security.rules.patterns",
      exclude_patterns: "security.rules.excludePatterns",
      description: "security.rules.descriptionLabel",
      remediation: "security.rules.remediationLabel",
    };
    for (const name of NAMES) {
      expect(itemByName(name).getAttribute("data-label")).toBe(expected[name]);
    }
  });

  it("marks only the id and the patterns fields as required", () => {
    renderModal({ open: true });
    expect(itemByName("id").getAttribute("data-required")).toBe("true");
    expect(itemByName("patterns").getAttribute("data-required")).toBe("true");
    for (const name of NAMES.filter((n) => n !== "id" && n !== "patterns")) {
      expect(itemByName(name).getAttribute("data-required")).toBe("false");
    }
  });

  it("carries the required message from the catalogue on both required fields", () => {
    renderModal({ open: true });
    const idRules = h.captured["id"].rules as any[];
    expect(idRules.find((r) => r.required)?.message).toBe(
      "security.rules.ruleIdRequired",
    );
    const patternRules = h.captured["patterns"].rules as any[];
    expect(patternRules.find((r) => r.required)?.message).toBe(
      "security.rules.patternsRequired",
    );
  });

  it("puts the two explanatory tooltips on the pattern fields only", () => {
    renderModal({ open: true });
    expect(itemByName("patterns").getAttribute("data-tooltip")).toBe(
      "security.rules.patternsTooltip",
    );
    expect(itemByName("exclude_patterns").getAttribute("data-tooltip")).toBe(
      "security.rules.excludePatternsTooltip",
    );
    for (const name of NAMES.filter(
      (n) => !n.startsWith("patterns") && n !== "exclude_patterns",
    )) {
      expect(itemByName(name).getAttribute("data-tooltip")).toBe("");
    }
  });
});

describe("the id field", () => {
  it("is editable with the example placeholder while adding", () => {
    renderModal({ open: true, editingRule: null });
    const input = within(itemByName("id")).getByTestId("text-input");
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(input.getAttribute("placeholder")).toBe("TOOL_CMD_CUSTOM_RULE");
  });

  it("is locked while editing so that the rule keeps its identity", () => {
    renderModal({ open: true, editingRule: editingRule() });
    expect(
      within(itemByName("id"))
        .getByTestId("text-input")
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("the duplicate id validator", () => {
  it("accepts an empty value and leaves the complaint to the required rule", async () => {
    renderModal({ open: true, existingRuleIds: ["SOMETHING"] });
    await expect(validatorFor("id")(null, "")).resolves.toBeUndefined();
    await expect(validatorFor("id")(null, undefined)).resolves.toBeUndefined();
  });

  it("accepts an id that no other rule uses", async () => {
    renderModal({ open: true, existingRuleIds: ["OTHER_ONE", "OTHER_TWO"] });
    await expect(
      validatorFor("id")(null, "BRAND_NEW"),
    ).resolves.toBeUndefined();
  });

  it("rejects an id that another rule already uses, with the catalogue message", async () => {
    renderModal({ open: true, existingRuleIds: ["TAKEN_ONE", "TAKEN_TWO"] });
    await expect(validatorFor("id")(null, "TAKEN_TWO")).rejects.toThrow(
      "security.rules.duplicateId",
    );
  });

  it("accepts the id of the rule being edited, since keeping it is not a duplicate", async () => {
    renderModal({
      open: true,
      editingRule: editingRule({ id: "TOOL_CMD_EXISTING" }),
      existingRuleIds: ["TOOL_CMD_EXISTING"],
    });
    await expect(
      validatorFor("id")(null, "TOOL_CMD_EXISTING"),
    ).resolves.toBeUndefined();
  });

  it("accepts any id at all while editing, because the field is locked anyway", async () => {
    renderModal({
      open: true,
      editingRule: editingRule({ id: "TOOL_CMD_EXISTING" }),
      existingRuleIds: ["WHATEVER"],
    });
    await expect(validatorFor("id")(null, "WHATEVER")).resolves.toBeUndefined();
  });

  it("accepts everything when no rule exists yet", async () => {
    renderModal({ open: true, existingRuleIds: [] });
    await expect(validatorFor("id")(null, "ANYTHING")).resolves.toBeUndefined();
  });
});

describe("the select fields", () => {
  it("offers the builtin tools as a clearable tag select", () => {
    renderModal({ open: true });
    const select = selectOf("tools");
    expect(select.getAttribute("data-mode")).toBe("tags");
    expect(select.getAttribute("data-allow-clear")).toBe("true");
    expect(select.getAttribute("data-placeholder")).toBe(
      "security.rules.toolsPlaceholder",
    );
  });

  it("lists the builtin tool names exactly as the product declares them", () => {
    renderModal({ open: true });
    const values = within(selectOf("tools"))
      .queryAllByTestId("select-option")
      .map((o) => o.getAttribute("data-value"));
    // Measured from BUILTIN_TOOLS: 13 entries in which "browser" appears twice,
    // the second one marked in the source as the deprecated browser.
    expect(values).toHaveLength(13);
    expect(values.filter((v) => v === "browser")).toHaveLength(2);
    expect(new Set(values).size).toBe(12);
    expect(values[0]).toBe("execute_shell_command");
    expect(values[values.length - 1]).toBe("send_file_to_user");
    for (const expected of [
      "execute_python_code",
      "desktop_screenshot",
      "view_image",
      "read_file",
      "write_file",
      "edit_file",
      "append_file",
      "view_text_file",
      "write_text_file",
    ]) {
      expect(values).toContain(expected);
    }
  });

  it("labels every tool option with its own name", () => {
    renderModal({ open: true });
    const options = within(selectOf("tools")).queryAllByTestId("select-option");
    for (const option of options) {
      expect(option.textContent).toBe(option.getAttribute("data-value"));
    }
  });

  it("offers free-form params with no option list at all", () => {
    renderModal({ open: true });
    const select = selectOf("params");
    expect(select.getAttribute("data-mode")).toBe("tags");
    expect(select.getAttribute("data-allow-clear")).toBe("true");
    expect(select.getAttribute("data-placeholder")).toBe(
      "security.rules.paramsPlaceholder",
    );
    expect(select.getAttribute("data-has-options")).toBe("false");
    expect(within(select).queryAllByTestId("select-option")).toEqual([]);
  });

  it("offers the five severities from critical down to info", () => {
    renderModal({ open: true });
    const select = selectOf("severity");
    expect(select.getAttribute("data-has-options")).toBe("true");
    expect(
      within(select)
        .queryAllByTestId("select-option")
        .map((o) => o.getAttribute("data-value")),
    ).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
  });

  it("offers the ten categories with their catalogue labels", () => {
    renderModal({ open: true });
    const options = within(selectOf("category")).queryAllByTestId(
      "select-option",
    );
    expect(options.map((o) => o.getAttribute("data-value"))).toEqual([
      "command_injection",
      "code_execution",
      "data_exfiltration",
      "path_traversal",
      "sensitive_file_access",
      "network_abuse",
      "credential_exposure",
      "resource_abuse",
      "privilege_escalation",
      "prompt_injection",
    ]);
    expect(options[0].textContent).toBe(
      "security.rules.categories.command_injection",
    );
  });

  it("falls back to the raw category name when the catalogue has no label", () => {
    h.tMissing.add("security.rules.categories.network_abuse");
    renderModal({ open: true });
    const options = within(selectOf("category")).queryAllByTestId(
      "select-option",
    );
    const network = options.find(
      (o) => o.getAttribute("data-value") === "network_abuse",
    );
    expect(network?.textContent).toBe("network_abuse");
    // The other nine keep their catalogue labels.
    expect(options[0].textContent).toBe(
      "security.rules.categories.command_injection",
    );
  });
});

describe("the text fields", () => {
  it("shows the pattern example, three rows and a monospace face", () => {
    renderModal({ open: true });
    const area = within(itemByName("patterns")).getByTestId("text-area");
    // Measured from the product source (RuleModal.tsx:158): the literal there is
    // "\\brm\\b\\n\\bmv\\b", so the value holds a backslash plus the letter n,
    // not a newline. Asserting it as a newline would look identical in the
    // failure output, because the reporter escapes both forms to \n.
    expect(area.getAttribute("placeholder")).toBe("\\brm\\b\\n\\bmv\\b");
    expect(area.getAttribute("rows")).toBe("3");
    expect((area as HTMLTextAreaElement).style.fontFamily).toBe("monospace");
  });

  it("shows the comment example and two rows on the exclude field", () => {
    renderModal({ open: true });
    const area = within(itemByName("exclude_patterns")).getByTestId(
      "text-area",
    );
    expect(area.getAttribute("placeholder")).toBe("^#");
    expect(area.getAttribute("rows")).toBe("2");
    expect((area as HTMLTextAreaElement).style.fontFamily).toBe("monospace");
  });

  it("gives the description and remediation fields their own placeholders", () => {
    renderModal({ open: true });
    expect(
      within(itemByName("description"))
        .getByTestId("text-input")
        .getAttribute("placeholder"),
    ).toBe("security.rules.descriptionPlaceholder");
    expect(
      within(itemByName("remediation"))
        .getByTestId("text-input")
        .getAttribute("placeholder"),
    ).toBe("security.rules.remediationPlaceholder");
  });

  it("leaves the description and remediation fields editable while editing a rule", () => {
    renderModal({ open: true, editingRule: editingRule() });
    expect(
      within(itemByName("description"))
        .getByTestId("text-input")
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      within(itemByName("remediation"))
        .getByTestId("text-input")
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
