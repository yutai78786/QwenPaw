/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AllowNoAuthHostsTab - the IP allow-list editor of the Security page: the
 * initial load (server list, the localhost fallback, and the load failure
 * toast), the add path with its three guards (blank input, malformed address,
 * duplicate entry), the trim behaviour, the Enter shortcut, the disabled state
 * of the add button, the per-row renderers (the "default" tag only on
 * 127.0.0.1 and ::1), the remove confirmation, the empty-list placeholder, and
 * the save / reset handlers handed up through `onSave` together with the
 * in-flight `saving` flag.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub exports neither Card, Table, Popconfirm nor Alert
 *   (measured: HAS_Card=false HAS_Table=false HAS_Popconfirm=false
 *   HAS_Alert=false, and it has no Space either), so `@agentscope-ai/design` is
 *   overridden here, which src/test/design-mock.ts:4 authorises.
 * - `Space` and `Space.Compact` come from antd and are left as the real
 *   components (measured: antd.Space is an object and Space.Compact a
 *   function), so the row layout the product asks for is the real one.
 * - The four icons come from lucide-react, not from @ant-design/icons
 *   (measured: Shield / Plus / Trash2 / AlertTriangle are all objects there,
 *   5729 keys). They are stubbed as plain spans and no assertion reads them.
 * - `styles.tabContent` resolves to undefined (measured: the rule
 *   ".tabContent {}" at index.module.less:116 has an empty body, so the CSS
 *   module emits no key for it and the 47 exported keys contain neither it nor
 *   any case-insensitive substring match). This is an empty style rule, not a
 *   product defect, and no assertion reads any class name (styles.formCard is
 *   the hashed "_formCard_cfb928", so a class assertion would break on any
 *   rename).
 * - The stub Table invokes every column `render(value, record, index)`, so the
 *   product cell logic really executes, and it shows `locale.emptyText` only
 *   when there is no row, which is what the real Table does.
 * - `Popconfirm.onConfirm` and `Input.onPressEnter` have no DOM event of their
 *   own in a stub, so each is surfaced by an explicit driver button. No
 *   assertion reads the driver buttons themselves; they only deliver the
 *   callback the product wired up.
 * - The IP regular expressions are exercised through the product's own add
 *   path. Every accepted / rejected literal below was first run through the
 *   two regular expressions copied verbatim from the source, so the expected
 *   verdicts are measured rather than assumed (measured, among others:
 *   "1:2:3:4:5:6:1.2.3.4" is REJECTED by the IPv6 expression even though it
 *   looks like a valid mixed notation, and "01.02.03.04" is accepted).
 * - Plain `render` is used instead of `renderWithProviders` because this
 *   component needs no router, no antd App context and no real i18n: both
 *   `useTranslation` and `useAppMessage` are mocked, matching the sibling
 *   FileGuardSection.test.tsx.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type HostsHandlers = {
  save: () => Promise<void>;
  reset: () => void;
  saving: boolean;
};

type HostsResponse = { hosts?: string[] } | null;

const h = vi.hoisted(() => ({
  api: {
    getAllowNoAuthHosts: vi.fn((): Promise<unknown> => Promise.resolve(null)),
    updateAllowNoAuthHosts: vi.fn(
      (_body: unknown): Promise<unknown> => Promise.resolve(null),
    ),
  },
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  stableT: (key: string) => key,
  stableI18n: {
    language: "en",
    resolvedLanguage: "en",
    changeLanguage: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("../../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({ message: h.message }),
}));

vi.mock("../../../../api", () => ({
  default: {
    getAllowNoAuthHosts: () => h.api.getAllowNoAuthHosts(),
    updateAllowNoAuthHosts: (body: unknown) =>
      h.api.updateAllowNoAuthHosts(body),
  },
}));

vi.mock("lucide-react", () => {
  const icon = (name: string) => () =>
    React.createElement("span", { "data-icon": name });
  return {
    Shield: icon("shield"),
    Plus: icon("plus"),
    Trash2: icon("trash"),
    AlertTriangle: icon("alert-triangle"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Card = ({ children, className }: any) =>
    React.createElement("div", { className }, children);
  const Tag = ({ children, color }: any) =>
    React.createElement("span", { "data-color": color }, children);
  const Button = ({ children, onClick, disabled, icon }: any) =>
    React.createElement(
      "button",
      { type: "button", onClick, disabled },
      icon,
      children,
    );
  const Input = ({
    value,
    onChange,
    onPressEnter,
    placeholder,
    disabled,
  }: any) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement("input", {
        "data-testid": "host-input",
        value: value ?? "",
        placeholder,
        disabled,
        onChange,
      }),
      // Driver button: onPressEnter is an antd Input prop with no DOM event of
      // its own in a stub, so it is surfaced explicitly.
      React.createElement("button", {
        type: "button",
        "data-testid": "host-press-enter",
        onClick: () => (onPressEnter as (() => void) | undefined)?.(),
      }),
    );
  const Table = ({
    dataSource = [],
    columns = [],
    locale,
    loading,
    pagination,
    size,
  }: any) => {
    const rows = dataSource as any[];
    const shell = {
      "data-testid": rows.length === 0 ? "table-empty" : "hosts-table",
      "data-loading": String(Boolean(loading)),
      "data-pagination": String(pagination),
      "data-size": String(size),
    };
    // The real Table renders a header row, so the column titles the product
    // passes are rendered here too and can be asserted as product content.
    const header = React.createElement(
      "div",
      { "data-testid": "table-header" },
      (columns as any[]).map((col, ci) =>
        React.createElement("div", { key: String(col.key ?? ci) }, col.title),
      ),
    );
    if (rows.length === 0) {
      return React.createElement(
        "div",
        shell,
        header,
        (locale as any)?.emptyText ?? "",
      );
    }
    return React.createElement(
      "div",
      shell,
      header,
      rows.map((record) =>
        React.createElement(
          "div",
          { key: String(record.key), "data-testid": "table-row" },
          (columns as any[]).map((col, ci) =>
            React.createElement(
              "div",
              { key: String(col.key ?? ci) },
              col.render
                ? col.render(
                    col.dataIndex ? record[col.dataIndex] : undefined,
                    record,
                    0,
                  )
                : null,
            ),
          ),
        ),
      ),
    );
  };
  const Popconfirm = ({
    children,
    onConfirm,
    title,
    okText,
    cancelText,
  }: any) =>
    React.createElement(
      "span",
      null,
      React.createElement(
        "span",
        { "data-testid": "confirm-texts" },
        title,
        okText,
        cancelText,
      ),
      children,
      // Driver button: Popconfirm.onConfirm only fires from the confirmation
      // popover, which a stub does not open.
      React.createElement("button", {
        type: "button",
        "data-testid": "row-remove-confirm",
        onClick: () => (onConfirm as (() => void) | undefined)?.(),
      }),
    );
  const Alert = ({ message, description, type, showIcon }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "warning-alert",
        "data-type": type,
        "data-show-icon": String(showIcon),
      },
      React.createElement("div", null, message),
      description,
    );
  return { Card, Tag, Button, Input, Table, Popconfirm, Alert };
});

import { AllowNoAuthHostsTab } from "./AllowNoAuthHostsTab";

const SERVER_HOSTS = ["127.0.0.1", "::1", "192.168.1.100"];

const onSaveSpy = vi.fn((_handlers: HostsHandlers): void => {});

function loadedResponse(): HostsResponse {
  return { hosts: JSON.parse(JSON.stringify(SERVER_HOSTS)) as string[] };
}

function renderTab(props: Record<string, unknown> = {}) {
  return render(React.createElement(AllowNoAuthHostsTab, props as any));
}

/** Mount with the server list resolved, then wait for the rows to appear. */
async function renderLoaded(props: Record<string, unknown> = {}) {
  h.api.getAllowNoAuthHosts.mockResolvedValue(loadedResponse());
  const view = renderTab(props);
  await screen.findByText("192.168.1.100");
  return view;
}

function renderedHosts(): string[] {
  return screen
    .queryAllByTestId("table-row")
    .map(
      (row) => (within(row).getByRole("code") as HTMLElement).textContent ?? "",
    );
}

function rowOf(host: string): HTMLElement {
  const cell = screen.getByText(host);
  const row = cell.closest('[data-testid="table-row"]');
  if (!row) throw new Error("no table row for " + host);
  return row as HTMLElement;
}

function lastHandlers(): HostsHandlers {
  const calls = onSaveSpy.mock.calls;
  return calls[calls.length - 1][0];
}

function addButtonText(): string {
  return "security.allowNoAuthHosts.add";
}

async function typeHost(value: string) {
  const input = screen.getByTestId("host-input");
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  return input as HTMLInputElement;
}

/**
 * Drain the pending work of an async handler the product does not return a
 * promise for (`handleReset` calls `fetchData` without awaiting it), so the
 * assertions below run against a settled render. Real timers are in use in
 * this file, so a macrotask hop is safe here.
 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.api.getAllowNoAuthHosts.mockResolvedValue(loadedResponse());
  h.api.updateAllowNoAuthHosts.mockResolvedValue(loadedResponse());
});

describe("initial load", () => {
  it("renders the server allow-list once the fetch resolves", async () => {
    await renderLoaded();
    expect(h.api.getAllowNoAuthHosts).toHaveBeenCalledTimes(1);
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
    expect(screen.getByTestId("hosts-table")).toHaveAttribute(
      "data-loading",
      "false",
    );
  });

  it("falls back to the two localhost entries when the response has no hosts field", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({});
    renderTab();
    await screen.findByText("127.0.0.1");
    expect(renderedHosts()).toEqual(["127.0.0.1", "::1"]);
  });

  it("falls back to the two localhost entries when the response is null", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue(null);
    renderTab();
    await screen.findByText("::1");
    expect(renderedHosts()).toEqual(["127.0.0.1", "::1"]);
  });

  it("keeps an explicitly empty server list empty instead of substituting the defaults", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: [] });
    renderTab();
    await screen.findByText("security.allowNoAuthHosts.empty");
    expect(renderedHosts()).toEqual([]);
  });

  it("reports a load failure and still leaves the table usable", async () => {
    h.api.getAllowNoAuthHosts.mockRejectedValue(new Error("network down"));
    renderTab();
    await screen.findByText("security.allowNoAuthHosts.empty");
    expect(h.message.error).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.loadFailed",
    );
    expect(screen.getByTestId("table-empty")).toHaveAttribute(
      "data-loading",
      "false",
    );
    expect(renderedHosts()).toEqual([]);
  });

  it("renders without any props at all, so the default parameter object is used", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue(loadedResponse());
    render(React.createElement(AllowNoAuthHostsTab));
    await screen.findByText("192.168.1.100");
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
    expect(screen.queryAllByRole("code")).toHaveLength(SERVER_HOSTS.length);
  });
});

describe("the security warning card", () => {
  it("shows the warning title and description as a warning alert with its icon enabled", async () => {
    await renderLoaded();
    const alert = screen.getByTestId("warning-alert");
    expect(alert).toHaveTextContent("security.allowNoAuthHosts.warningTitle");
    expect(alert).toHaveTextContent(
      "security.allowNoAuthHosts.warningDescription",
    );
    expect(alert).toHaveAttribute("data-type", "warning");
    expect(alert).toHaveAttribute("data-show-icon", "true");
  });

  it("passes the table its column titles, the disabled pagination and the middle size", async () => {
    await renderLoaded();
    const table = screen.getByTestId("hosts-table");
    expect(table).toHaveAttribute("data-pagination", "false");
    expect(table).toHaveAttribute("data-size", "middle");
    expect(
      screen.getByText("security.allowNoAuthHosts.ipAddress"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("security.allowNoAuthHosts.actions"),
    ).toBeInTheDocument();
  });
});

describe("the default tag on each row", () => {
  it("tags 127.0.0.1 and ::1 as default and no other address", async () => {
    await renderLoaded();
    const tagged = screen
      .queryAllByText("security.allowNoAuthHosts.default")
      .map((el) => {
        const row = el.closest('[data-testid="table-row"]');
        return row
          ? within(row as HTMLElement).getByRole("code").textContent ?? ""
          : "";
      });
    expect(tagged.sort()).toEqual(["127.0.0.1", "::1"]);
  });

  it("shows no default tag when the list holds only non-default addresses", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({
      hosts: ["10.0.0.1", "2001:db8::1"],
    });
    renderTab();
    await screen.findByText("10.0.0.1");
    expect(
      screen.queryAllByText("security.allowNoAuthHosts.default"),
    ).toHaveLength(0);
    expect(renderedHosts()).toEqual(["10.0.0.1", "2001:db8::1"]);
  });
});

describe("adding an address", () => {
  it("appends a valid IPv4 address and clears the input", async () => {
    await renderLoaded();
    await typeHost("10.0.0.5");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toEqual([...SERVER_HOSTS, "10.0.0.5"]);
    expect((screen.getByTestId("host-input") as HTMLInputElement).value).toBe(
      "",
    );
    expect(h.message.error).not.toHaveBeenCalled();
    expect(h.message.warning).not.toHaveBeenCalled();
  });

  it("appends a valid compressed IPv6 address", async () => {
    await renderLoaded();
    await typeHost("2001:db8::1");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toEqual([...SERVER_HOSTS, "2001:db8::1"]);
  });

  it.each([
    "0.0.0.0",
    "255.255.255.255",
    "01.02.03.04",
    "::",
    "fe80::",
    "fe80::1%eth0",
    "::ffff:192.168.1.1",
    "1:2:3:4:5:6:7:8",
    "0:0:0:0:0:0:0:1",
    "2001:0db8:0000:0000:0000:ff00:0042:8329",
  ])("accepts %s", async (candidate) => {
    await renderLoaded();
    await typeHost(candidate);
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toContain(candidate);
    expect(h.message.error).not.toHaveBeenCalledWith(
      "security.allowNoAuthHosts.invalidIP",
    );
  });

  it.each([
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "-1.0.0.0",
    "abc",
    "not-an-ip",
    "1.2.3.4/24",
    "localhost",
    "[::1]",
    ":::",
    "%eth0",
    "127.0.0.1:8080",
    "1:2:3:4:5:6:1.2.3.4",
  ])(
    "rejects %s with the invalid-format toast and leaves the list untouched",
    async (candidate) => {
      await renderLoaded();
      await typeHost(candidate);
      await act(async () => {
        fireEvent.click(screen.getByText(addButtonText()));
      });
      expect(h.message.error).toHaveBeenCalledWith(
        "security.allowNoAuthHosts.invalidIP",
      );
      expect(renderedHosts()).toEqual(SERVER_HOSTS);
    },
  );

  it("rejects an address that is already in the list with the duplicate toast", async () => {
    await renderLoaded();
    await typeHost("192.168.1.100");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(h.message.warning).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.duplicate",
    );
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
    expect(h.message.error).not.toHaveBeenCalled();
  });

  it("rejects a duplicate of a default entry too", async () => {
    await renderLoaded();
    await typeHost("::1");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(h.message.warning).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.duplicate",
    );
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("trims surrounding whitespace before validating and stores the trimmed value", async () => {
    await renderLoaded();
    await typeHost("   10.0.0.9   ");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toEqual([...SERVER_HOSTS, "10.0.0.9"]);
    expect(h.message.error).not.toHaveBeenCalled();
  });

  it("does nothing at all when the input holds only whitespace", async () => {
    await renderLoaded();
    await typeHost("     ");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(h.message.error).not.toHaveBeenCalled();
    expect(h.message.warning).not.toHaveBeenCalled();
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("takes the blank-input guard through Enter, the one path where the add button does not already block it", async () => {
    // The add button carries disabled={!newHost.trim()}, so a whitespace-only
    // input can never reach handleAdd through the button; the Enter handler
    // has no such disable, which is what makes the guard reachable and
    // worth its own case.
    await renderLoaded();
    await typeHost("     ");
    expect(screen.getByText(addButtonText())).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-press-enter"));
    });
    expect(h.message.error).not.toHaveBeenCalled();
    expect(h.message.warning).not.toHaveBeenCalled();
    expect(h.api.updateAllowNoAuthHosts).not.toHaveBeenCalled();
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("adds through the Enter shortcut exactly as the button does", async () => {
    await renderLoaded();
    await typeHost("172.16.0.7");
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-press-enter"));
    });
    expect(renderedHosts()).toEqual([...SERVER_HOSTS, "172.16.0.7"]);
    expect((screen.getByTestId("host-input") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("reports the invalid-format toast through the Enter shortcut as well", async () => {
    await renderLoaded();
    await typeHost("999.1.1.1");
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-press-enter"));
    });
    expect(h.message.error).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.invalidIP",
    );
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("lets several addresses be added one after another", async () => {
    await renderLoaded();
    for (const candidate of ["10.1.1.1", "10.1.1.2", "2001:db8::9"]) {
      await typeHost(candidate);
      await act(async () => {
        fireEvent.click(screen.getByText(addButtonText()));
      });
    }
    expect(renderedHosts()).toEqual([
      ...SERVER_HOSTS,
      "10.1.1.1",
      "10.1.1.2",
      "2001:db8::9",
    ]);
  });
});

describe("the add button enabled state", () => {
  it("is disabled while the input is empty and enabled once something is typed", async () => {
    await renderLoaded();
    expect(screen.getByText(addButtonText())).toBeDisabled();
    await typeHost("10.0.0.1");
    expect(screen.getByText(addButtonText())).toBeEnabled();
  });

  it("is disabled for a whitespace-only input even though it is not empty", async () => {
    await renderLoaded();
    await typeHost("    ");
    expect(screen.getByText(addButtonText())).toBeDisabled();
  });

  it("becomes disabled again after the input is cleared", async () => {
    await renderLoaded();
    await typeHost("10.0.0.1");
    expect(screen.getByText(addButtonText())).toBeEnabled();
    await typeHost("");
    expect(screen.getByText(addButtonText())).toBeDisabled();
  });

  it("is disabled again right after a successful add clears the input", async () => {
    await renderLoaded();
    await typeHost("10.0.0.1");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(screen.getByText(addButtonText())).toBeDisabled();
  });
});

describe("removing an address", () => {
  it("drops the confirmed row from the list", async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(
        within(rowOf("192.168.1.100")).getByTestId("row-remove-confirm"),
      );
    });
    expect(renderedHosts()).toEqual(["127.0.0.1", "::1"]);
    expect(screen.queryByText("192.168.1.100")).not.toBeInTheDocument();
  });

  it("also removes a default localhost entry, since the tag is only a label", async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(
        within(rowOf("127.0.0.1")).getByTestId("row-remove-confirm"),
      );
    });
    expect(renderedHosts()).toEqual(["::1", "192.168.1.100"]);
  });

  it("leaves the other entries of the same value alone when only one is confirmed", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({
      hosts: ["10.0.0.1", "10.0.0.2", "10.0.0.3"],
    });
    renderTab();
    await screen.findByText("10.0.0.2");
    await act(async () => {
      fireEvent.click(
        within(rowOf("10.0.0.2")).getByTestId("row-remove-confirm"),
      );
    });
    expect(renderedHosts()).toEqual(["10.0.0.1", "10.0.0.3"]);
  });

  it("shows the empty placeholder once the last entry is removed", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: ["10.0.0.1"] });
    renderTab();
    await screen.findByText("10.0.0.1");
    await act(async () => {
      fireEvent.click(
        within(rowOf("10.0.0.1")).getByTestId("row-remove-confirm"),
      );
    });
    expect(renderedHosts()).toEqual([]);
    expect(screen.getByTestId("table-empty")).toHaveTextContent(
      "security.allowNoAuthHosts.empty",
    );
  });

  it("lets a removed address be added back", async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(
        within(rowOf("192.168.1.100")).getByTestId("row-remove-confirm"),
      );
    });
    await typeHost("192.168.1.100");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toEqual(["127.0.0.1", "::1", "192.168.1.100"]);
    expect(h.message.warning).not.toHaveBeenCalled();
  });

  it("passes the confirmation and its two button labels to each row", async () => {
    await renderLoaded();
    const texts = within(rowOf("192.168.1.100")).getByTestId("confirm-texts");
    expect(texts).toHaveTextContent("security.allowNoAuthHosts.removeConfirm");
    expect(texts).toHaveTextContent("common.delete");
    expect(texts).toHaveTextContent("common.cancel");
  });
});

describe("the handlers handed up through onSave", () => {
  it("hands save, reset and the saving flag to the parent", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    expect(onSaveSpy).toHaveBeenCalled();
    const handlers = lastHandlers();
    expect(typeof handlers.save).toBe("function");
    expect(typeof handlers.reset).toBe("function");
    expect(handlers.saving).toBe(false);
  });

  it("saves the list currently on screen and reports success", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    await typeHost("10.9.9.9");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    await act(async () => {
      fireEvent.click(within(rowOf("::1")).getByTestId("row-remove-confirm"));
    });
    await act(async () => {
      await lastHandlers().save();
    });
    expect(h.api.updateAllowNoAuthHosts).toHaveBeenCalledTimes(1);
    expect(h.api.updateAllowNoAuthHosts).toHaveBeenCalledWith({
      hosts: ["127.0.0.1", "192.168.1.100", "10.9.9.9"],
    });
    expect(h.message.success).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.saveSuccess",
    );
    expect(h.message.error).not.toHaveBeenCalled();
  });

  it("saves an empty list when every entry was removed", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: ["10.0.0.1"] });
    renderTab({ onSave: onSaveSpy });
    await screen.findByText("10.0.0.1");
    await act(async () => {
      fireEvent.click(
        within(rowOf("10.0.0.1")).getByTestId("row-remove-confirm"),
      );
    });
    await act(async () => {
      await lastHandlers().save();
    });
    expect(h.api.updateAllowNoAuthHosts).toHaveBeenCalledWith({ hosts: [] });
    expect(h.message.success).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.saveSuccess",
    );
  });

  it("reports a save failure and leaves the list on screen unchanged", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    h.api.updateAllowNoAuthHosts.mockRejectedValue(new Error("server down"));
    await act(async () => {
      await lastHandlers().save();
    });
    expect(h.message.error).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.saveFailed",
    );
    expect(h.message.success).not.toHaveBeenCalled();
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("flips the saving flag while the request is in flight and back afterwards", async () => {
    let release: (() => void) | undefined;
    h.api.updateAllowNoAuthHosts.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(loadedResponse());
        }),
    );
    await renderLoaded({ onSave: onSaveSpy });
    expect(lastHandlers().saving).toBe(false);

    let inFlight: Promise<void> | undefined;
    await act(async () => {
      inFlight = lastHandlers().save();
    });
    expect(lastHandlers().saving).toBe(true);
    expect(h.message.success).not.toHaveBeenCalled();

    await act(async () => {
      release?.();
      await inFlight;
    });
    expect(lastHandlers().saving).toBe(false);
    expect(h.message.success).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.saveSuccess",
    );
  });

  it("keeps the saving flag false after a failed save", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    h.api.updateAllowNoAuthHosts.mockRejectedValue(new Error("server down"));
    await act(async () => {
      await lastHandlers().save();
    });
    expect(lastHandlers().saving).toBe(false);
  });

  it("re-reads the server list on reset and drops the local edits", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    await typeHost("10.5.5.5");
    await act(async () => {
      fireEvent.click(screen.getByText(addButtonText()));
    });
    expect(renderedHosts()).toEqual([...SERVER_HOSTS, "10.5.5.5"]);

    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: ["10.0.0.1"] });
    await act(async () => {
      lastHandlers().reset();
    });
    await flush();

    expect(h.api.getAllowNoAuthHosts).toHaveBeenCalledTimes(2);
    expect(renderedHosts()).toEqual(["10.0.0.1"]);
  });

  it("shows the table as loading again while a reset is in flight", async () => {
    let release: (() => void) | undefined;
    await renderLoaded({ onSave: onSaveSpy });
    h.api.getAllowNoAuthHosts.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ hosts: ["10.0.0.1"] });
        }),
    );
    await act(async () => {
      lastHandlers().reset();
    });
    // While the re-read is pending the previous rows are still on screen, so
    // the loading flag is read off the populated table carrier.
    expect(screen.getByTestId("hosts-table")).toHaveAttribute(
      "data-loading",
      "true",
    );
    await act(async () => {
      release?.();
    });
    await flush();
    expect(screen.getByTestId("hosts-table")).toHaveAttribute(
      "data-loading",
      "false",
    );
    expect(renderedHosts()).toEqual(["10.0.0.1"]);
  });

  it("reports a reset failure through the load toast", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    h.api.getAllowNoAuthHosts.mockRejectedValue(new Error("network down"));
    await act(async () => {
      lastHandlers().reset();
    });
    await flush();
    expect(h.message.error).toHaveBeenCalledWith(
      "security.allowNoAuthHosts.loadFailed",
    );
    expect(renderedHosts()).toEqual(SERVER_HOSTS);
  });

  it("does not call onSave when the parent passed none", async () => {
    await renderLoaded();
    expect(onSaveSpy).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("code")).toHaveLength(SERVER_HOSTS.length);
  });
});

describe("list shapes", () => {
  it("renders nothing but the placeholder for an empty list", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: [] });
    renderTab();
    await screen.findByText("security.allowNoAuthHosts.empty");
    expect(screen.queryAllByTestId("table-row")).toHaveLength(0);
    expect(screen.getByTestId("table-empty")).toHaveAttribute(
      "data-loading",
      "false",
    );
  });

  it("renders exactly one row for a single-entry list", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({ hosts: ["10.0.0.1"] });
    renderTab();
    await screen.findByText("10.0.0.1");
    expect(screen.queryAllByTestId("table-row")).toHaveLength(1);
    expect(
      screen.queryAllByText("security.allowNoAuthHosts.default"),
    ).toHaveLength(0);
  });

  it("renders two rows for a two-entry list", async () => {
    h.api.getAllowNoAuthHosts.mockResolvedValue({
      hosts: ["127.0.0.1", "10.0.0.1"],
    });
    renderTab();
    await screen.findByText("10.0.0.1");
    expect(screen.queryAllByTestId("table-row")).toHaveLength(2);
    expect(
      screen.queryAllByText("security.allowNoAuthHosts.default"),
    ).toHaveLength(1);
  });

  it("keeps the input placeholder from the translation catalogue", async () => {
    await renderLoaded();
    expect(screen.getByTestId("host-input")).toHaveAttribute(
      "placeholder",
      "security.allowNoAuthHosts.inputPlaceholder",
    );
  });
});
