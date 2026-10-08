/**
 * BackupTable - paginated backup list with inline Restore / Export / Delete.
 *
 * What this suite pins down, and why the harness looks the way it does:
 *
 * 1. Search must cover the whole list, not the visible page. The component
 *    filters the in-memory array before paginating, so a query has to be able
 *    to reach an item that lives on another page. Several cases here render 12
 *    rows (two pages) and assert the match is found while the user sits on a
 *    page that does not contain it.
 *
 * 2. Two different page-reset mechanisms exist and they must not be conflated.
 *    Changing searchQuery runs an effect that resets the page to 1. Shrinking
 *    the list without changing searchQuery does NOT run that effect; the
 *    visible page is instead clamped by Math.min(page, maxPage). Both paths are
 *    covered separately, because a regression in either one shows up as a blank
 *    list rather than an error.
 *
 * 3. The desktop table and the mobile card list sort independently. The mobile
 *    list is always newest first, while the desktop table honours the column
 *    sorter the user clicked. A case here flips the desktop table to ascending
 *    and asserts the mobile order stays newest first.
 *
 * 4. antd Modal.confirm renders into document.body and survives cleanup().
 *    Measured in this batch: Modal.destroyAll() leaves the confirm node in the
 *    DOM, while resetting document.body.innerHTML removes it. The afterEach
 *    hook therefore does both cleanup() and a body reset, otherwise a confirm
 *    dialog opened by one test is still clickable by the next one and the
 *    "no dialog on screen" assertions turn into false greens.
 *
 * 5. Export is covered twice on purpose. Once with a spy on Modal.confirm, which
 *    asserts the full dialog contract (title, content, button labels, the danger
 *    flag on the OK button, centered) and drives onOk directly for both the
 *    success and the failure path. Once with the real dialog, driven by a click,
 *    which proves a user can actually reach that button and that cancelling it
 *    never calls the API. The spy path creates no DOM node at all, so it cannot
 *    leak into later cases.
 *
 * 6. Delete goes through a Popconfirm, and its three outcomes differ in an
 *    observable way: success reports and refreshes the list, failure reports and
 *    deliberately does not refresh, cancel does neither. Asserting the absence of
 *    onRefresh on the failure path is what keeps a swallowed error from reading
 *    as a successful delete.
 *
 * 7. Date strings are asserted by shape, never by value. The container renders
 *    created_at through dayjs in the local time zone, so a fixed expectation such
 *    as "18:00" would pass here and fail on a machine in another zone. Relative
 *    labels depend on the current date for the same reason.
 *
 * 8. Elements are located by CSS module class or by accessible name, never by
 *    positional index. The desktop action cell and the mobile action row hold
 *    three buttons with identical labels, so an index would silently point at
 *    the wrong control as soon as one wrapper adds a node.
 *
 * 9. The mobile half of the component is queried with hidden: true, and that is
 *    not a shortcut. BackupTable.module.less keeps .mobileCards at display:none
 *    and only reveals it inside @media (max-width: 768px). Vitest runs with
 *    css: true, so that rule is injected into jsdom, while the media query never
 *    matches the default 1024px viewport. The result is that testing-library
 *    correctly reports the mobile controls as inaccessible at desktop width.
 *    Both layouts are still asserted, the mobile one through hidden: true and
 *    through plain class queries, so neither half is left unverified.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Modal } from "antd";

const apiMocks = vi.hoisted(() => ({
  deleteBackups: vi.fn(),
  exportBackup: vi.fn(),
}));

vi.mock("@/api", () => ({ default: apiMocks }));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/useAppMessage", () => ({
  useAppMessage: () => ({ message: messageMocks }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
  }),
}));

import styles from "./BackupTable.module.less";
import type { BackupMeta } from "@/api/types/backup";
import BackupTable from "./BackupTable";

const NOOP = () => undefined;

const FULL_SCOPE = {
  include_agents: true,
  include_global_config: true,
  include_secrets: true,
  include_skill_pool: true,
};

const EMPTY_SCOPE = {
  include_agents: false,
  include_global_config: false,
  include_secrets: false,
  include_skill_pool: false,
};

function makeBackup(overrides: Partial<BackupMeta> = {}): BackupMeta {
  return {
    id: "bk-1",
    name: "nightly",
    description: "a description",
    created_at: "2026-09-01T10:00:00Z",
    scope: {
      ...EMPTY_SCOPE,
      include_agents: true,
      include_global_config: true,
    },
    agent_count: 3,
    ...overrides,
  };
}

/**
 * Builds n backups whose created_at decreases with the index, so index 0 is the
 * newest. The direction matters: the mobile list is sorted newest first, so the
 * second page of a 12-item list holds index 10 then index 11.
 */
function makeList(n: number, prefix = "row"): BackupMeta[] {
  return Array.from({ length: n }, (_, i) =>
    makeBackup({
      id: `${prefix}-${i}`,
      name: `${prefix}-name-${i}`,
      description: i % 2 === 0 ? `${prefix}-desc-${i}` : "",
      created_at: `2026-09-${String(28 - i).padStart(2, "0")}T10:00:00Z`,
    }),
  );
}

function renderTable(
  props: Partial<React.ComponentProps<typeof BackupTable>> = {},
) {
  const onRestore = props.onRestore ?? vi.fn();
  const onRefresh = props.onRefresh ?? vi.fn();
  const view = render(
    <BackupTable
      backups={props.backups ?? []}
      searchQuery={props.searchQuery ?? ""}
      onRestore={onRestore}
      onRefresh={onRefresh}
    />,
  );
  return { ...view, onRestore, onRefresh };
}

function desktopRowKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".ant-table-row")).map(
    (row) => row.getAttribute("data-row-key") ?? "",
  );
}

function desktopActionCell(container: HTMLElement): HTMLElement {
  const cell = container.querySelector(`.ant-table-row .${styles.actions}`);
  if (!cell) throw new Error("desktop action cell not rendered");
  return cell as HTMLElement;
}

function mobileActionRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector(`.${styles.mobileActions}`);
  if (!row) throw new Error("mobile action row not rendered");
  return row as HTMLElement;
}

function buttonByName(scope: HTMLElement, label: string): HTMLElement {
  // hidden: true is required for the mobile action row, see note 9 above.
  const button = within(scope).getByRole("button", {
    name: label,
    hidden: true,
  });
  return button as HTMLElement;
}

function desktopRowById(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector(`.ant-table-row[data-row-key="${id}"]`);
  if (!row) throw new Error(`desktop row for ${id} not rendered`);
  return row as HTMLElement;
}

function mobileIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(`.${styles.mobileId}`)).map(
    (node) => node.textContent ?? "",
  );
}

function simplePaginationText(container: HTMLElement): string {
  const node = container.querySelector(".ant-pagination-simple");
  return node ? node.textContent ?? "" : "";
}

function scopeTagLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".ant-tag")).map(
    (tag) => tag.textContent ?? "",
  );
}

function relativeDateCells(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".ant-table-row td:nth-child(5)"),
  ).map((cell) => (cell.textContent ?? "").trim());
}

/** Captures every Modal.confirm config so onOk can be driven without a dialog. */
function spyOnConfirm() {
  const configs: any[] = [];
  const spy = vi.spyOn(Modal, "confirm").mockImplementation((config: any) => {
    configs.push(config);
    return { destroy: vi.fn(), update: vi.fn() } as any;
  });
  return { spy, configs };
}

afterEach(() => {
  // cleanup() unmounts the React tree but antd portals a confirm dialog straight
  // into document.body, and Modal.destroyAll() was measured to leave that node
  // behind. Resetting the body is what actually removes it, so both are needed.
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("BackupTable rendering", () => {
  it("renders one desktop card and one row per backup", () => {
    const { container } = renderTable({ backups: makeList(3) });
    expect(container.querySelectorAll(`.${styles.tableCard}`).length).toBe(1);
    expect(desktopRowKeys(container)).toEqual(["row-0", "row-1", "row-2"]);
    expect(container.querySelectorAll(`.${styles.idCell}`).length).toBe(3);
  });

  it("renders both the desktop table and the mobile card list at once", () => {
    const { container } = renderTable({ backups: makeList(2) });
    expect(container.querySelectorAll(".ant-table").length).toBe(1);
    expect(container.querySelectorAll(`.${styles.mobileCards}`).length).toBe(1);
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(2);
  });

  it("shows the id column inside its own cell style", () => {
    const { container } = renderTable({
      backups: [makeBackup({ id: "unique-id" })],
    });
    const cell = container.querySelector(`.${styles.idCell}`);
    expect(cell?.textContent).toBe("unique-id");
  });

  it("labels the columns with the translated headers", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const headers = Array.from(container.querySelectorAll("th")).map((node) =>
      (node.textContent ?? "").trim(),
    );
    expect(headers).toEqual([
      "ID",
      "backup.name",
      "backup.scopeSummary",
      "backup.descriptionLabel",
      "backup.createdAt",
      "common.actions",
    ]);
  });

  it("shows the description column value for a backup that has one", () => {
    const { container } = renderTable({
      backups: [makeBackup({ description: "plain text description" })],
    });
    const descriptionCell = container.querySelector(
      ".ant-table-row td:nth-child(4)",
    );
    expect((descriptionCell?.textContent ?? "").trim()).toBe(
      "plain text description",
    );
  });

  it("formats the created date as a relative label by shape, not by value", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const labels = relativeDateCells(container);
    expect(labels).toHaveLength(1);
    expect(labels[0].length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("Invalid Date");
  });

  it("exposes the absolute timestamp in the tooltip, in local time shape", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      backups: [makeBackup({ created_at: "2026-09-01T10:00:00Z" })],
    });
    const dateCell = container.querySelector(
      ".ant-table-row td:nth-child(5)",
    ) as HTMLElement;
    await user.hover(within(dateCell).getByText(/.+/));
    const tooltip = await within(document.body).findByRole("tooltip");
    expect(tooltip.textContent?.trim()).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});

describe("BackupTable empty states", () => {
  it("renders no table at all when the backup list is empty", () => {
    const { container } = renderTable({ backups: [] });
    expect(container.querySelectorAll(".ant-table").length).toBe(0);
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(0);
    expect(container.querySelectorAll(".ant-pagination").length).toBe(0);
  });

  it("reports the empty message twice when the backup list is empty", () => {
    const { container } = renderTable({ backups: [] });
    const descriptions = Array.from(
      container.querySelectorAll(".ant-empty-description"),
    ).map((node) => node.textContent);
    expect(descriptions).toEqual(["backup.noBackups", "backup.noBackups"]);
  });

  it("keeps the desktop table mounted when a search excludes every row", () => {
    const { container } = renderTable({
      backups: makeList(2),
      searchQuery: "nothing-matches-this",
    });
    expect(container.querySelectorAll(".ant-table").length).toBe(1);
    expect(desktopRowKeys(container)).toEqual([]);
  });

  it("switches the mobile list to its empty message when a search excludes every row", () => {
    const { container } = renderTable({
      backups: makeList(2),
      searchQuery: "nothing-matches-this",
    });
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(0);
    expect(
      container.querySelectorAll(`.${styles.mobilePagination}`).length,
    ).toBe(0);
    const descriptions = Array.from(
      container.querySelectorAll(
        `.${styles.mobileCards} .ant-empty-description`,
      ),
    ).map((node) => node.textContent);
    expect(descriptions).toEqual(["backup.noBackups"]);
  });

  it("recovers both lists when the search query is cleared again", () => {
    const { container, rerender } = renderTable({
      backups: makeList(2),
      searchQuery: "nothing-matches-this",
    });
    rerender(
      <BackupTable
        backups={makeList(2)}
        searchQuery=""
        onRestore={NOOP}
        onRefresh={NOOP}
      />,
    );
    expect(desktopRowKeys(container)).toEqual(["row-0", "row-1"]);
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(2);
  });
});

describe("BackupTable search", () => {
  it("matches a backup by name, case insensitively", () => {
    const { container } = renderTable({
      backups: [makeBackup({ id: "aaa", name: "Weekly Snapshot" })],
      searchQuery: "weekly snap",
    });
    expect(desktopRowKeys(container)).toEqual(["aaa"]);
  });

  it("matches a backup by id when the name does not contain the query", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "id-hit", name: "unrelated" }),
        makeBackup({ id: "other", name: "another" }),
      ],
      searchQuery: "hit",
    });
    expect(desktopRowKeys(container)).toEqual(["id-hit"]);
  });

  it("trims surrounding whitespace before matching", () => {
    const { container } = renderTable({
      backups: [makeBackup({ id: "trim-me", name: "kept" })],
      searchQuery: "   trim-me   ",
    });
    expect(desktopRowKeys(container)).toEqual(["trim-me"]);
  });

  it("treats a whitespace-only query as no filter at all", () => {
    const { container } = renderTable({
      backups: makeList(3),
      searchQuery: "     ",
    });
    expect(desktopRowKeys(container)).toEqual(["row-0", "row-1", "row-2"]);
  });

  it("keeps rows whose id matches even when an earlier row matches by name", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "first", name: "shared-token" }),
        makeBackup({ id: "shared-token-id", name: "unrelated" }),
      ],
      searchQuery: "shared-token",
    });
    expect(desktopRowKeys(container)).toEqual(["first", "shared-token-id"]);
  });

  it("searches the whole list rather than only the page on screen", async () => {
    const user = userEvent.setup();
    const backups = makeList(12);
    const { container, rerender } = renderTable({ backups, searchQuery: "" });
    expect(desktopRowKeys(container)).toHaveLength(10);
    expect(desktopRowKeys(container)).not.toContain("row-11");

    // Move to the second page, then search for an item that lives on page one.
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    await user.click(nextButton);
    expect(mobileIds(container)).toEqual(["row-10", "row-11"]);

    rerender(
      <BackupTable
        backups={backups}
        searchQuery="row-name-0"
        onRestore={NOOP}
        onRefresh={NOOP}
      />,
    );
    expect(desktopRowKeys(container)).toEqual(["row-0"]);
    expect(mobileIds(container)).toEqual(["row-0"]);
  });
});

describe("BackupTable ordering", () => {
  it("orders the desktop table newest first by default", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "oldest", created_at: "2026-01-01T00:00:00Z" }),
        makeBackup({ id: "newest", created_at: "2026-09-01T00:00:00Z" }),
        makeBackup({ id: "middle", created_at: "2026-05-01T00:00:00Z" }),
      ],
    });
    expect(desktopRowKeys(container)).toEqual(["newest", "middle", "oldest"]);
  });

  it("orders the mobile cards newest first even when the input list is oldest first", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "oldest", created_at: "2026-01-01T00:00:00Z" }),
        makeBackup({ id: "newest", created_at: "2026-09-01T00:00:00Z" }),
      ],
    });
    expect(mobileIds(container)).toEqual(["newest", "oldest"]);
  });

  it("flips the desktop table to oldest first when the sorter is clicked once", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "oldest", created_at: "2026-01-01T00:00:00Z" }),
        makeBackup({ id: "newest", created_at: "2026-09-01T00:00:00Z" }),
      ],
    });
    const sorters = container.querySelector(
      ".ant-table-column-sorters",
    ) as HTMLElement;
    await user.click(sorters);
    expect(desktopRowKeys(container)).toEqual(["oldest", "newest"]);
  });

  it("keeps the mobile list newest first while the desktop table is ascending", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "oldest", created_at: "2026-01-01T00:00:00Z" }),
        makeBackup({ id: "newest", created_at: "2026-09-01T00:00:00Z" }),
      ],
    });
    const sorters = container.querySelector(
      ".ant-table-column-sorters",
    ) as HTMLElement;
    await user.click(sorters);
    expect(desktopRowKeys(container)).toEqual(["oldest", "newest"]);
    expect(mobileIds(container)).toEqual(["newest", "oldest"]);
  });

  it("returns the desktop table to newest first after the sorter cycles through", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "oldest", created_at: "2026-01-01T00:00:00Z" }),
        makeBackup({ id: "newest", created_at: "2026-09-01T00:00:00Z" }),
      ],
    });
    const sorters = container.querySelector(
      ".ant-table-column-sorters",
    ) as HTMLElement;
    await user.click(sorters);
    await user.click(sorters);
    await user.click(sorters);
    expect(desktopRowKeys(container)).toEqual(["newest", "oldest"]);
  });
});

describe("BackupTable pagination", () => {
  it("shows ten rows on the first page and reports the unfiltered total", () => {
    const { container } = renderTable({ backups: makeList(12) });
    expect(desktopRowKeys(container)).toHaveLength(10);
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(10);
    const totals = Array.from(
      container.querySelectorAll(".ant-pagination-total-text"),
    ).map((node) => node.textContent);
    expect(totals).toEqual(['backup.total:{"count":12}']);
  });

  it("offers the configured page size choices", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(12) });
    const selector = container.querySelector(
      ".ant-pagination-options .ant-select-selector",
    ) as HTMLElement;
    await user.click(selector);
    const options = Array.from(
      document.querySelectorAll(".ant-select-item-option"),
    ).map((node) => node.textContent);
    expect(options).toEqual(["10 / page", "20 / page", "50 / page"]);
  });

  it("hides the mobile pager when everything fits on one page", () => {
    const { container } = renderTable({ backups: makeList(10) });
    const pager = container.querySelector(`.${styles.mobilePagination}`);
    expect(pager).not.toBeNull();
    const nextButton = pager?.querySelector(
      ".ant-pagination-next",
    ) as HTMLElement;
    expect(nextButton.classList.contains("ant-pagination-disabled")).toBe(true);
  });

  it("moves the mobile list to the remaining rows when the pager advances", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(12) });
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(false);
    await user.click(nextButton);
    expect(mobileIds(container)).toEqual(["row-10", "row-11"]);
    expect(simplePaginationText(container)).toBe("/2");
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(2);
  });

  it("does not move the desktop table when the mobile pager advances", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(12) });
    const before = desktopRowKeys(container);
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    await user.click(nextButton);
    expect(desktopRowKeys(container)).toEqual(before);
  });

  it("disables the mobile next control on the last page", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(12) });
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    await user.click(nextButton);
    expect(nextButton.disabled).toBe(true);
  });

  it("resets to the first page when the search query changes on a later page", async () => {
    const user = userEvent.setup();
    const backups = makeList(12);
    const { container, rerender } = renderTable({ backups, searchQuery: "" });
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    await user.click(nextButton);
    expect(simplePaginationText(container)).toBe("/2");

    rerender(
      <BackupTable
        backups={backups}
        searchQuery="row-name"
        onRestore={NOOP}
        onRefresh={NOOP}
      />,
    );
    expect(simplePaginationText(container)).toBe("/2");
    expect(mobileIds(container)).toHaveLength(10);
    expect(mobileIds(container)[0]).toBe("row-0");
  });

  it("clamps the visible page when the list shrinks without a search change", async () => {
    const user = userEvent.setup();
    const backups = makeList(12);
    const { container, rerender } = renderTable({ backups, searchQuery: "" });
    const nextButton = container.querySelector(
      ".ant-pagination-simple .ant-pagination-next button",
    ) as HTMLButtonElement;
    await user.click(nextButton);
    expect(mobileIds(container)).toEqual(["row-10", "row-11"]);

    // Same query, so the reset effect does not run: the clamp keeps the list visible.
    rerender(
      <BackupTable
        backups={backups.slice(0, 3)}
        searchQuery=""
        onRestore={NOOP}
        onRefresh={NOOP}
      />,
    );
    expect(mobileIds(container)).toEqual(["row-0", "row-1", "row-2"]);
    expect(container.querySelectorAll(`.${styles.mobileCard}`).length).toBe(3);
    expect(simplePaginationText(container)).toBe("/1");
  });

  it("keeps a single page for a list smaller than the page size", () => {
    const { container } = renderTable({ backups: makeList(1) });
    expect(simplePaginationText(container)).toBe("/1");
    expect(mobileIds(container)).toEqual(["row-0"]);
  });
});

describe("BackupTable scope tags", () => {
  it("renders one tag per enabled scope entry", () => {
    const { container } = renderTable({
      backups: [makeBackup({ scope: { ...FULL_SCOPE }, agent_count: 7 })],
    });
    const labels = scopeTagLabels(container).filter(
      (label, index, all) => all.indexOf(label) === index,
    );
    expect(labels).toEqual([
      'backup.agents:{"count":7}',
      "backup.globalConfig",
      "backup.skillPool",
      "backup.secrets",
    ]);
  });

  it("marks the secrets tag as a warning", () => {
    const { container } = renderTable({
      backups: [makeBackup({ scope: { ...FULL_SCOPE } })],
    });
    expect(
      container.querySelectorAll(".ant-tag-warning").length,
    ).toBeGreaterThan(0);
  });

  it("renders no tag when every scope entry is disabled", () => {
    const { container } = renderTable({
      backups: [makeBackup({ scope: { ...EMPTY_SCOPE }, agent_count: 5 })],
    });
    expect(scopeTagLabels(container)).toEqual([]);
  });

  it("omits the agent tag when the agent count is zero even if agents are included", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({
          scope: { ...EMPTY_SCOPE, include_agents: true },
          agent_count: 0,
        }),
      ],
    });
    expect(scopeTagLabels(container)).toEqual([]);
  });

  it("renders the same scope summary on the mobile card", () => {
    const { container } = renderTable({
      backups: [makeBackup({ scope: { ...FULL_SCOPE }, agent_count: 2 })],
    });
    const card = container.querySelector(
      `.${styles.mobileCard}`,
    ) as HTMLElement;
    const labels = Array.from(card.querySelectorAll(".ant-tag")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      'backup.agents:{"count":2}',
      "backup.globalConfig",
      "backup.skillPool",
      "backup.secrets",
    ]);
  });

  it("applies the compact tag style only on the mobile card", () => {
    const { container } = renderTable({
      backups: [makeBackup({ scope: { ...FULL_SCOPE }, agent_count: 2 })],
    });
    const card = container.querySelector(
      `.${styles.mobileCard}`,
    ) as HTMLElement;
    const desktopRow = desktopRowById(container, "bk-1");
    const mobileClasses = Array.from(card.querySelectorAll(".ant-tag")).map(
      (node) => node.className,
    );
    const desktopClasses = Array.from(
      desktopRow.querySelectorAll(".ant-tag"),
    ).map((node) => node.className);
    expect(mobileClasses.length).toBe(4);
    expect(desktopClasses.length).toBe(4);
    // The compact flag reaches the tags through ScopeTags, so the two layouts
    // must not end up with the same class list.
    expect(new Set(mobileClasses)).not.toEqual(new Set(desktopClasses));
    expect(card.querySelectorAll(`.${styles.mobileRow}`).length).toBe(3);
    expect(desktopRow.querySelectorAll(`.${styles.mobileRow}`).length).toBe(0);
  });
});

describe("BackupTable mobile card body", () => {
  it("shows name, scope and time rows for a backup with a description", () => {
    const { container } = renderTable({
      backups: [makeBackup({ id: "with-desc", description: "kept text" })],
    });
    const card = container.querySelector(
      `.${styles.mobileCard}`,
    ) as HTMLElement;
    expect(within(card).getByText("kept text")).not.toBeNull();
    expect(within(card).getAllByText("backup.name")).toHaveLength(1);
    expect(within(card).getAllByText("backup.scopeSummary")).toHaveLength(1);
    const time = card.querySelector(`.${styles.mobileTime}`);
    expect(time?.textContent ?? "").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("omits the description row when the backup has no description", () => {
    const { container } = renderTable({
      backups: [makeBackup({ id: "no-desc", description: "" })],
    });
    const card = container.querySelector(
      `.${styles.mobileCard}`,
    ) as HTMLElement;
    const labels = Array.from(
      card.querySelectorAll(`.${styles.mobileLabel}`),
    ).map((node) => node.textContent);
    expect(labels).not.toContain("backup.descriptionLabel");
    expect(labels).toEqual(["backup.name", "backup.scopeSummary"]);
  });

  it("renders both variants side by side when the list mixes described and plain backups", () => {
    const { container } = renderTable({
      backups: [
        makeBackup({ id: "a", description: "present" }),
        makeBackup({ id: "b", description: "" }),
      ],
    });
    const cards = Array.from(
      container.querySelectorAll(`.${styles.mobileCard}`),
    );
    expect(cards).toHaveLength(2);
    const labelCounts = cards.map(
      (card) => card.querySelectorAll(`.${styles.mobileLabel}`).length,
    );
    expect(labelCounts).toEqual([3, 2]);
  });
});

describe("BackupTable restore", () => {
  it("hands the whole record to onRestore from the desktop row", async () => {
    const user = userEvent.setup();
    const backup = makeBackup({ id: "restore-me", name: "target" });
    const { container, onRestore } = renderTable({ backups: [backup] });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.restore"),
    );
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(backup);
  });

  it("hands the whole record to onRestore from the mobile card", async () => {
    const user = userEvent.setup();
    const backup = makeBackup({ id: "restore-mobile", name: "target" });
    const { container, onRestore } = renderTable({ backups: [backup] });
    await user.click(
      buttonByName(mobileActionRow(container), "backup.restore"),
    );
    expect(onRestore).toHaveBeenCalledWith(backup);
  });

  it("does not call the API and does not refresh when restoring", async () => {
    const user = userEvent.setup();
    const { container, onRefresh } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.restore"),
    );
    expect(apiMocks.deleteBackups).not.toHaveBeenCalled();
    expect(apiMocks.exportBackup).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports which record was restored when several rows are on screen", async () => {
    const user = userEvent.setup();
    const { container, onRestore } = renderTable({ backups: makeList(3) });
    const secondRow = desktopRowById(container, "row-1");
    await user.click(
      buttonByName(
        secondRow.querySelector(`.${styles.actions}`) as HTMLElement,
        "backup.restore",
      ),
    );
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect((onRestore as any).mock.calls[0][0].id).toBe("row-1");
  });
});

describe("BackupTable export confirmation", () => {
  it("asks for confirmation with the danger contract before exporting", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );

    expect(configs).toHaveLength(1);
    expect(configs[0].title).toBe("backup.exportWarningTitle");
    expect(configs[0].content).toBe("backup.exportWarningContent");
    expect(configs[0].okText).toBe("backup.exportConfirm");
    expect(configs[0].cancelText).toBe("common.cancel");
    expect(configs[0].okButtonProps).toEqual({ danger: true });
    expect(configs[0].centered).toBe(true);
  });

  it("does not touch the API until the dialog is confirmed", async () => {
    const user = userEvent.setup();
    spyOnConfirm();
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    expect(apiMocks.exportBackup).not.toHaveBeenCalled();
  });

  it("downloads the backup by id and name once the dialog is confirmed", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    apiMocks.exportBackup.mockResolvedValue(undefined);
    const { container } = renderTable({
      backups: [makeBackup({ id: "export-id", name: "export-name" })],
    });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    await configs[0].onOk();
    expect(apiMocks.exportBackup).toHaveBeenCalledWith(
      "export-id",
      "export-name",
    );
  });

  it("stays silent when the export succeeds", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    apiMocks.exportBackup.mockResolvedValue(undefined);
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    await configs[0].onOk();
    expect(messageMocks.error).not.toHaveBeenCalled();
    expect(messageMocks.success).not.toHaveBeenCalled();
  });

  it("reports the export failure and swallows the rejection", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    apiMocks.exportBackup.mockRejectedValueOnce(new Error("download failed"));
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    await expect(configs[0].onOk()).resolves.toBeUndefined();
    expect(messageMocks.error).toHaveBeenCalledWith("backup.exportFailed");
  });

  it("does not refresh the list after an export, whatever the outcome", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    apiMocks.exportBackup.mockRejectedValueOnce(new Error("download failed"));
    const { container, onRefresh } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    await configs[0].onOk();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("exports from the mobile card through the same dialog", async () => {
    const user = userEvent.setup();
    const { configs } = spyOnConfirm();
    apiMocks.exportBackup.mockResolvedValue(undefined);
    const { container } = renderTable({
      backups: [makeBackup({ id: "mobile-export", name: "mobile-name" })],
    });
    await user.click(buttonByName(mobileActionRow(container), "backup.export"));
    expect(configs).toHaveLength(1);
    await configs[0].onOk();
    expect(apiMocks.exportBackup).toHaveBeenCalledWith(
      "mobile-export",
      "mobile-name",
    );
  });

  it("opens a real dialog a user can confirm, and that dialog calls the API", async () => {
    const user = userEvent.setup();
    apiMocks.exportBackup.mockResolvedValue(undefined);
    const { container } = renderTable({
      backups: [makeBackup({ id: "real-export", name: "real-name" })],
    });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );

    const dialog = await within(document.body).findByRole("dialog");
    expect(dialog.textContent).toContain("backup.exportWarningTitle");
    expect(dialog.textContent).toContain("backup.exportWarningContent");

    const okButton = within(dialog).getByRole("button", {
      name: "backup.exportConfirm",
    });
    expect(okButton.className).toContain("ant-btn-dangerous");
    await user.click(okButton);
    await vi.waitFor(() =>
      expect(apiMocks.exportBackup).toHaveBeenCalledWith(
        "real-export",
        "real-name",
      ),
    );
  });

  it("never calls the API when the real dialog is cancelled", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );

    const dialog = await within(document.body).findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "common.cancel" }),
    );
    await user.click(
      buttonByName(mobileActionRow(container), "backup.restore"),
    );

    expect(apiMocks.exportBackup).not.toHaveBeenCalled();
    expect(messageMocks.error).not.toHaveBeenCalled();
  });

  it("leaves no confirm dialog on screen for the next case", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.export"),
    );
    expect(document.querySelectorAll(".ant-modal-confirm").length).toBe(1);
  });
});

describe("BackupTable delete", () => {
  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ backups: makeList(1) });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.delete"),
    );
    const popconfirm = await within(document.body).findByRole("tooltip");
    expect(popconfirm.textContent).toContain("backup.deleteConfirm");
    expect(apiMocks.deleteBackups).not.toHaveBeenCalled();
  });

  it("deletes by id, reports success and refreshes the list", async () => {
    const user = userEvent.setup();
    apiMocks.deleteBackups.mockResolvedValue({
      deleted: ["del-1"],
      failed: [],
    });
    const { container, onRefresh } = renderTable({
      backups: [makeBackup({ id: "del-1" })],
    });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.delete"),
    );
    const popconfirm = await within(document.body).findByRole("tooltip");
    await user.click(within(popconfirm).getByRole("button", { name: "OK" }));

    await vi.waitFor(() => expect(apiMocks.deleteBackups).toHaveBeenCalled());
    expect(apiMocks.deleteBackups).toHaveBeenCalledWith(["del-1"]);
    expect(messageMocks.success).toHaveBeenCalledWith("backup.deleteSuccess");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("passes a single-element id list even when several backups are shown", async () => {
    const user = userEvent.setup();
    apiMocks.deleteBackups.mockResolvedValue({
      deleted: ["row-2"],
      failed: [],
    });
    const { container } = renderTable({ backups: makeList(3) });
    const thirdRow = desktopRowById(container, "row-2");
    await user.click(
      buttonByName(
        thirdRow.querySelector(`.${styles.actions}`) as HTMLElement,
        "backup.delete",
      ),
    );
    const popconfirm = await within(document.body).findByRole("tooltip", {
      hidden: true,
    });
    await user.click(within(popconfirm).getByRole("button", { name: "OK" }));
    await vi.waitFor(() => expect(apiMocks.deleteBackups).toHaveBeenCalled());
    expect(apiMocks.deleteBackups).toHaveBeenCalledWith(["row-2"]);
  });

  it("reports the failure and does not refresh when the delete call rejects", async () => {
    const user = userEvent.setup();
    apiMocks.deleteBackups.mockRejectedValueOnce(new Error("server refused"));
    const { container, onRefresh } = renderTable({
      backups: [makeBackup({ id: "del-bad" })],
    });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.delete"),
    );
    const popconfirm = await within(document.body).findByRole("tooltip");
    await user.click(within(popconfirm).getByRole("button", { name: "OK" }));

    await vi.waitFor(() => expect(messageMocks.error).toHaveBeenCalled());
    expect(messageMocks.error).toHaveBeenCalledWith("backup.deleteFailed");
    expect(messageMocks.success).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("keeps the list untouched when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    const { container, onRefresh } = renderTable({
      backups: [makeBackup({ id: "del-cancel" })],
    });
    await user.click(
      buttonByName(desktopActionCell(container), "backup.delete"),
    );
    const popconfirm = await within(document.body).findByRole("tooltip");
    await user.click(
      within(popconfirm).getByRole("button", { name: "Cancel" }),
    );

    expect(apiMocks.deleteBackups).not.toHaveBeenCalled();
    expect(messageMocks.success).not.toHaveBeenCalled();
    expect(messageMocks.error).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(desktopRowKeys(container)).toEqual(["del-cancel"]);
  });

  it("deletes from the mobile card through the same confirmation", async () => {
    const user = userEvent.setup();
    apiMocks.deleteBackups.mockResolvedValue({
      deleted: ["mob-del"],
      failed: [],
    });
    const { container, onRefresh } = renderTable({
      backups: [makeBackup({ id: "mob-del" })],
    });
    await user.click(buttonByName(mobileActionRow(container), "backup.delete"));
    const popconfirm = await within(document.body).findByRole("tooltip");
    await user.click(within(popconfirm).getByRole("button", { name: "OK" }));

    await vi.waitFor(() =>
      expect(apiMocks.deleteBackups).toHaveBeenCalledWith(["mob-del"]),
    );
    expect(messageMocks.success).toHaveBeenCalledWith("backup.deleteSuccess");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("reports a mobile delete failure the same way as the desktop one", async () => {
    const user = userEvent.setup();
    apiMocks.deleteBackups.mockRejectedValueOnce(new Error("server refused"));
    const { container, onRefresh } = renderTable({
      backups: [makeBackup({ id: "mob-bad" })],
    });
    await user.click(buttonByName(mobileActionRow(container), "backup.delete"));
    const popconfirm = await within(document.body).findByRole("tooltip");
    await user.click(within(popconfirm).getByRole("button", { name: "OK" }));

    await vi.waitFor(() => expect(messageMocks.error).toHaveBeenCalled());
    expect(messageMocks.error).toHaveBeenCalledWith("backup.deleteFailed");
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("BackupTable action layout", () => {
  it("offers exactly restore, export and delete on the desktop row", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const labels = Array.from(
      desktopActionCell(container).querySelectorAll("button"),
    ).map((button) => button.textContent);
    expect(labels).toEqual([
      "backup.restore",
      "backup.export",
      "backup.delete",
    ]);
  });

  it("offers exactly restore, export and delete on the mobile card", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const labels = Array.from(
      mobileActionRow(container).querySelectorAll("button"),
    ).map((button) => button.textContent);
    expect(labels).toEqual([
      "backup.restore",
      "backup.export",
      "backup.delete",
    ]);
  });

  it("marks the delete control as destructive on both layouts", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const desktopDelete = buttonByName(
      desktopActionCell(container),
      "backup.delete",
    );
    const mobileDelete = buttonByName(
      mobileActionRow(container),
      "backup.delete",
    );
    expect(desktopDelete.className).toContain("ant-btn-dangerous");
    expect(mobileDelete.className).toContain("ant-btn-dangerous");
  });

  it("marks the mobile restore control as the primary action", () => {
    const { container } = renderTable({ backups: makeList(1) });
    const mobileRestore = buttonByName(
      mobileActionRow(container),
      "backup.restore",
    );
    expect(mobileRestore.className).toContain("ant-btn-primary");
  });

  it("repeats the three actions for every row rather than sharing one set", () => {
    const { container } = renderTable({ backups: makeList(3) });
    const rows = Array.from(container.querySelectorAll(".ant-table-row"));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const labels = Array.from(
        (row as HTMLElement).querySelectorAll(`.${styles.actions} button`),
      ).map((button) => button.textContent);
      expect(labels).toEqual([
        "backup.restore",
        "backup.export",
        "backup.delete",
      ]);
    }
  });
});
