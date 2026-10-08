// @vitest-environment jsdom
/**
 * createColumns tests — regression family: cron job table column contract.
 *
 * The factory is a pure function returning antd column definitions, so render
 * callbacks are invoked directly instead of mounting a whole Table: each case
 * then stays focused on one cell's user visible output.
 *
 * Three environment facts drive the local mocks (all probed in this repo):
 *  - createCopyToClipboard calls useAppMessage() at click time and
 *    App.useApp() throws "Invalid hook call" outside a render pass, so the hook
 *    module is stubbed with a recordable message api.
 *  - The global design stub renders Tooltip as a pass-through and drops its
 *    title, which is exactly where the copy button lives. The package is
 *    re-mocked here with a Tooltip that materialises the overlay in a separate
 *    zone (src/test/design-mock.ts authorises this override). The zone split is
 *    deliberate: several cells pass the same string as both title and child, so
 *    a single flat tree would make every text query ambiguous.
 *  - jsdom provides neither navigator.clipboard nor window.isSecureContext nor
 *    document.execCommand, so each copy strategy has to be installed per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import React from "react";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";
import type { CronJobSpecOutput } from "../../../../api/types";

// ---- Hoisted mocks ---------------------------------------------------------
const messageApi = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({ message: messageApi, modal: {}, notification: {} }),
}));

vi.mock("@agentscope-ai/design", async () => {
  const stub = await vi.importActual<Record<string, unknown>>(
    "../../../../test/design-mock",
  );
  const ReactNS = await import("react");
  const h = ReactNS.createElement;

  const Tooltip = ({
    title,
    children,
  }: {
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    h(
      "div",
      { "data-testid": "tooltip" },
      h("div", { "data-testid": "tooltip-title" }, title as never),
      h("div", { "data-testid": "tooltip-body" }, children as never),
    );

  const Button = ({
    children,
    onClick,
    icon,
    loading,
    ...props
  }: Record<string, unknown>) =>
    h(
      "button",
      {
        onClick,
        "data-loading": loading ? "true" : "false",
        ...props,
      },
      icon as never,
      children as never,
    );

  type MenuItem = {
    key?: string;
    label?: React.ReactNode;
    danger?: boolean;
    onClick?: () => void;
  };

  const Dropdown = ({
    menu,
    children,
  }: {
    menu?: { items?: MenuItem[] };
    children?: React.ReactNode;
  }) =>
    h(
      "div",
      { "data-testid": "dropdown" },
      children as never,
      h(
        "div",
        { "data-testid": "dropdown-menu" },
        (menu?.items ?? []).map((item, index) =>
          h(
            "button",
            {
              key: String(item.key ?? index),
              type: "button",
              "data-testid": `menu-${item.key ?? index}`,
              "data-danger": item.danger ? "true" : undefined,
              onClick: item.onClick,
            },
            item.label as never,
          ),
        ),
      ),
    );

  return { ...stub, Tooltip, Button, Dropdown };
});

import { createColumns } from "./columns";

// ---- Fixtures --------------------------------------------------------------

type Handlers = {
  onToggleEnabled: ReturnType<typeof vi.fn>;
  onExecuteNow: ReturnType<typeof vi.fn>;
  onPromoteImported: ReturnType<typeof vi.fn>;
  onViewHistory: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  promotingJobIds: Set<string>;
  t: (key: string) => string;
};

function makeHandlers(over: Partial<Handlers> = {}): Handlers {
  return {
    onToggleEnabled: vi.fn(),
    onExecuteNow: vi.fn(),
    onPromoteImported: vi.fn(),
    onViewHistory: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    promotingJobIds: new Set<string>(),
    // Echoing the key keeps assertions readable and independent of locale files.
    t: (key: string) => key,
    ...over,
  };
}

function makeJob(over: Partial<CronJobSpecOutput> = {}): CronJobSpecOutput {
  return {
    id: "job-1",
    name: "nightly digest",
    enabled: true,
    schedule: { type: "cron", cron: "0 9 * * *", timezone: "Asia/Shanghai" },
    task_type: "agent",
    text: "summarise the inbox",
    request: { input: { prompt: "go" } },
    dispatch: {
      type: "channel",
      channel: "console",
      target: { user_id: "u-1", session_id: "s-1" },
      mode: "final",
    },
    runtime: { max_concurrency: 2, timeout_seconds: 600 },
    ...over,
  } as CronJobSpecOutput;
}

/** Imported job quarantined by the explicit review flag. */
function jobWithReview(): CronJobSpecOutput {
  return makeJob({
    meta: { portability: { requires_review: true } },
  } as Partial<CronJobSpecOutput>);
}

/** Imported job quarantined by the safety gate form instead. */
function jobWithSafetyGate(): CronJobSpecOutput {
  return makeJob({
    meta: {
      portability: { safety: "disabled_until_explicit_promotion" },
    },
  } as Partial<CronJobSpecOutput>);
}

type AnyColumn = {
  key?: React.Key;
  title?: unknown;
  render?: (...args: never[]) => unknown;
};

function columnsOf(handlers: Handlers = makeHandlers()): AnyColumn[] {
  return createColumns(handlers as never) as unknown as AnyColumn[];
}

function columnOf(key: string, handlers?: Handlers): AnyColumn {
  const found = columnsOf(handlers).find((c) => c.key === key);
  if (!found) {
    throw new Error(`column not found: ${key}`);
  }
  return found;
}

/** Render one cell produced from the given handlers, so their spies are live. */
function renderCellWith(
  handlers: Handlers,
  key: string,
  ...args: unknown[]
): void {
  const col = columnOf(key, handlers);
  const rendered = (col.render as (...a: unknown[]) => React.ReactNode)(
    ...args,
  );
  render(React.createElement(React.Fragment, null, rendered));
}

/** Render one cell against a fresh set of recording handlers. */
function renderCell(key: string, ...args: unknown[]): void {
  renderCellWith(makeHandlers(), key, ...args);
}

/** The visible part of a cell, excluding any tooltip overlay. */
function cellBody(): HTMLElement {
  return screen.getByTestId("tooltip-body");
}

const LONG_INPUT = { note: "y".repeat(80) };
const LONG_INPUT_FULL = JSON.stringify(LONG_INPUT, null, 2);

// ---- Clipboard scaffolding -------------------------------------------------

let errorSpy: { mockRestore(): void } | undefined;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  });
}

/** Secure-context path: the async Clipboard API is used. */
function installSecureClipboard(writeText: ReturnType<typeof vi.fn>) {
  setClipboard({ writeText });
  setSecureContext(true);
}

/** Insecure path: neither async clipboard nor secure context is available. */
function dropClipboard() {
  setClipboard(undefined);
  setSecureContext(false);
}

function installExecCommand(impl?: () => boolean) {
  const spy = vi.fn(impl ?? (() => true));
  Object.defineProperty(document, "execCommand", {
    value: spy,
    configurable: true,
  });
  return spy;
}

function copyButton(): HTMLElement {
  const button = screen.getByTestId("tooltip-title").querySelector("button");
  if (!button) {
    throw new Error("copy button not rendered inside the tooltip overlay");
  }
  return button;
}

beforeEach(() => {
  messageApi.success.mockClear();
  messageApi.error.mockClear();
  dropClipboard();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

// ---- Column contract -------------------------------------------------------

describe("createColumns — column contract", () => {
  it("emits one column per declared key, in order", () => {
    expect(columnsOf().map((c) => c.key)).toEqual([
      "id",
      "name",
      "enabled",
      "schedule_type",
      "cron",
      "timezone",
      "task_type",
      "text",
      "request_input",
      "dispatch_type",
      "channel",
      "target_user_id",
      "target_session_id",
      "mode",
      "max_concurrency",
      "timeout_seconds",
      "misfire_grace_seconds",
      "action",
    ]);
  });

  it("pins the id column left and the action column right", () => {
    const cols = columnsOf();
    expect(cols.find((c) => c.key === "id")).toMatchObject({ fixed: "left" });
    expect(cols.find((c) => c.key === "action")).toMatchObject({
      fixed: "right",
    });
  });

  it("routes every localised title through the provided t function", () => {
    const t = vi.fn((key: string) => `L(${key})`);
    const cols = columnsOf(makeHandlers({ t }));
    expect(cols.find((c) => c.key === "id")?.title).toBe("L(cronJobs.id)");
    expect(cols.find((c) => c.key === "text")?.title).toBe("L(cronJobs.text)");
    expect(cols.find((c) => c.key === "action")?.title).toBe(
      "L(cronJobs.action)",
    );
  });

  it("leaves the runtime columns untranslated", () => {
    const cols = columnsOf();
    const titles = ["max_concurrency", "timeout_seconds"].map(
      (key) => cols.find((c) => c.key === key)?.title,
    );
    expect(titles).toEqual(["RuntimeMaxConcurrency", "RuntimeTimeoutSeconds"]);
  });

  it("declares the ellipsis strategy per text heavy column", () => {
    expect(columnOf("text")).toMatchObject({ ellipsis: { showTitle: true } });
    expect(columnOf("request_input")).toMatchObject({ ellipsis: true });
  });

  it("addresses nested values by path so antd can read them", () => {
    expect(columnOf("request_input")).toMatchObject({
      dataIndex: ["request", "input"],
    });
    expect(columnOf("target_session_id")).toMatchObject({
      dataIndex: ["dispatch", "target", "session_id"],
    });
    expect(columnOf("misfire_grace_seconds")).toMatchObject({
      dataIndex: ["runtime", "misfire_grace_seconds"],
    });
  });

  it("returns an antd column array of the expected size", () => {
    const cols: ColumnsType<CronJobSpecOutput> = createColumns(
      makeHandlers() as never,
    );
    expect(Array.isArray(cols)).toBe(true);
    expect(cols).toHaveLength(18);
  });
});

// ---- enabled column --------------------------------------------------------

describe("createColumns — enabled cell", () => {
  it("shows the enabled label for an active job", () => {
    renderCell("enabled", true, makeJob({ enabled: true }));
    expect(screen.getByText("common.enabled")).toBeInTheDocument();
    expect(screen.queryByText("cronJobs.importReviewBadge")).toBeNull();
  });

  it("shows the disabled label for an inactive job", () => {
    renderCell("enabled", false, makeJob({ enabled: false }));
    expect(screen.getByText("common.disabled")).toBeInTheDocument();
  });

  it("replaces the status with the review badge for requires_review jobs", () => {
    renderCell("enabled", true, jobWithReview());
    expect(screen.getByText("cronJobs.importReviewBadge")).toBeInTheDocument();
    expect(screen.queryByText("common.enabled")).toBeNull();
  });

  it("replaces the status with the review badge for the safety gate form", () => {
    renderCell("enabled", true, jobWithSafetyGate());
    expect(screen.getByText("cronJobs.importReviewBadge")).toBeInTheDocument();
  });

  it("keeps the status cell when portability metadata is present but clean", () => {
    const job = makeJob({
      meta: { portability: { source: "export" } },
    } as Partial<CronJobSpecOutput>);
    renderCell("enabled", true, job);
    expect(screen.getByText("common.enabled")).toBeInTheDocument();
    expect(screen.queryByText("cronJobs.importReviewBadge")).toBeNull();
  });
});

// ---- schedule type column --------------------------------------------------

describe("createColumns — schedule type cell", () => {
  it("labels a once schedule", () => {
    renderCell(
      "schedule_type",
      "once",
      makeJob({ schedule: { type: "once", run_at: "2026-03-05T09:30:00Z" } }),
    );
    expect(screen.getByText("cronJobs.scheduleTypeOnce")).toBeInTheDocument();
  });

  it("labels a recurring schedule", () => {
    renderCell("schedule_type", "cron", makeJob());
    expect(
      screen.getByText("cronJobs.scheduleTypeRecurring"),
    ).toBeInTheDocument();
  });

  it("treats an unknown schedule type as recurring", () => {
    renderCell("schedule_type", "something-else", makeJob());
    expect(
      screen.getByText("cronJobs.scheduleTypeRecurring"),
    ).toBeInTheDocument();
  });
});

// ---- schedule column -------------------------------------------------------

describe("createColumns — schedule cell", () => {
  it("formats a once run time as a local date and time", () => {
    const runAt = "2026-03-05T09:30:00Z";
    renderCell("cron", { type: "once", run_at: runAt }, makeJob());
    const text = within(cellBody()).getByText(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    ).textContent;
    // Comparing against dayjs in the same process keeps this timezone agnostic.
    expect(text).toBe(dayjs(runAt).format("YYYY-MM-DD HH:mm"));
  });

  it("offers the raw run time as the tooltip for a once schedule", () => {
    const runAt = "2026-03-05T09:30:00Z";
    renderCell("cron", { type: "once", run_at: runAt }, makeJob());
    expect(screen.getByTestId("tooltip-title")).toHaveTextContent(runAt);
  });

  it("falls back to a dash when a once schedule carries no run time", () => {
    renderCell("cron", { type: "once" }, makeJob());
    expect(within(cellBody()).getByText("-")).toBeInTheDocument();
    // The tooltip falls back to the same dash rather than rendering nothing.
    expect(screen.getByTestId("tooltip-title")).toHaveTextContent("-");
  });

  it("describes an hourly cron without repeating the expression", () => {
    renderCell("cron", { type: "cron", cron: "0 * * * *" }, makeJob());
    expect(
      within(cellBody()).getByText("cronJobs.cronTypeHourly"),
    ).toBeInTheDocument();
  });

  it("describes a daily cron with a zero padded time", () => {
    renderCell("cron", { type: "cron", cron: "5 9 * * *" }, makeJob());
    expect(
      within(cellBody()).getByText("cronJobs.cronTypeDaily 09:05"),
    ).toBeInTheDocument();
  });

  it("pads midnight to 00:00", () => {
    renderCell("cron", { type: "cron", cron: "0 0 * * *" }, makeJob());
    expect(
      within(cellBody()).getByText("cronJobs.cronTypeDaily 00:00"),
    ).toBeInTheDocument();
  });

  it("names every day of a weekly cron in order", () => {
    renderCell("cron", { type: "cron", cron: "0 9 * * mon-wed" }, makeJob());
    expect(
      within(cellBody()).getByText(
        "cronJobs.cronTypeWeekly cronJobs.cronDayMon,cronJobs.cronDayTue,cronJobs.cronDayWed 09:00",
      ),
    ).toBeInTheDocument();
  });

  it("shows the raw expression for a cron shape that cannot be described", () => {
    renderCell("cron", { type: "cron", cron: "*/15 * * * *" }, makeJob());
    expect(within(cellBody()).getByText("*/15 * * * *")).toBeInTheDocument();
  });

  it("assumes the daily default when the schedule carries no expression", () => {
    renderCell("cron", { type: "cron" }, makeJob());
    expect(
      within(cellBody()).getByText("cronJobs.cronTypeDaily 09:00"),
    ).toBeInTheDocument();
  });

  it("explains the raw expression inside the tooltip", () => {
    renderCell("cron", { type: "cron", cron: "30 6 * * *" }, makeJob());
    expect(screen.getByTestId("tooltip-title")).toHaveTextContent("30 6 * * *");
  });

  it("survives a null schedule without throwing", () => {
    expect(() => renderCell("cron", null, makeJob())).not.toThrow();
    expect(
      within(cellBody()).getByText("cronJobs.cronTypeDaily 09:00"),
    ).toBeInTheDocument();
  });
});

// ---- text column -----------------------------------------------------------

describe("createColumns — text cell", () => {
  it("shows the task text", () => {
    renderCell("text", "summarise the inbox", makeJob());
    expect(
      within(cellBody()).getByText("summarise the inbox"),
    ).toBeInTheDocument();
  });

  it("shows a dash for an empty text", () => {
    renderCell("text", "", makeJob());
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("shows a dash when the text field is missing", () => {
    renderCell("text", undefined, makeJob());
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("keeps non latin task text intact", () => {
    renderCell("text", "汇总收件箱 📥", makeJob());
    expect(within(cellBody()).getByText("汇总收件箱 📥")).toBeInTheDocument();
  });

  it("mirrors the text into the tooltip for truncated display", () => {
    const text = "a".repeat(120);
    renderCell("text", text, makeJob());
    expect(screen.getByTestId("tooltip-title")).toHaveTextContent(text);
  });
});

// ---- request input column --------------------------------------------------

describe("createColumns — request input cell", () => {
  it("shows a dash when there is no request input", () => {
    renderCell("request_input", undefined, makeJob());
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("shows a dash for an explicitly empty input", () => {
    renderCell("request_input", "", makeJob());
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("renders a short input inline without a copy control", () => {
    renderCell("request_input", { a: 1 }, makeJob());
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders an input sitting exactly on the 50 character limit inline", () => {
    const input = { k: "v".repeat(42) };
    const compact = JSON.stringify(input);
    expect(compact).toHaveLength(50);
    renderCell("request_input", input, makeJob());
    expect(screen.getByText(compact)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("truncates an input one character over the limit", () => {
    const input = { k: "v".repeat(43) };
    const compact = JSON.stringify(input);
    expect(compact).toHaveLength(51);
    renderCell("request_input", input, makeJob());
    expect(within(cellBody()).getByText(`${compact.slice(0, 50)}...`));
  });

  it("keeps the full pretty printed json in the tooltip of a long input", () => {
    renderCell("request_input", LONG_INPUT, makeJob());
    // textContent rather than toHaveTextContent: the latter normalises the
    // received whitespace away, which would hide the pretty printing.
    expect(screen.getByTestId("tooltip-title").textContent).toBe(
      LONG_INPUT_FULL,
    );
  });

  it("renders a copy control next to a truncated input", () => {
    renderCell("request_input", LONG_INPUT, makeJob());
    expect(copyButton()).toBeInTheDocument();
  });

  it("degrades to a string rendering for input that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    renderCell("request_input", circular, makeJob());
    // JSON.stringify throws here, so the cell falls back to String(input)
    // instead of taking the whole table row down with it.
    expect(screen.getByText("[object Object]")).toBeInTheDocument();
  });

  it("keeps an array input readable", () => {
    renderCell("request_input", ["a", "b"], makeJob());
    expect(screen.getByText('["a","b"]')).toBeInTheDocument();
  });

  it("renders a scalar input as its json form", () => {
    renderCell("request_input", 42, makeJob());
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows a dash for a falsy boolean input instead of rendering false", () => {
    renderCell("request_input", false, makeJob());
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});

// ---- copy behaviour --------------------------------------------------------

describe("createColumns — copy to clipboard", () => {
  it("uses the async clipboard and reports success in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installSecureClipboard(writeText);

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() =>
      expect(messageApi.success).toHaveBeenCalledWith("common.copied"),
    );
    expect(writeText).toHaveBeenCalledWith(LONG_INPUT_FULL);
    expect(messageApi.error).not.toHaveBeenCalled();
  });

  it("uses the textarea fallback when the async clipboard is unavailable", async () => {
    dropClipboard();
    const exec = installExecCommand();

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() =>
      expect(messageApi.success).toHaveBeenCalledWith("common.copied"),
    );
    expect(exec).toHaveBeenCalledWith("copy");
    // The scratch element is removed again so it cannot leak into the layout.
    expect(document.body.querySelector("textarea")).toBeNull();
  });

  it("uses the textarea fallback when the context is not secure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    setSecureContext(false);
    const exec = installExecCommand();

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
    expect(writeText).not.toHaveBeenCalled();
    expect(messageApi.success).toHaveBeenCalledWith("common.copied");
  });

  it("copies the pretty printed json rather than the truncated text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installSecureClipboard(writeText);

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("\n");
    expect(copied).not.toContain("...");
  });

  it("reports failure and logs when the clipboard write rejects", async () => {
    installSecureClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() =>
      expect(messageApi.error).toHaveBeenCalledWith("common.copyFailed"),
    );
    expect(messageApi.success).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to copy text: ",
      expect.any(Error),
    );
  });

  it("reports failure when the fallback path throws", async () => {
    dropClipboard();
    const exec = installExecCommand(() => {
      throw new Error("execCommand blocked");
    });

    renderCell("request_input", LONG_INPUT, makeJob());
    fireEvent.click(copyButton());

    await waitFor(() =>
      expect(messageApi.error).toHaveBeenCalledWith("common.copyFailed"),
    );
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("does not let the copy click bubble into the row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installSecureClipboard(writeText);
    const onRowClick = vi.fn();

    const col = columnOf("request_input");
    const rendered = (col.render as (...a: unknown[]) => React.ReactNode)(
      LONG_INPUT,
    );
    render(
      React.createElement(
        "div",
        { onClick: onRowClick, role: "presentation" },
        rendered,
      ),
    );
    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

// ---- action column ---------------------------------------------------------

describe("createColumns — action cell", () => {
  it("offers toggle, execute and history for a normal job", () => {
    renderCell("action", null, makeJob());
    expect(screen.getByText("cronJobs.disable")).toBeInTheDocument();
    expect(screen.getByText("cronJobs.executeNow")).toBeInTheDocument();
    expect(screen.getByText("cronJobs.executionHistory")).toBeInTheDocument();
    expect(screen.queryByText("cronJobs.importReviewApprove")).toBeNull();
  });

  it("labels the toggle as enable when the job is off", () => {
    renderCell("action", null, makeJob({ enabled: false }));
    expect(screen.getByText("common.enable")).toBeInTheDocument();
    expect(screen.queryByText("cronJobs.disable")).toBeNull();
  });

  it("leaves every action usable for a normal job", () => {
    renderCell("action", null, makeJob());
    for (const label of [
      "cronJobs.disable",
      "cronJobs.executeNow",
      "cronJobs.executionHistory",
    ]) {
      expect(screen.getByText(label).closest("button")).not.toBeDisabled();
    }
  });

  it("reports the job back to each handler", () => {
    const handlers = makeHandlers();
    const job = makeJob();
    renderCellWith(handlers, "action", null, job);

    fireEvent.click(screen.getByText("cronJobs.disable"));
    fireEvent.click(screen.getByText("cronJobs.executeNow"));
    fireEvent.click(screen.getByText("cronJobs.executionHistory"));

    expect(handlers.onToggleEnabled).toHaveBeenCalledWith(job);
    expect(handlers.onExecuteNow).toHaveBeenCalledWith(job);
    expect(handlers.onViewHistory).toHaveBeenCalledWith(job);
  });

  it("exposes edit and delete through the overflow menu", () => {
    const handlers = makeHandlers();
    const job = makeJob();
    renderCellWith(handlers, "action", null, job);

    expect(screen.getByTestId("menu-edit")).toHaveTextContent("cronJobs.edit");
    expect(screen.getByTestId("menu-delete")).toHaveAttribute(
      "data-danger",
      "true",
    );

    fireEvent.click(screen.getByTestId("menu-edit"));
    fireEvent.click(screen.getByTestId("menu-delete"));

    expect(handlers.onEdit).toHaveBeenCalledWith(job);
    // Delete only needs the id, matching the handler signature.
    expect(handlers.onDelete).toHaveBeenCalledWith(job.id);
  });

  it("quarantines an imported job behind the approve action", () => {
    const handlers = makeHandlers();
    const job = jobWithReview();
    renderCellWith(handlers, "action", null, job);

    const approve = screen.getByText("cronJobs.importReviewApprove");
    expect(approve).toBeInTheDocument();
    expect(
      screen.getByText("cronJobs.disable").closest("button"),
    ).toBeDisabled();
    expect(
      screen.getByText("cronJobs.executeNow").closest("button"),
    ).toBeDisabled();

    fireEvent.click(approve);
    expect(handlers.onPromoteImported).toHaveBeenCalledWith(job);
    expect(handlers.onToggleEnabled).not.toHaveBeenCalled();
    expect(handlers.onExecuteNow).not.toHaveBeenCalled();
  });

  it("still allows history inspection while a job is quarantined", () => {
    const handlers = makeHandlers();
    const job = jobWithReview();
    renderCellWith(handlers, "action", null, job);

    const history = screen
      .getByText("cronJobs.executionHistory")
      .closest("button") as HTMLButtonElement;
    expect(history).not.toBeDisabled();
    fireEvent.click(history);
    expect(handlers.onViewHistory).toHaveBeenCalledWith(job);
  });

  it("keeps the overflow menu reachable while a job is quarantined", () => {
    const handlers = makeHandlers();
    renderCellWith(handlers, "action", null, jobWithReview());
    fireEvent.click(screen.getByTestId("menu-delete"));
    expect(handlers.onDelete).toHaveBeenCalledWith("job-1");
  });

  it("shows the approve action as busy while that job is promoting", () => {
    const handlers = makeHandlers({ promotingJobIds: new Set(["job-1"]) });
    renderCellWith(handlers, "action", null, jobWithReview());
    expect(
      screen.getByText("cronJobs.importReviewApprove").closest("button"),
    ).toHaveAttribute("data-loading", "true");
  });

  it("does not mark the approve action busy for an unrelated job", () => {
    const handlers = makeHandlers({ promotingJobIds: new Set(["other-job"]) });
    renderCellWith(handlers, "action", null, jobWithReview());
    expect(
      screen.getByText("cronJobs.importReviewApprove").closest("button"),
    ).toHaveAttribute("data-loading", "false");
  });

  it("quarantines the safety gate form the same way", () => {
    renderCell("action", null, jobWithSafetyGate());
    expect(
      screen.getByText("cronJobs.importReviewApprove"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("cronJobs.executeNow").closest("button"),
    ).toBeDisabled();
  });
});
