// @vitest-environment jsdom
/**
 * SkillPoolPage tests - the skill-pool page shell's user-visible contract:
 * the two mutually exclusive header toolbars (batch mode versus normal mode),
 * the batch-action buttons and the empty-selection guard on the broadcast
 * button, the hidden zip import input and its ref-driven click, the three
 * import-builtin tooltip title derivations (unseen notice with lines, unseen
 * notice without lines, and no notice) plus the badge dot that mirrors the
 * unseen flag, the add-skill dropdown's four routes, the toolbar gating, the
 * search input and tag select wiring (including the select's two popup arms),
 * the view-mode toggle and its active-class derivation, the four content
 * states (loading, no-search-results, card grid, list), the progressive-render
 * sentinel arm, the per-skill prop plumbing into both card and list item
 * renderers, and the prop plumbing into the four modals plus the drawer.
 *
 * Harness notes (each one a measured fact about this target, not a guess):
 *
 * 1. `useSkillPool` is replaced by a plain object because this page's contract
 *    is "render whatever the hook reports, and route user intent back to it";
 *    the hook itself is covered by useSkillPool.test.tsx (76478 B). The object
 *    is built by `makePool()` below so each case overrides only what it needs.
 * 2. `useProgressiveRender` is stubbed rather than driven, because its real
 *    implementation observes an IntersectionObserver sentinel and jsdom's
 *    IntersectionObserver is not installed by src/test/setup.ts (only
 *    ResizeObserver and matchMedia are). The hook has its own suite
 *    (src/hooks/useProgressiveRender.test.ts). The stub returns the three
 *    fields the page reads, so the `hasMore` arm stays reachable.
 * 3. `getBuiltinNoticeLines` is stubbed to a fixed array so the tooltip title
 *    derivation can be asserted against the exact lines the page maps over,
 *    instead of against i18n notice formatting (covered by
 *    builtinNotice.test.ts). Both arms (non-empty and empty) are driven.
 * 4. The child components (`PoolSkillCard`, `PoolSkillListItem`,
 *    `PoolSkillDrawer`, `BroadcastModal`, `ImportBuiltinModal`,
 *    `ImportHubModal`, `AddSkillDropdown`, `SkillFilterDropdown`) are stubbed
 *    because each already has its own suite under ./components or
 *    ../../Agent/Skills/components. The stubs render the props they receive so
 *    the plumbing stays observable - that plumbing is this page's own logic.
 * 5. `PageHeader` is NOT stubbed: it has its own suite
 *    (src/components/PageHeader/PageHeader.test.tsx) and it renders `extra`
 *    verbatim, so keeping it real lets the header assertions go through the
 *    real breadcrumb plus the real extra slot.
 * 6. The shared design stub (src/test/design-mock.ts) exports neither `Select`
 *    nor a Tooltip that surfaces `title`, and this page reads both (the select
 *    drives the tag filter through `popupRender`/`onOpenChange`, and the
 *    tooltip title is where all three notice derivations land). This suite
 *    therefore supplies its own factory and leaves the shared stub untouched,
 *    because other suites depend on it.
 * 7. `antd`'s `Badge` is stubbed to expose `dot`, since the page sets
 *    `dot={pool.hasUnseenBuiltinNotice}` - a real antd badge renders the dot as
 *    a styled span with no readable attribute.
 * 8. Translation is stubbed to a deterministic function that folds
 *    interpolation params into the returned key (`key::k=v`), so counts carried
 *    by `skills.selectedCount` and `skillPool.importBuiltinAlertHint` can be
 *    asserted exactly rather than by substring.
 * 9. Class-name assertions for the view toggle go through the imported CSS
 *    module object rather than a literal hashed name, so a stylesheet rename
 *    breaks this file at compile time instead of passing silently.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuiltinUpdateNotice,
  PoolSkillDetail,
  PoolSkillSpec,
  WorkspaceSkillSummary,
} from "../../../api/types";
import type { FormInstance } from "antd";
import type { useSkillPool as useSkillPoolFn } from "./useSkillPool";
import styles from "./index.module.less";

type PoolState = ReturnType<typeof useSkillPoolFn>;

const h = vi.hoisted(() => ({
  // Deterministic translation stub: interpolation params are folded into the
  // returned key so counts can be asserted exactly rather than by substring.
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
  pool: {} as Record<string, unknown>,
  navigate: vi.fn(),
  noticeLines: [] as string[],
  progressive: {
    visibleItems: [] as unknown[],
    hasMore: false,
    sentinelRef: vi.fn(),
  },
  zipInput: { current: null as { click: () => void } | null },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: { language: "en" } }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
}));

vi.mock("./useSkillPool", () => ({
  useSkillPool: () => h.pool,
}));

vi.mock("../../../hooks/useProgressiveRender", () => ({
  useProgressiveRender: () => h.progressive,
}));

vi.mock("./builtinNotice", () => ({
  getBuiltinNoticeLines: () => h.noticeLines,
}));

vi.mock("@ant-design/icons", () => {
  const make = (name: string) =>
    function Icon({ spin }: { spin?: boolean }) {
      return (
        <span data-testid={`icon-${name}`} data-spin={spin ? "yes" : "no"} />
      );
    };
  return {
    AppstoreOutlined: make("appstore"),
    CloseOutlined: make("close"),
    DeleteOutlined: make("delete"),
    ReloadOutlined: make("reload"),
    SendOutlined: make("send"),
    SyncOutlined: make("sync"),
    UnorderedListOutlined: make("unordered-list"),
  };
});

vi.mock("antd", () => ({
  Badge: ({ dot, color, offset, children }: any) => (
    <span
      data-testid="notice-badge"
      data-dot={dot ? "yes" : "no"}
      data-color={color}
      data-offset={JSON.stringify(offset ?? null)}
    >
      {children}
    </span>
  ),
}));

vi.mock("@agentscope-ai/design", () => {
  const Button = ({
    children,
    onClick,
    disabled,
    danger,
    icon,
    className,
    type,
    ...rest
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-danger={danger ? "yes" : "no"}
      data-btn-type={type ?? "default"}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
  const Input = ({
    className,
    placeholder,
    value,
    onChange,
    allowClear,
  }: any) => (
    <input
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      data-allow-clear={allowClear ? "yes" : "no"}
    />
  );
  // The page drives the tag filter through the select's own popup renderer and
  // its open-state callback, so the stub must surface all four of them.
  const Select = ({
    className,
    placeholder,
    value,
    onChange,
    open,
    onOpenChange,
    popupRender,
    notFoundContent,
    mode,
    allowClear,
    maxTagCount,
  }: any) => (
    <div
      data-testid="tag-select"
      className={className}
      data-mode={mode}
      data-open={open ? "yes" : "no"}
      data-max-tag-count={String(maxTagCount)}
      data-allow-clear={allowClear ? "yes" : "no"}
    >
      <span data-testid="tag-select-placeholder">{placeholder}</span>
      <span data-testid="tag-select-value">
        {JSON.stringify(value ?? null)}
      </span>
      <span data-testid="tag-select-notfound">
        {notFoundContent === null ? "null" : "node"}
      </span>
      <button
        type="button"
        data-testid="tag-select-open"
        onClick={() => onOpenChange(true)}
      >
        open
      </button>
      <button
        type="button"
        data-testid="tag-select-close"
        onClick={() => onOpenChange(false)}
      >
        close
      </button>
      <button
        type="button"
        data-testid="tag-select-change"
        onClick={() => onChange(["tag-x", "tag-y"])}
      >
        change
      </button>
      <div data-testid="tag-select-popup">{popupRender()}</div>
    </div>
  );
  // The real tooltip decides when to show its title; this page's three notice
  // derivations all land in `title`, so the stub renders it unconditionally.
  const Tooltip = ({ title, children }: any) => (
    <div data-testid="tooltip">
      <div data-testid="tooltip-title">{title}</div>
      {children}
    </div>
  );
  return { Button, Input, Select, Tooltip };
});

vi.mock("./components", () => ({
  BroadcastModal: (props: any) => (
    <div
      data-testid="broadcast-modal"
      data-open={props.open ? "yes" : "no"}
      data-skill-count={props.skills.length}
      data-workspace-count={props.workspaces.length}
      data-initial-names={JSON.stringify(props.initialSkillNames)}
    >
      <button
        type="button"
        data-testid="broadcast-cancel"
        onClick={props.onCancel}
      >
        cancel
      </button>
      <button
        type="button"
        data-testid="broadcast-confirm"
        onClick={() => props.onConfirm(["skill-a"], ["ws-1"])}
      >
        confirm
      </button>
    </div>
  ),
  ImportBuiltinModal: (props: any) => (
    <div
      data-testid="import-builtin-modal"
      data-open={props.open ? "yes" : "no"}
      data-loading={props.loading ? "yes" : "no"}
      data-source-count={props.sources.length}
      data-language={props.defaultLanguage}
      data-default-selected={JSON.stringify(props.defaultSelectedNames ?? null)}
      data-notice-has-updates={
        props.notice ? String(props.notice.has_updates) : "null"
      }
    >
      <button
        type="button"
        data-testid="builtin-cancel"
        onClick={props.onCancel}
      >
        cancel
      </button>
      <button
        type="button"
        data-testid="builtin-confirm"
        onClick={() =>
          props.onConfirm([{ skill_name: "skill-a", language: "zh" }])
        }
      >
        confirm
      </button>
    </div>
  ),
  PoolSkillCard: (props: any) => (
    <div
      data-testid={`pool-card-${props.skill.name}`}
      data-selected={props.isSelected ? "yes" : "no"}
      data-batch={props.batchModeEnabled ? "yes" : "no"}
      data-automation-pending={props.automationPending ? "yes" : "no"}
    >
      <button
        type="button"
        data-testid={`card-select-${props.skill.name}`}
        onClick={() => props.onToggleSelect(props.skill.name)}
      >
        select
      </button>
      <button
        type="button"
        data-testid={`card-edit-${props.skill.name}`}
        onClick={() => props.onEdit(props.skill)}
      >
        edit
      </button>
      <button
        type="button"
        data-testid={`card-broadcast-${props.skill.name}`}
        onClick={() => props.onBroadcast(props.skill)}
      >
        broadcast
      </button>
      <button
        type="button"
        data-testid={`card-delete-${props.skill.name}`}
        onClick={() => props.onDelete(props.skill)}
      >
        delete
      </button>
      <button
        type="button"
        data-testid={`card-automation-${props.skill.name}`}
        onClick={() => props.onAutomationQuickAction(props.skill)}
      >
        automation
      </button>
    </div>
  ),
  PoolSkillListItem: (props: any) => (
    <div
      data-testid={`pool-row-${props.skill.name}`}
      data-selected={props.isSelected ? "yes" : "no"}
      data-batch={props.batchModeEnabled ? "yes" : "no"}
    >
      <button
        type="button"
        data-testid={`row-select-${props.skill.name}`}
        onClick={() => props.onToggleSelect(props.skill.name)}
      >
        select
      </button>
      <button
        type="button"
        data-testid={`row-edit-${props.skill.name}`}
        onClick={() => props.onEdit(props.skill)}
      >
        edit
      </button>
      <button
        type="button"
        data-testid={`row-broadcast-${props.skill.name}`}
        onClick={() => props.onBroadcast(props.skill)}
      >
        broadcast
      </button>
      <button
        type="button"
        data-testid={`row-delete-${props.skill.name}`}
        onClick={() => props.onDelete(props.skill)}
      >
        delete
      </button>
    </div>
  ),
  PoolSkillDrawer: (props: any) => (
    <div
      data-testid="pool-drawer"
      data-mode={String(props.mode)}
      data-active-skill={props.activeSkill ? props.activeSkill.name : "null"}
      data-loading={props.loading ? "yes" : "no"}
      data-saving={props.saving ? "yes" : "no"}
      data-skill-name={String(props.skillName ?? "")}
      data-show-markdown={props.showMarkdown ? "yes" : "no"}
      data-config-text={props.configText}
      data-tag-count={props.availableTags.length}
      data-workspace-count={props.workspaces.length}
      data-builtin-auto-update={props.builtinAutoUpdateEnabled ? "yes" : "no"}
      data-auto-sync={props.autoSyncEnabled ? "yes" : "no"}
      data-auto-sync-targets={JSON.stringify(props.autoSyncTargets ?? null)}
      data-drawer-content={props.drawerContent}
      data-form-keys={Object.keys(props.form).sort().join(",")}
    >
      <button type="button" data-testid="drawer-close" onClick={props.onClose}>
        close
      </button>
      <button
        type="button"
        data-testid="drawer-save"
        onClick={() => props.onSave()}
      >
        save
      </button>
      <button
        type="button"
        data-testid="drawer-content-change"
        onClick={() => props.onContentChange("# next")}
      >
        content
      </button>
      <button
        type="button"
        data-testid="drawer-markdown-change"
        onClick={() => props.onShowMarkdownChange(!props.showMarkdown)}
      >
        markdown
      </button>
      <button
        type="button"
        data-testid="drawer-config-change"
        onClick={() => props.onConfigTextChange("k: v")}
      >
        config
      </button>
      <button
        type="button"
        data-testid="drawer-language-change"
        onClick={() => props.onChangeBuiltinLanguage?.(props.activeSkill, "en")}
      >
        language
      </button>
      <button
        type="button"
        data-testid="drawer-builtin-auto-update"
        onClick={() =>
          props.onBuiltinAutoUpdateEnabledChange(
            !props.builtinAutoUpdateEnabled,
          )
        }
      >
        auto-update
      </button>
      <button
        type="button"
        data-testid="drawer-auto-sync"
        onClick={() => props.onAutoSyncEnabledChange(!props.autoSyncEnabled)}
      >
        auto-sync
      </button>
      <button
        type="button"
        data-testid="drawer-auto-sync-targets"
        onClick={() => props.onAutoSyncTargetsChange(["ws-9"])}
      >
        targets
      </button>
      <span data-testid="drawer-validate-result">
        {JSON.stringify(props.validateFrontmatter("# x"))}
      </span>
    </div>
  ),
}));

vi.mock("../../Agent/Skills/components/ImportHubModal", () => ({
  ImportHubModal: (props: any) => (
    <div
      data-testid="import-hub-modal"
      data-open={props.open ? "yes" : "no"}
      data-importing={props.importing ? "yes" : "no"}
      data-hint={props.hint}
    >
      <button type="button" data-testid="hub-cancel" onClick={props.onCancel}>
        cancel
      </button>
      <button
        type="button"
        data-testid="hub-confirm"
        onClick={() => props.onConfirm("https://x/y")}
      >
        confirm
      </button>
    </div>
  ),
}));

vi.mock("../../Agent/Skills/components/SkillFilterDropdown", () => ({
  SkillFilterDropdown: (props: any) => (
    <div
      data-testid="skill-filter-dropdown"
      data-tag-count={props.allTags.length}
      data-selected={JSON.stringify(props.searchTags)}
    >
      <button
        type="button"
        data-testid="filter-set-tags"
        onClick={() => props.setSearchTags(["tag-z"])}
      >
        set
      </button>
      <span data-testid="filter-styles-is-module">
        {props.styles === undefined ? "missing" : "present"}
      </span>
    </div>
  ),
}));

vi.mock("../../Agent/Skills/components/AddSkillDropdown", () => ({
  AddSkillDropdown: (props: any) => (
    <div data-testid="add-skill-dropdown">
      <button type="button" data-testid="add-create" onClick={props.onCreate}>
        create
      </button>
      <button
        type="button"
        data-testid="add-upload-zip"
        onClick={props.onUploadZip}
      >
        upload
      </button>
      <button
        type="button"
        data-testid="add-from-url"
        onClick={props.onFromUrl}
      >
        url
      </button>
      <button
        type="button"
        data-testid="add-browse-market"
        onClick={props.onBrowseMarket}
      >
        market
      </button>
    </div>
  ),
}));

import SkillPoolPage from "./index";

const SKILL_A: PoolSkillSpec = {
  name: "skill-a",
  source: "pool",
  description: "first",
};
const SKILL_B: PoolSkillSpec = {
  name: "skill-b",
  source: "pool",
  description: "second",
};

// The drawer receives the detail shape (content included), not the list spec.
const SKILL_A_DETAIL: PoolSkillDetail = { ...SKILL_A, content: "# body" };

const NOTICE: BuiltinUpdateNotice = {
  fingerprint: "fp-1",
  has_updates: true,
  total_changes: 2,
  actionable_skill_names: ["skill-a"],
  added: [],
  missing: [],
  updated: [],
  removed: [],
};

/**
 * Builds the hook state the page consumes. Every case overrides only the
 * fields it exercises; the defaults describe an idle, non-batch pool page with
 * two skills in list view and nothing open.
 */
function makePool(overrides: Partial<PoolState> = {}): void {
  const base: Record<string, unknown> = {
    loading: false,
    skills: [SKILL_A, SKILL_B],
    sortedSkills: [SKILL_A, SKILL_B],
    workspaces: [{ agent_id: "ws-1", skill_names: ["skill-a"] }],
    mode: null,
    activeSkill: null,
    detailLoading: false,
    detailSkillName: "",
    saving: false,
    automationPendingSkills: new Set<string>(),
    broadcastInitialNames: [],
    configText: "",
    zipInputRef: h.zipInput,
    importBuiltinModalOpen: false,
    builtinSources: [],
    builtinLanguage: "en",
    builtinNotice: null,
    builtinNoticeTotal: 0,
    hasUnseenBuiltinNotice: false,
    importBuiltinLoading: false,
    importModalOpen: false,
    importing: false,
    selectedPoolSkills: new Set<string>(),
    batchModeEnabled: false,
    viewMode: "list",
    filterOpen: false,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchTags: [],
    setSearchTags: vi.fn(),
    allTags: ["tag-1", "tag-2"],
    form: {},
    drawerContent: "",
    showMarkdown: false,
    conflictRenameModal: null,
    setImportModalOpen: vi.fn(),
    setConfigText: vi.fn(),
    builtinAutoUpdateEnabled: false,
    autoSyncEnabled: false,
    autoSyncTargets: [],
    setBuiltinAutoUpdateEnabled: vi.fn(),
    setAutoSyncEnabled: vi.fn(),
    setAutoSyncTargets: vi.fn(),
    setShowMarkdown: vi.fn(),
    setFilterOpen: vi.fn(),
    setViewMode: vi.fn(),
    handleRefresh: vi.fn(),
    closeModal: vi.fn(),
    openCreate: vi.fn(),
    openBroadcast: vi.fn(),
    openBatchBroadcast: vi.fn(),
    openImportBuiltin: vi.fn(),
    closeImportBuiltin: vi.fn(),
    closeImportModal: vi.fn(),
    openEdit: vi.fn(),
    closeDrawer: vi.fn(),
    handleDrawerContentChange: vi.fn(),
    validateFrontmatter: vi.fn(() => ({ ok: true })),
    handleBroadcast: vi.fn(),
    handleImportBuiltins: vi.fn(),
    handleBuiltinLanguageSwitch: vi.fn(),
    handleAutomationQuickAction: vi.fn(),
    handleSavePoolSkill: vi.fn(),
    handleDelete: vi.fn(),
    handleZipImport: vi.fn(),
    handleConfirmImport: vi.fn(),
    handleBatchDeletePool: vi.fn(),
    togglePoolSelect: vi.fn(),
    toggleBatchMode: vi.fn(),
    selectAllPool: vi.fn(),
    clearPoolSelection: vi.fn(),
  };
  Object.assign(base, overrides as Record<string, unknown>);
  h.pool = base;
  // The progressive-render stub mirrors the hook's own contract: it slices the
  // list it is handed. Cases that need the sentinel arm override `hasMore`.
  h.progressive = {
    visibleItems: h.pool.sortedSkills as unknown[],
    hasMore: false,
    sentinelRef: vi.fn(),
  };
}

function pool(): Record<string, unknown> {
  return h.pool as Record<string, unknown>;
}

beforeEach(() => {
  h.navigate = vi.fn();
  h.noticeLines = [];
  makePool();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SkillPoolPage - header and batch toolbar", () => {
  it("renders the breadcrumb trail and keeps the normal-mode toolbar when batch mode is off", () => {
    render(<SkillPoolPage />);
    expect(screen.getByText("nav.settings")).toBeInTheDocument();
    expect(screen.getByText("nav.skillPool")).toBeInTheDocument();
    // The batch stack must be absent, and the normal-mode stack present.
    expect(screen.queryByText("skills.selectAll")).toBeNull();
    expect(screen.getByText("skills.batchOperation")).toBeInTheDocument();
    expect(screen.getByTestId("add-skill-dropdown")).toBeInTheDocument();
  });

  it("swaps to the batch stack and reports the selection count in every batch label", () => {
    makePool({
      batchModeEnabled: true,
      selectedPoolSkills: new Set(["skill-a", "skill-b"]),
    });
    render(<SkillPoolPage />);
    expect(
      screen.getByText("skills.selectedCount::count=2"),
    ).toBeInTheDocument();
    expect(screen.getByText("skills.selectAll")).toBeInTheDocument();
    expect(screen.getByText("skills.clearSelection")).toBeInTheDocument();
    // Both transfer buttons carry the count, so a stale count is visible.
    expect(screen.getByText("skillPool.broadcast (2)")).toBeInTheDocument();
    expect(screen.getByText("common.delete (2)")).toBeInTheDocument();
    expect(screen.getByText("skills.exitBatch")).toBeInTheDocument();
    // The normal-mode stack is gone, not merely hidden.
    expect(screen.queryByText("skills.batchOperation")).toBeNull();
    expect(screen.queryByTestId("add-skill-dropdown")).toBeNull();
  });

  it("routes every batch button to its own hook handler", () => {
    makePool({
      batchModeEnabled: true,
      selectedPoolSkills: new Set(["skill-a"]),
    });
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByText("skills.selectAll"));
    expect(pool().selectAllPool).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("skills.clearSelection"));
    expect(pool().clearPoolSelection).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("skillPool.broadcast (1)"));
    expect(pool().openBatchBroadcast).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("common.delete (1)"));
    expect(pool().handleBatchDeletePool).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("skills.exitBatch"));
    expect(pool().toggleBatchMode).toHaveBeenCalledTimes(1);
  });

  it("disables the batch broadcast button only while the selection is empty", () => {
    makePool({ batchModeEnabled: true, selectedPoolSkills: new Set<string>() });
    render(<SkillPoolPage />);
    const broadcast = screen
      .getByText("skillPool.broadcast (0)")
      .closest("button");
    expect(broadcast).toBeDisabled();
    // Deleting an empty selection is not guarded, so it stays enabled.
    expect(
      screen.getByText("common.delete (0)").closest("button"),
    ).toBeEnabled();
  });

  it("enables the batch broadcast button once a skill is selected", () => {
    makePool({
      batchModeEnabled: true,
      selectedPoolSkills: new Set(["skill-a"]),
    });
    render(<SkillPoolPage />);
    expect(
      screen.getByText("skillPool.broadcast (1)").closest("button"),
    ).toBeEnabled();
  });

  it("marks the delete button as dangerous so a stylesheet rename cannot hide it", () => {
    makePool({ batchModeEnabled: true });
    render(<SkillPoolPage />);
    expect(
      screen.getByText(/common\.delete/).closest("button"),
    ).toHaveAttribute("data-danger", "yes");
  });
});

describe("SkillPoolPage - normal-mode header actions", () => {
  it("reflects the loading flag on the refresh button's spinner and its disabled state", () => {
    render(<SkillPoolPage />);
    expect(screen.getByTestId("icon-reload")).toHaveAttribute(
      "data-spin",
      "no",
    );
    expect(screen.getByTestId("icon-reload").closest("button")).toBeEnabled();
  });

  it("disables refresh and spins its icon while loading", () => {
    makePool({ loading: true });
    render(<SkillPoolPage />);
    expect(screen.getByTestId("icon-reload")).toHaveAttribute(
      "data-spin",
      "yes",
    );
    expect(screen.getByTestId("icon-reload").closest("button")).toBeDisabled();
  });

  it("routes the refresh button to handleRefresh", () => {
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByTestId("icon-reload").closest("button")!);
    expect(pool().handleRefresh).toHaveBeenCalledTimes(1);
  });

  it("routes the header broadcast button to openBroadcast", () => {
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByText("skillPool.broadcast"));
    expect(pool().openBroadcast).toHaveBeenCalledTimes(1);
  });

  it("routes the import-builtin button to openImportBuiltin", () => {
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByText("skillPool.importBuiltin"));
    expect(pool().openImportBuiltin).toHaveBeenCalledTimes(1);
  });

  it("opens the hidden zip input through the add-skill dropdown", () => {
    render(<SkillPoolPage />);
    // React commits the ref to the real input before any click can happen.
    const committed = h.zipInput.current as unknown as HTMLInputElement | null;
    expect(committed).not.toBeNull();
    expect(committed!.getAttribute("accept")).toBe(".zip");
    expect(committed!.getAttribute("type")).toBe("file");
    const click = vi.fn();
    h.zipInput.current = { click } as unknown as { click: () => void } | null;
    fireEvent.click(screen.getByTestId("add-upload-zip"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("survives the zip-input click when the ref is still empty", () => {
    render(<SkillPoolPage />);
    // The `?.` guard is the only thing standing between this click and a throw.
    h.zipInput.current = null;
    expect(() =>
      fireEvent.click(screen.getByTestId("add-upload-zip")),
    ).not.toThrow();
  });

  it("fires the zip import handler when a file is chosen", () => {
    render(<SkillPoolPage />);
    const input = h.zipInput.current as unknown as HTMLInputElement;
    fireEvent.change(input);
    expect(pool().handleZipImport).toHaveBeenCalledTimes(1);
  });

  it("routes the add-skill dropdown's create, url and market entries", () => {
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByTestId("add-create"));
    expect(pool().openCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("add-from-url"));
    expect(pool().setImportModalOpen).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("add-browse-market"));
    // The pool page sends the shared market to its own destination.
    expect(h.navigate).toHaveBeenCalledWith("/market?tab=skills&target=pool");
  });
});

describe("SkillPoolPage - import-builtin tooltip title", () => {
  function builtinTooltipTitle(): HTMLElement {
    const tooltips = screen.getAllByTestId("tooltip");
    // Order in the product: refresh hint, broadcast hint, import-builtin.
    return within(tooltips[2]).getByTestId("tooltip-title");
  }

  it("falls back to the plain hint when there is no unseen notice", () => {
    render(<SkillPoolPage />);
    expect(builtinTooltipTitle()).toHaveTextContent(
      "skillPool.importBuiltinHint",
    );
    expect(screen.getByTestId("notice-badge")).toHaveAttribute(
      "data-dot",
      "no",
    );
  });

  it("renders one element per notice line when the unseen notice has lines", () => {
    makePool({ hasUnseenBuiltinNotice: true, builtinNotice: NOTICE });
    h.noticeLines = ["added: skill-a", "updated: skill-b"];
    render(<SkillPoolPage />);
    const title = builtinTooltipTitle();
    expect(title.children).toHaveLength(2);
    expect(title.children[0]).toHaveTextContent("added: skill-a");
    expect(title.children[1]).toHaveTextContent("updated: skill-b");
    expect(screen.getByTestId("notice-badge")).toHaveAttribute(
      "data-dot",
      "yes",
    );
  });

  it("falls back to the counted hint when the notice is unseen but has no lines", () => {
    makePool({
      hasUnseenBuiltinNotice: true,
      builtinNotice: NOTICE,
      builtinNoticeTotal: 3,
    });
    h.noticeLines = [];
    render(<SkillPoolPage />);
    expect(builtinTooltipTitle()).toHaveTextContent(
      "skillPool.importBuiltinAlertHint::count=3",
    );
    expect(screen.getByTestId("notice-badge")).toHaveAttribute(
      "data-dot",
      "yes",
    );
  });

  it("keeps the badge colour and offset stable", () => {
    render(<SkillPoolPage />);
    const badge = screen.getByTestId("notice-badge");
    expect(badge).toHaveAttribute("data-color", "rgba(255, 157, 77, 1)");
    expect(badge).toHaveAttribute("data-offset", "[-4,4]");
  });
});

describe("SkillPoolPage - toolbar gating and search", () => {
  it("renders the toolbar when idle and the pool has skills", () => {
    render(<SkillPoolPage />);
    expect(
      screen.getByPlaceholderText("skills.searchPlaceholder"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tag-select")).toBeInTheDocument();
  });

  it("hides the toolbar while loading", () => {
    makePool({ loading: true });
    render(<SkillPoolPage />);
    expect(
      screen.queryByPlaceholderText("skills.searchPlaceholder"),
    ).toBeNull();
  });

  it("hides the toolbar when the pool is empty even though the list is idle", () => {
    makePool({ skills: [], sortedSkills: [] });
    render(<SkillPoolPage />);
    expect(
      screen.queryByPlaceholderText("skills.searchPlaceholder"),
    ).toBeNull();
  });

  it("mirrors the search query into the input and routes edits back to the hook", () => {
    makePool({ searchQuery: "typed" });
    render(<SkillPoolPage />);
    const input = screen.getByPlaceholderText("skills.searchPlaceholder");
    expect(input).toHaveValue("typed");
    fireEvent.change(input, { target: { value: "next" } });
    expect(pool().setSearchQuery).toHaveBeenCalledTimes(1);
  });

  it("mirrors the selected tags and the open flag into the tag select", () => {
    makePool({ searchTags: ["tag-1"], filterOpen: true });
    render(<SkillPoolPage />);
    const select = screen.getByTestId("tag-select");
    expect(select).toHaveAttribute("data-open", "yes");
    expect(within(select).getByTestId("tag-select-value")).toHaveTextContent(
      '["tag-1"]',
    );
    expect(select).toHaveAttribute("data-mode", "multiple");
    expect(select).toHaveAttribute("data-max-tag-count", "responsive");
  });

  it("routes the select's open, close and change events to their hook handlers", () => {
    render(<SkillPoolPage />);
    const select = screen.getByTestId("tag-select");
    fireEvent.click(within(select).getByTestId("tag-select-open"));
    expect(pool().setFilterOpen).toHaveBeenCalledWith(true);
    fireEvent.click(within(select).getByTestId("tag-select-close"));
    expect(pool().setFilterOpen).toHaveBeenCalledWith(false);
    fireEvent.click(within(select).getByTestId("tag-select-change"));
    expect(pool().setSearchTags).toHaveBeenCalledWith(["tag-x", "tag-y"]);
  });

  it("renders the filter dropdown as the popup when the pool has tags", () => {
    render(<SkillPoolPage />);
    const popup = screen.getByTestId("tag-select-popup");
    const dropdown = within(popup).getByTestId("skill-filter-dropdown");
    expect(dropdown).toHaveAttribute("data-tag-count", "2");
    expect(
      within(dropdown).getByTestId("filter-styles-is-module"),
    ).toHaveTextContent("present");
    fireEvent.click(within(dropdown).getByTestId("filter-set-tags"));
    expect(pool().setSearchTags).toHaveBeenCalledWith(["tag-z"]);
  });

  it("renders the no-tags placeholder as the popup when the pool has none", () => {
    makePool({ allTags: [] });
    render(<SkillPoolPage />);
    const popup = screen.getByTestId("tag-select-popup");
    expect(within(popup).queryByTestId("skill-filter-dropdown")).toBeNull();
    expect(within(popup).getByText("skills.noTags")).toBeInTheDocument();
  });

  it("passes an empty fragment as the select's not-found content", () => {
    render(<SkillPoolPage />);
    expect(
      within(screen.getByTestId("tag-select")).getByTestId(
        "tag-select-notfound",
      ),
    ).toHaveTextContent("node");
  });
});

describe("SkillPoolPage - view toggle", () => {
  it("marks the list button active in list mode and routes both buttons", () => {
    render(<SkillPoolPage />);
    const listBtn = screen.getByTitle("skills.listView");
    const cardBtn = screen.getByTitle("skills.gridView");
    expect(listBtn.className).toContain(styles.viewToggleBtnActive);
    expect(cardBtn.className).not.toContain(styles.viewToggleBtnActive);
    fireEvent.click(cardBtn);
    expect(pool().setViewMode).toHaveBeenCalledWith("card");
    fireEvent.click(listBtn);
    expect(pool().setViewMode).toHaveBeenCalledWith("list");
  });

  it("marks the card button active in card mode", () => {
    makePool({ viewMode: "card" });
    render(<SkillPoolPage />);
    expect(screen.getByTitle("skills.gridView").className).toContain(
      styles.viewToggleBtnActive,
    );
    expect(screen.getByTitle("skills.listView").className).not.toContain(
      styles.viewToggleBtnActive,
    );
  });
});

describe("SkillPoolPage - content states", () => {
  it("shows the loading state instead of any skill row", () => {
    makePool({ loading: true });
    render(<SkillPoolPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("pool-row-skill-a")).toBeNull();
  });

  it("shows the no-results state when the filter emptied the list but the pool is not empty", () => {
    makePool({ sortedSkills: [] });
    render(<SkillPoolPage />);
    expect(screen.getByText("skills.noSearchResults")).toBeInTheDocument();
    expect(screen.queryByTestId("pool-row-skill-a")).toBeNull();
  });

  it("shows neither loading nor no-results when the pool itself is empty", () => {
    makePool({ skills: [], sortedSkills: [] });
    render(<SkillPoolPage />);
    expect(screen.queryByText("common.loading")).toBeNull();
    expect(screen.queryByText("skills.noSearchResults")).toBeNull();
  });

  it("renders list rows in list mode and a responsive grid in card mode", () => {
    render(<SkillPoolPage />);
    expect(screen.getByTestId("pool-row-skill-a")).toBeInTheDocument();
    expect(screen.queryByTestId("pool-card-skill-a")).toBeNull();
  });

  it("renders cards on the responsive grid class when in card mode", () => {
    makePool({ viewMode: "card" });
    render(<SkillPoolPage />);
    const grid = screen.getByTestId("pool-card-skill-a").parentElement!;
    expect(grid.className).toContain(styles.skillsGrid);
    expect(grid.className).toContain("responsive-grid");
    expect(screen.queryByTestId("pool-row-skill-a")).toBeNull();
  });

  it("renders every visible skill in list mode", () => {
    render(<SkillPoolPage />);
    expect(screen.getByTestId("pool-row-skill-a")).toBeInTheDocument();
    expect(screen.getByTestId("pool-row-skill-b")).toBeInTheDocument();
  });

  it("omits the progressive-render sentinel while everything is visible", () => {
    render(<SkillPoolPage />);
    expect(h.progressive.sentinelRef).not.toHaveBeenCalled();
  });

  it("attaches the progressive-render sentinel in list mode when more items remain", () => {
    makePool();
    h.progressive.hasMore = true;
    render(<SkillPoolPage />);
    expect(h.progressive.sentinelRef).toHaveBeenCalledTimes(1);
    const sentinel = h.progressive.sentinelRef.mock.calls[0][0] as HTMLElement;
    expect(sentinel.style.height).toBe("1px");
  });

  it("attaches the progressive-render sentinel in card mode too", () => {
    makePool({ viewMode: "card" });
    h.progressive.hasMore = true;
    render(<SkillPoolPage />);
    expect(h.progressive.sentinelRef).toHaveBeenCalledTimes(1);
  });
});

describe("SkillPoolPage - per-skill prop plumbing", () => {
  it("marks a row as selected only when its name is in the selection set", () => {
    makePool({
      batchModeEnabled: true,
      selectedPoolSkills: new Set(["skill-b"]),
    });
    render(<SkillPoolPage />);
    expect(screen.getByTestId("pool-row-skill-a")).toHaveAttribute(
      "data-selected",
      "no",
    );
    expect(screen.getByTestId("pool-row-skill-b")).toHaveAttribute(
      "data-selected",
      "yes",
    );
    expect(screen.getByTestId("pool-row-skill-a")).toHaveAttribute(
      "data-batch",
      "yes",
    );
  });

  it("routes a row's four actions with that row's own skill", () => {
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByTestId("row-select-skill-b"));
    expect(pool().togglePoolSelect).toHaveBeenCalledWith("skill-b");
    fireEvent.click(screen.getByTestId("row-edit-skill-a"));
    expect(pool().openEdit).toHaveBeenCalledWith(SKILL_A);
    fireEvent.click(screen.getByTestId("row-broadcast-skill-a"));
    expect(pool().openBroadcast).toHaveBeenCalledWith(SKILL_A);
    fireEvent.click(screen.getByTestId("row-delete-skill-b"));
    expect(pool().handleDelete).toHaveBeenCalledWith(SKILL_B);
  });

  it("flags a card as automation-pending only for names in the pending set", () => {
    makePool({
      viewMode: "card",
      automationPendingSkills: new Set(["skill-a"]),
    });
    render(<SkillPoolPage />);
    expect(screen.getByTestId("pool-card-skill-a")).toHaveAttribute(
      "data-automation-pending",
      "yes",
    );
    expect(screen.getByTestId("pool-card-skill-b")).toHaveAttribute(
      "data-automation-pending",
      "no",
    );
  });

  it("routes a card's five actions with that card's own skill", () => {
    makePool({ viewMode: "card" });
    render(<SkillPoolPage />);
    fireEvent.click(screen.getByTestId("card-select-skill-a"));
    expect(pool().togglePoolSelect).toHaveBeenCalledWith("skill-a");
    fireEvent.click(screen.getByTestId("card-edit-skill-b"));
    expect(pool().openEdit).toHaveBeenCalledWith(SKILL_B);
    fireEvent.click(screen.getByTestId("card-broadcast-skill-a"));
    expect(pool().openBroadcast).toHaveBeenCalledWith(SKILL_A);
    fireEvent.click(screen.getByTestId("card-delete-skill-b"));
    expect(pool().handleDelete).toHaveBeenCalledWith(SKILL_B);
    fireEvent.click(screen.getByTestId("card-automation-skill-a"));
    expect(pool().handleAutomationQuickAction).toHaveBeenCalledWith(SKILL_A);
  });
});

describe("SkillPoolPage - modal and drawer plumbing", () => {
  it("opens the broadcast modal only while the mode is broadcast, with the pool's skills and workspaces", () => {
    render(<SkillPoolPage />);
    expect(screen.getByTestId("broadcast-modal")).toHaveAttribute(
      "data-open",
      "no",
    );
  });

  it("opens the broadcast modal and seeds its initial names in broadcast mode", () => {
    makePool({ mode: "broadcast", broadcastInitialNames: ["skill-b"] });
    render(<SkillPoolPage />);
    const modal = screen.getByTestId("broadcast-modal");
    expect(modal).toHaveAttribute("data-open", "yes");
    expect(modal).toHaveAttribute("data-skill-count", "2");
    expect(modal).toHaveAttribute("data-workspace-count", "1");
    expect(modal).toHaveAttribute("data-initial-names", '["skill-b"]');
    fireEvent.click(within(modal).getByTestId("broadcast-cancel"));
    expect(pool().closeModal).toHaveBeenCalledTimes(1);
    fireEvent.click(within(modal).getByTestId("broadcast-confirm"));
    expect(pool().handleBroadcast).toHaveBeenCalledWith(["skill-a"], ["ws-1"]);
  });

  it("opens the hub modal from the hook flag and routes both of its buttons", () => {
    makePool({ importModalOpen: true, importing: true });
    render(<SkillPoolPage />);
    const modal = screen.getByTestId("import-hub-modal");
    expect(modal).toHaveAttribute("data-open", "yes");
    expect(modal).toHaveAttribute("data-importing", "yes");
    expect(modal).toHaveAttribute("data-hint", "skillPool.externalHubHint");
    fireEvent.click(within(modal).getByTestId("hub-cancel"));
    expect(pool().closeImportModal).toHaveBeenCalledTimes(1);
    fireEvent.click(within(modal).getByTestId("hub-confirm"));
    expect(pool().handleConfirmImport).toHaveBeenCalledWith("https://x/y");
  });

  it("opens the import-builtin modal from the hook flag and passes the notice's default selection", () => {
    makePool({
      importBuiltinModalOpen: true,
      importBuiltinLoading: true,
      builtinSources: [{ name: "builtin-skill" }],
      builtinLanguage: "zh",
      builtinNotice: NOTICE,
    });
    render(<SkillPoolPage />);
    const modal = screen.getByTestId("import-builtin-modal");
    expect(modal).toHaveAttribute("data-open", "yes");
    expect(modal).toHaveAttribute("data-loading", "yes");
    expect(modal).toHaveAttribute("data-source-count", "1");
    expect(modal).toHaveAttribute("data-language", "zh");
    expect(modal).toHaveAttribute("data-notice-has-updates", "true");
    expect(modal).toHaveAttribute("data-default-selected", '["skill-a"]');
    fireEvent.click(within(modal).getByTestId("builtin-cancel"));
    expect(pool().closeImportBuiltin).toHaveBeenCalledTimes(1);
    fireEvent.click(within(modal).getByTestId("builtin-confirm"));
    expect(pool().handleImportBuiltins).toHaveBeenCalledWith([
      { skill_name: "skill-a", language: "zh" },
    ]);
  });

  it("passes a null notice default selection through untouched", () => {
    makePool({ importBuiltinModalOpen: true, builtinNotice: null });
    render(<SkillPoolPage />);
    const modal = screen.getByTestId("import-builtin-modal");
    expect(modal).toHaveAttribute("data-default-selected", "null");
    expect(modal).toHaveAttribute("data-notice-has-updates", "null");
  });

  it("mirrors the hook's drawer state into the drawer and routes all of its callbacks", () => {
    makePool({
      mode: "edit",
      activeSkill: SKILL_A_DETAIL,
      detailLoading: true,
      saving: true,
      detailSkillName: "skill-a",
      showMarkdown: true,
      configText: "a: 1",
      drawerContent: "# body",
      allTags: ["tag-1", "tag-2", "tag-3"],
      workspaces: [
        { agent_id: "ws-1", skill_names: [] },
        { agent_id: "ws-2", skill_names: [] },
      ] as WorkspaceSkillSummary[],
      builtinAutoUpdateEnabled: true,
      autoSyncEnabled: true,
      autoSyncTargets: ["ws-1"],
      form: { name: "skill-a", tags: [] } as unknown as FormInstance,
    });
    render(<SkillPoolPage />);
    const drawer = screen.getByTestId("pool-drawer");
    expect(drawer).toHaveAttribute("data-mode", "edit");
    expect(drawer).toHaveAttribute("data-active-skill", "skill-a");
    expect(drawer).toHaveAttribute("data-loading", "yes");
    expect(drawer).toHaveAttribute("data-saving", "yes");
    expect(drawer).toHaveAttribute("data-skill-name", "skill-a");
    expect(drawer).toHaveAttribute("data-show-markdown", "yes");
    expect(drawer).toHaveAttribute("data-config-text", "a: 1");
    expect(drawer).toHaveAttribute("data-drawer-content", "# body");
    expect(drawer).toHaveAttribute("data-tag-count", "3");
    expect(drawer).toHaveAttribute("data-workspace-count", "2");
    expect(drawer).toHaveAttribute("data-builtin-auto-update", "yes");
    expect(drawer).toHaveAttribute("data-auto-sync", "yes");
    expect(drawer).toHaveAttribute("data-auto-sync-targets", '["ws-1"]');
    expect(drawer).toHaveAttribute("data-form-keys", "name,tags");
    expect(
      within(drawer).getByTestId("drawer-validate-result"),
    ).toHaveTextContent('{"ok":true}');

    fireEvent.click(within(drawer).getByTestId("drawer-close"));
    expect(pool().closeDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawer).getByTestId("drawer-save"));
    expect(pool().handleSavePoolSkill).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawer).getByTestId("drawer-content-change"));
    expect(pool().handleDrawerContentChange).toHaveBeenCalledWith("# next");
    fireEvent.click(within(drawer).getByTestId("drawer-markdown-change"));
    expect(pool().setShowMarkdown).toHaveBeenCalledWith(false);
    fireEvent.click(within(drawer).getByTestId("drawer-config-change"));
    expect(pool().setConfigText).toHaveBeenCalledWith("k: v");
    fireEvent.click(within(drawer).getByTestId("drawer-language-change"));
    expect(pool().handleBuiltinLanguageSwitch).toHaveBeenCalledWith(
      SKILL_A_DETAIL,
      "en",
    );
    fireEvent.click(within(drawer).getByTestId("drawer-builtin-auto-update"));
    expect(pool().setBuiltinAutoUpdateEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(within(drawer).getByTestId("drawer-auto-sync"));
    expect(pool().setAutoSyncEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(within(drawer).getByTestId("drawer-auto-sync-targets"));
    expect(pool().setAutoSyncTargets).toHaveBeenCalledWith(["ws-9"]);
  });

  it("renders the hook's conflict-rename modal node verbatim", () => {
    makePool({ conflictRenameModal: <div data-testid="conflict-rename" /> });
    render(<SkillPoolPage />);
    expect(screen.getByTestId("conflict-rename")).toBeInTheDocument();
  });

  it("renders nothing extra when the hook has no conflict modal", () => {
    render(<SkillPoolPage />);
    expect(screen.queryByTestId("conflict-rename")).toBeNull();
  });
});
