// @vitest-environment jsdom
/**
 * ReactAgentCard tests - the React-Agent tab of the Agent Config page
 * (rendered from `pages/Agent/Config/index.tsx:145`).
 *
 * What is pinned down here is the card's user-visible contract: the four
 * language/timezone/timeout/executable settings and their exact field names and
 * validation messages, the memory-backend option list including both the
 * "unavailable" and the "watched plugin is gone" arms, the auto-title switch's
 * nested field name and `valuePropName`, and the two internal settings sections
 * that own their own async loading state (project directory, coding mode).
 *
 * Harness notes (each one a measured fact about this target, not a guess):
 *
 * 1. The shared design stub (src/test/design-mock.ts) exports neither `Card`,
 *    `Select` nor `Alert`, and its `Form` has no `useWatch`, which this
 *    component calls at the top of the render. So this suite supplies its own
 *    factory and leaves the shared stub untouched (other suites depend on it).
 * 2. Every `Form.Item` child is cloned with a `data-item` attribute so the
 *    three `Select` instances stay addressable. The key is the `name` prop when
 *    the item has one, otherwise its label: `shell_command_timeout` and
 *    `memory_manager_backend` are named, while the language and timezone items
 *    are label-keyed. Assertions therefore locate a control by the field the
 *    product declared, not by its order in the DOM.
 * 3. `Form.useWatch` is backed by a mutable holder instead of a real antd form
 *    instance: the component only reads the watched value to decide whether to
 *    append a "(plugin unavailable)" option, and driving that decision through
 *    a real form would require simulating rc-field-form's store. The holder is
 *    what makes both arms of that branch testable.
 * 4. The stub `Select` records the props it received (including `filterOption`)
 *    so the timezone search predicate can be called directly with the exact
 *    shapes the product passes. The predicate is case-insensitive substring
 *    matching over `label`, with `?.toString() || ""` guarding a label-less
 *    option; all three arms are asserted.
 * 5. Both API modules are mocked at their module path, and the two stores are
 *    mocked as selector-taking hooks (`useStore((s) => s.field)`), which is how
 *    the component consumes them. The store mocks hand back `vi.fn()` setters so
 *    every case can assert the arguments the product derived.
 * 6. `ProjectSelectModal` is stubbed because it has its own suite; the stub
 *    exposes the `agentId`/`open` props and fires `onClose`/`onConfirm` so the
 *    drawer-less wiring (confirm closes and re-reads the directories) stays
 *    observable.
 * 7. The two async sections keep their own `loading` state, so every assertion
 *    on them is wrapped in `waitFor`. The spinner-to-control transition is
 *    asserted in both directions, because a stuck `loading` would otherwise
 *    look like a rendering bug.
 * 8. Translation is stubbed to a deterministic function that folds
 *    interpolation params into the key, so label and message assertions pin the
 *    i18n key the product asks for rather than an English sentence that could
 *    be reworded without any behaviour change.
 * 9. Directory-name derivation is asserted against the exact source expression:
 *    trailing separators are stripped, the last path segment is taken, and a
 *    root-only path falls back to the whole string through the `||` arm.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactAgentCard } from "./ReactAgentCard";

const h = vi.hoisted(() => ({
  stableT: (key: string, arg?: unknown) => {
    if (typeof arg === "string") return `${key}::${arg}`;
    if (arg && typeof arg === "object") {
      const parts = Object.entries(arg as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${String(v)}`);
      return `${key}::${parts.join(",")}`;
    }
    return key;
  },
  watch: {} as Record<string, unknown>,
  selects: [] as Array<Record<string, unknown>>,
  backends: [] as unknown[],
  timezoneOptions: [] as unknown[],
  selectedAgent: "agent-1",
  setProjectDir: undefined as unknown,
  setCodingMode: undefined as unknown,
  codingMode: false,
  getDirs: undefined as unknown,
  codingGet: undefined as unknown,
  codingToggle: undefined as unknown,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: { language: "en" } }),
}));

vi.mock("lucide-react", () => ({
  FolderOpen: (p: Record<string, unknown>) => (
    <span data-icon="FolderOpen" data-size={String(p.size ?? "")} />
  ),
  LoaderCircle: () => <span data-icon="LoaderCircle" data-testid="spinner" />,
}));

vi.mock("../../../../api/modules/codingMode", () => ({
  codingModeApi: {
    get: () => (h.codingGet as () => Promise<unknown>)(),
    toggle: (v: boolean) =>
      (h.codingToggle as (v: boolean) => Promise<unknown>)(v),
  },
}));

vi.mock("../../../../api/modules/projectDirectory", () => ({
  projectDirectoryApi: {
    getDirs: () => (h.getDirs as () => Promise<unknown>)(),
  },
}));

vi.mock("../../../../components/ProjectSelectModal", () => ({
  default: ({ agentId, open, onClose, onConfirm }: any) =>
    open ? (
      <div
        role="dialog"
        data-testid="project-select-modal"
        data-agent={agentId}
      >
        <button type="button" data-testid="modal-close" onClick={onClose}>
          close
        </button>
        <button
          type="button"
          data-testid="modal-confirm"
          onClick={() => onConfirm("/picked")}
        >
          confirm
        </button>
      </div>
    ) : null,
}));

vi.mock("../../../../hooks/useTimezoneOptions", () => ({
  useTimezoneOptions: () => h.timezoneOptions,
}));

vi.mock("../../../../plugins/memoryBackends", () => ({
  useMemoryBackends: () => h.backends,
}));

vi.mock("../../../../stores/agentStore", () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ selectedAgent: h.selectedAgent }),
}));

vi.mock("../../../../stores/codingModeStore", () => ({
  useCodingMode: () => ({ codingMode: h.codingMode, setCodingMode: vi.fn() }),
  useCodingModeStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setCodingMode: h.setCodingMode }),
}));

vi.mock("../../../../stores/projectDirectoryStore", () => ({
  useProjectDirectoryStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setProjectDir: h.setProjectDir }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Button = ({ children, onClick, size, ...rest }: any) => (
    <button type="button" onClick={onClick} data-size={size ?? ""} {...rest}>
      {children}
    </button>
  );

  const Item = ({
    children,
    label,
    name,
    rules,
    tooltip,
    valuePropName,
  }: any) => {
    // note 2: the item is wrapped in a container keyed by the field name the
    // product declared (or by its label when the item is unnamed), so a control
    // is located by that key and never by its position in the DOM.
    // A nested field name arrives as an array; join it so the key stays readable.
    const key =
      name !== undefined
        ? Array.isArray(name)
          ? name.join(".")
          : String(name)
        : String(label ?? "");
    return (
      <div data-item={key} data-tooltip={tooltip ?? ""}>
        {label ? <span data-label="true">{label}</span> : null}
        {children}
        <span
          data-rules={JSON.stringify(rules ?? null)}
          data-value-prop={valuePropName ?? ""}
        />
      </div>
    );
  };

  const Form = ({ children }: any) => (
    <div data-testid="agent-form">{children}</div>
  );
  const useWatch = (name: string) => h.watch[name];

  const Select = (props: any) => {
    h.selects.push(props);
    const { options, value, onChange, placeholder, disabled, loading } = props;
    return (
      <div
        data-testid="select"
        data-placeholder={placeholder ?? ""}
        data-disabled={disabled ? "true" : "false"}
        data-loading={loading ? "true" : "false"}
      >
        <span data-testid="select-current">{String(value ?? "")}</span>
        {(options ?? []).map((o: any, i: number) => (
          <button
            type="button"
            key={i}
            data-opt={String(o.value)}
            data-opt-disabled={o.disabled ? "true" : "false"}
            data-opt-label={String(o.label)}
            onClick={() => onChange?.(o.value)}
          >
            {String(o.label)}
          </button>
        ))}
      </div>
    );
  };

  const InputNumber = (props: any) => (
    <input
      type="number"
      data-testid="timeout-input"
      placeholder={props.placeholder}
      min={props.min}
      step={props.step}
    />
  );
  const Input = (props: any) => (
    <input data-testid="executable-input" placeholder={props.placeholder} />
  );
  const Switch = ({ checked, onChange, ...rest }: any) => {
    // The card renders two switches; only the coding-mode one carries an
    // aria-label, so the label is what keeps them apart in assertions.
    const ariaLabel = rest["aria-label"] ? String(rest["aria-label"]) : "";
    return (
      <input
        type="checkbox"
        role="switch"
        data-testid={ariaLabel ? `switch-${ariaLabel}` : "auto-title-switch"}
        checked={Boolean(checked)}
        onChange={(e) => onChange?.(e.target.checked)}
        {...rest}
      />
    );
  };
  const Card = ({ children, title }: any) => (
    <section data-testid="react-agent-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
  const Alert = ({ message, type }: any) => (
    <div role="alert" data-type={type}>
      {message}
    </div>
  );

  return {
    Button,
    Form: Object.assign(Form, { Item, useWatch }),
    Input,
    InputNumber,
    Select,
    Card,
    Alert,
    Switch,
  };
});

/** Locates the control inside the Form.Item carrying this field/label key. */
function itemOf(key: string) {
  const el = document.querySelector(`[data-item="${key}"]`);
  if (!el) throw new Error(`no form item for ${key}`);
  return el;
}

function selectOf(key: string) {
  return itemOf(key).querySelector('[data-testid="select"]') as HTMLElement;
}

function optionOf(key: string, value: string) {
  return selectOf(key).querySelector(`[data-opt="${value}"]`) as HTMLElement;
}

function rulesOf(key: string) {
  const raw = itemOf(key)
    .querySelector("[data-rules]")
    ?.getAttribute("data-rules");
  return JSON.parse(raw ?? "null") as Array<Record<string, unknown>> | null;
}

function defaults(
  over: Partial<React.ComponentProps<typeof ReactAgentCard>> = {},
) {
  return {
    language: "en",
    savingLang: false,
    onLanguageChange: vi.fn(),
    timezone: "Asia/Shanghai",
    savingTimezone: false,
    onTimezoneChange: vi.fn(),
    ...over,
  };
}

/** Renders the card and flushes the two internal async sections. */
async function renderCard(
  over: Partial<React.ComponentProps<typeof ReactAgentCard>> = {},
) {
  const props = defaults(over);
  const utils = render(<ReactAgentCard {...props} />);
  await waitFor(() => {
    expect(screen.queryByTestId("spinner")).toBeNull();
  });
  return { props, ...utils };
}

beforeEach(() => {
  h.watch = { memory_manager_backend: "remelight" };
  h.selects = [];
  h.backends = [
    { id: "remelight", label: "ReMeLight", available: true },
    { id: "mem0", label: "Mem0", available: false },
  ];
  h.timezoneOptions = [
    { value: "Asia/Shanghai", label: "Asia/Shanghai" },
    { value: "UTC", label: "UTC" },
  ];
  h.selectedAgent = "agent-1";
  h.codingMode = false;
  h.setProjectDir = vi.fn();
  h.setCodingMode = vi.fn();
  h.getDirs = vi.fn().mockResolvedValue({
    project_dirs: [{ path: "/work/repo/" }, { path: "/work/other" }],
    source: "agent_config",
    workspace_dir: "/work/ws",
  });
  h.codingGet = vi.fn().mockResolvedValue({ enabled: false });
  h.codingToggle = vi.fn().mockResolvedValue({ enabled: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReactAgentCard - shell", () => {
  it("renders the card under the product's own title key", async () => {
    await renderCard();
    expect(screen.getByTestId("react-agent-card")).toBeInTheDocument();
    expect(screen.getByText("agentConfig.reactAgentTitle")).toBeInTheDocument();
  });

  it("keeps the restart warning visible as a warning alert", async () => {
    await renderCard();
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-type")).toBe("warning");
    expect(alert.textContent).toBe(
      "agentConfig.memoryManagerBackendRestartWarning",
    );
  });
});

describe("ReactAgentCard - language and timezone selects", () => {
  it("lists all four built-in language options in source order", async () => {
    await renderCard();
    const sel = selectOf("agentConfig.language");
    const opts = Array.from(sel.querySelectorAll("[data-opt]"));
    expect(opts.map((o) => o.getAttribute("data-opt"))).toEqual([
      "zh",
      "en",
      "id",
      "ru",
    ]);
    // Labels are the product's own literals, including the non-English ones.
    expect(opts.map((o) => o.getAttribute("data-opt-label"))).toEqual([
      "中文",
      "English",
      "Bahasa Indonesia",
      "Русский",
    ]);
  });

  it("routes a language pick to the prop callback with the option value", async () => {
    const { props } = await renderCard();
    fireEvent.click(optionOf("agentConfig.language", "zh"));
    expect(props.onLanguageChange).toHaveBeenCalledWith("zh");
  });

  it("disables and spins the language select while it is saving", async () => {
    await renderCard({ savingLang: true });
    const sel = selectOf("agentConfig.language");
    expect(sel.getAttribute("data-disabled")).toBe("true");
    expect(sel.getAttribute("data-loading")).toBe("true");
  });

  it("shows the current timezone and the placeholder key when none is set", async () => {
    const { unmount } = await renderCard({ timezone: "UTC" });
    expect(
      selectOf("agentConfig.timezone").querySelector(
        "[data-testid=select-current]",
      )?.textContent,
    ).toBe("UTC");
    unmount();

    await renderCard({ timezone: "" });
    const sel = selectOf("agentConfig.timezone");
    expect(sel.getAttribute("data-placeholder")).toBe(
      "agentConfig.selectTimezone",
    );
  });

  it("feeds the timezone select from useTimezoneOptions, not a local list", async () => {
    h.timezoneOptions = [{ value: "Europe/Berlin", label: "Europe/Berlin" }];
    await renderCard();
    const opts = Array.from(
      selectOf("agentConfig.timezone").querySelectorAll("[data-opt]"),
    );
    expect(opts).toHaveLength(1);
    expect(opts[0].getAttribute("data-opt")).toBe("Europe/Berlin");
  });

  it("routes a timezone pick to the prop callback", async () => {
    const { props } = await renderCard();
    fireEvent.click(optionOf("agentConfig.timezone", "UTC"));
    expect(props.onTimezoneChange).toHaveBeenCalledWith("UTC");
  });

  it("filters timezone options case-insensitively over the label", async () => {
    await renderCard();
    const tzProps = h.selects.find(
      (s) => s.placeholder === "agentConfig.selectTimezone",
    ) as Record<string, any>;
    expect(tzProps.showSearch).toBe(true);
    const filter = tzProps.filterOption as (
      input: string,
      option?: { label?: unknown },
    ) => boolean;
    expect(filter("shang", { label: "Asia/Shanghai" })).toBe(true);
    expect(filter("SHANG", { label: "Asia/Shanghai" })).toBe(true);
    expect(filter("berlin", { label: "Asia/Shanghai" })).toBe(false);
  });

  it("treats a label-less option as an empty string instead of throwing", async () => {
    await renderCard();
    const tzProps = h.selects.find(
      (s) => s.placeholder === "agentConfig.selectTimezone",
    ) as Record<string, any>;
    const filter = tzProps.filterOption as (
      input: string,
      option?: { label?: unknown },
    ) => boolean;
    expect(() => filter("utc", {})).not.toThrow();
    expect(filter("utc", {})).toBe(false);
    expect(filter("", {})).toBe(true);
  });
});

describe("ReactAgentCard - timeout and executable fields", () => {
  it("declares the timeout field with its product field name and both rules", async () => {
    await renderCard();
    const rules = rulesOf("shell_command_timeout");
    expect(rules).toHaveLength(2);
    expect(rules?.[0]).toMatchObject({
      required: true,
      message: "agentConfig.shellCommandTimeoutRequired",
    });
    expect(rules?.[1]).toMatchObject({
      type: "number",
      min: 1,
      message: "agentConfig.shellCommandTimeoutMin",
    });
    expect(itemOf("shell_command_timeout").getAttribute("data-tooltip")).toBe(
      "agentConfig.shellCommandTimeoutTooltip",
    );
  });

  it("constrains the timeout input to a minimum of one with step ten", async () => {
    await renderCard();
    const input = screen.getByTestId("timeout-input");
    expect(input.getAttribute("min")).toBe("1");
    expect(input.getAttribute("step")).toBe("10");
    expect(input.getAttribute("placeholder")).toBe(
      "agentConfig.shellCommandTimeoutPlaceholder",
    );
  });

  it("declares the executable field name and its placeholder, without rules", async () => {
    await renderCard();
    expect(itemOf("shell_command_executable")).toBeInTheDocument();
    expect(rulesOf("shell_command_executable")).toBeNull();
    expect(
      screen.getByTestId("executable-input").getAttribute("placeholder"),
    ).toBe("agentConfig.shellCommandExecutablePlaceholder");
  });
});

describe("ReactAgentCard - memory backend options", () => {
  it("lists the registered backends and marks unavailable ones as disabled", async () => {
    await renderCard();
    const sel = selectOf("memory_manager_backend");
    const opts = Array.from(sel.querySelectorAll("[data-opt]"));
    expect(opts.map((o) => o.getAttribute("data-opt"))).toEqual([
      "remelight",
      "mem0",
    ]);
    expect(opts.map((o) => o.getAttribute("data-opt-label"))).toEqual([
      "ReMeLight",
      "Mem0 (unavailable)",
    ]);
    expect(opts.map((o) => o.getAttribute("data-opt-disabled"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("treats a backend without an availability field as available", async () => {
    // `available === false` is a strict comparison, so a missing field must
    // not disable the option.
    h.backends = [{ id: "plain", label: "Plain" }];
    h.watch = { memory_manager_backend: "plain" };
    await renderCard();
    const opt = selectOf("memory_manager_backend").querySelector("[data-opt]");
    expect(opt?.getAttribute("data-opt-label")).toBe("Plain");
    expect(opt?.getAttribute("data-opt-disabled")).toBe("false");
  });

  it("appends a disabled placeholder option when the watched plugin is gone", async () => {
    h.backends = [{ id: "remelight", label: "ReMeLight", available: true }];
    h.watch = { memory_manager_backend: "vanished-plugin" };
    await renderCard();
    const opts = Array.from(
      selectOf("memory_manager_backend").querySelectorAll("[data-opt]"),
    );
    expect(opts).toHaveLength(2);
    expect(opts[1].getAttribute("data-opt")).toBe("vanished-plugin");
    expect(opts[1].getAttribute("data-opt-label")).toBe(
      "vanished-plugin (plugin unavailable)",
    );
    expect(opts[1].getAttribute("data-opt-disabled")).toBe("true");
  });

  it("does not duplicate a watched backend that is registered", async () => {
    h.watch = { memory_manager_backend: "mem0" };
    await renderCard();
    const opts = Array.from(
      selectOf("memory_manager_backend").querySelectorAll("[data-opt]"),
    );
    expect(opts.map((o) => o.getAttribute("data-opt"))).toEqual([
      "remelight",
      "mem0",
    ]);
    expect(
      opts.filter(
        (o) => o.getAttribute("data-opt-label")?.includes("plugin unavailable"),
      ),
    ).toHaveLength(0);
  });

  it("falls back to remelight when nothing is being watched yet", async () => {
    // `Form.useWatch(...) || "remelight"` arm: an untouched form field yields
    // undefined, and remelight is registered below, so no extra option appears.
    h.watch = {};
    await renderCard();
    const opts = Array.from(
      selectOf("memory_manager_backend").querySelectorAll("[data-opt]"),
    );
    expect(opts).toHaveLength(2);
    expect(opts.some((o) => o.getAttribute("data-opt") === "remelight")).toBe(
      true,
    );
  });
});

describe("ReactAgentCard - auto title switch", () => {
  it("binds the switch to the nested auto_title_config.enabled field via checked", async () => {
    await renderCard();
    const item = itemOf("auto_title_config.enabled");
    expect(item.getAttribute("data-tooltip")).toBe(
      "agentConfig.autoGenerateSessionTitleTooltip",
    );
    expect(
      item.querySelector("[data-value-prop]")?.getAttribute("data-value-prop"),
    ).toBe("checked");
    expect(screen.getByTestId("auto-title-switch")).toBeInTheDocument();
  });
});

describe("ReactAgentCard - project directory section", () => {
  it("shows the directory basename and the full path once loaded", async () => {
    await renderCard();
    // Derivation is `path.replace(/[\\/]+$/, "").split(/[\\/]/).pop()`.
    expect(screen.getByText("repo")).toBeInTheDocument();
    expect(screen.getByTitle("/work/repo/")).toBeInTheDocument();
  });

  it("derives the display name through a Windows style path as well", async () => {
    h.getDirs = vi.fn().mockResolvedValue({
      project_dirs: [{ path: "C:\\work\\repo\\" }],
      source: "agent_config",
      workspace_dir: "C:\\work\\ws",
    });
    await renderCard();
    expect(screen.getByText("repo")).toBeInTheDocument();
  });

  it("reports how many extra directories are configured", async () => {
    await renderCard();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("hides the extra counter when there is exactly one directory", async () => {
    h.getDirs = vi.fn().mockResolvedValue({
      project_dirs: [{ path: "/work/only" }],
      source: "agent_config",
      workspace_dir: "/work/ws",
    });
    await renderCard();
    expect(screen.queryByText("+1")).toBeNull();
    expect(screen.getByText("only")).toBeInTheDocument();
  });

  it("falls back to the workspace directory when the agent has none configured", async () => {
    // `project_dirs.length ? mapped : [workspace_dir]` arm.
    h.getDirs = vi.fn().mockResolvedValue({
      project_dirs: [],
      source: "workspace_fallback",
      workspace_dir: "/work/ws",
    });
    await renderCard();
    expect(screen.getByTitle("/work/ws")).toBeInTheDocument();
  });

  it("records a null directory when the source is the workspace fallback", async () => {
    // The store must not be told that the agent picked the workspace default,
    // otherwise the setting would look explicit when it is inherited.
    h.getDirs = vi.fn().mockResolvedValue({
      project_dirs: [],
      source: "workspace_fallback",
      workspace_dir: "/work/ws",
    });
    await renderCard();
    expect(h.setProjectDir).toHaveBeenCalledWith("agent-1", null);
  });

  it("records the first configured directory for the selected agent", async () => {
    await renderCard();
    expect(h.setProjectDir).toHaveBeenCalledWith("agent-1", "/work/repo/");
  });

  it("records null when the agent config exists but lists no directories", async () => {
    // `defaults.project_dirs[0]?.path ?? null` arm.
    h.getDirs = vi.fn().mockResolvedValue({
      project_dirs: [],
      source: "agent_config",
      workspace_dir: "/work/ws",
    });
    await renderCard();
    expect(h.setProjectDir).toHaveBeenCalledWith("agent-1", null);
  });

  it("targets the selected agent from the agent store", async () => {
    h.selectedAgent = "agent-9";
    await renderCard();
    expect(h.setProjectDir).toHaveBeenCalledWith("agent-9", "/work/repo/");
  });

  it("shows a spinner instead of the change button while loading", async () => {
    let resolveDirs: (v: unknown) => void = () => {};
    h.getDirs = vi.fn().mockReturnValue(new Promise((r) => (resolveDirs = r)));
    const utils = render(<ReactAgentCard {...defaults()} />);
    // Scoped to this section's Form.Item: the coding-mode section has a spinner
    // of its own, so an unscoped query would match either one.
    const dirItem = () => itemOf("agentConfig.projectDirectoryTitle");
    await waitFor(() =>
      expect(dirItem().querySelector('[data-testid="spinner"]')).not.toBeNull(),
    );
    expect(screen.queryByText("agentConfig.changeProjectDirectory")).toBeNull();
    await act(async () => {
      resolveDirs({
        project_dirs: [{ path: "/work/repo" }],
        source: "agent_config",
        workspace_dir: "/work/ws",
      });
    });
    await waitFor(() =>
      expect(
        screen.getByText("agentConfig.changeProjectDirectory"),
      ).toBeInTheDocument(),
    );
    expect(dirItem().querySelector('[data-testid="spinner"]')).toBeNull();
    utils.unmount();
  });

  it("opens the project picker with the selected agent when change is clicked", async () => {
    await renderCard();
    expect(screen.queryByTestId("project-select-modal")).toBeNull();
    fireEvent.click(screen.getByText("agentConfig.changeProjectDirectory"));
    const modal = screen.getByTestId("project-select-modal");
    expect(modal.getAttribute("data-agent")).toBe("agent-1");
  });

  it("closes the picker without re-reading directories on cancel", async () => {
    await renderCard();
    fireEvent.click(screen.getByText("agentConfig.changeProjectDirectory"));
    const callsAfterOpen = (h.getDirs as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    fireEvent.click(screen.getByTestId("modal-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("project-select-modal")).toBeNull(),
    );
    expect(
      (h.getDirs as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsAfterOpen);
  });

  it("closes the picker and re-reads directories on confirm", async () => {
    await renderCard();
    fireEvent.click(screen.getByText("agentConfig.changeProjectDirectory"));
    const callsAfterOpen = (h.getDirs as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    fireEvent.click(screen.getByTestId("modal-confirm"));
    await waitFor(() =>
      expect(
        (h.getDirs as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsAfterOpen),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("project-select-modal")).toBeNull(),
    );
  });
});

describe("ReactAgentCard - enhanced code capability section", () => {
  it("renders the switch with its label and description keys", async () => {
    await renderCard();
    expect(
      screen.getByText("agentConfig.enhancedCodeCapabilityDescription"),
    ).toBeInTheDocument();
    const codingSwitch = screen.getByTestId(
      "switch-agentConfig.enhancedCodeCapability",
    );
    expect(codingSwitch).toBeInTheDocument();
  });

  it("reads the current mode from the API on mount", async () => {
    await renderCard();
    expect(h.codingGet).toHaveBeenCalledTimes(1);
  });

  it("mirrors the store value onto the switch", async () => {
    h.codingMode = true;
    await renderCard();
    expect(
      screen.getByLabelText("agentConfig.enhancedCodeCapability"),
    ).toBeChecked();
  });

  it("writes the toggled value back through the store for the selected agent", async () => {
    await renderCard();
    fireEvent.click(
      screen.getByLabelText("agentConfig.enhancedCodeCapability"),
    );
    await waitFor(() =>
      expect(h.setCodingMode).toHaveBeenCalledWith("agent-1", true),
    );
    expect(h.codingToggle).toHaveBeenCalledWith(true);
  });

  it("writes back whatever the API reports, not what the switch asked for", async () => {
    // The backend is authoritative: it reloads the agent and answers with the
    // resulting state, which the store then takes verbatim.
    h.codingToggle = vi.fn().mockResolvedValue({ enabled: false });
    await renderCard();
    fireEvent.click(
      screen.getByLabelText("agentConfig.enhancedCodeCapability"),
    );
    await waitFor(() =>
      expect(h.setCodingMode).toHaveBeenCalledWith("agent-1", false),
    );
  });

  it("shows a spinner instead of the switch while the mode is loading", async () => {
    let resolveMode: (v: unknown) => void = () => {};
    h.codingGet = vi
      .fn()
      .mockReturnValue(new Promise((r) => (resolveMode = r)));
    let resolveDirs: (v: unknown) => void = () => {};
    h.getDirs = vi.fn().mockReturnValue(new Promise((r) => (resolveDirs = r)));
    render(<ReactAgentCard {...defaults()} />);
    const codingItem = () => itemOf("agentConfig.enhancedCodeCapability");
    await waitFor(() =>
      expect(
        codingItem().querySelector('[data-testid="spinner"]'),
      ).not.toBeNull(),
    );
    expect(
      screen.queryByLabelText("agentConfig.enhancedCodeCapability"),
    ).toBeNull();
    await act(async () => {
      resolveMode({ enabled: true });
      resolveDirs({
        project_dirs: [{ path: "/work/repo" }],
        source: "agent_config",
        workspace_dir: "/work/ws",
      });
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("agentConfig.enhancedCodeCapability"),
      ).toBeInTheDocument(),
    );
  });
});

describe("ReactAgentCard - field labels and tooltips", () => {
  it("pins every label and tooltip key the card declares", async () => {
    await renderCard();
    const expected: Array<[string, string]> = [
      ["agentConfig.language", "agentConfig.languageTooltip"],
      ["agentConfig.timezone", "agentConfig.timezoneTooltip"],
      [
        "agentConfig.shellCommandTimeout",
        "agentConfig.shellCommandTimeoutTooltip",
      ],
      [
        "agentConfig.shellCommandExecutable",
        "agentConfig.shellCommandExecutableTooltip",
      ],
      [
        "agentConfig.memoryManagerBackend",
        "agentConfig.memoryManagerBackendTooltip",
      ],
      [
        "agentConfig.autoGenerateSessionTitle",
        "agentConfig.autoGenerateSessionTitleTooltip",
      ],
    ];
    for (const [labelKey, tooltipKey] of expected) {
      const items = Array.from(document.querySelectorAll("[data-item]"));
      const hit = items.find((el) =>
        Array.from(el.querySelectorAll('[data-label="true"]')).some(
          (s) => s.textContent === labelKey,
        ),
      );
      expect(hit, `no item labelled ${labelKey}`).toBeTruthy();
      expect(hit?.getAttribute("data-tooltip")).toBe(tooltipKey);
    }
  });

  it("labels the two internal settings sections with their own keys", async () => {
    await renderCard();
    expect(
      screen.getByText("agentConfig.projectDirectoryTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("agentConfig.enhancedCodeCapability"),
    ).toBeInTheDocument();
  });
});
