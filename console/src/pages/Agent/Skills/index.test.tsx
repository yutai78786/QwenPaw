// @vitest-environment jsdom
/**
 * SkillsPage tests - the workspace skills page shell's user-visible contract.
 *
 * Visible contract under test (each one can be broken by a product change, so
 * none of them is a tautology):
 *
 *  1. the shared market entry keeps the install destination: clicking the
 *     header's "browse market" action navigates to the literal
 *     "/market?tab=skills&target=workspace" (the skill pool uses the same page
 *     with a different destination, so a shared constant would be wrong);
 *  2. the managed-by-QwenPaw banner is gated SOLELY on
 *     `providerSkills.length > 0`;
 *  3. the skills toolbar is gated on TWO conditions at once - not loading AND
 *     at least one skill - so all three of (loading, empty, populated) differ;
 *  4. the content area has exactly four mutually exclusive states driven by
 *     `loading`, `skills.length`, `sortedSkills.length`: loading text, empty
 *     state (whose compact class additionally depends on `providerSkills`),
 *     no-search-results, and the sections;
 *  5. the enabled/disabled split is computed from `visibleSkills` (not from
 *     `skills` and not from `sortedSkills`), while the count badge in the
 *     enabled header is computed from `sortedSkills` - two different sources,
 *     so a mix-up is caught;
 *  6. `viewMode` switches BOTH sections between grid and list, and the list
 *     arm routes through the shared `renderSkillListItem` callback factory;
 *  7. in card mode `selected` is `selectedSkills.has(name)` ONLY while batch
 *     mode is on, and exactly `undefined` otherwise (a `false` instead of
 *     `undefined` would leak batch styling onto normal cards);
 *  8. the disabled grid item's enable affordance calls `stopPropagation` and
 *     then the toggle handler, and never opens the editor - while the item's
 *     own click does open the editor;
 *  9. the provider section renders one button per discovered skill with a
 *     derived `aria-label`, a description fallback to `skills.noDescription`,
 *     an enabled/disabled label, and a `source` chip that disappears when
 *     `source` is empty; clicking a card opens the ProviderSkillDrawer with
 *     that exact skill object, and the drawer is closed (open=false) when no
 *     provider skill is selected;
 * 10. the progressive-render sentinel is rendered ONLY when `hasMore`;
 * 11. the per-skill plumbing into SkillCard and SkillListItem, and the prop
 *     plumbing into ImportHubModal / PoolTransferModal / SkillDrawer /
 *     PageHeader.extra (HeaderActions), stays faithful.
 *
 * Harness notes (measured facts about this target, not guesses):
 *
 * - `useSkillsPage` is replaced by a plain object built by `makeState()`; the
 *   hook itself has two suites (useSkillsPage.test.ts 12612 B and
 *   useSkillsPage.test.tsx 34014 B). This page's own logic is the grouping,
 *   the gating and the plumbing, so the hook is not driven here.
 * - Every component imported from `./components` is stubbed with a recorder
 *   that renders the props it received as data attributes, because each of
 *   them already has its own suite in ./components (SkillCard.test.tsx,
 *   SkillDrawer.test.tsx, ImportHubModal.test.tsx, PoolTransferModal.test.tsx,
 *   HeaderActions.test.tsx, SkillsToolbar.test.tsx, ProviderSkillDrawer.test.tsx).
 *   `SkillListItem.tsx` is the one exception without a suite of its own, so its
 *   stub only records the props this page is responsible for passing.
 * - `PageHeader` is NOT stubbed: it renders `items` and `extra` verbatim
 *   (src/components/PageHeader/index.tsx:47-73) and has its own suite, so the
 *   breadcrumb and the header-actions slot are asserted through the real one.
 * - `@agentscope-ai/design` is aliased to src/test/design-mock.ts by
 *   vite.config.ts:87-89, whose `Button` renders a real <button> with
 *   children and onClick; that is enough for the empty-state primary action,
 *   so the shared stub is left untouched.
 * - `@agentscope-ai/icons` is aliased to src/test/icons-mock.ts (vite.config.ts:91-93);
 *   `@ant-design/icons` and `lucide-react` are NOT aliased, so this file mocks
 *   the two icons it reads (`PlusOutlined`, `LockKeyhole`, `Sparkles`) into
 *   labelled spans.
 * - Translation is stubbed to fold interpolation params into the returned key
 *   (`key::k=v`), so the count in the enabled header and the derived
 *   `aria-label` can be asserted exactly rather than by substring.
 * - Class-name assertions go through the imported CSS module object rather
 *   than a literal hashed name, so a stylesheet rename breaks this file at
 *   compile time instead of passing silently.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillDetail, SkillSpec } from "../../../api/types";
import type { HarnessDiscoveredSkill } from "../../../api/modules/harness";
import type { useSkillsPage as useSkillsPageFn } from "./useSkillsPage";
import styles from "./index.module.less";

type PageState = ReturnType<typeof useSkillsPageFn>;

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
  state: {} as Record<string, unknown>,
  navigate: vi.fn(),
  // Props each stubbed child received on its most recent render, keyed by the
  // child name. Reset per render so a stale value can never satisfy a case.
  seen: {} as Record<string, Record<string, unknown>>,
  calls: [] as string[],
}));

const makeSkill = (over: Partial<SkillSpec> = {}): SkillSpec => ({
  name: "skill-a",
  source: "workspace",
  enabled: true,
  channels: ["all"],
  ...over,
});

const makeSkillDetail = (over: Partial<SkillDetail> = {}): SkillDetail => ({
  ...makeSkill(over),
  content: "# skill body",
  ...over,
});

const makeProviderSkill = (
  over: Partial<HarnessDiscoveredSkill> = {},
): HarnessDiscoveredSkill => ({
  name: "prov-a",
  description: "provider managed",
  provider_id: "harness-1",
  source: "builtin",
  enabled: true,
  read_only: true,
  scope: "provider",
  ...over,
});

const makeState = (over: Partial<PageState> = {}): PageState =>
  ({
    channelOptions: [],
    getChannelName: (key: string) => `channel::${key}`,
    skills: [makeSkill()],
    providerSkills: [],
    visibleSkills: [makeSkill()],
    hasMore: false,
    sentinelRef: { current: null },
    poolSkills: [],
    allTags: [],
    sortedSkills: [makeSkill()],
    conflictRenameModal: <div data-testid="conflict-rename-modal" />,
    loading: false,
    uploading: false,
    importing: false,
    drawerOpen: false,
    drawerLoading: false,
    editingSkillName: null,
    importModalOpen: false,
    setImportModalOpen: vi.fn(),
    editingSkill: null,
    form: { resetFields: vi.fn() },
    fileInputRef: { current: null },
    poolModal: null,
    setPoolModal: vi.fn(),
    selectedSkills: new Set<string>(),
    batchModeEnabled: false,
    viewMode: "card",
    setViewMode: vi.fn(),
    filterOpen: false,
    setFilterOpen: vi.fn(),
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchTags: [],
    setSearchTags: vi.fn(),
    handleCreate: vi.fn(),
    handleEdit: vi.fn(),
    handleToggleEnabled: vi.fn(),
    handleDelete: vi.fn(),
    handleDrawerClose: vi.fn(),
    handleSubmit: vi.fn(),
    handleUploadToPool: vi.fn(),
    handleDownloadFromPool: vi.fn(),
    handleBatchEnable: vi.fn(),
    handleBatchDisable: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleUploadClick: vi.fn(),
    handleFileChange: vi.fn(),
    handleConfirmImport: vi.fn(),
    closeImportModal: vi.fn(),
    closePoolModal: vi.fn(),
    toggleSelect: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    toggleBatchMode: vi.fn(),
    toggleEnabled: vi.fn(),
    refreshSkills: vi.fn(),
    hardRefresh: vi.fn(),
    cancelImport: vi.fn(),
    ...over,
  }) as unknown as PageState;

const renderPage = (over: Partial<PageState> = {}) => {
  const state = makeState(over);
  h.state = state as unknown as Record<string, unknown>;
  h.seen = {};
  h.calls = [];
  h.navigate.mockClear();
  const utils = render(<SkillsPage />);
  return { ...utils, state };
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: { language: "en" } }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
}));

vi.mock("./useSkillsPage", () => ({
  useSkillsPage: () => h.state,
}));

vi.mock("@ant-design/icons", () => ({
  PlusOutlined: () => <span data-testid="icon-plus" />,
}));

vi.mock("lucide-react", () => ({
  LockKeyhole: ({ size }: { size?: number }) => (
    <span data-testid="icon-lock" data-size={String(size)} />
  ),
  Sparkles: ({ size }: { size?: number }) => (
    <span data-testid="icon-sparkles" data-size={String(size)} />
  ),
}));

// Every child comes from the ./components barrel. Each of them has its own
// suite already (SkillListItem being the single exception), so they are
// replaced by recorders that hand back the props this page is responsible for
// passing. Recording by data attribute keeps the assertions on the plumbing
// itself instead of on the child's rendering.
vi.mock("./components", () => {
  const rec = (name: string) =>
    function Stub(props: Record<string, unknown>) {
      h.seen[name] = props;
      h.calls.push(name);
      return (
        <div
          data-testid={`stub-${name}`}
          data-open={String(props.open)}
          data-mode={String(props.mode)}
          data-importing={String(props.importing)}
          data-hint={String(props.hint)}
          data-editing={String(props.editing)}
          data-editing-name={String(props.editingName)}
          data-loading={String(props.loading)}
          data-skill={String((props.skill as { name?: string })?.name)}
          data-skills={String(
            JSON.stringify(
              ((props.skills as { name: string }[]) ?? []).map((s) => s.name),
            ),
          )}
          data-pool-skills={String(
            JSON.stringify(
              ((props.poolSkills as { name: string }[]) ?? []).map(
                (s) => s.name,
              ),
            ),
          )}
          data-available-tags={String(
            JSON.stringify(props.availableTags ?? null),
          )}
          data-batch-mode={String(props.batchModeEnabled)}
          data-is-selected={String(props.isSelected)}
          data-selected={
            props.selected === undefined ? "undef" : String(props.selected)
          }
          data-uploading={String(props.uploading)}
          data-selected-skills={String(
            JSON.stringify(
              [
                ...((props.selectedSkills as Set<string>) ?? new Set<string>()),
              ].sort(),
            ),
          )}
          data-search-query={String(props.searchQuery)}
          data-view-mode={String(props.viewMode)}
          data-filter-open={String(props.filterOpen)}
          data-all-tags={String(JSON.stringify(props.allTags ?? null))}
          data-search-tags={String(JSON.stringify(props.searchTags ?? null))}
          data-channel-options={String(
            JSON.stringify(props.channelOptions ?? null),
          )}
          data-skill-name={String((props.skill as { name?: string })?.name)}
        >
          <button
            type="button"
            data-testid={`${name}-click`}
            onClick={(e) => {
              (props.onClick as (() => void) | undefined)?.();
              e.stopPropagation();
            }}
          />
          <button
            type="button"
            data-testid={`${name}-select`}
            onClick={() => (props.onSelect as (() => void) | undefined)?.()}
          />
          <button
            type="button"
            data-testid={`${name}-toggle`}
            onClick={(e) =>
              (props.onToggleEnabled as ((ev?: unknown) => void) | undefined)?.(
                e,
              )
            }
          />
          <button
            type="button"
            data-testid={`${name}-delete`}
            onClick={(e) =>
              (props.onDelete as ((ev?: unknown) => void) | undefined)?.(e)
            }
          />
          <button
            type="button"
            data-testid={`${name}-mouse-enter`}
            onMouseEnter={() =>
              (props.onMouseEnter as (() => void) | undefined)?.()
            }
          />
          <button
            type="button"
            data-testid={`${name}-mouse-leave`}
            onMouseLeave={() =>
              (props.onMouseLeave as (() => void) | undefined)?.()
            }
          />
          <button
            type="button"
            data-testid={`${name}-import-hub`}
            onClick={() => (props.onImportHub as (() => void) | undefined)?.()}
          />
          <button
            type="button"
            data-testid={`${name}-browse-market`}
            onClick={() =>
              (props.onBrowseMarket as (() => void) | undefined)?.()
            }
          />
          <button
            type="button"
            data-testid={`${name}-close`}
            onClick={() => (props.onClose as (() => void) | undefined)?.()}
          />
        </div>
      );
    };
  return {
    SkillCard: rec("SkillCard"),
    SkillDrawer: rec("SkillDrawer"),
    PoolTransferModal: rec("PoolTransferModal"),
    ImportHubModal: rec("ImportHubModal"),
    HeaderActions: rec("HeaderActions"),
    SkillsToolbar: rec("SkillsToolbar"),
    SkillListItem: rec("SkillListItem"),
    ProviderSkillDrawer: rec("ProviderSkillDrawer"),
    getSkillVisual: (name: string, emoji?: string) => (
      <span data-testid="skill-visual">
        {emoji ? emoji : `visual::${name}`}
      </span>
    ),
  };
});

import SkillsPage from "./index";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsPage", () => {
  it("routes the market entry to the shared market page with the workspace destination", () => {
    const { getByTestId } = renderPage();
    fireEvent.click(getByTestId("HeaderActions-browse-market"));
    expect(h.navigate).toHaveBeenCalledWith(
      "/market?tab=skills&target=workspace",
    );
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("builds the breadcrumb from nav.agent then skills.title", () => {
    const { container } = renderPage();
    const crumbs = within(container).getAllByText(
      /^(nav\.agent|skills\.title)$/,
    );
    expect(crumbs.map((c) => c.textContent)).toEqual([
      "nav.agent",
      "skills.title",
    ]);
  });

  it("hands the header the raw hook callbacks, not page-local wrappers", () => {
    const { getByTestId } = renderPage({
      batchModeEnabled: true,
      selectedSkills: new Set(["skill-b", "skill-a"]),
      uploading: true,
    });
    const stub = getByTestId("stub-HeaderActions");
    expect(stub.getAttribute("data-batch-mode")).toBe("true");
    expect(stub.getAttribute("data-uploading")).toBe("true");
    expect(stub.getAttribute("data-loading")).toBe("false");
    // The page passes the hook's Set straight through (sorted for the assert).
    expect(stub.getAttribute("data-selected-skills")).toBe(
      '["skill-a","skill-b"]',
    );
    const s = h.state as unknown as PageState;
    // Identity checks: a page-local arrow wrapper around any of these would
    // break equality, and that is exactly the regression this catches.
    expect(h.seen["HeaderActions"]?.["onSelectAll"]).toBe(s.selectAll);
    expect(h.seen["HeaderActions"]?.["onClearSelection"]).toBe(
      s.clearSelection,
    );
    expect(h.seen["HeaderActions"]?.["onUploadToPool"]).toBe(
      s.handleUploadToPool,
    );
    expect(h.seen["HeaderActions"]?.["onBatchEnable"]).toBe(
      s.handleBatchEnable,
    );
    expect(h.seen["HeaderActions"]?.["onBatchDisable"]).toBe(
      s.handleBatchDisable,
    );
    expect(h.seen["HeaderActions"]?.["onBatchDelete"]).toBe(
      s.handleBatchDelete,
    );
    expect(h.seen["HeaderActions"]?.["onToggleBatchMode"]).toBe(
      s.toggleBatchMode,
    );
    expect(h.seen["HeaderActions"]?.["onHardRefresh"]).toBe(s.hardRefresh);
    expect(h.seen["HeaderActions"]?.["onUploadClick"]).toBe(
      s.handleUploadClick,
    );
    expect(h.seen["HeaderActions"]?.["onImportHub"]).not.toBe(
      s.setImportModalOpen,
    );
    expect(h.seen["HeaderActions"]?.["onCreate"]).toBe(s.handleCreate);
    expect(h.seen["HeaderActions"]?.["fileInputRef"]).toBe(s.fileInputRef);
    // The two page-local callbacks open their own destination.
    (h.seen["HeaderActions"]?.["onOpenDownloadPool"] as () => void)();
    expect(s.setPoolModal).toHaveBeenCalledWith("download");
    (h.seen["HeaderActions"]?.["onOpenUploadPool"] as () => void)();
    expect(s.setPoolModal).toHaveBeenCalledWith("upload");
    (h.seen["HeaderActions"]?.["onFileChange"] as () => void)();
    expect(s.handleFileChange).toHaveBeenCalledTimes(1);
    expect(getByTestId("stub-HeaderActions")).toBeInTheDocument();
  });

  it("shows the managed banner only when the provider reported skills", () => {
    const withoutProvider = renderPage();
    expect(withoutProvider.queryByText("skills.qwenpawManaged")).toBeNull();
    cleanup();

    const withProvider = renderPage({
      providerSkills: [makeProviderSkill()],
    });
    expect(withProvider.getByText("skills.qwenpawManaged")).toBeInTheDocument();
    expect(
      withProvider.getByText("skills.qwenpawManagedHint"),
    ).toBeInTheDocument();
    expect(
      withProvider.getByTestId("icon-sparkles").getAttribute("data-size"),
    ).toBe("16");
  });

  it("gates the toolbar on both loading and a non-empty skill list", () => {
    const loading = renderPage({ loading: true, skills: [makeSkill()] });
    expect(loading.queryByTestId("stub-SkillsToolbar")).toBeNull();
    cleanup();

    const empty = renderPage({ loading: false, skills: [] });
    expect(empty.queryByTestId("stub-SkillsToolbar")).toBeNull();
    cleanup();

    const populated = renderPage({ loading: false, skills: [makeSkill()] });
    const toolbar = populated.getByTestId("stub-SkillsToolbar");
    expect(toolbar).toBeInTheDocument();
    expect(toolbar.getAttribute("data-view-mode")).toBe("card");
    expect(toolbar.getAttribute("data-filter-open")).toBe("false");
    expect(toolbar.getAttribute("data-search-query")).toBe("");
    expect(toolbar.getAttribute("data-all-tags")).toBe("[]");
    expect(toolbar.getAttribute("data-search-tags")).toBe("[]");
    const s = h.state as unknown as PageState;
    expect(h.seen["SkillsToolbar"]?.["onSearchChange"]).toBe(s.setSearchQuery);
    expect(h.seen["SkillsToolbar"]?.["onTagsChange"]).toBe(s.setSearchTags);
    expect(h.seen["SkillsToolbar"]?.["onFilterOpenChange"]).toBe(
      s.setFilterOpen,
    );
    expect(h.seen["SkillsToolbar"]?.["onViewModeChange"]).toBe(s.setViewMode);
  });

  it("renders the loading state alone while the hook is busy", () => {
    const { getByText, queryByTestId } = renderPage({ loading: true });
    expect(getByText("common.loading")).toBeInTheDocument();
    expect(queryByTestId("stub-SkillCard")).toBeNull();
    expect(getByText("common.loading").closest("div")?.className).toContain(
      styles.loading,
    );
  });

  it("renders the empty state without the compact class when nothing is managed", () => {
    const { getByText } = renderPage({
      skills: [],
      sortedSkills: [],
      visibleSkills: [],
      providerSkills: [],
    });
    expect(getByText("skills.emptyStateBadge")).toBeInTheDocument();
    expect(getByText("skills.emptyStateTitle")).toBeInTheDocument();
    expect(getByText("skills.emptyStateText")).toBeInTheDocument();
    const box = getByText("skills.emptyStateBadge")
      .parentElement as HTMLElement;
    expect(box.className).toContain(styles.emptyState);
    expect(box.className).not.toContain(styles.emptyStateCompact);
    const s = h.state as unknown as PageState;
    fireEvent.click(getByText("skills.emptyStateCreate"));
    expect(s.handleCreate).toHaveBeenCalledTimes(1);
  });

  it("adds the compact empty-state class when provider skills exist", () => {
    const { getByText } = renderPage({
      skills: [],
      sortedSkills: [],
      visibleSkills: [],
      providerSkills: [makeProviderSkill()],
    });
    const box = getByText("skills.emptyStateBadge")
      .parentElement as HTMLElement;
    expect(box.className).toContain(styles.emptyStateCompact);
  });

  it("renders the no-search-results state when filtering removed everything", () => {
    const { getByText, queryByText } = renderPage({
      skills: [makeSkill()],
      sortedSkills: [],
      visibleSkills: [],
    });
    expect(getByText("skills.noSearchResults")).toBeInTheDocument();
    expect(queryByText("skills.emptyStateTitle")).toBeNull();
    expect(
      getByText("skills.noSearchResults").parentElement?.className,
    ).toContain(styles.noSearchResults);
  });

  it("splits enabled from disabled on visibleSkills and counts on sortedSkills", () => {
    const { getByText, getAllByTestId } = renderPage({
      skills: [makeSkill({ name: "s1" }), makeSkill({ name: "s2" })],
      // visibleSkills drives the split: one enabled, one disabled.
      visibleSkills: [
        makeSkill({ name: "s1", enabled: true }),
        makeSkill({ name: "s2", enabled: false }),
      ],
      // sortedSkills drives the count badge only: three enabled here, so a
      // mix-up between the two sources shows up as a wrong number.
      sortedSkills: [
        makeSkill({ name: "s1" }),
        makeSkill({ name: "s2" }),
        makeSkill({ name: "s3" }),
      ],
    });
    expect(getByText("skills.enabledSkills")).toBeInTheDocument();
    expect(getByText("skills.disabledSkills")).toBeInTheDocument();
    expect(getByText(/3 skills\.active/)).toBeInTheDocument();
    expect(getAllByTestId("stub-SkillCard")).toHaveLength(1);
  });

  it("hides a section entirely when that group is empty", () => {
    const onlyEnabled = renderPage({
      visibleSkills: [makeSkill({ name: "s1", enabled: true })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    expect(onlyEnabled.queryByText("skills.disabledSkills")).toBeNull();
    expect(onlyEnabled.getByText("skills.enabledSkills")).toBeInTheDocument();
    cleanup();

    const onlyDisabled = renderPage({
      visibleSkills: [makeSkill({ name: "s2", enabled: false })],
      sortedSkills: [makeSkill({ name: "s2", enabled: false })],
    });
    expect(onlyDisabled.queryByText("skills.enabledSkills")).toBeNull();
    expect(onlyDisabled.getByText("skills.disabledSkills")).toBeInTheDocument();
  });

  it("passes undefined as selected outside batch mode and the set membership inside it", () => {
    const off = renderPage({
      viewMode: "card",
      batchModeEnabled: false,
      selectedSkills: new Set(["s1"]),
      visibleSkills: [makeSkill({ name: "s1" })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    expect(
      off.getByTestId("stub-SkillCard").getAttribute("data-selected"),
    ).toBe("undef");
    cleanup();

    const on = renderPage({
      viewMode: "card",
      batchModeEnabled: true,
      selectedSkills: new Set(["s1"]),
      visibleSkills: [
        makeSkill({ name: "s1" }),
        makeSkill({ name: "s2", enabled: false }),
      ],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    expect(on.getByTestId("stub-SkillCard").getAttribute("data-selected")).toBe(
      "true",
    );
  });

  it("routes the list view through the shared list-item renderer in both sections", () => {
    const { getAllByTestId } = renderPage({
      viewMode: "list",
      visibleSkills: [
        makeSkill({ name: "s1", enabled: true }),
        makeSkill({ name: "s2", enabled: false }),
      ],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    const items = getAllByTestId("stub-SkillListItem");
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.getAttribute("data-skill"))).toEqual([
      "s1",
      "s2",
    ]);
    // Card renderer must not be mounted in list mode.
    expect(document.querySelector('[data-testid="stub-SkillCard"]')).toBeNull();
  });

  it("awaits the toggle and then refreshes when a list item is switched", async () => {
    const { getAllByTestId } = renderPage({
      viewMode: "list",
      visibleSkills: [makeSkill({ name: "s1" })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    const s = h.state as unknown as PageState;
    (s.toggleEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    (s.refreshSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    fireEvent.click(getAllByTestId("SkillListItem-toggle")[0]);
    expect(s.toggleEnabled).toHaveBeenCalledTimes(1);
    expect(
      (s.toggleEnabled as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ name: "s1" });
    // The product awaits the toggle before refreshing, so the refresh is
    // queued on the microtask queue rather than fired synchronously.
    await Promise.resolve();
    await Promise.resolve();
    expect(s.refreshSkills).toHaveBeenCalledTimes(1);
  });

  it("plumbs selection and deletion of a list item back to the hook", () => {
    const { getAllByTestId } = renderPage({
      viewMode: "list",
      batchModeEnabled: true,
      selectedSkills: new Set(["s1"]),
      visibleSkills: [makeSkill({ name: "s1" })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    const item = getAllByTestId("stub-SkillListItem")[0];
    expect(item.getAttribute("data-batch-mode")).toBe("true");
    expect(item.getAttribute("data-is-selected")).toBe("true");
    const s = h.state as unknown as PageState;
    fireEvent.click(getAllByTestId("SkillListItem-select")[0]);
    expect(s.toggleSelect).toHaveBeenCalledWith("s1");
    fireEvent.click(getAllByTestId("SkillListItem-delete")[0]);
    expect(s.handleDelete).toHaveBeenCalledTimes(1);
    expect(
      (s.handleDelete as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ name: "s1" });
  });

  it("opens the editor from a disabled grid card but enables it from the action without editing", () => {
    const { container, getByText } = renderPage({
      viewMode: "card",
      visibleSkills: [
        makeSkill({ name: "off-1", enabled: false, emoji: "🧪" }),
      ],
      // sortedSkills must stay non-empty: an empty one renders the
      // no-search-results branch instead of the sections (asserted above).
      sortedSkills: [makeSkill({ name: "off-1", enabled: false })],
    });
    const item = container.querySelector(
      `.${styles.disabledSkillGridItem}`,
    ) as HTMLElement;
    expect(item).not.toBeNull();
    expect(getByText("off-1")).toBeInTheDocument();
    // getSkillVisual is stubbed, so the emoji arm is observable through it.
    expect(getByText("🧪")).toBeInTheDocument();
    const action = container.querySelector(
      `.${styles.disabledSkillGridAction}`,
    ) as HTMLElement;
    expect(action.textContent).toBe("common.enable");
    const s = h.state as unknown as PageState;
    fireEvent.click(action);
    expect(s.handleToggleEnabled).toHaveBeenCalledTimes(1);
    expect(
      (s.handleToggleEnabled as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0][0],
    ).toMatchObject({ name: "off-1" });
    // stopPropagation must keep the editor closed.
    expect(s.handleEdit).not.toHaveBeenCalled();
    fireEvent.click(item);
    expect(s.handleEdit).toHaveBeenCalledTimes(1);
  });

  it("renders one provider card per discovered skill with a derived label and a source chip", () => {
    const { getAllByRole, getByText } = renderPage({
      providerSkills: [
        makeProviderSkill({ name: "prov-a", description: "first" }),
        makeProviderSkill({
          name: "prov-b",
          description: "",
          source: "",
          enabled: false,
          provider_id: "harness-2",
        }),
      ],
    });
    const cards = getAllByRole("button", { name: /^common\.view: / });
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("aria-label")).toBe("common.view: prov-a");
    expect(cards[1].getAttribute("aria-label")).toBe("common.view: prov-b");
    expect(getByText("first")).toBeInTheDocument();
    // Empty description falls back to the translated placeholder.
    expect(getByText("skills.noDescription")).toBeInTheDocument();
    // The enabled/disabled label mirrors the discovered flag.
    expect(getByText("common.enabled")).toBeInTheDocument();
    expect(getByText("common.disabled")).toBeInTheDocument();
    // The source chip disappears for an empty source, so "builtin" appears
    // exactly once while the second card contributes none.
    expect(cards[0].textContent).toContain("builtin");
    expect(cards[1].textContent).not.toContain("builtin");
    expect(cards[0].textContent).toContain("harness-1");
    expect(cards[1].textContent).toContain("harness-2");
    expect(getByText("2")).toBeInTheDocument();
    expect(getByText("skills.providerManaged")).toBeInTheDocument();
    expect(getByText("skills.providerManagedHint")).toBeInTheDocument();
    // Both read-only chips are per card, so they appear once per provider.
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getAllByText("skills.providerOnly")).toHaveLength(
      1,
    );
    expect(within(cards[1]).getAllByText("skills.readOnly")).toHaveLength(1);
  });

  it("keeps the provider drawer closed until a provider card is clicked, then opens it with that skill", () => {
    const { getAllByRole, getByTestId } = renderPage({
      providerSkills: [
        makeProviderSkill({ name: "prov-a" }),
        makeProviderSkill({ name: "prov-b", provider_id: "harness-2" }),
      ],
    });
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-open"),
    ).toBe("false");
    // `skill` is null before any click, and the recorder reads `skill?.name`,
    // so the attribute carries the string form of undefined.
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-skill"),
    ).toBe("undefined");
    const cards = getAllByRole("button", { name: /^common\.view: / });
    fireEvent.click(cards[1]);
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-open"),
    ).toBe("true");
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-skill"),
    ).toBe("prov-b");
    // Closing hands control back to the page state. The callback runs inside
    // act() because it drives a local useState, so the re-render has to be
    // flushed before the attribute can be read.
    const seen = h.seen["ProviderSkillDrawer"];
    act(() => {
      (seen["onClose"] as () => void)();
    });
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-open"),
    ).toBe("false");
    expect(
      getByTestId("stub-ProviderSkillDrawer").getAttribute("data-skill"),
    ).toBe("undefined");
  });

  it("renders the progressive sentinel only while more items are pending", () => {
    const withMore = renderPage({ hasMore: true });
    const sentinel = withMore.container.querySelector(
      'div[style*="height: 1px"]',
    );
    expect(sentinel).not.toBeNull();
    cleanup();

    const withoutMore = renderPage({ hasMore: false });
    expect(
      withoutMore.container.querySelector('div[style*="height: 1px"]'),
    ).toBeNull();
  });

  it("plumbs the import modal, the pool modal and the skill drawer from the hook state", () => {
    const form = { resetFields: vi.fn() };
    const { getByTestId } = renderPage({
      importModalOpen: true,
      importing: true,
      poolModal: "download",
      skills: [makeSkill({ name: "s1" })],
      poolSkills: [makeSkill({ name: "p1" })],
      drawerOpen: true,
      drawerLoading: true,
      editingSkillName: "s1",
      editingSkill: makeSkillDetail({ name: "s1" }),
      allTags: ["tag-a", "tag-b"],
      channelOptions: [{ label: "All", value: "all" }] as never,
      form: form as never,
    });
    const hub = getByTestId("stub-ImportHubModal");
    expect(hub.getAttribute("data-open")).toBe("true");
    expect(hub.getAttribute("data-importing")).toBe("true");
    expect(hub.getAttribute("data-hint")).toBe("skillPool.externalHubHint");
    const s = h.state as unknown as PageState;
    expect(h.seen["ImportHubModal"]?.["onCancel"]).toBe(s.closeImportModal);
    expect(h.seen["ImportHubModal"]?.["onConfirm"]).toBe(s.handleConfirmImport);
    expect(h.seen["ImportHubModal"]?.["cancelImport"]).toBe(s.cancelImport);

    const pool = getByTestId("stub-PoolTransferModal");
    expect(pool.getAttribute("data-mode")).toBe("download");
    expect(pool.getAttribute("data-skills")).toBe('["s1"]');
    expect(pool.getAttribute("data-pool-skills")).toBe('["p1"]');
    expect(h.seen["PoolTransferModal"]?.["onCancel"]).toBe(s.closePoolModal);
    expect(h.seen["PoolTransferModal"]?.["onUpload"]).toBe(
      s.handleUploadToPool,
    );
    expect(h.seen["PoolTransferModal"]?.["onDownload"]).toBe(
      s.handleDownloadFromPool,
    );

    const drawer = getByTestId("stub-SkillDrawer");
    expect(drawer.getAttribute("data-open")).toBe("true");
    // `editing` is the OR of drawerLoading and "an editing skill is set".
    expect(drawer.getAttribute("data-editing")).toBe("true");
    expect(drawer.getAttribute("data-loading")).toBe("true");
    expect(drawer.getAttribute("data-editing-name")).toBe("s1");
    expect(drawer.getAttribute("data-available-tags")).toBe(
      '["tag-a","tag-b"]',
    );
    expect(drawer.getAttribute("data-channel-options")).toBe(
      '[{"label":"All","value":"all"}]',
    );
    expect(h.seen["SkillDrawer"]?.["form"]).toBe(form);
    expect(h.seen["SkillDrawer"]?.["onClose"]).toBe(s.handleDrawerClose);
    expect(h.seen["SkillDrawer"]?.["onSubmit"]).toBe(s.handleSubmit);
  });

  it("reports editing as false when the drawer is closed and nothing is being edited", () => {
    const { getByTestId } = renderPage({
      drawerOpen: false,
      drawerLoading: false,
      editingSkill: null,
      // The hook keeps the editing name as a string, so idle is "" not null.
      editingSkillName: "",
    });
    const drawer = getByTestId("stub-SkillDrawer");
    expect(drawer.getAttribute("data-open")).toBe("false");
    expect(drawer.getAttribute("data-editing")).toBe("false");
    expect(drawer.getAttribute("data-loading")).toBe("false");
    expect(drawer.getAttribute("data-editing-name")).toBe("");
  });

  it("wires the card hover no-ops, the card selection and the hub entry point", () => {
    const { getByTestId } = renderPage({
      viewMode: "card",
      visibleSkills: [makeSkill({ name: "s1" })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    const s = h.state as unknown as PageState;
    // The two hover callbacks are deliberate no-ops in the product; firing
    // them must not throw and must not reach any hook handler.
    fireEvent.mouseEnter(getByTestId("SkillCard-mouse-enter"));
    fireEvent.mouseLeave(getByTestId("SkillCard-mouse-leave"));
    expect(s.handleEdit).not.toHaveBeenCalled();
    expect(s.toggleSelect).not.toHaveBeenCalled();
    // Card selection routes to toggleSelect with the skill name.
    fireEvent.click(getByTestId("SkillCard-select"));
    expect(s.toggleSelect).toHaveBeenCalledWith("s1");
    // The header's import-hub entry is a page-local wrapper around the hook's
    // setter, so it is not the setter itself but does call it with true.
    expect(h.seen["HeaderActions"]?.["onImportHub"]).not.toBe(
      s.setImportModalOpen,
    );
    fireEvent.click(getByTestId("HeaderActions-import-hub"));
    expect(s.setImportModalOpen).toHaveBeenCalledWith(true);
    expect(s.setImportModalOpen).toHaveBeenCalledTimes(1);
  });

  it("routes a list-item click to the editor", () => {
    const { getByTestId } = renderPage({
      viewMode: "list",
      visibleSkills: [makeSkill({ name: "list-1" })],
      sortedSkills: [makeSkill({ name: "list-1" })],
    });
    const s = h.state as unknown as PageState;
    fireEvent.click(getByTestId("SkillListItem-click"));
    expect(s.handleEdit).toHaveBeenCalledTimes(1);
    expect(
      (s.handleEdit as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ name: "list-1" });
  });

  it("mounts the conflict rename modal produced by the hook", () => {
    const { getByTestId } = renderPage();
    expect(getByTestId("conflict-rename-modal")).toBeInTheDocument();
  });

  it("routes a card click to the editor and the card toggles to the hook handlers", () => {
    const { getByTestId } = renderPage({
      viewMode: "card",
      visibleSkills: [makeSkill({ name: "s1" })],
      sortedSkills: [makeSkill({ name: "s1" })],
    });
    const s = h.state as unknown as PageState;
    fireEvent.click(getByTestId("SkillCard-click"));
    expect(s.handleEdit).toHaveBeenCalledTimes(1);
    expect(
      (s.handleEdit as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ name: "s1" });
    fireEvent.click(getByTestId("SkillCard-toggle"));
    expect(s.handleToggleEnabled).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTestId("SkillCard-delete"));
    expect(s.handleDelete).toHaveBeenCalledTimes(1);
    // getChannelName is forwarded so the card can label its channels.
    expect(h.seen["SkillCard"]?.["getChannelName"]).toBe(s.getChannelName);
  });
});
