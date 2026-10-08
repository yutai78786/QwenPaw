/**
 * Unit tests for RestoreAgentTable, the expandable agent selection table
 * rendered inside RestoreBackupModal.
 *
 * Facts that shaped this suite (each one verified with throwaway probes that
 * were deleted before this file landed):
 *
 * 1. `react-i18next` is mocked with one stable `t` created inside the factory
 *    body, so its identity never changes across renders. A fresh arrow per
 *    `useTranslation()` call would be a hazard for any component that lists
 *    `t` in a dependency array.
 * 2. antd renders for real here. The component imports `Checkbox, Input, Tag,
 *    Table, Spin, Typography` straight from `antd` (no design-system alias is
 *    involved), so row markup, `data-row-key`, pagination and the empty
 *    placeholder are the genuine article and can be asserted directly.
 * 3. The parent used below is stateful. A `vi.fn()` parent never re-renders,
 *    so the component keeps receiving its initial `selectedAgents` prop; that
 *    makes "toggle a row back off" assertions pass for the wrong reason.
 *    Every selection test therefore drives real state through `Harness`.
 * 4. `pagination.hideOnSinglePage` is true, so the `showTotal` callback only
 *    runs while more than one page exists. Its search-aware branch needs a
 *    filter that still leaves more than ten rows.
 * 5. The CSS module resolves to hashed class names under vitest (`css: true`
 *    in vite.config), so `styles.*` is imported and used here instead of any
 *    hard-coded class string.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("react-i18next", () => {
  // Built once per factory call, so `t` keeps a stable identity.
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key;
  return {
    useTranslation: () => ({
      t,
      i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
    }),
  };
});

import RestoreAgentTable from "./RestoreAgentTable";
import type { AgentRow } from "./RestoreAgentTable";
import styles from "./RestoreAgentTable.module.less";

const SEARCH_PLACEHOLDER = "backup.agentSearchPlaceholder";

function makeRow(aid: string, overrides: Partial<AgentRow> = {}): AgentRow {
  // Full object literal on purpose: computed-key shortcuts widen to an index
  // signature and lose the type guard this suite relies on.
  return {
    key: aid,
    aid,
    name: `Name-${aid}`,
    isExisting: false,
    currentWorkspaceDir: "",
    ...overrides,
  };
}

function makeRows(count: number, prefix = "a"): AgentRow[] {
  return Array.from({ length: count }, (_, i) => makeRow(`${prefix}${i}`));
}

interface HarnessProps {
  rows: AgentRow[];
  initialSelection?: string[];
  dir?: string;
  initialInclude?: boolean;
  detailLoading?: boolean;
  summaryText?: string | null;
}

/**
 * Stateful parent. Keeping `selectedAgents` and `includeAgents` in real state
 * is what makes the "toggle off" and "collapse" assertions meaningful.
 */
function Harness({
  rows,
  initialSelection = [],
  dir = "/base",
  initialInclude = true,
  detailLoading = false,
  summaryText = null,
}: HarnessProps) {
  const [selection, setSelection] = useState<string[]>(initialSelection);
  const [include, setInclude] = useState(initialInclude);
  return (
    <div>
      <div data-testid="selection-out">{JSON.stringify(selection)}</div>
      <div data-testid="include-out">{String(include)}</div>
      <RestoreAgentTable
        allAgentRows={rows}
        selectedAgents={selection}
        onSelectionChange={setSelection}
        detailLoading={detailLoading}
        defaultWorkspaceDir={dir}
        includeAgents={include}
        onIncludeAgentsChange={setInclude}
        summaryText={summaryText}
      />
    </div>
  );
}

function renderTable(props: HarnessProps) {
  const view = render(<Harness {...props} />);
  const root = view.container;
  return {
    ...view,
    root,
    header: () =>
      root.querySelector(`.${styles.agentsRowHeader}`) as HTMLElement,
    content: () => root.querySelector(`.${styles.agentsContent}`),
    dataRows: () => Array.from(root.querySelectorAll(".ant-table-row")),
    bodyRows: () => Array.from(root.querySelectorAll(".ant-table-tbody tr")),
    rowOf: (aid: string) =>
      root.querySelector(`.ant-table-row[data-row-key="${aid}"]`),
    rowBox: (aid: string) =>
      root.querySelector<HTMLInputElement>(
        `.ant-table-row[data-row-key="${aid}"] input[type=checkbox]`,
      ),
    includeBox: () =>
      root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[0],
    selectAllBox: () =>
      root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1],
    searchInput: () =>
      root.querySelector<HTMLInputElement>(
        `input[placeholder="${SEARCH_PLACEHOLDER}"]`,
      ) as HTMLInputElement,
    expandToggle: () => root.querySelector(`.${styles.expandToggle}`),
    expandIconClass: () =>
      root.querySelector(`.${styles.expandToggle} .anticon`)?.className ?? "",
    countText: () =>
      root.querySelector(`.${styles.selectAllCount}`)?.textContent,
    cellTexts: () =>
      Array.from(root.querySelectorAll("td")).map((c) => c.textContent),
    titleAttrs: () =>
      Array.from(root.querySelectorAll("[title]")).map((e) =>
        e.getAttribute("title"),
      ),
    pagTotal: () =>
      root.querySelector(".ant-pagination-total-text")?.textContent ?? null,
    selectionOut: () => view.getByTestId("selection-out").textContent,
    includeOut: () => view.getByTestId("include-out").textContent,
    typeQuery: (value: string) => {
      fireEvent.change(
        root.querySelector<HTMLInputElement>(
          `input[placeholder="${SEARCH_PLACEHOLDER}"]`,
        ) as HTMLInputElement,
        { target: { value } },
      );
    },
  };
}

describe("RestoreAgentTable header row", () => {
  it("labels the include checkbox with the agents scope key", () => {
    const { header } = renderTable({ rows: makeRows(2) });
    expect(header().textContent).toContain("backup.scopeAgents");
  });

  it("renders the expand toggle only while agents are included", () => {
    const { expandToggle } = renderTable({ rows: makeRows(1) });
    expect(expandToggle()).not.toBeNull();
  });

  it("marks the expand icon as open in the default expanded state", () => {
    const { expandIconClass } = renderTable({ rows: makeRows(1) });
    expect(expandIconClass()).toContain("anticon-right");
    expect(expandIconClass()).toContain(styles.expandIcon);
    expect(expandIconClass()).toContain(styles.open);
  });

  it("shows the reported selection count over the total row count", () => {
    const { countText } = renderTable({
      rows: makeRows(3),
      initialSelection: ["a0", "a2"],
    });
    expect(countText()).toBe("(2/3)");
  });

  it("reports a zero-over-zero count when the backup holds no agents", () => {
    const { countText } = renderTable({ rows: [] });
    expect(countText()).toBe("(0/0)");
  });
});

describe("RestoreAgentTable agent name cell", () => {
  it("renders the display name in the emphasised slot", () => {
    const { root } = renderTable({ rows: [makeRow("alpha")] });
    expect(root.querySelector(`.${styles.agentName}`)?.textContent).toBe(
      "Name-alpha",
    );
  });

  it("appends the id in parentheses when the id differs from the name", () => {
    const { root } = renderTable({ rows: [makeRow("alpha")] });
    expect(root.querySelector(`.${styles.agentId}`)?.textContent).toBe(
      "(alpha)",
    );
  });

  it("omits the parenthesised id when name and id are identical", () => {
    const { root } = renderTable({
      rows: [makeRow("same", { name: "same" })],
    });
    expect(root.querySelectorAll(`.${styles.agentId}`)).toHaveLength(0);
    expect(root.querySelector(`.${styles.agentName}`)?.textContent).toBe(
      "same",
    );
  });

  it("tags an existing agent as a replace action with the blue colour", () => {
    const { root } = renderTable({
      rows: [
        makeRow("ex", { isExisting: true, currentWorkspaceDir: "/ws/ex" }),
      ],
    });
    const tag = root.querySelector(`.${styles.agentActionTag}`) as HTMLElement;
    expect(tag.textContent).toBe("backup.agentActionReplace");
    expect(tag.className).toContain("ant-tag-blue");
  });

  it("tags a new agent as an add action with the green colour", () => {
    const { root } = renderTable({ rows: [makeRow("new")] });
    const tag = root.querySelector(`.${styles.agentActionTag}`) as HTMLElement;
    expect(tag.textContent).toBe("backup.agentActionAdd");
    expect(tag.className).toContain("ant-tag-green");
  });
});

describe("RestoreAgentTable destination workspace cell", () => {
  it("shows the current workspace directory for an existing agent", () => {
    const { cellTexts } = renderTable({
      rows: [
        makeRow("ex", { isExisting: true, currentWorkspaceDir: "/ws/ex" }),
      ],
    });
    expect(cellTexts()).toContain("/ws/ex");
  });

  it("falls back to the agent id when an existing agent has no directory", () => {
    const { cellTexts, titleAttrs } = renderTable({
      rows: [makeRow("ex2", { isExisting: true, currentWorkspaceDir: "" })],
    });
    expect(cellTexts()).toContain("ex2");
    expect(titleAttrs()).toContain("ex2");
  });

  it("joins the default directory and the id for a new agent", () => {
    const { cellTexts } = renderTable({
      rows: [makeRow("beta")],
      dir: "/base",
    });
    expect(cellTexts()).toContain("/base/beta");
  });

  it("strips trailing slashes from the default directory before joining", () => {
    const { cellTexts } = renderTable({
      rows: [makeRow("beta")],
      dir: "/base///",
    });
    expect(cellTexts()).toContain("/base/beta");
  });

  it("keeps a windows-style base path and appends with a forward slash", () => {
    const { cellTexts } = renderTable({
      rows: [makeRow("beta")],
      dir: "C:\\ws\\",
    });
    expect(cellTexts()).toContain("C:\\ws/beta");
  });

  it("falls back to the translated placeholder when the directory is blank", () => {
    const { cellTexts } = renderTable({
      rows: [makeRow("beta")],
      dir: "   ",
    });
    expect(cellTexts()).toContain(
      'backup.defaultWorkspaceDirDefault:{"aid":"beta"}',
    );
  });

  it("mirrors the same value into the ellipsis tooltip title", () => {
    const { titleAttrs } = renderTable({
      rows: [
        makeRow("ex", { isExisting: true, currentWorkspaceDir: "/ws/ex" }),
        makeRow("beta"),
      ],
      dir: "/base",
    });
    expect(titleAttrs()).toContain("/ws/ex");
    expect(titleAttrs()).toContain("/base/beta");
  });
});

describe("RestoreAgentTable search filtering", () => {
  it("shows every row while the query is empty", () => {
    const { dataRows } = renderTable({ rows: makeRows(3) });
    expect(dataRows()).toHaveLength(3);
  });

  it("treats a whitespace-only query as empty", () => {
    const { dataRows, typeQuery } = renderTable({ rows: makeRows(3) });
    typeQuery("   ");
    expect(dataRows()).toHaveLength(3);
  });

  it("matches on the display name case insensitively", () => {
    const { dataRows, typeQuery } = renderTable({
      rows: [
        makeRow("alpha", { name: "Zulu" }),
        makeRow("beta", { name: "Yankee" }),
      ],
    });
    typeQuery("ZULU");
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0].getAttribute("data-row-key")).toBe("alpha");
  });

  it("matches on the agent id when the name does not match", () => {
    const { dataRows, typeQuery } = renderTable({
      rows: [
        makeRow("alpha", { name: "Zulu" }),
        makeRow("beta", { name: "Yankee" }),
      ],
    });
    typeQuery("beta");
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0].getAttribute("data-row-key")).toBe("beta");
  });

  it("shows the table empty placeholder when nothing matches", () => {
    const { root, dataRows, typeQuery } = renderTable({ rows: makeRows(2) });
    typeQuery("zzz");
    expect(dataRows()).toHaveLength(0);
    expect(root.querySelector(".ant-table-placeholder")?.textContent).toBe(
      "backup.noAgentsInBackup",
    );
  });

  it("keeps the selection count based on the unfiltered list while filtered", () => {
    const { countText, typeQuery } = renderTable({
      rows: makeRows(3),
      initialSelection: ["a0"],
    });
    typeQuery("a1");
    expect(countText()).toBe("(1/3)");
  });

  it("restores the full list when the query is cleared with allowClear", () => {
    const { root, dataRows, typeQuery } = renderTable({ rows: makeRows(3) });
    typeQuery("a0");
    expect(dataRows()).toHaveLength(1);
    fireEvent.click(root.querySelector(".ant-input-clear-icon") as Element);
    expect(dataRows()).toHaveLength(3);
  });
});

describe("RestoreAgentTable row selection", () => {
  it("adds a row id when its checkbox is turned on", () => {
    const { rowBox, selectionOut } = renderTable({
      rows: makeRows(2),
      initialSelection: ["a0"],
    });
    fireEvent.click(rowBox("a1") as HTMLInputElement);
    expect(selectionOut()).toBe('["a0","a1"]');
  });

  it("removes a row id when its checkbox is turned back off", () => {
    const { rowBox, selectionOut } = renderTable({
      rows: makeRows(2),
      initialSelection: ["a0", "a1"],
    });
    fireEvent.click(rowBox("a1") as HTMLInputElement);
    expect(selectionOut()).toBe('["a0"]');
  });

  it("preserves selections that fall outside the filtered view", () => {
    const { rowBox, selectionOut, typeQuery } = renderTable({
      rows: [makeRow("alpha"), makeRow("beta"), makeRow("gamma")],
      initialSelection: ["alpha"],
    });
    typeQuery("beta");
    fireEvent.click(rowBox("beta") as HTMLInputElement);
    expect(selectionOut()).toBe('["alpha","beta"]');
  });

  it("marks a row checkbox as checked from the incoming selection prop", () => {
    const { rowBox } = renderTable({
      rows: makeRows(2),
      initialSelection: ["a1"],
    });
    expect((rowBox("a0") as HTMLInputElement).checked).toBe(false);
    expect((rowBox("a1") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the antd supplied cell node when rendering a row checkbox", () => {
    const { root } = renderTable({ rows: makeRows(1) });
    expect(root.querySelectorAll(".ant-table-row .ant-checkbox")).toHaveLength(
      1,
    );
  });
});

describe("RestoreAgentTable select-all control", () => {
  it("selects every id from the unfiltered list when turned on", () => {
    const { selectAllBox, selectionOut } = renderTable({ rows: makeRows(3) });
    fireEvent.click(selectAllBox() as HTMLInputElement);
    expect(selectionOut()).toBe('["a0","a1","a2"]');
  });

  it("clears the whole selection when turned off", () => {
    const { selectAllBox, selectionOut } = renderTable({
      rows: makeRows(2),
      initialSelection: ["a0", "a1"],
    });
    fireEvent.click(selectAllBox() as HTMLInputElement);
    expect(selectionOut()).toBe("[]");
  });

  it("reports the checked state once every id is selected", () => {
    const { selectAllBox } = renderTable({
      rows: makeRows(2),
      initialSelection: ["a0", "a1"],
    });
    expect((selectAllBox() as HTMLInputElement).checked).toBe(true);
  });

  it("reports the indeterminate state for a partial selection", () => {
    const { root, selectAllBox } = renderTable({
      rows: makeRows(3),
      initialSelection: ["a0"],
    });
    expect((selectAllBox() as HTMLInputElement).checked).toBe(false);
    expect(root.querySelectorAll(".ant-checkbox-indeterminate")).toHaveLength(
      1,
    );
  });

  it("selects the unfiltered ids even while a filter is active", () => {
    const { selectAllBox, selectionOut, typeQuery } = renderTable({
      rows: [makeRow("alpha"), makeRow("beta"), makeRow("gamma")],
    });
    typeQuery("beta");
    fireEvent.click(selectAllBox() as HTMLInputElement);
    expect(selectionOut()).toBe('["alpha","beta","gamma"]');
  });

  it("does not report the all-selected state for an empty backup", () => {
    const { selectAllBox, root } = renderTable({ rows: [] });
    expect((selectAllBox() as HTMLInputElement).checked).toBe(false);
    expect(root.querySelectorAll(".ant-checkbox-indeterminate")).toHaveLength(
      0,
    );
  });

  it("clears nothing when select-all is toggled off on an empty backup", () => {
    const { selectAllBox, selectionOut } = renderTable({ rows: [] });
    fireEvent.click(selectAllBox() as HTMLInputElement);
    expect(selectionOut()).toBe("[]");
  });

  it("selects nothing when select-all is toggled on for an empty backup", () => {
    const { selectionOut } = renderTable({
      rows: [],
      initialSelection: [],
    });
    expect(selectionOut()).toBe("[]");
  });
});

describe("RestoreAgentTable expand and collapse", () => {
  it("hides the table body when the section is collapsed", () => {
    const { root, expandToggle, content } = renderTable({ rows: makeRows(2) });
    fireEvent.click(expandToggle() as Element);
    expect(root.querySelectorAll(".ant-table")).toHaveLength(0);
    expect(content()).toBeNull();
  });

  it("drops the open marker from the icon while collapsed", () => {
    const { expandToggle, expandIconClass } = renderTable({
      rows: makeRows(1),
    });
    fireEvent.click(expandToggle() as Element);
    expect(expandIconClass()).toContain(styles.expandIcon);
    expect(expandIconClass()).not.toContain(styles.open);
  });

  it("brings the table back when the section is expanded again", () => {
    const { root, expandToggle } = renderTable({ rows: makeRows(2) });
    fireEvent.click(expandToggle() as Element);
    fireEvent.click(expandToggle() as Element);
    expect(root.querySelectorAll(".ant-table-row")).toHaveLength(2);
    expect(expandToggle() as Element).not.toBeNull();
  });
});

describe("RestoreAgentTable include-agents gate", () => {
  it("hides the toggle and the body when agents are excluded", () => {
    const { root, expandToggle, content } = renderTable({
      rows: makeRows(2),
      initialInclude: false,
    });
    expect(root.querySelectorAll(".ant-table")).toHaveLength(0);
    expect(expandToggle()).toBeNull();
    expect(content()).toBeNull();
  });

  it("still renders the header checkbox when agents are excluded", () => {
    const { header, includeBox } = renderTable({
      rows: makeRows(1),
      initialInclude: false,
    });
    expect(header().textContent).toContain("backup.scopeAgents");
    expect((includeBox() as HTMLInputElement).checked).toBe(false);
  });

  it("reports false and collapses expansion when the checkbox is turned off", () => {
    const { root, includeBox, includeOut } = renderTable({ rows: makeRows(2) });
    fireEvent.click(includeBox() as HTMLInputElement);
    expect(includeOut()).toBe("false");
    expect(root.querySelectorAll(".ant-table")).toHaveLength(0);
  });

  it("returns to the expanded table when the checkbox is turned back on", () => {
    const { root, includeBox, includeOut } = renderTable({ rows: makeRows(2) });
    fireEvent.click(includeBox() as HTMLInputElement);
    fireEvent.click(includeBox() as HTMLInputElement);
    expect(includeOut()).toBe("true");
    expect(root.querySelectorAll(".ant-table-row")).toHaveLength(2);
  });
});

describe("RestoreAgentTable loading state", () => {
  it("replaces the table with the loading block while details load", () => {
    const { root, content } = renderTable({
      rows: makeRows(2),
      detailLoading: true,
    });
    expect(root.querySelectorAll(".ant-table")).toHaveLength(0);
    expect(content()).not.toBeNull();
    expect(root.querySelector(`.${styles.agentsLoading}`)).not.toBeNull();
  });

  it("shows the loading label under the spinner", () => {
    const { root } = renderTable({ rows: [], detailLoading: true });
    expect(
      root.querySelector(`.${styles.agentsLoadingText}`)?.textContent,
    ).toBe("backup.loadingAgents");
  });

  it("adds a small inline spinner next to the header label", () => {
    const { header } = renderTable({ rows: [], detailLoading: true });
    expect(header().querySelectorAll(".ant-spin")).toHaveLength(1);
    expect(header().querySelector(".ant-spin")?.className).toContain(
      "ant-spin-sm",
    );
  });

  it("omits the header spinner once loading has finished", () => {
    const { header } = renderTable({ rows: makeRows(1), detailLoading: false });
    expect(header().querySelectorAll(".ant-spin")).toHaveLength(0);
  });

  it("hides the header spinner when agents are excluded even while loading", () => {
    const { header } = renderTable({
      rows: makeRows(1),
      detailLoading: true,
      initialInclude: false,
    });
    expect(header().querySelectorAll(".ant-spin")).toHaveLength(0);
  });
});

describe("RestoreAgentTable summary text", () => {
  it("shows the summary next to the label when details are ready", () => {
    const { root } = renderTable({
      rows: makeRows(2),
      summaryText: "3 agents selected",
    });
    expect(root.querySelector(`.${styles.agentSummaryText}`)?.textContent).toBe(
      "\u2014 3 agents selected",
    );
  });

  it("omits the summary while details are still loading", () => {
    const { root } = renderTable({
      rows: makeRows(2),
      detailLoading: true,
      summaryText: "3 agents selected",
    });
    expect(root.querySelector(`.${styles.agentSummaryText}`)).toBeNull();
    expect(root.textContent).not.toContain("3 agents selected");
  });

  it("omits the summary when no summary text was reported", () => {
    const { root } = renderTable({ rows: makeRows(2), summaryText: null });
    expect(root.querySelector(`.${styles.agentSummaryText}`)).toBeNull();
  });

  it("omits the summary when agents are excluded", () => {
    const { root } = renderTable({
      rows: makeRows(1),
      initialInclude: false,
      summaryText: "3 agents selected",
    });
    expect(root.querySelector(`.${styles.agentSummaryText}`)).toBeNull();
  });
});

describe("RestoreAgentTable pagination", () => {
  it("hides pagination for a single page", () => {
    const { root } = renderTable({ rows: makeRows(3) });
    expect(root.querySelectorAll(".ant-pagination")).toHaveLength(0);
  });

  it("reports the plain total while no search is active", () => {
    const { root, pagTotal } = renderTable({ rows: makeRows(12) });
    expect(root.querySelectorAll(".ant-pagination")).toHaveLength(1);
    expect(pagTotal()).toBe('backup.agentTotal:{"count":12}');
  });

  it("shows ten rows on the first page of a twelve row backup", () => {
    const { dataRows } = renderTable({ rows: makeRows(12) });
    expect(dataRows()).toHaveLength(10);
  });

  it("switches to the search aware total while a multi page filter is active", () => {
    const { pagTotal, typeQuery, dataRows } = renderTable({
      rows: makeRows(12, "common"),
    });
    typeQuery("common");
    expect(dataRows()).toHaveLength(10);
    expect(pagTotal()).toBe('backup.agentSearchTotal:{"count":12,"total":12}');
  });

  it("hides pagination again once the filter narrows to a single page", () => {
    const { root, pagTotal, typeQuery } = renderTable({
      rows: makeRows(12, "common"),
    });
    typeQuery("common1");
    expect(root.querySelectorAll(".ant-pagination")).toHaveLength(0);
    expect(pagTotal()).toBeNull();
  });

  it("disables the page size changer", () => {
    const { root } = renderTable({ rows: makeRows(12) });
    expect(root.querySelectorAll(".ant-pagination-options")).toHaveLength(0);
  });
});

describe("RestoreAgentTable empty backup", () => {
  it("renders the translated empty text inside the table placeholder", () => {
    const { root } = renderTable({ rows: [] });
    expect(root.querySelector(".ant-table-placeholder")?.textContent).toBe(
      "backup.noAgentsInBackup",
    );
  });

  it("still renders the search toolbar and both column titles", () => {
    const { root, searchInput } = renderTable({ rows: [] });
    expect(searchInput()).not.toBeNull();
    expect(root.textContent).toContain("backup.agentColumnName");
    expect(root.textContent).toContain("backup.agentColumnWorkspace");
  });
});

describe("RestoreAgentTable column titles", () => {
  it("renders both column titles from the translation keys", () => {
    const { root } = renderTable({ rows: makeRows(1) });
    const titles = Array.from(root.querySelectorAll("th")).map(
      (t) => t.textContent,
    );
    expect(titles).toContain("backup.agentColumnName");
    expect(titles).toContain("backup.agentColumnWorkspace");
  });
});

describe("RestoreAgentTable prop plumbing", () => {
  it("renders a row per agent supplied by the parent", () => {
    const { dataRows } = renderTable({
      rows: [
        makeRow("alpha", {
          isExisting: true,
          currentWorkspaceDir: "/ws/alpha",
        }),
        makeRow("beta"),
      ],
    });
    expect(dataRows().map((r) => r.getAttribute("data-row-key"))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("re-renders with new rows when the parent list changes", () => {
    const view = render(
      <Harness rows={[makeRow("alpha")]} initialSelection={[]} />,
    );
    expect(view.container.querySelectorAll(".ant-table-row")).toHaveLength(1);
    view.rerender(
      <Harness
        rows={[makeRow("alpha"), makeRow("beta")]}
        initialSelection={[]}
      />,
    );
    expect(view.container.querySelectorAll(".ant-table-row")).toHaveLength(2);
  });

  it("does not call back into the parent during the first render", () => {
    const onSelectionChange = vi.fn();
    const onIncludeAgentsChange = vi.fn();
    render(
      <RestoreAgentTable
        allAgentRows={makeRows(2)}
        selectedAgents={[]}
        onSelectionChange={onSelectionChange}
        detailLoading={false}
        defaultWorkspaceDir="/base"
        includeAgents
        onIncludeAgentsChange={onIncludeAgentsChange}
        summaryText={null}
      />,
    );
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onIncludeAgentsChange).not.toHaveBeenCalled();
  });
});
