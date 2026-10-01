// @vitest-environment jsdom
/**
 * DebugPage tests - the visible contract of the backend log page itself.
 *
 * Design decisions, so a reader can separate product behaviour from test
 * scaffolding:
 *
 * 1. `useDebugLogs` is replaced by ONE stable object built with `vi.hoisted`.
 *    A factory returning a fresh object per render would hand the page new
 *    setter identities on every render. The hook has its own suite
 *    (useDebugLogs.test.ts); this one only checks what the page does with the
 *    values it is given.
 * 2. `LogViewer` is replaced by a probe that echoes its props into data
 *    attributes. The viewer has its own suite too, so the contract under test
 *    here is the wiring: which lines, which query and which loading flag reach
 *    it.
 * 3. Only antd `Select` is replaced; every other antd primitive stays real, so
 *    the alerts, switches, search input and buttons are asserted against the
 *    DOM antd really produces. The stub exists because driving a real antd
 *    Select means opening a portal dropdown, while all this page contributes is
 *    the level list plus the change handler. The stub normalises option labels
 *    because this page passes a React element (a coloured Tag) as the label for
 *    every level except "all": the stub reads that element's children as the
 *    option text and its `color` prop into `data-color`. `backendLevelColor` is
 *    left as the real implementation (via importActual), so `data-color` proves
 *    which colour each level really maps to.
 * 4. `t` returns the fallback when one is supplied and the key otherwise, which
 *    matches what a user reads for every string on this page except
 *    `nav.settings` (no fallback in the product source).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";
import { isValidElement, type ReactElement } from "react";

type BackendLogs = {
  path?: string;
  updated_at?: number;
  exists?: boolean;
  content?: string;
};

const debug = vi.hoisted(() => {
  const state = {
    backendLogs: null as null | Record<string, unknown>,
    initialLoading: false,
    backendError: "",
    autoRefresh: true,
    setAutoRefresh: vi.fn(),
    backendNewestFirst: true,
    setBackendNewestFirst: vi.fn(),
    backendLevel: "all" as string,
    setBackendLevel: vi.fn(),
    backendQuery: "",
    setBackendQuery: vi.fn(),
    filteredBackendLines: [] as string[],
    loadBackendLogs: vi.fn(),
    handleCopyBackend: vi.fn(),
  };
  return { state };
});

vi.mock("./useDebugLogs", async () => {
  const actual = await vi.importActual<typeof import("./useDebugLogs")>(
    "./useDebugLogs",
  );
  return { ...actual, useDebugLogs: () => debug.state };
});

vi.mock("./components", () => ({
  LogViewer: (props: { lines: string[]; query: string; loading: boolean }) => (
    <div
      data-testid="log-viewer"
      data-loading={String(props.loading)}
      data-query={props.query}
      data-lines={JSON.stringify(props.lines)}
    />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  type Option = { value: string; label: unknown };
  const Select = ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (next: string) => void;
    options: Option[];
  }) => (
    <select
      data-testid="level-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => {
        const element = option.label as ReactElement<{
          color?: string;
          children?: string;
        }>;
        const isElement = isValidElement(option.label);
        return (
          <option
            key={option.value}
            value={option.value}
            data-color={isElement ? element.props.color : undefined}
          >
            {isElement ? element.props.children : String(option.label)}
          </option>
        );
      })}
    </select>
  );
  return { ...actual, Select };
});

import DebugPage from "./index";

/** Restore the hoisted hook double to the defaults most cases start from. */
function resetState(): void {
  debug.state.backendLogs = null;
  debug.state.initialLoading = false;
  debug.state.backendError = "";
  debug.state.autoRefresh = true;
  debug.state.backendNewestFirst = true;
  debug.state.backendLevel = "all";
  debug.state.backendQuery = "";
  debug.state.filteredBackendLines = [];
  vi.clearAllMocks();
}

function renderPage() {
  return render(<DebugPage />);
}

beforeEach(resetState);
afterEach(cleanup);

describe("DebugPage - breadcrumb and static chrome", () => {
  it("builds the breadcrumb from the settings parent and the debug title", () => {
    renderPage();
    // `nav.settings` has no fallback in the product source, `debug.title` does.
    expect(screen.getByText("nav.settings")).toBeInTheDocument();
    expect(screen.getByText("Debug")).toBeInTheDocument();
  });

  it("shows the explanatory tip and the backend card title", () => {
    renderPage();
    expect(
      screen.getByText(
        "View backend daemon log file to help diagnose issues. Logs refresh automatically while this page is open.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Backend logs")).toBeInTheDocument();
  });

  it("labels both toggles so a user can tell them apart", () => {
    renderPage();
    expect(screen.getByText("Newest first")).toBeInTheDocument();
    expect(screen.getByText("Auto refresh")).toBeInTheDocument();
  });
});

describe("DebugPage - level filter", () => {
  it("offers all five levels with 'all' first and the selected one as value", () => {
    debug.state.backendLevel = "warning";
    renderPage();
    const select = screen.getByTestId("level-select");
    const values = Array.from(select.querySelectorAll("option")).map((option) =>
      option.getAttribute("value"),
    );
    expect(values).toEqual(["all", "error", "warning", "info", "debug"]);
    expect(select).toHaveValue("warning");
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("colour-codes each level tag through the real backendLevelColor mapping", () => {
    renderPage();
    const colours = Array.from(
      screen.getByTestId("level-select").querySelectorAll("option"),
    ).map((option) => option.getAttribute("data-color"));
    // "all" has a plain string label, so it carries no tag colour.
    expect(colours).toEqual([null, "red", "gold", "blue", "geekblue"]);
  });

  it("reports the chosen level to the hook without touching any other filter", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("level-select"), {
      target: { value: "error" },
    });
    expect(debug.state.setBackendLevel).toHaveBeenCalledTimes(1);
    expect(debug.state.setBackendLevel).toHaveBeenCalledWith("error");
    expect(debug.state.setBackendQuery).not.toHaveBeenCalled();
  });
});

describe("DebugPage - search box", () => {
  it("mirrors the hook query into the input and forwards every keystroke", () => {
    debug.state.backendQuery = "SIGBUS";
    renderPage();
    const input = screen.getByPlaceholderText("Search backend logs...");
    expect(input).toHaveValue("SIGBUS");
    fireEvent.change(input, { target: { value: "timeout" } });
    expect(debug.state.setBackendQuery).toHaveBeenCalledTimes(1);
    expect(debug.state.setBackendQuery).toHaveBeenCalledWith("timeout");
  });

  it("passes the raw query to the viewer so highlighting stays in sync", () => {
    debug.state.backendQuery = "trace";
    renderPage();
    expect(screen.getByTestId("log-viewer")).toHaveAttribute(
      "data-query",
      "trace",
    );
  });
});

describe("DebugPage - toggles", () => {
  it("reflects both flags and reports the new value, not the old one", () => {
    debug.state.backendNewestFirst = true;
    debug.state.autoRefresh = false;
    renderPage();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    expect(switches[1]).toHaveAttribute("aria-checked", "false");

    // antd's real Switch calls onChange with (checked, event) and the page
    // wires the hook setters straight to it, so the second argument is the
    // click event. Only the first argument is this page's contract: the flag
    // must be reported as its NEW value, not echoed back.
    fireEvent.click(switches[0]);
    expect(debug.state.setBackendNewestFirst).toHaveBeenCalledTimes(1);
    expect(debug.state.setBackendNewestFirst.mock.calls[0][0]).toBe(false);
    expect(debug.state.setAutoRefresh).not.toHaveBeenCalled();

    fireEvent.click(switches[1]);
    expect(debug.state.setAutoRefresh).toHaveBeenCalledTimes(1);
    expect(debug.state.setAutoRefresh.mock.calls[0][0]).toBe(true);
    expect(debug.state.setBackendNewestFirst).toHaveBeenCalledTimes(1);
  });
});

describe("DebugPage - toolbar actions", () => {
  it("asks for a success toast on manual refresh, because the user triggered it", () => {
    renderPage();
    fireEvent.click(screen.getByText("Refresh backend logs"));
    expect(debug.state.loadBackendLogs).toHaveBeenCalledTimes(1);
    expect(debug.state.loadBackendLogs).toHaveBeenCalledWith({
      successToast: true,
    });
  });

  it("does not request a toast on the automatic initial load", () => {
    // The hook performs the automatic load itself; the page must not add a
    // second call that would toast on every poll.
    renderPage();
    expect(debug.state.loadBackendLogs).not.toHaveBeenCalled();
  });

  it("copies the filtered backend logs on demand", () => {
    renderPage();
    fireEvent.click(screen.getByText("Copy backend logs"));
    expect(debug.state.handleCopyBackend).toHaveBeenCalledTimes(1);
    expect(debug.state.handleCopyBackend).toHaveBeenCalledWith();
  });
});

describe("DebugPage - log file metadata", () => {
  it("renders the timestamp from epoch seconds, not milliseconds", () => {
    const updatedAt = 1790000000;
    debug.state.backendLogs = { updated_at: updatedAt } as BackendLogs;
    renderPage();
    const expected = dayjs(updatedAt * 1000).format("YYYY-MM-DD HH:mm:ss");
    expect(screen.getByText(/Updated at/)).toHaveTextContent(
      `Updated at: ${expected}`,
    );
    // A missing `* 1000` would silently land in 1970.
    expect(expected).not.toMatch(/^1970-/);
  });

  it("hides the timestamp row when the response carries none", () => {
    debug.state.backendLogs = { path: "/var/log/qwenpaw.log" } as BackendLogs;
    renderPage();
    expect(screen.queryByText(/Updated at/)).not.toBeInTheDocument();
  });

  it("shows the log file path in a code element when present", () => {
    debug.state.backendLogs = { path: "/var/log/qwenpaw.log" } as BackendLogs;
    const { container } = renderPage();
    expect(screen.getByText("Log file")).toBeInTheDocument();
    expect(container.querySelector("code")).toHaveTextContent(
      "/var/log/qwenpaw.log",
    );
  });

  it("omits the path row entirely while nothing has loaded yet", () => {
    renderPage();
    expect(screen.queryByText("Log file")).not.toBeInTheDocument();
  });
});

describe("DebugPage - status alerts are mutually exclusive", () => {
  it("prefers the load error over the missing-file warning", () => {
    debug.state.backendError = "boom";
    debug.state.backendLogs = { exists: false } as BackendLogs;
    renderPage();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(
      screen.queryByText("Backend log file was not found yet."),
    ).not.toBeInTheDocument();
  });

  it("warns about a missing file only when there is no error", () => {
    debug.state.backendLogs = { exists: false } as BackendLogs;
    renderPage();
    expect(
      screen.getByText("Backend log file was not found yet."),
    ).toBeInTheDocument();
  });

  it("shows neither the error nor the missing-file alert once logs loaded cleanly", () => {
    debug.state.backendLogs = { exists: true } as BackendLogs;
    renderPage();
    expect(
      screen.queryByText("Backend log file was not found yet."),
    ).not.toBeInTheDocument();
    // The page's own explanatory tip is also an antd Alert, so it stays as the
    // only alert role in the document; a status alert would be a second one.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      "View backend daemon log file to help diagnose issues.",
    );
  });

  it("still reports the error when no response object arrived at all", () => {
    debug.state.backendError = "network down";
    debug.state.backendLogs = null;
    renderPage();
    expect(screen.getByText("network down")).toBeInTheDocument();
  });
});

describe("DebugPage - viewer wiring", () => {
  it("hands the filtered lines and the initial loading flag straight through", () => {
    debug.state.filteredBackendLines = ["line-a", "line-b"];
    debug.state.initialLoading = true;
    renderPage();
    const viewer = screen.getByTestId("log-viewer");
    expect(viewer).toHaveAttribute("data-loading", "true");
    expect(viewer).toHaveAttribute(
      "data-lines",
      JSON.stringify(["line-a", "line-b"]),
    );
  });

  it("reports an empty line list as an empty array, never as undefined", () => {
    renderPage();
    expect(screen.getByTestId("log-viewer")).toHaveAttribute(
      "data-lines",
      "[]",
    );
    expect(screen.getByTestId("log-viewer")).toHaveAttribute(
      "data-loading",
      "false",
    );
  });
});
