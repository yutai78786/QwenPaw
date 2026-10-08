/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FileGuardSection - the file guard enable switch, the preview-outside-workspace
 * switch, the deny-list editor (add / duplicate / blank / Enter / remove with
 * confirmation), the per-row cell renderers (directory vs file, unix vs windows
 * separator), the save/reset handlers handed up through `onSave` including the
 * in-flight `saving` flag, and the four-condition deny-paths protection card
 * (platform support, sandbox on, "unelevated" reason, handler present) with its
 * active alert listing every protected path.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub exports neither Card, Table, Popconfirm nor Alert
 *   (measured: HAS_Card=false HAS_Table=false HAS_Popconfirm=false
 *   HAS_Alert=false, and it has no Space either), so `@agentscope-ai/design`
 *   is overridden here, which src/test/design-mock.ts:4 authorises.
 * - `Space` and `Space.Compact` come from antd and are left as the real
 *   components (measured: antd.Space is an object and Space.Compact a
 *   function), so the row layout the product asks for is the real one.
 * - The stub Table invokes every column `render(value, record, index)`, so the
 *   product cell logic really executes, and it shows `locale.emptyText` only
 *   when there is no row, which is what the real Table does.
 * - `Popconfirm.onConfirm` and `Input.onPressEnter` have no DOM event of their
 *   own in a stub, so each is surfaced by an explicit driver button. No
 *   assertion reads the driver buttons themselves; they only deliver the
 *   callback the product wired up.
 * - The three switches carry no product-owned name, so each is located by
 *   walking up from the label text the product renders until an ancestor holds
 *   a switch. Nothing is asserted about icon markup or about CSS module class
 *   names (measured: styles.formCard resolves to a hashed "_formCard_cfb928",
 *   so a class assertion would break on any rename).
 * - Plain `render` is used instead of `renderWithProviders` because this
 *   component needs no router, no antd App context and no real i18n: both
 *   `useTranslation` and `useAppMessage` are mocked, matching the sibling
 *   SkillScannerSection.test.tsx.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type GuardConfig = {
  enabled: boolean;
  paths: string[];
  allow_preview_outside_workspace: boolean;
};

type GuardHandlers = {
  save: () => Promise<void>;
  reset: () => void;
  saving: boolean;
};

const h = vi.hoisted(() => ({
  api: {
    getFileGuard: vi.fn((): Promise<unknown> => Promise.resolve(null)),
    updateFileGuard: vi.fn(
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
    getFileGuard: () => h.api.getFileGuard(),
    updateFileGuard: (body: unknown) => h.api.updateFileGuard(body),
  },
}));

vi.mock("@ant-design/icons", () => {
  const icon = (name: string) => () =>
    React.createElement("span", { "data-icon": name });
  return {
    PlusCircleOutlined: icon("plus-circle"),
    DeleteOutlined: icon("delete"),
    FolderOutlined: icon("folder"),
    FileOutlined: icon("file"),
    LockOutlined: icon("lock"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Card = ({ children, className }: any) =>
    React.createElement("div", { className }, children);
  const Tag = ({ children }: any) =>
    React.createElement("span", null, children);
  const Button = ({ children, onClick, disabled, icon }: any) =>
    React.createElement(
      "button",
      { type: "button", onClick, disabled },
      icon,
      children,
    );
  const Switch = ({ checked, onChange }: any) =>
    React.createElement("input", {
      type: "checkbox",
      role: "switch",
      checked: Boolean(checked),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        (onChange as ((v: boolean) => void) | undefined)?.(e.target.checked),
    });
  const Input = ({
    value,
    onChange,
    onPressEnter,
    disabled,
    placeholder,
  }: any) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement("input", {
        "data-testid": "path-input",
        value: value ?? "",
        disabled,
        placeholder,
        onChange,
      }),
      // Driver button: onPressEnter is an antd Input prop with no DOM event of
      // its own in a stub, so it is surfaced explicitly.
      React.createElement("button", {
        type: "button",
        "data-testid": "path-press-enter",
        onClick: () => (onPressEnter as (() => void) | undefined)?.(),
      }),
    );
  const Table = ({ dataSource = [], columns = [], locale }: any) => {
    const rows = dataSource as any[];
    if (rows.length === 0) {
      return React.createElement(
        "div",
        { "data-testid": "table-empty" },
        (locale as any)?.emptyText,
      );
    }
    return React.createElement(
      "div",
      { "data-testid": "file-guard-table" },
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
  const Popconfirm = ({ children, onConfirm }: any) =>
    React.createElement(
      "span",
      null,
      children,
      // Driver button: Popconfirm.onConfirm only fires from the confirmation
      // popover, which a stub does not open.
      React.createElement("button", {
        type: "button",
        "data-testid": "row-remove-confirm",
        onClick: () => (onConfirm as (() => void) | undefined)?.(),
      }),
    );
  const Alert = ({ message, description }: any) =>
    React.createElement(
      "div",
      { "data-testid": "deny-paths-alert" },
      React.createElement("div", null, message),
      description,
    );
  return { Card, Tag, Button, Switch, Input, Table, Popconfirm, Alert };
});

import { FileGuardSection } from "./FileGuardSection";

const FULL_CONFIG: GuardConfig = {
  enabled: true,
  paths: ["/unix/dir/", "C:\\windows\\keys\\", "/etc/hosts.txt"],
  allow_preview_outside_workspace: false,
};

const onSaveSpy = vi.fn((_handlers: GuardHandlers): void => {});

function loadedConfig(): GuardConfig {
  return JSON.parse(JSON.stringify(FULL_CONFIG)) as GuardConfig;
}

function renderSection(props: Record<string, unknown> = {}) {
  return render(React.createElement(FileGuardSection, props as any));
}

async function renderLoaded(props: Record<string, unknown> = {}) {
  h.api.getFileGuard.mockResolvedValue(loadedConfig());
  const view = renderSection(props);
  await screen.findByText("/unix/dir/");
  return view;
}

/** The switch that sits in the same product-rendered row as `labelKey`. */
function switchBeside(labelKey: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(labelKey);
  while (node) {
    const found = within(node).queryByRole("switch");
    if (found) return found;
    node = node.parentElement;
  }
  throw new Error("no switch found beside " + labelKey);
}

function rowOf(path: string): HTMLElement {
  const cell = screen.getByText(path);
  const row = cell.closest('[data-testid="table-row"]');
  if (!row) throw new Error("no table row for " + path);
  return row as HTMLElement;
}

function renderedPaths(): string[] {
  return screen
    .queryAllByTestId("table-row")
    .map(
      (row) => (within(row).getByRole("code") as HTMLElement).textContent ?? "",
    );
}

function lastHandlers(): GuardHandlers {
  const calls = onSaveSpy.mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.api.getFileGuard.mockResolvedValue(loadedConfig());
  h.api.updateFileGuard.mockResolvedValue(loadedConfig());
  onSaveSpy.mockImplementation((_handlers: GuardHandlers): void => {});
});

describe("FileGuardSection - loading the stored configuration", () => {
  it("reads the file guard config on mount and fills the switches and the path list", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: true,
      paths: ["/unix/dir/"],
      allow_preview_outside_workspace: true,
    });
    renderSection();

    expect(await screen.findByText("/unix/dir/")).toBeInTheDocument();
    expect(h.api.getFileGuard).toHaveBeenCalledTimes(1);
    expect(switchBeside("security.fileGuard.enableLabel")).toBeChecked();
    expect(
      switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
    ).toBeChecked();
  });

  it("falls back to guard on, preview off and an empty list when the response is null", async () => {
    h.api.getFileGuard.mockResolvedValue(null);
    renderSection();

    expect(await screen.findByTestId("table-empty")).toHaveTextContent(
      "security.fileGuard.empty",
    );
    expect(switchBeside("security.fileGuard.enableLabel")).toBeChecked();
    expect(
      switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
    ).not.toBeChecked();
  });

  it("falls back to guard on and preview off when the response omits those fields", async () => {
    h.api.getFileGuard.mockResolvedValue({});
    renderSection();

    expect(await screen.findByTestId("table-empty")).toBeInTheDocument();
    expect(switchBeside("security.fileGuard.enableLabel")).toBeChecked();
    expect(
      switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
    ).not.toBeChecked();
  });

  it("reports the load failure and still renders the section when the request rejects", async () => {
    h.api.getFileGuard.mockRejectedValue(new Error("boom"));
    renderSection();

    await screen.findByTestId("table-empty");
    expect(h.message.error).toHaveBeenCalledWith(
      "security.fileGuard.loadFailed",
    );
    expect(h.message.success).not.toHaveBeenCalled();
  });

  it("renders with no props at all", async () => {
    render(React.createElement(FileGuardSection));

    expect(await screen.findByText("/unix/dir/")).toBeInTheDocument();
    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });
});

describe("FileGuardSection - the guard enable switch", () => {
  it("turns the guard off and saves only the enabled flag", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(switchBeside("security.fileGuard.enableLabel"));
    });

    expect(h.api.updateFileGuard).toHaveBeenCalledWith({ enabled: false });
    expect(h.message.success).toHaveBeenCalledWith(
      "security.fileGuard.saveSuccess",
    );
    expect(switchBeside("security.fileGuard.enableLabel")).not.toBeChecked();
  });

  it("turns the guard back on from a loaded off state", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: false,
      paths: [],
      allow_preview_outside_workspace: false,
    });
    renderSection();
    await screen.findByTestId("table-empty");

    await act(async () => {
      fireEvent.click(switchBeside("security.fileGuard.enableLabel"));
    });

    expect(h.api.updateFileGuard).toHaveBeenCalledWith({ enabled: true });
    expect(switchBeside("security.fileGuard.enableLabel")).toBeChecked();
  });

  it("rolls the switch back and reports the failure when the update rejects", async () => {
    await renderLoaded();
    h.api.updateFileGuard.mockRejectedValue(new Error("nope"));

    await act(async () => {
      fireEvent.click(switchBeside("security.fileGuard.enableLabel"));
    });

    expect(h.message.error).toHaveBeenCalledWith(
      "security.fileGuard.saveFailed",
    );
    expect(switchBeside("security.fileGuard.enableLabel")).toBeChecked();
  });
});

describe("FileGuardSection - the preview-outside-workspace switch", () => {
  it("turns preview outside the workspace on and saves only that flag", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(
        switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
      );
    });

    expect(h.api.updateFileGuard).toHaveBeenCalledWith({
      allow_preview_outside_workspace: true,
    });
    expect(h.message.success).toHaveBeenCalledWith(
      "security.fileGuard.saveSuccess",
    );
    expect(
      switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
    ).toBeChecked();
  });

  it("rolls the preview switch back and reports the failure when the update rejects", async () => {
    await renderLoaded();
    h.api.updateFileGuard.mockRejectedValue(new Error("nope"));

    await act(async () => {
      fireEvent.click(
        switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
      );
    });

    expect(h.message.error).toHaveBeenCalledWith(
      "security.fileGuard.saveFailed",
    );
    expect(
      switchBeside("security.fileGuard.allowPreviewOutsideWorkspace"),
    ).not.toBeChecked();
  });
});

describe("FileGuardSection - adding a path to the deny list", () => {
  it("adds the trimmed path and clears the input", async () => {
    await renderLoaded();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "  /tmp/scratch  " },
    });
    fireEvent.click(screen.getByText("security.fileGuard.add"));

    expect(renderedPaths()).toEqual([
      "/unix/dir/",
      "C:\\windows\\keys\\",
      "/etc/hosts.txt",
      "/tmp/scratch",
    ]);
    expect(screen.getByTestId("path-input")).toHaveValue("");
    expect(h.message.warning).not.toHaveBeenCalled();
  });

  it("adds the path when Enter is pressed in the input", async () => {
    await renderLoaded();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "/var/log/" },
    });
    fireEvent.click(screen.getByTestId("path-press-enter"));

    expect(screen.getByText("/var/log/")).toBeInTheDocument();
  });

  it("ignores an input that is blank after trimming", async () => {
    await renderLoaded();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "    " },
    });
    fireEvent.click(screen.getByTestId("path-press-enter"));

    expect(renderedPaths()).toEqual([
      "/unix/dir/",
      "C:\\windows\\keys\\",
      "/etc/hosts.txt",
    ]);
    expect(h.message.warning).not.toHaveBeenCalled();
    expect(h.message.success).not.toHaveBeenCalled();
  });

  it("warns about a duplicate instead of adding it a second time", async () => {
    await renderLoaded();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: " /unix/dir/ " },
    });
    fireEvent.click(screen.getByText("security.fileGuard.add"));

    expect(h.message.warning).toHaveBeenCalledWith(
      "security.fileGuard.duplicate",
    );
    expect(screen.getAllByText("/unix/dir/")).toHaveLength(1);
    expect(screen.getByTestId("path-input")).toHaveValue(" /unix/dir/ ");
  });

  it("keeps the add button disabled while the input is blank and enables it once there is text", async () => {
    await renderLoaded();
    const add = screen.getByText("security.fileGuard.add");

    expect(add).toBeDisabled();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "/data" },
    });

    expect(add).not.toBeDisabled();
  });

  it("disables both the input and the add button while the guard is off", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: false,
      paths: [],
      allow_preview_outside_workspace: false,
    });
    renderSection();
    await screen.findByTestId("table-empty");

    expect(screen.getByTestId("path-input")).toBeDisabled();

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "/data" },
    });

    expect(screen.getByText("security.fileGuard.add")).toBeDisabled();
  });
});

describe("FileGuardSection - rendering each deny-list row", () => {
  it("tags a unix directory and a windows directory but not a plain file", async () => {
    await renderLoaded();

    expect(
      within(rowOf("/unix/dir/")).getAllByText("security.fileGuard.directory"),
    ).toHaveLength(1);
    expect(
      within(rowOf("C:\\windows\\keys\\")).getAllByText(
        "security.fileGuard.directory",
      ),
    ).toHaveLength(1);
    expect(
      within(rowOf("/etc/hosts.txt")).queryByText(
        "security.fileGuard.directory",
      ),
    ).toBeNull();
  });

  it("keeps chinese, space and emoji paths exactly as they were loaded", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: true,
      paths: ["/工作区/密钥 目录/", "/emoji 🎉.txt"],
      allow_preview_outside_workspace: false,
    });
    renderSection();

    expect(await screen.findByText("/工作区/密钥 目录/")).toBeInTheDocument();
    expect(screen.getByText("/emoji 🎉.txt")).toBeInTheDocument();
    expect(
      within(rowOf("/工作区/密钥 目录/")).queryByText(
        "security.fileGuard.directory",
      ),
    ).toBeInTheDocument();
  });

  it("shows exactly one row when the list holds a single path", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: true,
      paths: ["/only/one/"],
      allow_preview_outside_workspace: false,
    });
    renderSection();

    expect(await screen.findAllByTestId("table-row")).toHaveLength(1);
    expect(renderedPaths()).toEqual(["/only/one/"]);
  });

  it("shows the product empty text when there are no paths", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: true,
      paths: [],
      allow_preview_outside_workspace: false,
    });
    renderSection();

    expect(await screen.findByTestId("table-empty")).toHaveTextContent(
      "security.fileGuard.empty",
    );
    expect(screen.queryAllByTestId("table-row")).toHaveLength(0);
  });
});

describe("FileGuardSection - removing a path behind a confirmation", () => {
  it("removes only the confirmed path", async () => {
    await renderLoaded();

    fireEvent.click(
      within(rowOf("C:\\windows\\keys\\")).getByTestId("row-remove-confirm"),
    );

    expect(renderedPaths()).toEqual(["/unix/dir/", "/etc/hosts.txt"]);
    expect(screen.queryByText("C:\\windows\\keys\\")).toBeNull();
  });

  it("leaves an empty list after removing the only path", async () => {
    h.api.getFileGuard.mockResolvedValue({
      enabled: true,
      paths: ["/only/one/"],
      allow_preview_outside_workspace: false,
    });
    renderSection();
    await screen.findByText("/only/one/");

    fireEvent.click(
      within(rowOf("/only/one/")).getByTestId("row-remove-confirm"),
    );

    expect(await screen.findByTestId("table-empty")).toHaveTextContent(
      "security.fileGuard.empty",
    );
  });
});

describe("FileGuardSection - the handlers handed up through onSave", () => {
  it("hands save, reset and the saving flag to the parent", async () => {
    await renderLoaded({ onSave: onSaveSpy });

    const handlers = lastHandlers();
    expect(typeof handlers.save).toBe("function");
    expect(typeof handlers.reset).toBe("function");
    expect(handlers.saving).toBe(false);
  });

  it("does not call onSave when the parent passed none", async () => {
    await renderLoaded();

    expect(onSaveSpy).not.toHaveBeenCalled();
  });

  it("saves the current path list when the parent calls save", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    h.api.updateFileGuard.mockClear();

    await act(async () => {
      await lastHandlers().save();
    });

    expect(h.api.updateFileGuard).toHaveBeenCalledWith({
      paths: ["/unix/dir/", "C:\\windows\\keys\\", "/etc/hosts.txt"],
    });
    expect(h.message.success).toHaveBeenCalledWith(
      "security.fileGuard.saveSuccess",
    );
  });

  it("saves the edited path list, not the loaded one, when the parent calls save", async () => {
    await renderLoaded({ onSave: onSaveSpy });

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "/added/by/me" },
    });
    fireEvent.click(screen.getByText("security.fileGuard.add"));
    await screen.findByText("/added/by/me");
    h.api.updateFileGuard.mockClear();

    await act(async () => {
      await lastHandlers().save();
    });

    expect(h.api.updateFileGuard).toHaveBeenCalledWith({
      paths: [
        "/unix/dir/",
        "C:\\windows\\keys\\",
        "/etc/hosts.txt",
        "/added/by/me",
      ],
    });
  });

  it("reports the failure when the parent-triggered save rejects", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    h.api.updateFileGuard.mockRejectedValue(new Error("nope"));

    await act(async () => {
      await lastHandlers().save();
    });

    expect(h.message.error).toHaveBeenCalledWith(
      "security.fileGuard.saveFailed",
    );
    expect(lastHandlers().saving).toBe(false);
  });

  it("reports saving as in flight to the parent while the request is pending", async () => {
    await renderLoaded({ onSave: onSaveSpy });
    let settle: (value: unknown) => void = () => {};
    h.api.updateFileGuard.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    await act(async () => {
      void lastHandlers().save();
    });
    expect(lastHandlers().saving).toBe(true);

    await act(async () => {
      settle(null);
      await Promise.resolve();
    });
    expect(lastHandlers().saving).toBe(false);
    expect(h.message.success).toHaveBeenCalledWith(
      "security.fileGuard.saveSuccess",
    );
  });

  it("re-reads the stored config when the parent calls reset", async () => {
    await renderLoaded({ onSave: onSaveSpy });

    fireEvent.change(screen.getByTestId("path-input"), {
      target: { value: "/not/saved/yet" },
    });
    fireEvent.click(screen.getByText("security.fileGuard.add"));
    await screen.findByText("/not/saved/yet");
    expect(h.api.getFileGuard).toHaveBeenCalledTimes(1);

    await act(async () => {
      lastHandlers().reset();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.api.getFileGuard).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("/not/saved/yet")).toBeNull();
    expect(renderedPaths()).toEqual([
      "/unix/dir/",
      "C:\\windows\\keys\\",
      "/etc/hosts.txt",
    ]);
  });
});

const DENY_PROPS = {
  denyPathsPlatformSupported: true,
  sandboxEnabled: true,
  sandboxReason: "unelevated",
  toggleDenyPaths: vi.fn(),
};

describe("FileGuardSection - the deny-paths protection card", () => {
  it("stays hidden when the platform does not support deny paths", async () => {
    await renderLoaded({ ...DENY_PROPS, denyPathsPlatformSupported: false });

    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });

  it("stays hidden when the sandbox is off", async () => {
    await renderLoaded({ ...DENY_PROPS, sandboxEnabled: false });

    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });

  it("stays hidden when the sandbox reason is not the unelevated one", async () => {
    await renderLoaded({ ...DENY_PROPS, sandboxReason: "elevated" });

    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });

  it("stays hidden when the sandbox reason is absent", async () => {
    await renderLoaded({ ...DENY_PROPS, sandboxReason: null });

    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });

  it("stays hidden when the parent passed no toggle handler", async () => {
    await renderLoaded({
      denyPathsPlatformSupported: true,
      sandboxEnabled: true,
      sandboxReason: "unelevated",
    });

    expect(screen.queryByText("security.denyPathsProtection")).toBeNull();
  });

  it("appears and forwards the switch change to the handler the parent passed", async () => {
    const toggleDenyPaths = vi.fn();
    await renderLoaded({ ...DENY_PROPS, toggleDenyPaths });

    expect(
      screen.getByText("security.denyPathsProtection"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("security.denyPathsSandboxEnhancement"),
    ).toBeInTheDocument();

    const guard = switchBeside("security.denyPathsProtectionTooltip");
    expect(guard).not.toBeChecked();
    fireEvent.click(guard);

    expect(toggleDenyPaths).toHaveBeenCalledWith(true);
  });

  it("shows the switch without the alert while protection is inactive", async () => {
    await renderLoaded({
      ...DENY_PROPS,
      denyPathsActive: false,
      denyPathsProtectedPaths: ["/should/not/appear"],
    });

    expect(
      switchBeside("security.denyPathsProtectionTooltip"),
    ).not.toBeChecked();
    expect(screen.queryByTestId("deny-paths-alert")).toBeNull();
    expect(screen.queryByText("/should/not/appear")).toBeNull();
  });

  it("shows every protected path in the alert while protection is active", async () => {
    await renderLoaded({
      ...DENY_PROPS,
      denyPathsActive: true,
      denyPathsLoading: false,
      denyPathsProtectedPaths: ["/系统/目录", "C:\\Program Files", "/etc"],
    });

    const alert = await screen.findByTestId("deny-paths-alert");
    expect(alert).toHaveTextContent("security.denyPathsActiveMessage");
    expect(alert).toHaveTextContent("security.denyPathsActiveDescription");
    expect(within(alert).getByText("/系统/目录")).toBeInTheDocument();
    expect(within(alert).getByText("C:\\Program Files")).toBeInTheDocument();
    expect(within(alert).getByText("/etc")).toBeInTheDocument();
    expect(switchBeside("security.denyPathsProtectionTooltip")).toBeChecked();
  });

  it("shows a single protected path chip when the list holds one entry", async () => {
    await renderLoaded({
      ...DENY_PROPS,
      denyPathsActive: true,
      denyPathsProtectedPaths: ["/only/protected"],
    });

    const alert = await screen.findByTestId("deny-paths-alert");
    expect(within(alert).getAllByText("/only/protected")).toHaveLength(1);
  });

  it("shows an alert with no path chip when the protected list is empty", async () => {
    await renderLoaded({
      ...DENY_PROPS,
      denyPathsActive: true,
      denyPathsProtectedPaths: [],
    });

    const alert = await screen.findByTestId("deny-paths-alert");
    expect(alert).toHaveTextContent("security.denyPathsActiveMessage");
    expect(within(alert).queryAllByRole("code")).toHaveLength(0);
  });

  it("forwards a false value when an active protection is switched off", async () => {
    const toggleDenyPaths = vi.fn();
    await renderLoaded({
      ...DENY_PROPS,
      toggleDenyPaths,
      denyPathsActive: true,
      denyPathsProtectedPaths: ["/etc"],
    });

    fireEvent.click(switchBeside("security.denyPathsProtectionTooltip"));

    expect(toggleDenyPaths).toHaveBeenCalledWith(false);
  });
});
