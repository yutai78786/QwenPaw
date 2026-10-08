/**
 * Unit tests for the Hub governance model usage analytics page.
 *
 * Target under test: `src/pages/Hub/governance/ModelUsage.tsx` (default
 * export). It fetches `admin/usage/details` for a date range, then renders a
 * toolbar (range picker, model filter, member filter, refresh, timezone), four
 * summary cards, a per-day/per-model trend chart, and a ranking table whose
 * dimension is switchable between member / model / date.
 *
 * Harness notes (each one is a measured fact, not a guess):
 *
 * 1. The presentational children are rendered for real, not stubbed. The
 *    target imports `UsageSummaryCards` and `UsageTable` (which compose
 *    `@agentscope-ai/design` `Card`/`Table`) plus `LoadingState`, `EmptyState`
 *    and `ModelTrendChart`. Rendering them for real is what makes the column
 *    definitions reachable at all: `render`/`sorter` callbacks only execute
 *    inside a real table.
 *
 * 2. `@agentscope-ai/design` is globally aliased to `src/test/design-mock.ts`,
 *    which does not export `Card` or `Table` (measured: `grep -c "export const
 *    Card"` on that stub returns 0). Both are supplied here by a local factory
 *    mock that keeps every other stubbed export intact. `Table` is bound to the
 *    real antd `Table` so header sorting and cell rendering behave like
 *    production, while the same factory captures props for column assertions.
 *
 * 3. `@ant-design/plots` is stubbed with a prop-capturing `Line`; the real
 *    package needs a canvas, which jsdom does not provide. The captured
 *    `chartConfig` is exactly what the target feeds the chart, so asserting on
 *    it asserts on product output rather than on the stub.
 *
 * 4. `DatePicker.RangePicker` and `Select` are wrapped (not replaced) so both
 *    the real antd components and a prop capture are available.
 *    `disabledDate` is driven through that capture because antd only calls it
 *    for panel cells, and in jsdom those calls all short-circuit on the
 *    `isAfter(today)` arm — the second operand is otherwise unreachable.
 *    Driving the range picker through the capture matches what
 *    `src/pages/Settings/TokenUsage/index.test.tsx` already does for this
 *    component family.
 *
 * 5. The `react-i18next` stub returns stable references (`vi.hoisted`) and a
 *    fixed `i18n.language`, which the number formatter reads.
 *
 * 6. `governanceRequest` is mocked because the real implementation performs
 *    `fetch` against a configured hub base URL. The mock is also what makes the
 *    staleness guards reachable: they compare a per-call sequence id against a
 *    ref, so they can only be exercised by resolving requests out of order.
 *
 * 7. Assertions target user-visible outcomes (rendered timezone, summary card
 *    values, live dropdown option text, row order after a header click)
 *    wherever the DOM exposes them. Two places assert on captured props
 *    instead, and both are forced: the chart series (the chart is stubbed by
 *    necessity, note 3) and the column `sorter`/`render` callbacks — calling
 *    those directly is the established convention in this repo, see
 *    `src/pages/Control/Sessions/components/columns.test.tsx`, which documents
 *    "exercised by calling their render/sorter functions directly". Each such
 *    call still asserts an ordering/formatting contract.
 *
 * 8. antd portals `Select` dropdowns to `document` level and, because jsdom
 *    never fires `animationend`, a closed dropdown keeps its leave-motion
 *    classes instead of disappearing. Every dropdown assertion therefore goes
 *    through `liveDropdown()`, which filters on motion/hidden classes and
 *    asserts exactly one dropdown is live.
 *
 * 9. The antd table renders an extra `tbody tr.ant-table-measure-row`, so row
 *    selectors exclude it. Counting `tbody tr` without that filter is off by
 *    one.
 *
 * 10. Dates are computed with `dayjs()` at test time rather than frozen with
 *     fake timers, and every expectation is derived from the same dayjs calls
 *     the product makes. Assertions that need an exact day list switch the
 *     range to a fixed window first, so nothing depends on the run date.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import dayjs from "dayjs";
import React from "react";

const governanceRequest = vi.hoisted(() => vi.fn());

vi.mock("../../../api/modules/hubGovernance", () => ({ governanceRequest }));

// Stable references on purpose — see harness note 5.
const i18nStub = vi.hoisted(() => {
  const stableT = (key: string) => key;
  return { t: stableT, i18n: { language: "en-US" } };
});

vi.mock("react-i18next", () => ({ useTranslation: () => i18nStub }));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));

const captured = vi.hoisted(() => ({
  chart: null as any,
  picker: null as any,
  table: null as any,
  selects: {} as Record<string, any>,
}));

vi.mock("@ant-design/plots", () => ({
  Line: (props: any) => {
    captured.chart = props;
    return React.createElement("div", { "data-testid": "trend-line" });
  },
}));

// The global design stub has no Card/Table (harness note 2).
vi.mock("@agentscope-ai/design", async (importOriginal) => {
  const actual: any = await importOriginal();
  const antd: any = await import("antd");
  const Table = (props: any) => {
    captured.table = props;
    return React.createElement(antd.Table, props);
  };
  const Card = ({ children, title, className }: any) =>
    React.createElement(
      "div",
      { className, "data-testid": "ds-card" },
      title === undefined || title === null
        ? null
        : React.createElement("div", { "data-testid": "ds-card-title" }, title),
      children,
    );
  return { ...actual, Table, Card };
});

vi.mock("antd", async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealRangePicker = actual.DatePicker.RangePicker;
  const RangePicker = (props: any) => {
    captured.picker = props;
    return React.createElement(RealRangePicker, props);
  };
  const SelectWrapper = (props: any) => {
    const label = props["aria-label"];
    if (typeof label === "string") captured.selects[label] = props;
    return React.createElement(actual.Select, props);
  };
  return {
    ...actual,
    DatePicker: Object.assign({}, actual.DatePicker, { RangePicker }),
    Select: Object.assign(SelectWrapper, actual.Select),
  };
});

import ModelUsage from "./ModelUsage";
import type { UsageGroup } from "./usageAnalytics";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const TODAY = dayjs();
const MONTH_START = TODAY.startOf("month");
const START_PARAM = MONTH_START.format("YYYY-MM-DD");
const END_PARAM = TODAY.format("YYYY-MM-DD");
const EXPECTED_URL = `admin/usage/details?start_date=${START_PARAM}&end_date=${END_PARAM}`;
const DAYS_IN_RANGE = TODAY.diff(MONTH_START, "day") + 1;
const SECOND_DAY = MONTH_START.add(1, "day").format("YYYY-MM-DD");

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    date: START_PARAM,
    user_id: "u1",
    username: "Alice",
    model_id: "m1",
    model_name: "GPT-4o",
    requests: 10,
    charged: 1000,
    actual: 900,
    reserved: 50,
    conservative: 40,
    failures: 1,
    ...overrides,
  };
}

function report(rows: unknown[], timezone = "Asia/Shanghai") {
  return { timezone, rows };
}

/**
 * Two members across two models and two days: Alice charged 1600 (1000 on
 * GPT-4o, 600 on Claude), Bob charged 400 (Claude only).
 */
function mixedRows() {
  return [
    makeRow({ date: START_PARAM, charged: 1000, requests: 10, failures: 1 }),
    makeRow({
      date: START_PARAM,
      user_id: "u2",
      username: "Bob",
      model_id: "m2",
      model_name: "Claude",
      charged: 400,
      requests: 4,
      failures: 0,
    }),
    makeRow({
      date: SECOND_DAY,
      model_id: "m2",
      model_name: "Claude",
      charged: 600,
      requests: 6,
      failures: 2,
    }),
  ];
}

const MODEL_LABEL = "tokenUsage.model";
const MEMBER_LABEL = "hub.governance.users.member";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function renderWithData(rows = mixedRows(), timezone = "Asia/Shanghai") {
  governanceRequest.mockResolvedValue(report(rows, timezone));
  const utils = render(<ModelUsage />);
  await waitFor(() => expect(screen.getByText(timezone)).toBeInTheDocument());
  return utils;
}

function selectProps(label: string) {
  const props = captured.selects[label];
  expect(props, `select ${label} not captured`).toBeTruthy();
  return props;
}

/** Change a filter the way antd would: through the captured onChange. */
async function setFilter(label: string, value: string | undefined) {
  await act(async () => {
    selectProps(label).onChange(value);
  });
}

/** Change the range the way antd would: through the captured onChange. */
async function setRange(start: dayjs.Dayjs, end: dayjs.Dayjs) {
  await act(async () => {
    captured.picker.onChange([start, end]);
  });
}

/** The dropdown that is actually open right now; see harness note 8. */
function liveDropdown(): Element {
  const nodes = Array.from(
    document.querySelectorAll(".ant-select-dropdown"),
  ).filter(
    (n) =>
      !n.className.includes("ant-slide-up-leave") &&
      !n.className.includes("ant-select-dropdown-hidden"),
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function optionTexts(dd: Element): string[] {
  return Array.from(dd.querySelectorAll(".ant-select-item-option")).map(
    (n) => n.textContent ?? "",
  );
}

async function openSelectByLabel(label: string): Promise<Element> {
  const combo = document.querySelector(
    `input[role='combobox'][aria-label='${label}']`,
  ) as HTMLInputElement;
  expect(combo, `combobox ${label} not found`).toBeTruthy();
  fireEvent.mouseDown(combo.closest(".ant-select-selector") as HTMLElement);
  await waitFor(() => expect(combo.getAttribute("aria-expanded")).toBe("true"));
  return liveDropdown();
}

function tableRows(): UsageGroup[] {
  expect(captured.table, "table must be rendered").toBeTruthy();
  return captured.table.dataSource as UsageGroup[];
}

function rowLabels(): string[] {
  return tableRows().map((r) => r.label);
}

/**
 * A complete `UsageGroup`, so sorter/render callbacks can be called with real
 * objects instead of partial casts. Every field defaults to zero.
 */
function group(overrides: Partial<UsageGroup> = {}): UsageGroup {
  return {
    key: "k",
    label: "k",
    members: 0,
    models: 0,
    requests: 0,
    charged: 0,
    actual: 0,
    reserved: 0,
    conservative: 0,
    failures: 0,
    ...overrides,
  };
}

/**
 * The five generated numeric columns, each with a low and a high sample row.
 * Written out explicitly rather than built with a computed key: a computed key
 * over a union of field names widens to an index signature, which does not
 * overlap `UsageGroup` and fails type checking.
 */
const NUMERIC_SORTER_CASES: Array<{
  field: string;
  low: UsageGroup;
  high: UsageGroup;
}> = [
  {
    field: "requests",
    low: group({ requests: 3 }),
    high: group({ requests: 7 }),
  },
  {
    field: "failures",
    low: group({ failures: 3 }),
    high: group({ failures: 7 }),
  },
  { field: "actual", low: group({ actual: 3 }), high: group({ actual: 7 }) },
  {
    field: "conservative",
    low: group({ conservative: 3 }),
    high: group({ conservative: 7 }),
  },
  {
    field: "reserved",
    low: group({ reserved: 3 }),
    high: group({ reserved: 7 }),
  },
];

/** Data rows as rendered in the DOM, excluding the antd measure row. */
function domRowCells(container: HTMLElement, cellIndex: number): string[] {
  return Array.from(
    container.querySelectorAll("tbody tr:not(.ant-table-measure-row)"),
  ).map((tr) => {
    const cells = tr.querySelectorAll("td");
    return cells[cellIndex]?.textContent ?? "";
  });
}

function columnBy(key: string): any {
  const cols = captured.table?.columns ?? [];
  const col = cols.find((c: any) => c.key === key);
  expect(
    col,
    `column ${key} not in ${cols.map((c: any) => c.key).join("|")}`,
  ).toBeTruthy();
  return col;
}

function hasColumn(key: string): boolean {
  return (captured.table?.columns ?? []).some((c: any) => c.key === key);
}

function sorterOf(key: string): (a: UsageGroup, b: UsageGroup) => number {
  const sorter = columnBy(key).sorter;
  expect(typeof sorter, `${key} must be sortable`).toBe("function");
  return sorter as (a: UsageGroup, b: UsageGroup) => number;
}

/** Share percent, read from the column's own render output (note 7). */
function sharePercentOf(row: UsageGroup): number {
  const element = columnBy("share").render(null, row) as React.ReactElement;
  return element.props.percent as number;
}

/**
 * Summary card values keyed by their label text. The cards are real DOM (the
 * design `Card` is mocked as a plain div), and summary cards are the only
 * cards rendered without a title.
 */
function summaryValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const card of Array.from(
    document.querySelectorAll('[data-testid="ds-card"]'),
  )) {
    if (card.querySelector('[data-testid="ds-card-title"]')) continue;
    const kids = Array.from(card.children) as HTMLElement[];
    if (kids.length !== 2) continue;
    out[kids[1].textContent ?? ""] = kids[0].textContent ?? "";
  }
  return out;
}

/** The retry button inside the error state (the toolbar refresh shares its name). */
function retryButton(): HTMLElement {
  const found = screen
    .getAllByRole("button", { name: "common.refresh" })
    .filter((b) => b.textContent === "common.refresh");
  expect(found, "retry button not found").toHaveLength(1);
  return found[0] as HTMLElement;
}

function refreshButton(): HTMLElement {
  const found = screen
    .getAllByRole("button", { name: "common.refresh" })
    .filter((b) => b.textContent !== "common.refresh");
  expect(found, "toolbar refresh button not found").toHaveLength(1);
  return found[0] as HTMLElement;
}

function sortableHeader(container: HTMLElement, titleFragment: string) {
  const header = Array.from(
    container.querySelectorAll("th.ant-table-column-has-sorters"),
  ).find((th) => (th.textContent ?? "").includes(titleFragment));
  expect(header, `sortable header ${titleFragment} not found`).toBeTruthy();
  return header as HTMLElement;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("ModelUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    governanceRequest.mockReset();
    captured.chart = null;
    captured.picker = null;
    captured.table = null;
    captured.selects = {};
  });

  describe("loading, error and staleness guards", () => {
    it("shows the loading state and requests the current month range", () => {
      governanceRequest.mockReturnValue(new Promise(() => {}));
      render(<ModelUsage />);
      expect(screen.getByText("common.loading")).toBeInTheDocument();
      expect(governanceRequest).toHaveBeenCalledTimes(1);
      expect(governanceRequest.mock.calls[0][0]).toBe(EXPECTED_URL);
      // Only the toolbar is rendered while loading.
      expect(screen.queryByText("tokenUsage.noData")).not.toBeInTheDocument();
      expect(captured.table).toBeNull();
    });

    it("shows the error state with a retry that refetches", async () => {
      governanceRequest.mockRejectedValueOnce(new Error("down"));
      render(<ModelUsage />);
      await waitFor(() =>
        expect(screen.getByText("tokenUsage.loadFailed")).toBeInTheDocument(),
      );
      expect(captured.table).toBeNull();

      governanceRequest.mockResolvedValue(report(mixedRows(), "UTC"));
      fireEvent.click(retryButton());
      await waitFor(() => expect(screen.getByText("UTC")).toBeInTheDocument());
      expect(
        screen.queryByText("tokenUsage.loadFailed"),
      ).not.toBeInTheDocument();
      expect(tableRows()).toHaveLength(2);
    });

    it("discards a superseded response instead of overwriting the newer one", async () => {
      let resolveFirst: (v: unknown) => void = () => {};
      let resolveSecond: (v: unknown) => void = () => {};
      governanceRequest
        .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
        .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
      render(<ModelUsage />);
      await waitFor(() => expect(governanceRequest).toHaveBeenCalledTimes(1));

      // A new range bumps the sequence ref past the in-flight first call.
      await setRange(
        MONTH_START.subtract(1, "month"),
        MONTH_START.subtract(1, "day"),
      );
      await waitFor(() => expect(governanceRequest).toHaveBeenCalledTimes(2));

      await act(async () => {
        resolveSecond(report(mixedRows(), "TZ-NEW"));
      });
      await waitFor(() =>
        expect(screen.getByText("TZ-NEW")).toBeInTheDocument(),
      );

      // The stale first response resolves last and must be ignored: no report
      // overwrite, and no loading state left behind either.
      await act(async () => {
        resolveFirst(report([], "TZ-STALE"));
      });
      await waitFor(() =>
        expect(screen.getByText("TZ-NEW")).toBeInTheDocument(),
      );
      expect(screen.queryByText("TZ-STALE")).not.toBeInTheDocument();
      expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
      expect(tableRows()).toHaveLength(2);
    });

    it("discards a superseded failure instead of showing the error state", async () => {
      let rejectFirst: (e: unknown) => void = () => {};
      let resolveSecond: (v: unknown) => void = () => {};
      governanceRequest
        .mockReturnValueOnce(new Promise((_r, rej) => (rejectFirst = rej)))
        .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
      render(<ModelUsage />);
      await waitFor(() => expect(governanceRequest).toHaveBeenCalledTimes(1));

      await setRange(
        MONTH_START.subtract(1, "month"),
        MONTH_START.subtract(1, "day"),
      );
      await waitFor(() => expect(governanceRequest).toHaveBeenCalledTimes(2));

      await act(async () => {
        resolveSecond(report(mixedRows(), "TZ-NEW"));
      });
      await waitFor(() =>
        expect(screen.getByText("TZ-NEW")).toBeInTheDocument(),
      );

      await act(async () => {
        rejectFirst(new Error("stale boom"));
        await Promise.resolve();
      });
      expect(
        screen.queryByText("tokenUsage.loadFailed"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("TZ-NEW")).toBeInTheDocument();
      expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
    });

    it("ignores a response that lands after unmount", async () => {
      let resolveLate: (v: unknown) => void = () => {};
      governanceRequest.mockReturnValue(new Promise((r) => (resolveLate = r)));
      const { unmount } = render(<ModelUsage />);
      await waitFor(() => expect(governanceRequest).toHaveBeenCalledTimes(1));
      unmount();
      // Unmounting bumps the sequence ref, so this resolution is stale.
      await act(async () => {
        resolveLate(report(mixedRows(), "TZ-LATE"));
      });
      expect(document.body.textContent).not.toContain("TZ-LATE");
    });
  });

  describe("toolbar", () => {
    it("shows the report timezone next to the controls", async () => {
      await renderWithData(mixedRows(), "Europe/Berlin");
      expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
    });

    it("refreshes on demand without changing the requested range", async () => {
      await renderWithData();
      const callsBefore = governanceRequest.mock.calls.length;
      fireEvent.click(refreshButton());
      await waitFor(() =>
        expect(governanceRequest.mock.calls.length).toBe(callsBefore + 1),
      );
      expect(
        governanceRequest.mock.calls[
          governanceRequest.mock.calls.length - 1
        ][0],
      ).toBe(EXPECTED_URL);
    });

    it("refetches the new range and clears both filters", async () => {
      await renderWithData();
      expect(captured.picker.allowClear).toBe(false);

      await setFilter(MODEL_LABEL, "m1");
      await setFilter(MEMBER_LABEL, "u1");
      expect(selectProps(MODEL_LABEL).value).toBe("m1");
      expect(selectProps(MEMBER_LABEL).value).toBe("u1");

      const nextStart = MONTH_START.subtract(1, "month");
      const nextEnd = MONTH_START.subtract(1, "day");
      await setRange(nextStart, nextEnd);

      await waitFor(() =>
        expect(governanceRequest).toHaveBeenLastCalledWith(
          `admin/usage/details?start_date=${nextStart.format(
            "YYYY-MM-DD",
          )}&end_date=${nextEnd.format("YYYY-MM-DD")}`,
        ),
      );
      expect(captured.picker.value[0].format("YYYY-MM-DD")).toBe(
        nextStart.format("YYYY-MM-DD"),
      );
      // Both filters are reset by the range change.
      expect(selectProps(MODEL_LABEL).value).toBeUndefined();
      expect(selectProps(MEMBER_LABEL).value).toBeUndefined();
    });

    it("ignores an incomplete range selection", async () => {
      await renderWithData();
      const callsBefore = governanceRequest.mock.calls.length;
      await act(async () => {
        captured.picker.onChange(null);
      });
      await act(async () => {
        captured.picker.onChange([null, null]);
      });
      await act(async () => {
        captured.picker.onChange([MONTH_START, null]);
      });
      expect(governanceRequest.mock.calls.length).toBe(callsBefore);
    });

    it("disables future dates and dates a year away from the range start", async () => {
      await renderWithData();
      const disabledDate = captured.picker.disabledDate;
      expect(typeof disabledDate).toBe("function");

      // Arm 1: anything after today is disabled, today itself is not.
      expect(disabledDate(TODAY.add(1, "day"), {})).toBe(true);
      expect(disabledDate(TODAY, {})).toBe(false);

      // Arm 2 is only reachable with a non-future date: without an anchor the
      // date is allowed.
      expect(disabledDate(TODAY.subtract(1, "day"), {})).toBe(false);

      // With an anchor, a span of 365 days or more is disabled ...
      const anchor = TODAY.subtract(2, "day");
      expect(disabledDate(anchor.subtract(365, "day"), { from: anchor })).toBe(
        true,
      );
      // ... while a shorter span is allowed.
      expect(disabledDate(anchor.subtract(10, "day"), { from: anchor })).toBe(
        false,
      );
      // The span is measured in absolute terms, so a later date counts too.
      expect(disabledDate(anchor.add(400, "day"), { from: anchor })).toBe(true);
    });

    it("lists every model and member from the unfiltered report", async () => {
      await renderWithData();
      const modelDd = await openSelectByLabel(MODEL_LABEL);
      expect(optionTexts(modelDd).sort()).toEqual(["Claude", "GPT-4o"]);
      fireEvent.click(document.body);

      const memberDd = await openSelectByLabel(MEMBER_LABEL);
      expect(optionTexts(memberDd).sort()).toEqual(["Alice", "Bob"]);
    });
  });

  describe("filters", () => {
    it("narrows the table to the selected model", async () => {
      await renderWithData();
      expect(rowLabels().sort()).toEqual(["Alice", "Bob"]);

      await setFilter(MODEL_LABEL, "m2");
      await waitFor(() => expect(rowLabels().sort()).toEqual(["Alice", "Bob"]));
      // Bob only used Claude; Alice used both. Claude-only total is 400 + 600.
      expect(tableRows().reduce((a, r) => a + r.charged, 0)).toBe(1000);

      await setFilter(MODEL_LABEL, "m1");
      await waitFor(() => expect(rowLabels()).toEqual(["Alice"]));
      expect(tableRows().reduce((a, r) => a + r.charged, 0)).toBe(1000);
    });

    it("narrows the table to the selected member", async () => {
      await renderWithData();
      await setFilter(MEMBER_LABEL, "u2");
      await waitFor(() => expect(rowLabels()).toEqual(["Bob"]));
      expect(tableRows().reduce((a, r) => a + r.charged, 0)).toBe(400);

      // Clearing the filter brings Alice back.
      await setFilter(MEMBER_LABEL, undefined);
      await waitFor(() => expect(rowLabels().sort()).toEqual(["Alice", "Bob"]));
    });

    it("combines both filters, which can leave nothing behind", async () => {
      const { container } = await renderWithData();
      expect(container.querySelector(".ant-table")).toBeTruthy();
      await setFilter(MODEL_LABEL, "m1");
      await setFilter(MEMBER_LABEL, "u2");
      // Bob never used GPT-4o, so every row is filtered out.
      await waitFor(() =>
        expect(screen.getByText("tokenUsage.noData")).toBeInTheDocument(),
      );
      // Asserted through the DOM on purpose: the captured table props are
      // sticky, so they would still hold the previous render's value after the
      // table stops being rendered.
      expect(container.querySelector(".ant-table")).toBeNull();
      expect(
        container.querySelectorAll("tbody tr:not(.ant-table-measure-row)"),
      ).toHaveLength(0);
    });

    it("drills from a member into that member's models", async () => {
      await renderWithData();
      // The member column renders a link button; clicking it filters to that
      // member and switches the dimension to model.
      fireEvent.click(screen.getByRole("button", { name: "Alice" }));
      await waitFor(() =>
        expect(rowLabels().sort()).toEqual(["Claude", "GPT-4o"]),
      );
      expect(selectProps(MEMBER_LABEL).value).toBe("u1");
      expect(
        screen.getByRole("tab", { name: "tokenUsage.byModel" }),
      ).toHaveAttribute("aria-selected", "true");
      // Only Alice's rows count: 1000 (GPT-4o) + 600 (Claude).
      expect(tableRows().reduce((a, r) => a + r.charged, 0)).toBe(1600);
    });
  });

  describe("summary cards", () => {
    it("totals charged, requests, active members and failures", async () => {
      await renderWithData();
      const values = summaryValues();
      // formatTokens uses compact notation: 2000 -> "2K".
      expect(values["hub.governance.analytics.charged"]).toBe("2K");
      expect(values["tokenUsage.totalCalls"]).toBe("20");
      expect(values["hub.governance.analytics.activeMembers"]).toBe("2");
      expect(values["hub.governance.analytics.failures"]).toBe("3");
    });

    it("counts only the members left after filtering as active", async () => {
      await renderWithData();
      await setFilter(MODEL_LABEL, "m1");
      await waitFor(() =>
        expect(summaryValues()["hub.governance.analytics.activeMembers"]).toBe(
          "1",
        ),
      );
      expect(summaryValues()["tokenUsage.totalCalls"]).toBe("10");
    });

    it("renders each member's share of the charged total", async () => {
      const { container } = await renderWithData();
      const byLabel = Object.fromEntries(tableRows().map((r) => [r.label, r]));
      // Alice 1600 of 2000 = 80%, Bob 400 of 2000 = 20%.
      expect(sharePercentOf(byLabel["Alice"])).toBe(80);
      expect(sharePercentOf(byLabel["Bob"])).toBe(20);
      // One progress bar per rendered row.
      expect(
        container.querySelectorAll(
          "tbody tr:not(.ant-table-measure-row) .ant-progress",
        ),
      ).toHaveLength(tableRows().length);
    });

    it("renders a zero share when nothing was charged", async () => {
      await renderWithData([
        makeRow({ charged: 0, actual: 0, reserved: 0, conservative: 0 }),
      ]);
      const rows = tableRows();
      expect(rows).toHaveLength(1);
      expect(sharePercentOf(rows[0])).toBe(0);
      expect(summaryValues()["hub.governance.analytics.charged"]).toBe("0");
    });

    it("still renders zeroed cards when the report is empty", async () => {
      await renderWithData([]);
      expect(screen.getByText("tokenUsage.noData")).toBeInTheDocument();
      expect(captured.table).toBeNull();
      const values = summaryValues();
      expect(values["tokenUsage.totalCalls"]).toBe("0");
      expect(values["hub.governance.analytics.activeMembers"]).toBe("0");
      expect(values["hub.governance.analytics.failures"]).toBe("0");
    });
  });

  describe("trend chart", () => {
    it("emits one point per day in range per model", async () => {
      await renderWithData();
      expect(captured.chart).toBeTruthy();
      expect(captured.chart.smooth).toBe(false);
      expect(captured.chart.seriesField).toBe("model");
      expect(captured.chart.data).toHaveLength(DAYS_IN_RANGE * 2);
      expect(captured.chart.data.slice(0, 2).map((p: any) => p.date)).toEqual([
        START_PARAM,
        START_PARAM,
      ]);
      // The first day's spend lands on the right model series.
      const firstDayGpt = captured.chart.data.find(
        (p: any) => p.date === START_PARAM && p.model === "GPT-4o",
      );
      expect(firstDayGpt.value).toBe(1000);
      const firstDayClaude = captured.chart.data.find(
        (p: any) => p.date === START_PARAM && p.model === "Claude",
      );
      expect(firstDayClaude.value).toBe(400);
    });

    it("places spend on the right day and zero elsewhere for a fixed range", async () => {
      governanceRequest.mockResolvedValue(
        report([
          makeRow({ date: "2026-01-05", charged: 100 }),
          makeRow({
            date: "2026-01-06",
            model_id: "m2",
            model_name: "Claude",
            charged: 200,
          }),
        ]),
      );
      render(<ModelUsage />);
      await waitFor(() => expect(captured.chart).toBeTruthy());

      await setRange(dayjs("2026-01-05"), dayjs("2026-01-07"));
      await waitFor(() => expect(captured.chart.data).toHaveLength(6));
      const at = (date: string, model: string) =>
        captured.chart.data.find(
          (p: any) => p.date === date && p.model === model,
        );
      expect(at("2026-01-05", "GPT-4o").value).toBe(100);
      expect(at("2026-01-06", "Claude").value).toBe(200);
      // The last day of the window has no rows at all.
      expect(at("2026-01-07", "GPT-4o").value).toBe(0);
      expect(at("2026-01-07", "Claude").value).toBe(0);
      expect(captured.chart.axis.x.tickCount).toBe(3);
    });

    it("disambiguates two model ids that share a display name", async () => {
      await renderWithData([
        makeRow({ model_id: "m1", model_name: "GPT-4o", charged: 100 }),
        makeRow({ model_id: "m2", model_name: "GPT-4o", charged: 200 }),
      ]);
      const labels = Array.from(
        new Set(captured.chart.data.map((p: any) => p.model)),
      ).sort();
      expect(labels).toEqual(["GPT-4o · m1", "GPT-4o · m2"]);
    });

    it("keeps the plain display name when names are unique", async () => {
      await renderWithData();
      const labels = Array.from(
        new Set(captured.chart.data.map((p: any) => p.model)),
      ).sort();
      expect(labels).toEqual(["Claude", "GPT-4o"]);
    });

    it("caps the tick count at ten for long ranges", async () => {
      await renderWithData();
      expect(captured.chart.axis.x.tickCount).toBe(Math.min(10, DAYS_IN_RANGE));
    });
  });

  describe("ranking table", () => {
    it("ranks members by charged spend", async () => {
      await renderWithData();
      expect(rowLabels()).toEqual(["Alice", "Bob"]);
      // The rank column renders 1-based positions in that spend order.
      expect(columnBy("rank").render(null, tableRows()[0])).toBe(1);
      expect(columnBy("rank").render(null, tableRows()[1])).toBe(2);
    });

    it("renders member names as buttons only in the member dimension", async () => {
      await renderWithData();
      const asButton = columnBy("label").render("Alice", tableRows()[0]);
      expect(React.isValidElement(asButton)).toBe(true);
      expect(hasColumn("rank")).toBe(true);

      fireEvent.click(screen.getByRole("tab", { name: "tokenUsage.byModel" }));
      await waitFor(() => expect(hasColumn("rank")).toBe(false));
      // In the model dimension the label cell is plain text.
      expect(columnBy("label").render("GPT-4o", tableRows()[0])).toBe("GPT-4o");
    });

    it("sorts by label, by charged and by every numeric field", async () => {
      await renderWithData();
      const labelSorter = sorterOf("label");
      expect(
        labelSorter(group({ label: "aaa" }), group({ label: "bbb" })),
      ).toBeLessThan(0);
      expect(
        labelSorter(group({ label: "bbb" }), group({ label: "aaa" })),
      ).toBeGreaterThan(0);
      expect(
        labelSorter(group({ label: "aaa" }), group({ label: "aaa" })),
      ).toBe(0);

      expect(
        sorterOf("charged")(group({ charged: 5 }), group({ charged: 9 })),
      ).toBe(-4);

      // The five generated numeric columns all sort ascending by their field.
      for (const { field, low, high } of NUMERIC_SORTER_CASES) {
        const sorter = sorterOf(field);
        expect(sorter(low, high), `${field} sorter ascending`).toBe(-4);
        expect(sorter(high, low), `${field} sorter descending`).toBe(4);
        expect(sorter(low, low), `${field} sorter equal`).toBe(0);
      }
    });

    it("reorders rows when a sortable header is clicked", async () => {
      const { container } = await renderWithData();
      // Cell 1 is the member label (cell 0 is the rank column).
      const before = domRowCells(container, 1);
      expect(before).toEqual(["Alice", "Bob"]);

      fireEvent.click(
        sortableHeader(container, "hub.governance.analytics.charged"),
      );
      await waitFor(() =>
        expect(domRowCells(container, 1)).toEqual(["Bob", "Alice"]),
      );
      // The rank column reports the spend-based rank, so it does not follow the
      // sort: Bob is displayed first but still carries rank 2.
      expect(domRowCells(container, 0)).toEqual(["2", "1"]);
    });

    it("formats every numeric cell through the locale formatter", async () => {
      await renderWithData([
        makeRow({
          requests: 1234,
          charged: 5,
          failures: 4321,
          actual: 7,
          conservative: 8,
          reserved: 9,
        }),
      ]);
      const row = tableRows()[0];
      expect(columnBy("charged").render(5, row)).toBe("5");
      expect(columnBy("requests").render(1234, row)).toBe("1,234");
      expect(columnBy("failures").render(4321, row)).toBe("4,321");
      expect(columnBy("actual").render(7, row)).toBe("7");
      // The trailing count column shows models in the member dimension.
      expect(columnBy("count").dataIndex).toBe("models");
      expect(columnBy("count").render(2, row)).toBe("2");
    });

    it("switches to the date dimension and sorts dates descending", async () => {
      await renderWithData();
      fireEvent.click(screen.getByRole("tab", { name: "tokenUsage.byDate" }));
      await waitFor(() =>
        expect(
          screen.getByRole("tab", { name: "tokenUsage.byDate" }),
        ).toHaveAttribute("aria-selected", "true"),
      );
      const keys = tableRows().map((r) => r.key);
      expect(keys).toHaveLength(2);
      expect(keys).toEqual([...keys].sort().reverse());
      expect(keys[0]).toBe(SECOND_DAY);
      // The count column flips to members and the label title follows.
      expect(columnBy("count").dataIndex).toBe("members");
      expect(columnBy("label").title).toBe("tokenUsage.date");
      expect(columnBy("label").render(SECOND_DAY, tableRows()[0])).toBe(
        SECOND_DAY,
      );
    });

    it("labels the count column by the opposite dimension", async () => {
      await renderWithData();
      expect(columnBy("label").title).toBe(MEMBER_LABEL);
      expect(columnBy("count").title).toBe("tokenUsage.model");

      fireEvent.click(screen.getByRole("tab", { name: "tokenUsage.byModel" }));
      await waitFor(() => expect(columnBy("label").title).toBe(MODEL_LABEL));
      expect(columnBy("count").title).toBe("hub.navigation.users");
      expect(columnBy("count").dataIndex).toBe("members");
    });
  });
});
