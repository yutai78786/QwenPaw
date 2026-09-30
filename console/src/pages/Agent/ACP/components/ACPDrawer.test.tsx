// @vitest-environment jsdom
/**
 * ACPDrawer tests - the user-visible contract of the drawer that creates and
 * edits an external ACP runner agent.
 *
 * Two halves are covered:
 *
 * 1. The exported text <-> config converters (parseArgsText / parseEnvText /
 *    stringifyArgs / stringifyEnv). They define what a user may type into the
 *    multi-line boxes and what the config ends up holding, so they are asserted
 *    on the shapes people actually type: blank lines, surrounding whitespace,
 *    values that themselves contain "=", and lines with no key at all.
 * 2. The drawer itself: which title each mode gets, what the footer offers,
 *    which field is locked in edit mode, the validation contract each field
 *    declares (required, the agent-key character set, the env line check, the
 *    buffer-limit minimum), the tool-parse-mode choices, and the docs link
 *    target per UI language.
 *
 * The shared design stub renders Drawer as nothing at all and Form as a
 * pass-through div, so this suite supplies its own Drawer, Form and Form.Item.
 * Form.Item captures the `rules` array per field name, which lets a test invoke
 * a declared validator directly instead of driving a whole real antd form; the
 * assertions below therefore check the contract the product declares rather
 * than antd's internals.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  language: "en",
  openExternalLink: vi.fn(),
  onFinishRef: { current: undefined as ((v: unknown) => void) | undefined },
  initialValuesRef: { current: undefined as unknown },
  rulesByName: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: {
      get language() {
        return h.language;
      },
    },
  }),
}));

vi.mock("../../../../utils/openExternalLink", () => ({
  openExternalLink: (url: string) => h.openExternalLink(url),
}));

vi.mock("@ant-design/icons", () => ({
  LinkOutlined: () => <span data-icon="link" />,
}));

vi.mock("@agentscope-ai/design", () => {
  const Drawer = ({ children, title, footer, open, onClose }: any) => {
    if (!open) return null;
    return (
      <div data-testid="drawer">
        <div data-testid="drawer-title">{title}</div>
        <div data-testid="drawer-body">{children}</div>
        <div data-testid="drawer-footer">{footer}</div>
        <button
          type="button"
          data-testid="drawer-close-request"
          onClick={onClose}
        >
          close
        </button>
      </div>
    );
  };
  const Form: any = ({ children, onFinish, initialValues }: any) => {
    h.onFinishRef.current = onFinish;
    h.initialValuesRef.current = initialValues;
    return <div data-testid="acp-form">{children}</div>;
  };
  Form.Item = ({ children, name, label, rules, tooltip }: any) => {
    if (rules) h.rulesByName[String(name ?? label)] = rules;
    return (
      <div data-testid={`field-${String(name ?? label)}`}>
        <span data-testid="field-label">{label}</span>
        {tooltip ? <span data-testid="field-tooltip">{tooltip}</span> : null}
        {children}
      </div>
    );
  };
  const Input = Object.assign(
    ({ placeholder, disabled }: any) => (
      <input
        data-testid="text-input"
        placeholder={placeholder}
        disabled={disabled}
        readOnly
      />
    ),
    {
      TextArea: ({ autoSize }: any) => (
        <textarea
          data-testid="text-area"
          data-min-rows={String(autoSize?.minRows)}
          data-max-rows={String(autoSize?.maxRows)}
          readOnly
        />
      ),
    },
  );
  const Switch = () => <span data-testid="switch" />;
  const Button = ({ children, onClick, danger, loading, type }: any) => (
    <button
      type="button"
      data-danger={danger ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
      data-btn-type={type}
      onClick={onClick}
    >
      {children}
    </button>
  );
  const Select = ({ options }: any) => (
    <select data-testid="parse-mode-select">
      {(options ?? []).map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const InputNumber = ({ min, step, placeholder }: any) => (
    <input
      type="number"
      data-testid="buffer-limit-input"
      data-min={String(min)}
      data-step={String(step)}
      placeholder={placeholder}
      readOnly
    />
  );
  return { Drawer, Form, Input, Switch, Button, Select, InputNumber };
});

import {
  ACPDrawer,
  parseArgsText,
  parseEnvText,
  stringifyArgs,
  stringifyEnv,
} from "./ACPDrawer";
import { ACP_DEFAULT_STDIO_BUFFER_LIMIT_BYTES } from "../../../../api/types";
import type { ACPAgentConfig } from "../../../../api/types";

type DrawerProps = {
  open: boolean;
  activeKey: string | null;
  isCreateMode?: boolean;
  form: { submit: () => void };
  saving: boolean;
  initialValues?: ACPAgentConfig;
  canEditKey?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
  onDelete?: () => void;
};

const noopForm = { submit: vi.fn() };

function makeProps(over: Partial<DrawerProps> = {}): DrawerProps {
  return {
    open: true,
    activeKey: null,
    form: noopForm,
    saving: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...over,
  };
}

function renderDrawer(over: Partial<DrawerProps> = {}) {
  const props = makeProps(over);
  const utils = render(<ACPDrawer {...(props as any)} />);
  return { ...utils, props };
}

/** The rules the product declared for a field. */
function rulesOf(field: string): Array<Record<string, unknown>> {
  const rules = h.rulesByName[field];
  if (!rules) throw new Error(`no rules captured for ${field}`);
  return rules;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const el = screen
    .getAllByTestId("drawer-footer")
    .flatMap((f) => Array.from(f.querySelectorAll("button")))
    .find((b) => (b.textContent ?? "").includes(label));
  if (!el) throw new Error(`no footer button for ${label}`);
  return el as HTMLButtonElement;
}

function fieldText(field: string): string {
  return screen.getByTestId(`field-${field}`).textContent ?? "";
}

afterEach(() => {
  cleanup();
  h.language = "en";
  h.openExternalLink.mockClear();
  h.onFinishRef.current = undefined;
  h.initialValuesRef.current = undefined;
  h.rulesByName = {};
  noopForm.submit = vi.fn();
});

describe("ACPDrawer - args text conversion", () => {
  it("keeps one argument per line and trims each one", () => {
    expect(parseArgsText("-y\n  @acp/agent \n--verbose")).toEqual([
      "-y",
      "@acp/agent",
      "--verbose",
    ]);
  });

  it("drops blank and whitespace-only lines", () => {
    expect(parseArgsText("-y\n\n   \n@acp/agent\n")).toEqual([
      "-y",
      "@acp/agent",
    ]);
  });

  it("yields no argument for empty or missing input", () => {
    expect(parseArgsText("")).toEqual([]);
    expect(parseArgsText(undefined)).toEqual([]);
    expect(parseArgsText(null)).toEqual([]);
    expect(parseArgsText("\n\n")).toEqual([]);
  });

  it("round-trips through stringifyArgs", () => {
    expect(stringifyArgs(["-y", "@acp/agent"])).toBe("-y\n@acp/agent");
    expect(parseArgsText(stringifyArgs(["-y", "@acp/agent"]))).toEqual([
      "-y",
      "@acp/agent",
    ]);
  });

  it("stringifyArgs defaults to an empty string", () => {
    expect(stringifyArgs()).toBe("");
    expect(stringifyArgs([])).toBe("");
  });
});

describe("ACPDrawer - env text conversion", () => {
  it("splits each line on the first '='", () => {
    expect(parseEnvText("API_KEY=abc\nPORT=8080")).toEqual({
      API_KEY: "abc",
      PORT: "8080",
    });
  });

  it("keeps '=' inside the value and trims both sides", () => {
    expect(parseEnvText("  URL = https://example.com/?a=1  ")).toEqual({
      URL: "https://example.com/?a=1",
    });
  });

  it("keeps an explicitly empty value", () => {
    expect(parseEnvText("EMPTY=")).toEqual({ EMPTY: "" });
  });

  it("ignores lines without a usable key", () => {
    expect(parseEnvText("=value\n  =x\nNOEQUALS\nKEEP=1")).toEqual({
      KEEP: "1",
    });
  });

  it("yields no variable for empty or missing input", () => {
    expect(parseEnvText("")).toEqual({});
    expect(parseEnvText(undefined)).toEqual({});
    expect(parseEnvText("\n  \n")).toEqual({});
  });

  it("round-trips through stringifyEnv and keeps declaration order", () => {
    expect(stringifyEnv({ A: "1", B: "2" })).toBe("A=1\nB=2");
    expect(parseEnvText(stringifyEnv({ A: "1", B: "2" }))).toEqual({
      A: "1",
      B: "2",
    });
  });

  it("stringifyEnv defaults to an empty string", () => {
    expect(stringifyEnv()).toBe("");
    expect(stringifyEnv({})).toBe("");
  });
});

describe("ACPDrawer - visibility and title", () => {
  it("renders nothing while closed", () => {
    renderDrawer({ open: false });
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("uses the create title in create mode even when a key is active", () => {
    renderDrawer({ isCreateMode: true, activeKey: "leftover" });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "acp.createTitle",
    );
  });

  it("appends the agent key to the edit title", () => {
    renderDrawer({ activeKey: "opencode" });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "acp.editTitle: opencode",
    );
  });

  it("falls back to the bare edit title with no active key", () => {
    renderDrawer({ activeKey: null });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "acp.editTitle",
    );
  });
});

describe("ACPDrawer - fields", () => {
  it("renders every documented field with its own label", () => {
    renderDrawer();
    const expected: Array<[string, string]> = [
      ["agentKey", "acp.agentKey"],
      ["enabled", "acp.enabled"],
      ["command", "acp.command"],
      ["argsText", "acp.args"],
      ["envText", "acp.env"],
      ["trusted", "acp.trusted"],
      ["tool_parse_mode", "acp.toolParseMode"],
      ["stdio_buffer_limit_bytes", "acp.stdioBufferLimit"],
    ];
    expect(expected.map(([field]) => field)).toHaveLength(
      screen.getAllByTestId("field-label").length,
    );
    for (const [field, label] of expected) {
      expect(fieldText(field)).toContain(label);
    }
  });

  it("explains the args, env and buffer-limit fields with a tooltip", () => {
    renderDrawer();
    expect(screen.getByTestId("field-argsText").textContent).toContain(
      "acp.argsHelp",
    );
    expect(screen.getByTestId("field-envText").textContent).toContain(
      "acp.envHelp",
    );
    expect(
      screen.getByTestId("field-stdio_buffer_limit_bytes").textContent,
    ).toContain("acp.stdioBufferLimitHelp");
  });

  it("locks the agent key unless editing is allowed", () => {
    const { unmount } = renderDrawer({ canEditKey: false });
    const locked = screen
      .getByTestId("field-agentKey")
      .querySelector("input") as HTMLInputElement;
    expect(locked.disabled).toBe(true);
    unmount();

    renderDrawer({ canEditKey: true });
    const editable = screen
      .getByTestId("field-agentKey")
      .querySelector("input") as HTMLInputElement;
    expect(editable.disabled).toBe(false);
    expect(editable.placeholder).toBe("my_custom_runner");
  });

  it("declares the agent key as required and restricted to key-safe characters", () => {
    renderDrawer();
    const rules = rulesOf("agentKey");
    expect(rules.some((r) => r.required === true)).toBe(true);

    const pattern = rules.find((r) => r.pattern)?.pattern as RegExp;
    expect(pattern).toBeTruthy();
    expect(pattern.test("my_runner-1")).toBe(true);
    expect(pattern.test("My Runner")).toBe(false);
    expect(pattern.test("runner!")).toBe(false);
    expect(pattern.test("")).toBe(false);
  });

  it("declares command and tool parse mode as required", () => {
    renderDrawer();
    expect(rulesOf("command").some((r) => r.required === true)).toBe(true);
    expect(rulesOf("tool_parse_mode").some((r) => r.required === true)).toBe(
      true,
    );
  });

  it("offers the three documented tool parse modes", () => {
    renderDrawer();
    const options = Array.from(
      screen.getByTestId("parse-mode-select").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(options).toEqual(["call_title", "update_detail", "call_detail"]);
  });

  it("declares the buffer limit as a required number of at least one byte", () => {
    renderDrawer();
    const rules = rulesOf("stdio_buffer_limit_bytes");
    expect(rules.some((r) => r.required === true)).toBe(true);
    const numeric = rules.find((r) => r.type === "number");
    expect(numeric?.min).toBe(1);

    const input = screen.getByTestId("buffer-limit-input");
    expect(input.getAttribute("data-min")).toBe("1");
    expect(input.getAttribute("placeholder")).toBe(
      String(ACP_DEFAULT_STDIO_BUFFER_LIMIT_BYTES),
    );
  });

  it("passes the caller's initial values to the form", () => {
    const initialValues: ACPAgentConfig = {
      enabled: true,
      command: "npx",
      args: ["-y"],
      env: {},
      trusted: false,
      tool_parse_mode: "call_detail",
    };
    renderDrawer({ initialValues });
    expect(h.initialValuesRef.current).toBe(initialValues);
  });

  it("gives the args and env boxes room for several lines", () => {
    renderDrawer();
    const areas = screen.getAllByTestId("text-area");
    expect(areas).toHaveLength(2);
    for (const area of areas) {
      expect(area.getAttribute("data-min-rows")).toBe("4");
      expect(area.getAttribute("data-max-rows")).toBe("8");
    }
  });
});

describe("ACPDrawer - env line validation", () => {
  async function validateEnv(value: unknown): Promise<string | undefined> {
    renderDrawer();
    const validator = rulesOf("envText")[0].validator as (
      _rule: unknown,
      value: unknown,
    ) => Promise<void>;
    try {
      await validator({}, value);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it("accepts well-formed lines", async () => {
    expect(await validateEnv("A=1\nB=2")).toBeUndefined();
  });

  it("accepts empty and whitespace-only input", async () => {
    expect(await validateEnv("")).toBeUndefined();
    expect(await validateEnv(undefined)).toBeUndefined();
    expect(await validateEnv("   \n  ")).toBeUndefined();
  });

  it("rejects a line with no '=' and names the offending line", async () => {
    const message = await validateEnv("A=1\nBROKEN");
    expect(message).toBe('acp.envInvalidLine:{"line":"BROKEN"}');
  });

  it("rejects a line whose '=' has nothing before it", async () => {
    expect(await validateEnv("=value")).toBe(
      'acp.envInvalidLine:{"line":"=value"}',
    );
  });

  it("reports the first offending line when several are wrong", async () => {
    expect(await validateEnv("OK=1\nFIRST\nSECOND")).toBe(
      'acp.envInvalidLine:{"line":"FIRST"}',
    );
  });
});

describe("ACPDrawer - footer actions", () => {
  it("submits the form when save is clicked", () => {
    const form = { submit: vi.fn() };
    renderDrawer({ form });
    fireEvent.click(buttonByLabel("common.save"));
    expect(form.submit).toHaveBeenCalledTimes(1);
  });

  it("shows the saving state on the save button", () => {
    renderDrawer({ saving: true });
    expect(buttonByLabel("common.save").getAttribute("data-loading")).toBe(
      "true",
    );
    cleanup();
    renderDrawer({ saving: false });
    expect(buttonByLabel("common.save").getAttribute("data-loading")).toBe(
      "false",
    );
  });

  it("hides cancel behind a close request and shows no delete by default", () => {
    const { props } = renderDrawer();
    expect(screen.queryByText("common.delete")).toBeNull();
    fireEvent.click(buttonByLabel("common.cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("drawer-close-request"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("offers a dangerous delete button only when deletion is allowed", () => {
    const onDelete = vi.fn();
    const { unmount } = renderDrawer({ canDelete: false, onDelete });
    expect(screen.queryByText("common.delete")).toBeNull();
    unmount();

    renderDrawer({ canDelete: true, onDelete });
    const del = buttonByLabel("common.delete");
    expect(del.getAttribute("data-danger")).toBe("true");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("ACPDrawer - docs link", () => {
  function docsButton(): HTMLButtonElement {
    return screen
      .getAllByTestId("drawer-body")
      .flatMap((b) => Array.from(b.querySelectorAll("button")))
      .find((b) =>
        (b.textContent ?? "").includes("acp.docs"),
      ) as HTMLButtonElement;
  }

  it("opens the English docs section for an English UI", () => {
    renderDrawer();
    fireEvent.click(docsButton());
    expect(h.openExternalLink).toHaveBeenCalledWith(
      "https://qwenpaw.agentscope.io/docs/acp-integration?lang=en#How-to-configure-external-runners",
    );
  });

  it("opens the Chinese docs section for any zh UI locale", () => {
    h.language = "zh-CN";
    renderDrawer();
    fireEvent.click(docsButton());
    expect(h.openExternalLink).toHaveBeenCalledWith(
      "https://qwenpaw.agentscope.io/docs/acp-integration?lang=zh#\u5982\u4f55\u914d\u7f6e\u5916\u90e8-runner",
    );
  });

  it("treats an unknown UI locale as English", () => {
    h.language = "fr";
    renderDrawer();
    fireEvent.click(docsButton());
    expect(h.openExternalLink.mock.calls[0][0]).toContain("lang=en#");
  });

  it("hands the finished values to the caller on submit", () => {
    const onSubmit = vi.fn();
    renderDrawer({ onSubmit });
    (h.onFinishRef.current as (v: unknown) => void)({ command: "npx" });
    expect(onSubmit).toHaveBeenCalledWith({ command: "npx" });
  });
});
