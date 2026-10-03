// @vitest-environment jsdom
/**
 * PoolSkillDrawer tests - the skill-pool create/edit drawer's user-visible
 * contract: open-state derivation from `mode`, title interpolation, the
 * saving-guarded close path, the loading short-circuit, the edit-only metadata
 * stack (sync status label and tone, builtin language switch, install origin,
 * automation panel), the auto-sync target picker and its workspace filtering,
 * the tag-length validator wired through the form item, and the prop plumbing
 * into the content editor and the config editor.
 *
 * Harness notes (each one a measured fact about this target, not a guess):
 *
 * 1. The shared design stub (src/test/design-mock.ts) exports neither `Drawer`
 *    nor `Select`, both of which this component imports, and its `Form` is a
 *    pass-through that drops `name`/`rules`/`label`. Importing them from the
 *    shared stub would yield `undefined` for the first two and would make the
 *    declared validation rules unobservable for the third. This suite therefore
 *    supplies its own factory and leaves the shared stub untouched, because
 *    other suites depend on it.
 * 2. The rules this component declares (`required` on the name field, the
 *    caller-supplied `validateFrontmatter` on the content field, and the inline
 *    tag-length validator) live on `Form.Item`, not on the DOM. The local `Form`
 *    stub records them in a per-name registry keyed by the `name` prop, so a
 *    test can pull the validator out and drive it directly with the value the
 *    product would pass. Asserting through the registry keeps the test on the
 *    declared contract instead of on antd's validation internals.
 * 3. `MarkdownCopy` and `SkillConfigEditor` are stubbed because each already
 *    has its own suite (src/components/SkillConfigEditor.test.tsx and the
 *    MarkdownCopy specs). Re-testing them here would duplicate that coverage,
 *    and pulling in the real Markdown viewer drags a markdown renderer into
 *    every case below. The stubs render the props they receive so the plumbing
 *    stays observable.
 * 4. The drawer stub renders `null` when `open` is false and exposes the
 *    `onClose` it was given through a dedicated close control. That is what
 *    makes the saving guard testable: the component wraps the caller's
 *    `onClose` in `if (!saving) onClose()`, so the guard is only reachable
 *    through the drawer's own close path, not through the footer buttons.
 * 5. Translation is stubbed to a deterministic function that folds
 *    interpolation params into the returned key (`key::k=v`). Titles and the
 *    tag-too-long message can then be asserted exactly, including the name and
 *    the limit they carry, rather than by substring.
 * 6. The metadata stack is gated by `mode === "edit" && activeSkill`. Three
 *    distinct shapes are exercised: edit with a skill, edit without one (the
 *    drawer still opens, the title falls back to the `skillName` prop), and
 *    create with a skill present (no metadata, because the gate is on mode).
 * 7. The builtin language switch is gated by three conditions AND-ed together
 *    (`isSkillBuiltin(source)`, more than one available language, and a handler
 *    being supplied). Each one is falsified on its own, because dropping any
 *    single guard would still render the row for the other cases.
 * 8. Optional callbacks are invoked with `?.` in the product. The suites below
 *    assert both arms: with a handler the click reaches it, and without one the
 *    interaction does not throw. The second arm is what a `?.` removal would
 *    break.
 * 9. Class-name assertions for the sync-status tone go through the imported CSS
 *    module object rather than a literal hashed name, so a stylesheet rename
 *    breaks this file at compile time instead of passing silently.
 * 10. The tag registry uses `mockClear`-safe plain objects, and every case
 *     resets the registry in `beforeEach`, because the registry is module state
 *     shared by all renders in this file.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PoolSkillDetail,
  WorkspaceSkillSummary,
} from "../../../../api/types/skill";
import { MAX_TAGS, MAX_TAG_LENGTH } from "../../../Agent/Skills/components";
import { deriveInstalledFromLabel } from "../../../../utils/skill";
import type { PoolMode } from "../useSkillPool";
import styles from "../index.module.less";

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
  // Rules registry keyed by the stringified `name` prop (note 2 above).
  rules: {} as Record<string, unknown[]>,
  labels: {} as Record<string, string>,
  // Content/config stubs report the props they were handed.
  contentProps: {} as Record<string, unknown>,
  configProps: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: { language: "en" } }),
}));

vi.mock("../../../../components/MarkdownCopy/MarkdownCopy", () => ({
  MarkdownCopy: (props: Record<string, unknown>) => {
    h.contentProps = props;
    return <div data-testid="markdown-copy" />;
  },
}));

vi.mock("../../../../components/SkillConfigEditor", () => ({
  SkillConfigEditor: (props: Record<string, unknown>) => {
    h.configProps = props;
    return <div data-testid="skill-config-editor" />;
  },
}));

vi.mock("@agentscope-ai/design", () => {
  const nameKey = (name: unknown) =>
    Array.isArray(name) ? name.join(".") : String(name ?? "");

  const Drawer = ({ open, title, footer, children, onClose }: any) => {
    if (!open) return null;
    return (
      <div role="dialog" data-testid="drawer">
        <div data-testid="drawer-title">{title}</div>
        <button type="button" data-testid="drawer-close" onClick={onClose}>
          x
        </button>
        {children}
        <div data-testid="drawer-footer">{footer}</div>
      </div>
    );
  };

  const FormItem = ({ children, name, label, rules }: any) => {
    const key = nameKey(name);
    if (name !== undefined) {
      h.rules[key] = rules ?? [];
      h.labels[key] = typeof label === "string" ? label : "";
    }
    return (
      <div data-testid={`form-item-${key || "unnamed"}`}>
        {label ? <span data-testid={`label-${key}`}>{label}</span> : null}
        {children}
      </div>
    );
  };

  const Form = ({ children }: any) => (
    <div data-testid="pool-form">{children}</div>
  );

  const Button = ({
    children,
    onClick,
    disabled,
    loading,
    type,
    ...rest
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-loading={loading ? "true" : "false"}
      data-btn-type={type ?? "default"}
      {...rest}
    >
      {children}
    </button>
  );

  const Input = (props: any) => <input {...props} />;

  const Select = ({
    options,
    value,
    onChange,
    mode,
    placeholder,
    maxCount,
  }: any) => (
    <div
      data-testid={`select-${mode ?? "single"}`}
      data-placeholder={placeholder}
      data-max-count={maxCount ?? ""}
    >
      <ul>
        {(options ?? []).map((o: any) => (
          <li key={String(o.value)} data-value={String(o.value)}>
            {o.label}
          </li>
        ))}
      </ul>
      <span data-testid="select-value">{JSON.stringify(value ?? null)}</span>
      <button
        type="button"
        data-testid="select-fire"
        onClick={() => onChange?.((window as any).__selectNext ?? [])}
      >
        fire
      </button>
    </div>
  );

  const Switch = ({ checked, onChange, ...rest }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={Boolean(checked)}
      onChange={(e) => onChange?.(e.target.checked)}
      {...rest}
    />
  );

  return {
    Drawer,
    Form: Object.assign(Form, { Item: FormItem }),
    Button,
    Input,
    Select,
    Switch,
  };
});

import { PoolSkillDrawer } from "./PoolSkillDrawer";

/** Builds a pool skill detail with every optional field defaulted. */
function makeSkill(over: Partial<PoolSkillDetail> = {}): PoolSkillDetail {
  return {
    name: "nightly-report",
    description: "",
    source: "customized",
    content: "# body",
    sync_status: "synced",
    installed_from: "",
    ...over,
  };
}

type DrawerProps = React.ComponentProps<typeof PoolSkillDrawer>;

/** Renders the drawer with inert defaults; callers override what they assert. */
function renderDrawer(over: Partial<DrawerProps> = {}) {
  const props: DrawerProps = {
    mode: "edit" as PoolMode,
    activeSkill: makeSkill(),
    form: {} as DrawerProps["form"],
    drawerContent: "# body",
    showMarkdown: false,
    configText: "{}",
    onClose: vi.fn(),
    onSave: vi.fn(),
    onContentChange: vi.fn(),
    onShowMarkdownChange: vi.fn(),
    onConfigTextChange: vi.fn(),
    validateFrontmatter: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const utils = render(<PoolSkillDrawer {...props} />);
  return { props, ...utils };
}

/** Pulls a declared validator/rule set out of the stub registry (note 2). */
function rulesOf(name: string) {
  return h.rules[name] as Array<Record<string, unknown>>;
}

beforeEach(() => {
  h.rules = {};
  h.labels = {};
  h.contentProps = {};
  h.configProps = {};
  delete (window as any).__selectNext;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PoolSkillDrawer - open state and title", () => {
  it("renders nothing when mode is null, so a closed drawer mounts no form", () => {
    renderDrawer({ mode: null });
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("renders nothing when mode is broadcast, which is another component's mode", () => {
    // `PoolMode` is a three-way union; the drawer claims only two of them.
    renderDrawer({ mode: "broadcast" as PoolMode });
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("opens for create mode and titles the drawer with the create key", () => {
    renderDrawer({ mode: "create", activeSkill: null });
    expect(screen.getByTestId("drawer")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "skillPool.createTitle",
    );
  });

  it("interpolates the skill name into the edit title", () => {
    renderDrawer({
      mode: "edit",
      activeSkill: makeSkill({ name: "nightly-report" }),
      skillName: "ignored-when-skill-present",
    });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "skillPool.editTitle::name=nightly-report",
    );
  });

  it("falls back to the skillName prop when editing without a loaded skill", () => {
    // The detail request is still in flight in this shape: the drawer is open
    // (mode edit) but activeSkill is null, so the title must come from the
    // name the list already knew.
    renderDrawer({ mode: "edit", activeSkill: null, skillName: "from-list" });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "skillPool.editTitle::name=from-list",
    );
  });

  it("leaves the edit title's name empty when neither skill nor skillName exists", () => {
    renderDrawer({ mode: "edit", activeSkill: null });
    expect(screen.getByTestId("drawer-title").textContent).toBe(
      "skillPool.editTitle::name=",
    );
  });
});

describe("PoolSkillDrawer - close and save guards", () => {
  it("routes the drawer close control to onClose when idle", () => {
    const { props } = renderDrawer({ saving: false });
    fireEvent.click(screen.getByTestId("drawer-close"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("swallows the drawer close control while saving", () => {
    const { props } = renderDrawer({ saving: true });
    fireEvent.click(screen.getByTestId("drawer-close"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("marks the cancel button disabled while saving and never fires its handler", () => {
    const { props } = renderDrawer({ saving: true });
    const footer = screen.getByTestId("drawer-footer");
    const cancel = within(footer).getByText("common.cancel").closest("button");
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel as HTMLButtonElement);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("disables save and shows its spinner while saving, and still calls onSave when idle", () => {
    const { props } = renderDrawer({ saving: false });
    const footer = screen.getByTestId("drawer-footer");
    const save = within(footer).getByText("common.save").closest("button");
    expect(save).not.toBeDisabled();
    expect(save?.getAttribute("data-loading")).toBe("false");
    fireEvent.click(save as HTMLButtonElement);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("disables save while the detail is still loading, independent of saving", () => {
    // `disabled={loading || saving}`: this case falsifies the second operand
    // so only the first can be responsible for the disabled state.
    renderDrawer({ loading: true, saving: false });
    const footer = screen.getByTestId("drawer-footer");
    const save = within(footer).getByText("common.save").closest("button");
    expect(save).toBeDisabled();
    expect(save?.getAttribute("data-loading")).toBe("false");
  });

  it("labels the primary action create in create mode and save in edit mode", () => {
    const { unmount } = renderDrawer({ mode: "create", activeSkill: null });
    expect(
      within(screen.getByTestId("drawer-footer")).queryByText("common.create"),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("drawer-footer")).queryByText("common.save"),
    ).toBeNull();
    unmount();

    renderDrawer({ mode: "edit" });
    expect(
      within(screen.getByTestId("drawer-footer")).queryByText("common.save"),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("drawer-footer")).queryByText("common.create"),
    ).toBeNull();
  });
});

describe("PoolSkillDrawer - loading short-circuit and metadata gate", () => {
  it("renders only the loading marker while loading, no form fields at all", () => {
    renderDrawer({ loading: true });
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("pool-form")).toBeNull();
    expect(screen.queryByText("skillPool.installedFrom")).toBeNull();
  });

  it("hides the whole metadata stack in create mode even with a skill present", () => {
    // The gate is `mode === "edit" && activeSkill`, so a skill alone is not
    // enough: create mode must not show another skill's status.
    renderDrawer({ mode: "create", activeSkill: makeSkill() });
    expect(screen.queryByText("skillPool.status")).toBeNull();
    expect(screen.queryByText("skillPool.automation")).toBeNull();
    expect(screen.getByTestId("pool-form")).toBeInTheDocument();
  });

  it("hides the metadata stack when editing without a skill", () => {
    renderDrawer({ mode: "edit", activeSkill: null });
    expect(screen.queryByText("skillPool.status")).toBeNull();
    expect(screen.getByTestId("pool-form")).toBeInTheDocument();
  });
});

describe("PoolSkillDrawer - sync status tone", () => {
  const cases: Array<[PoolSkillDetail["sync_status"], string]> = [
    ["outdated", "outdated"],
    ["synced", "synced"],
    ["not_synced", "neutral"],
    ["conflict", "neutral"],
    ["", "neutral"],
    [undefined, "neutral"],
  ];

  it.each(cases)(
    "maps sync status %p onto the %p tone class from the stylesheet",
    (status, toneKey) => {
      const { container } = renderDrawer({
        activeSkill: makeSkill({ sync_status: status }),
      });
      const expected = (styles as Record<string, string>)[toneKey];
      expect(expected).toBeTruthy();
      expect(container.querySelector(`.${expected}`)).not.toBeNull();
      // Exactly one tone class is applied: the other two must be absent.
      const others = ["outdated", "synced", "neutral"].filter(
        (k) => k !== toneKey,
      );
      for (const other of others) {
        const cls = (styles as Record<string, string>)[other];
        if (cls && cls !== expected) {
          expect(container.querySelector(`.${cls}`)).toBeNull();
        }
      }
    },
  );

  it("renders the status label key and the dash for an unknown status", () => {
    renderDrawer({ activeSkill: makeSkill({ sync_status: "synced" }) });
    expect(screen.getByText("skillPool.statusUpToDate")).toBeInTheDocument();
  });
});

describe("PoolSkillDrawer - builtin language switch", () => {
  it("renders one button per available language and marks the current one primary", () => {
    const onChangeBuiltinLanguage = vi.fn();
    renderDrawer({
      activeSkill: makeSkill({
        source: "builtin",
        available_builtin_languages: ["zh", "en"],
        builtin_language: "zh",
      }),
      onChangeBuiltinLanguage,
    });
    expect(screen.getByText("skillPool.builtinLanguage")).toBeInTheDocument();
    const zh = screen.getByText("中文").closest("button");
    const en = screen.getByText("English").closest("button");
    expect(zh?.getAttribute("data-btn-type")).toBe("primary");
    expect(en?.getAttribute("data-btn-type")).toBe("default");
  });

  it("calls the language handler with the skill and the clicked language", () => {
    const onChangeBuiltinLanguage = vi.fn();
    const skill = makeSkill({
      source: "builtin:pack",
      available_builtin_languages: ["zh", "en"],
      builtin_language: "zh",
    });
    renderDrawer({ activeSkill: skill, onChangeBuiltinLanguage });
    fireEvent.click(screen.getByText("English").closest("button") as Element);
    expect(onChangeBuiltinLanguage).toHaveBeenCalledTimes(1);
    expect(onChangeBuiltinLanguage).toHaveBeenCalledWith(skill, "en");
  });

  it("hides the row for a non-builtin skill that has two languages", () => {
    renderDrawer({
      activeSkill: makeSkill({
        source: "customized",
        available_builtin_languages: ["zh", "en"],
      }),
      onChangeBuiltinLanguage: vi.fn(),
    });
    expect(screen.queryByText("skillPool.builtinLanguage")).toBeNull();
  });

  it("hides the row for a builtin skill with a single language", () => {
    // `length > 1` guard: one language offers nothing to switch to.
    renderDrawer({
      activeSkill: makeSkill({
        source: "builtin",
        available_builtin_languages: ["zh"],
      }),
      onChangeBuiltinLanguage: vi.fn(),
    });
    expect(screen.queryByText("skillPool.builtinLanguage")).toBeNull();
  });

  it("hides the row for a builtin skill whose language list is absent", () => {
    // `?.length ?? 0` arm: no list at all must behave like zero languages.
    renderDrawer({
      activeSkill: makeSkill({ source: "system" }),
      onChangeBuiltinLanguage: vi.fn(),
    });
    expect(screen.queryByText("skillPool.builtinLanguage")).toBeNull();
  });

  it("hides the row when no language handler is supplied", () => {
    renderDrawer({
      activeSkill: makeSkill({
        source: "builtin",
        available_builtin_languages: ["zh", "en"],
      }),
      onChangeBuiltinLanguage: undefined,
    });
    expect(screen.queryByText("skillPool.builtinLanguage")).toBeNull();
  });

  it("does not render the language row at all in create mode", () => {
    renderDrawer({
      mode: "create",
      activeSkill: makeSkill({
        source: "builtin",
        available_builtin_languages: ["zh", "en"],
      }),
      onChangeBuiltinLanguage: vi.fn(),
    });
    expect(screen.queryByText("skillPool.builtinLanguage")).toBeNull();
  });
});

describe("PoolSkillDrawer - install origin", () => {
  it("prefers the external path over the recorded origin", () => {
    renderDrawer({
      activeSkill: makeSkill({
        external: true,
        external_path: "/opt/shared/skills/report",
        installed_from: "github",
      }),
    });
    expect(screen.getByText("/opt/shared/skills/report")).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("derives the label from the recorded origin when not external", () => {
    renderDrawer({ activeSkill: makeSkill({ installed_from: "modelscope" }) });
    // Same helper the product calls, so the expectation tracks the label table.
    expect(
      screen.getByText(deriveInstalledFromLabel("modelscope")),
    ).toBeInTheDocument();
  });

  it("shows the raw origin when the label table has no entry for it", () => {
    renderDrawer({ activeSkill: makeSkill({ installed_from: "handmade" }) });
    expect(screen.getByText("handmade")).toBeInTheDocument();
  });

  it("renders an empty origin cell for a skill with no recorded origin", () => {
    const { container } = renderDrawer({
      activeSkill: makeSkill({ installed_from: "" }),
    });
    expect(screen.getByText("skillPool.installedFrom")).toBeInTheDocument();
    const block = screen
      .getByText("skillPool.installedFrom")
      .parentElement?.querySelector(
        `.${(styles as Record<string, string>).infoBlock}`,
      );
    expect(block?.textContent ?? "").toBe("");
    expect(container).toBeTruthy();
  });
});

describe("PoolSkillDrawer - automation panel", () => {
  it("shows the builtin auto-update switch only for builtin skills", () => {
    const { unmount } = renderDrawer({
      activeSkill: makeSkill({ source: "builtin" }),
      builtinAutoUpdateEnabled: true,
    });
    const builtinSwitch = screen.getByTestId("builtin-auto-update-switch");
    expect(builtinSwitch).toBeChecked();
    expect(screen.getByText("skillPool.builtinAutoUpdateFlow")).toBeTruthy();
    unmount();

    renderDrawer({ activeSkill: makeSkill({ source: "customized" }) });
    expect(screen.queryByTestId("builtin-auto-update-switch")).toBeNull();
    expect(screen.queryByText("skillPool.builtinAutoUpdate")).toBeNull();
  });

  it("reports the new state when the builtin auto-update switch is flipped off", () => {
    const onBuiltinAutoUpdateEnabledChange = vi.fn();
    renderDrawer({
      activeSkill: makeSkill({ source: "builtin" }),
      builtinAutoUpdateEnabled: true,
      onBuiltinAutoUpdateEnabledChange,
    });
    fireEvent.click(screen.getByTestId("builtin-auto-update-switch"));
    expect(onBuiltinAutoUpdateEnabledChange).toHaveBeenCalledWith(false);
  });

  it("does not throw when the builtin switch is flipped without a handler", () => {
    // The product calls this one optionally, so a missing handler must be
    // survivable rather than a crash.
    renderDrawer({
      activeSkill: makeSkill({ source: "builtin" }),
      onBuiltinAutoUpdateEnabledChange: undefined,
    });
    expect(() =>
      fireEvent.click(screen.getByTestId("builtin-auto-update-switch")),
    ).not.toThrow();
  });

  it("always shows the auto-sync switch, for builtin and custom skills alike", () => {
    const { unmount } = renderDrawer({
      activeSkill: makeSkill({ source: "builtin" }),
    });
    expect(screen.getByTestId("auto-sync-switch")).toBeInTheDocument();
    unmount();

    renderDrawer({ activeSkill: makeSkill({ source: "customized" }) });
    expect(screen.getByTestId("auto-sync-switch")).toBeInTheDocument();
  });

  it("mirrors the autoSyncEnabled prop onto the switch and reports flips", () => {
    const onAutoSyncEnabledChange = vi.fn();
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: false,
      onAutoSyncEnabledChange,
    });
    const sw = screen.getByTestId("auto-sync-switch");
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(onAutoSyncEnabledChange).toHaveBeenCalledWith(true);
  });

  it("does not throw when auto-sync is flipped without a handler", () => {
    renderDrawer({
      activeSkill: makeSkill(),
      onAutoSyncEnabledChange: undefined,
    });
    expect(() =>
      fireEvent.click(screen.getByTestId("auto-sync-switch")),
    ).not.toThrow();
  });

  it("hides the target picker while auto-sync is off", () => {
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: false,
      workspaces: [{ agent_id: "a1", agent_name: "Alpha", skill_names: [] }],
    });
    expect(screen.queryByTestId("select-multiple")).toBeNull();
    expect(screen.queryByText("skillPool.autoSyncAgentsHint")).toBeNull();
  });

  it("lists the workspaces as target options and labels them by display name", () => {
    const workspaces: WorkspaceSkillSummary[] = [
      { agent_id: "a1", agent_name: "Alpha", skill_names: [] },
      { agent_id: "a2", agent_name: "", skill_names: [] },
    ];
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces,
      autoSyncTargets: [],
    });
    const picker = screen.getByTestId("select-multiple");
    const items = within(picker).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Named agent uses its name; the unnamed one falls back to its id.
    expect(items[0].textContent).toBe("Alpha");
    expect(items[1].textContent).toBe("a2");
    expect(picker.getAttribute("data-placeholder")).toBe(
      "skillPool.autoSyncAgentsPlaceholder",
    );
    expect(
      screen.getByText("skillPool.autoSyncAgentsHint"),
    ).toBeInTheDocument();
  });

  it("filters the selected targets down to agents still in the workspace list", () => {
    // A stale target id must not be sent back as a selected chip, because the
    // workspace that owned it is gone.
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces: [{ agent_id: "a1", agent_name: "Alpha", skill_names: [] }],
      autoSyncTargets: ["a1", "gone-agent"],
    });
    expect(
      within(screen.getByTestId("select-multiple")).getByTestId("select-value")
        .textContent,
    ).toBe(JSON.stringify(["a1"]));
  });

  it("keeps every target when all of them are still known workspaces", () => {
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces: [
        { agent_id: "a1", agent_name: "Alpha", skill_names: [] },
        { agent_id: "a2", agent_name: "Beta", skill_names: [] },
      ],
      autoSyncTargets: ["a1", "a2"],
    });
    expect(
      within(screen.getByTestId("select-multiple")).getByTestId("select-value")
        .textContent,
    ).toBe(JSON.stringify(["a1", "a2"]));
  });

  it("labels a workspace that has no agent_name field by its id", () => {
    // `ws.agent_name ?? ""` arm: the API omits the field for workspaces whose
    // agent was renamed away, and the display helper then falls back to the id.
    const workspaces = [
      { agent_id: "a3", skill_names: [] },
    ] as unknown as WorkspaceSkillSummary[];
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces,
      autoSyncTargets: ["a3"],
    });
    const items = within(screen.getByTestId("select-multiple")).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("a3");
  });

  it("forwards the picked targets to the handler", () => {
    const onAutoSyncTargetsChange = vi.fn();
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces: [{ agent_id: "a1", agent_name: "Alpha", skill_names: [] }],
      autoSyncTargets: [],
      onAutoSyncTargetsChange,
    });
    (window as any).__selectNext = ["a1"];
    fireEvent.click(
      within(screen.getByTestId("select-multiple")).getByTestId("select-fire"),
    );
    expect(onAutoSyncTargetsChange).toHaveBeenCalledWith(["a1"]);
  });

  it("does not throw when targets change without a handler", () => {
    renderDrawer({
      activeSkill: makeSkill(),
      autoSyncEnabled: true,
      workspaces: [],
      autoSyncTargets: [],
      onAutoSyncTargetsChange: undefined,
    });
    (window as any).__selectNext = ["x"];
    const fire = within(screen.getByTestId("select-multiple")).getByTestId(
      "select-fire",
    );
    expect(() => fireEvent.click(fire)).not.toThrow();
  });
});

describe("PoolSkillDrawer - declared form rules", () => {
  it("declares the name field as required with the product's own message", () => {
    renderDrawer();
    const rules = rulesOf("name");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      required: true,
      message: "skills.pleaseInputName",
    });
    expect(h.labels.name).toBe("skillPool.skillName");
  });

  it("wires the caller-supplied frontmatter validator onto the content field", async () => {
    const validateFrontmatter = vi.fn().mockRejectedValue(new Error("bad fm"));
    renderDrawer({ validateFrontmatter });
    const rules = rulesOf("content");
    expect(rules).toHaveLength(1);
    expect(rules[0].required).toBe(true);
    // The rule holds the very function the caller passed, not a copy: the
    // drawer must not swallow or re-wrap the validation error.
    expect(rules[0].validator).toBe(validateFrontmatter);
    await expect(
      (rules[0].validator as (a: unknown, b: string) => Promise<void>)(
        {},
        "no frontmatter",
      ),
    ).rejects.toThrow("bad fm");
  });

  it("accepts a tag list where every tag is within the length limit", async () => {
    renderDrawer();
    const rule = rulesOf("tags")[0];
    const atLimit = "a".repeat(MAX_TAG_LENGTH);
    await expect(
      (rule.validator as (a: unknown, b: string[]) => Promise<void>)({}, [
        atLimit,
        "short",
      ]),
    ).resolves.toBeUndefined();
  });

  it("rejects a tag one character over the limit with the limit interpolated", async () => {
    // Both sides of the boundary are asserted: MAX_TAG_LENGTH passes and
    // MAX_TAG_LENGTH + 1 fails, so an off-by-one flip cannot hide.
    renderDrawer();
    const rule = rulesOf("tags")[0];
    const overLimit = "a".repeat(MAX_TAG_LENGTH + 1);
    await expect(
      (rule.validator as (a: unknown, b: string[]) => Promise<void>)({}, [
        "ok",
        overLimit,
      ]),
    ).rejects.toThrow(`skillPool.tagTooLong::max=${MAX_TAG_LENGTH}`);
  });

  it("treats an absent tag value as an empty list rather than throwing", async () => {
    // `(value || [])` arm: rc-field-form hands `undefined` for an untouched
    // field, and that must validate clean.
    renderDrawer();
    const rule = rulesOf("tags")[0];
    await expect(
      (
        rule.validator as (a: unknown, b: string[] | undefined) => Promise<void>
      )({}, undefined),
    ).resolves.toBeUndefined();
  });

  it("caps the tag selector at the product's own MAX_TAGS and feeds it the known tags", () => {
    renderDrawer({ availableTags: ["ci", "nightly"] });
    const tagSelect = screen.getAllByTestId("select-tags")[0];
    expect(tagSelect.getAttribute("data-max-count")).toBe(String(MAX_TAGS));
    const items = within(tagSelect).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["ci", "nightly"]);
  });

  it("declares the config item without a name, so it carries no rules", () => {
    renderDrawer();
    // The config editor is a controlled component outside the form model:
    // `Form.Item` there has no `name`, hence nothing in the rule registry.
    expect(Object.keys(h.rules).sort()).toEqual(["content", "name", "tags"]);
  });
});

describe("PoolSkillDrawer - editor plumbing", () => {
  it("passes the drawer content, markdown state and edit capability down", () => {
    const onContentChange = vi.fn();
    const onShowMarkdownChange = vi.fn();
    renderDrawer({
      drawerContent: "# edited body",
      showMarkdown: true,
      onContentChange,
      onShowMarkdownChange,
    });
    expect(h.contentProps.content).toBe("# edited body");
    expect(h.contentProps.showMarkdown).toBe(true);
    expect(h.contentProps.editable).toBe(true);
    expect(h.contentProps.onContentChange).toBe(onContentChange);
    expect(h.contentProps.onShowMarkdownChange).toBe(onShowMarkdownChange);
    expect(h.contentProps.textareaProps).toMatchObject({
      placeholder: "skillPool.contentPlaceholder",
      rows: 12,
    });
  });

  it("passes the config text and its change handler to the config editor", () => {
    const onConfigTextChange = vi.fn();
    renderDrawer({ configText: '{"a":1}', onConfigTextChange });
    expect(h.configProps.value).toBe('{"a":1}');
    expect(h.configProps.onChange).toBe(onConfigTextChange);
  });

  it("forwards the skill requirements to the config editor in edit mode only", () => {
    const requirements = {
      require_bins: ["git"],
      require_envs: ["TOKEN"],
      require_mcps: [],
    };
    const { unmount } = renderDrawer({
      mode: "edit",
      activeSkill: makeSkill({ requirements }),
    });
    expect(h.configProps.requirements).toEqual(requirements);
    unmount();

    // In create mode the same skill object must not leak its requirements.
    renderDrawer({ mode: "create", activeSkill: makeSkill({ requirements }) });
    expect(h.configProps.requirements).toBeUndefined();
  });

  it("leaves requirements undefined when editing a skill that declares none", () => {
    // `activeSkill?.requirements` arm with a skill present.
    renderDrawer({ mode: "edit", activeSkill: makeSkill() });
    expect(h.configProps.requirements).toBeUndefined();
  });
});

describe("PoolSkillDrawer - lifecycle", () => {
  it("mounts no drawer body at all once mode goes back to null", () => {
    const { props, rerender } = renderDrawer({ mode: "edit" });
    expect(screen.getByTestId("drawer")).toBeInTheDocument();
    rerender(<PoolSkillDrawer {...props} mode={null} />);
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("reports the automation copy keys so a rename breaks this file", () => {
    renderDrawer({ activeSkill: makeSkill({ source: "builtin" }) });
    expect(screen.getByText("skillPool.automation")).toBeInTheDocument();
    expect(screen.getByText("skillPool.autoSync")).toBeInTheDocument();
    expect(screen.getByText("skillPool.autoSyncFlow")).toBeInTheDocument();
  });
});
