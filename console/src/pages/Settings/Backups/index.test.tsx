/**
 * Unit tests for the Backups page, the assembly layer of the backup feature.
 *
 * Facts that shaped this suite (each one read off the source or measured):
 *
 * 1. The page owns three things of its own: the fetched backup list, the
 *    fetched agent list, and the create-dialog open state plus its resume job.
 *    Everything else is a child module that already has a suite next door
 *    (`list/BackupTable`, `create/CreateBackupModal`, `restore/*`,
 *    `import/useImportFlow`), so those are stubbed on purpose and every
 *    assertion below is about the wiring this file owns.
 * 2. `fetchData` awaits `Promise.all([api.listBackups(), agentsApi.listAgents(),
 *    api.getActiveBackupJob()])` and only then clears `loading`, so a pending
 *    list read keeps the whole page in its loading branch. That is asserted by
 *    holding one promise open while the other two already resolved.
 * 3. A non-null active job is the resume signal: the same tick stores it as
 *    `resumeJob` and opens the create dialog. With no active job the dialog
 *    stays closed. Both halves are asserted, because they are two branches of
 *    `if (activeJob) setCreateOpen(true)`.
 * 4. The manual create button clears `resumeJob` before opening, so "start a
 *    fresh backup" and "resume the running one" are two distinct entry points
 *    into the same dialog. The stub reports the `resumeJob` it receives, which
 *    is what makes the clear assertable.
 * 5. The failure path is a bare `catch {}`: it reports `backup.loadFailed`
 *    through `useAppMessage` and still clears loading in `finally`, so the user
 *    lands on an empty page instead of an endless spinner. `useAppMessage` is
 *    stubbed to capture that toast (the real one needs antd's App context).
 * 6. `PageHeader`, `Button` and `Spin` render for real (PageHeader has no
 *    external deps, the other two come straight from antd), so the breadcrumb
 *    trail and the header buttons are the genuine article and are queried by
 *    text/role. No CSS-module class name is asserted: those are hashed.
 * 7. `RestoreBackupModal` is the only child mounted conditionally
 *    (`restoreFlow.restoreTarget && ...`), so "the restore dialog exists only
 *    while a restore target is set" is a real branch of this file.
 * 8. Two fallbacks live in this file and are asserted through stub props: the
 *    trust dialog mode falls back to `"foreign"` and its backup name falls back
 *    to `undefined` when the import flow has no pending trust prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BackupJobSnapshot, BackupMeta } from "@/api/types/backup";
import type { AgentSummary } from "@/api/types/agents";

const api = vi.hoisted(() => ({
  listBackups: vi.fn(),
  getActiveBackupJob: vi.fn(),
  listAgents: vi.fn(),
}));

const appMessage = vi.hoisted(() => ({
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const importFlowOptions = vi.hoisted(() => ({
  onSuccess: null as null | (() => void),
}));

const importFlow = vi.hoisted(() => ({
  conflictMeta: null as unknown,
  trustFileName: null as string | null,
  trustMode: null as string | null,
  trustLoading: false,
  handleImport: vi.fn(),
  handleConflictChoice: vi.fn(),
  handleTrustConfirm: vi.fn(),
  clearConflict: vi.fn(),
  clearTrust: vi.fn(),
}));

const restoreFlow = vi.hoisted(() => ({
  preRestoreConfirmTarget: null as unknown,
  preRestoreBackupTarget: null as unknown,
  restoreTarget: null as BackupMeta | null,
  setRestoreTarget: vi.fn(),
  handleRestore: vi.fn(),
  confirmRestoreWithoutBackup: vi.fn(),
  confirmRestoreWithBackup: vi.fn(),
  cancelPreRestore: vi.fn(),
  onPreRestoreBackupSuccess: vi.fn(),
  onPreRestoreBackupClose: vi.fn(),
}));

// A single stable i18n instance on purpose: the page memoises `fetchData` on
// `[message, t]` and runs it from `useEffect([fetchData])`, so handing out a
// fresh `t` per render would re-trigger the effect on every render and keep the
// page in its loading branch forever.
const i18nStub = vi.hoisted(() => {
  const t = (key: string) => key;
  const i18n = {
    resolvedLanguage: "en",
    changeLanguage: () => undefined,
    language: "en",
  };
  return { t, i18n };
});

vi.mock("react-i18next", () => ({
  // Keys are asserted as-is so no expectation depends on locale files.
  useTranslation: () => ({ t: i18nStub.t, i18n: i18nStub.i18n }),
}));

vi.mock("@/api", () => ({
  default: {
    listBackups: api.listBackups,
    getActiveBackupJob: api.getActiveBackupJob,
  },
  agentsApi: { listAgents: api.listAgents },
}));

vi.mock("@/hooks/useAppMessage", () => ({
  useAppMessage: () => appMessage,
}));

vi.mock("./import/useImportFlow", () => ({
  useImportFlow: (options: { onSuccess: () => void }) => {
    // Captured so the page-level "import finished, re-read everything" wiring
    // can be asserted; the flow's own behaviour has a suite next door.
    importFlowOptions.onSuccess = options.onSuccess;
    return importFlow;
  },
}));

vi.mock("./restore/useRestoreFlow", () => ({
  useRestoreFlow: () => restoreFlow,
}));

vi.mock("./list/BackupTable", () => ({
  default: (props: {
    backups: BackupMeta[];
    searchQuery: string;
    onRestore: (backup: BackupMeta) => void;
    onRefresh: () => void;
  }) => (
    <div
      data-testid="backup-table"
      data-count={props.backups.length}
      data-query={props.searchQuery}
      data-names={props.backups.map((b) => b.id).join(",")}
    >
      <button onClick={() => props.onRefresh()}>table-refresh</button>
      <button
        onClick={() => {
          if (props.backups.length > 0) props.onRestore(props.backups[0]);
        }}
      >
        table-restore
      </button>
    </div>
  ),
}));

vi.mock("./list/BackupToolbar", () => ({
  default: (props: {
    searchQuery: string;
    onSearchChange: (query: string) => void;
  }) => (
    <div data-testid="backup-toolbar" data-query={props.searchQuery}>
      <button onClick={() => props.onSearchChange("nightly")}>
        toolbar-search
      </button>
    </div>
  ),
}));

vi.mock("./import/ImportButton", () => ({
  default: (props: { onPick: (file: File) => void }) => (
    <button
      data-testid="import-button"
      onClick={() => props.onPick(new File(["zipped"], "backup.zip"))}
    >
      import-pick
    </button>
  ),
}));

vi.mock("./import/ImportConflictModal", () => ({
  default: (props: {
    conflictMeta: unknown;
    onChoice: (choice: string) => void;
    onCancel: () => void;
  }) => (
    <div
      data-testid="conflict-modal"
      data-meta={JSON.stringify(props.conflictMeta)}
    >
      <button onClick={() => props.onChoice("overwrite")}>
        conflict-choice
      </button>
      <button onClick={() => props.onCancel()}>conflict-cancel</button>
    </div>
  ),
}));

vi.mock("./trust/BackupTrustDialog", () => ({
  default: (props: {
    open: boolean;
    mode: string;
    backupName?: string;
    confirmLoading: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div
      data-testid="trust-dialog"
      data-open={String(props.open)}
      data-mode={props.mode}
      data-name={props.backupName === undefined ? "unset" : props.backupName}
      data-loading={String(props.confirmLoading)}
    >
      <button onClick={() => props.onConfirm()}>trust-confirm</button>
      <button onClick={() => props.onCancel()}>trust-cancel</button>
    </div>
  ),
}));

vi.mock("./create/CreateBackupModal", () => ({
  default: (props: {
    open: boolean;
    agents: AgentSummary[];
    resumeJob: BackupJobSnapshot | null;
    onClose: () => void;
    onSuccess: () => void;
  }) => (
    <div
      data-testid="create-modal"
      data-open={String(props.open)}
      data-resume={props.resumeJob === null ? "none" : props.resumeJob.job_id}
      data-agents={props.agents.map((a) => a.id).join(",")}
    >
      <button onClick={() => props.onClose()}>create-close</button>
      <button onClick={() => props.onSuccess()}>create-success</button>
    </div>
  ),
}));

vi.mock("./create/SilentBackupModal", () => ({
  default: (props: {
    target: BackupMeta | null;
    agentIds: string[];
    onClose: () => void;
    onSuccess: () => void;
  }) => (
    <div
      data-testid="silent-modal"
      data-target={props.target === null ? "null" : props.target.id}
      data-agent-ids={props.agentIds.join(",")}
    >
      <button onClick={() => props.onClose()}>silent-close</button>
      <button onClick={() => props.onSuccess()}>silent-success</button>
    </div>
  ),
}));

vi.mock("./restore/PreRestoreConfirmModal", () => ({
  default: (props: {
    target: unknown;
    onCancel: () => void;
    onNoBackup: () => void;
    onYesBackup: () => void;
  }) => (
    <div
      data-testid="pre-restore-modal"
      data-target={props.target === null ? "null" : "set"}
    >
      <button onClick={() => props.onCancel()}>pre-cancel</button>
      <button onClick={() => props.onNoBackup()}>pre-no-backup</button>
      <button onClick={() => props.onYesBackup()}>pre-yes-backup</button>
    </div>
  ),
}));

vi.mock("./restore/RestoreBackupModal", () => ({
  default: (props: {
    backup: BackupMeta;
    agents: AgentSummary[];
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
  }) => (
    <div
      data-testid="restore-modal"
      data-backup={props.backup.id}
      data-open={String(props.open)}
      data-agents={props.agents.map((a) => a.id).join(",")}
    >
      <button onClick={() => props.onClose()}>restore-close</button>
      <button onClick={() => props.onSuccess()}>restore-success</button>
    </div>
  ),
}));

import BackupsPage from "./index";

function makeBackup(
  id: string,
  overrides: Partial<BackupMeta> = {},
): BackupMeta {
  return {
    id,
    name: `Backup ${id}`,
    description: `Description ${id}`,
    created_at: "2026-09-30T08:00:00Z",
    scope: {
      include_agents: true,
      include_global_config: true,
      include_secrets: false,
      include_skill_pool: true,
    },
    agent_count: 1,
    ...overrides,
  } as BackupMeta;
}

function makeAgent(id: string): AgentSummary {
  return {
    id,
    name: `Agent ${id}`,
    description: `Desc ${id}`,
    workspace_dir: `/tmp/ws/${id}`,
    enabled: true,
    backend: "harness",
  } as AgentSummary;
}

function makeJob(id = "job-1"): BackupJobSnapshot {
  return {
    job_id: id,
    backup_id: "b1",
    status: "running",
    phase: "agents",
    percent: 40,
    current_agent: "a1",
    agent_index: 0,
    total_agents: 2,
    result: null,
    error: null,
  } as BackupJobSnapshot;
}

/** Mounts the page and waits for the loading branch to be left. */
async function renderLoaded() {
  render(<BackupsPage />);
  await waitFor(() =>
    expect(screen.getByTestId("backup-table")).toBeInTheDocument(),
  );
}

function resetFlows() {
  importFlowOptions.onSuccess = null;
  importFlow.conflictMeta = null;
  importFlow.trustFileName = null;
  importFlow.trustMode = null;
  importFlow.trustLoading = false;
  restoreFlow.preRestoreConfirmTarget = null;
  restoreFlow.preRestoreBackupTarget = null;
  restoreFlow.restoreTarget = null;
  for (const fn of [
    importFlow.handleImport,
    importFlow.handleConflictChoice,
    importFlow.handleTrustConfirm,
    importFlow.clearConflict,
    importFlow.clearTrust,
    restoreFlow.setRestoreTarget,
    restoreFlow.handleRestore,
    restoreFlow.confirmRestoreWithoutBackup,
    restoreFlow.confirmRestoreWithBackup,
    restoreFlow.cancelPreRestore,
    restoreFlow.onPreRestoreBackupSuccess,
    restoreFlow.onPreRestoreBackupClose,
  ]) {
    fn.mockClear();
  }
}

describe("BackupsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFlows();
    api.listBackups.mockResolvedValue([]);
    api.listAgents.mockResolvedValue({ agents: [] });
    api.getActiveBackupJob.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("stays in the loading branch until every read settles", async () => {
    let releaseList: (value: BackupMeta[]) => void = () => {};
    api.listBackups.mockReturnValue(
      new Promise<BackupMeta[]>((resolve) => {
        releaseList = resolve;
      }),
    );

    render(<BackupsPage />);

    // The other two reads already resolved, yet the page is still loading:
    // the header breadcrumb only appears in the loaded branch.
    expect(screen.queryByText("backup.title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-table")).not.toBeInTheDocument();

    releaseList([makeBackup("b1")]);

    await waitFor(() =>
      expect(screen.getByTestId("backup-table")).toBeInTheDocument(),
    );
    expect(screen.getByText("backup.title")).toBeInTheDocument();
    expect(screen.getByText("nav.settings")).toBeInTheDocument();
  });

  it("reads backups, agents and the active job together on mount", async () => {
    await renderLoaded();

    expect(api.listBackups).toHaveBeenCalledTimes(1);
    expect(api.listAgents).toHaveBeenCalledTimes(1);
    expect(api.getActiveBackupJob).toHaveBeenCalledTimes(1);
  });

  it("hands the fetched backup list to the table", async () => {
    api.listBackups.mockResolvedValue([makeBackup("b1"), makeBackup("b2")]);

    await renderLoaded();

    const table = screen.getByTestId("backup-table");
    expect(table.getAttribute("data-count")).toBe("2");
    expect(table.getAttribute("data-names")).toBe("b1,b2");
  });

  it("opens the create dialog in resume mode while a job is running", async () => {
    api.getActiveBackupJob.mockResolvedValue(makeJob("job-77"));

    render(<BackupsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("create-modal").getAttribute("data-open")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("create-modal").getAttribute("data-resume")).toBe(
      "job-77",
    );
  });

  it("leaves the create dialog closed when no job is running", async () => {
    await renderLoaded();

    const modal = screen.getByTestId("create-modal");
    expect(modal.getAttribute("data-open")).toBe("false");
    expect(modal.getAttribute("data-resume")).toBe("none");
  });

  it("drops the resume job when the dialog is closed and reopens fresh", async () => {
    api.getActiveBackupJob.mockResolvedValue(makeJob("job-77"));
    render(<BackupsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("create-modal").getAttribute("data-open")).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByText("create-close"));
    expect(screen.getByTestId("create-modal").getAttribute("data-open")).toBe(
      "false",
    );

    // The accessible name of that button is the antd icon's aria-label glued
    // to the i18n key ("plusbackup.create"), measured, not guessed, so the
    // matcher is a pattern anchored on the key rather than an exact string.
    fireEvent.click(screen.getByRole("button", { name: /backup\.create/ }));
    const modal = screen.getByTestId("create-modal");
    expect(modal.getAttribute("data-open")).toBe("true");
    expect(modal.getAttribute("data-resume")).toBe("none");
  });

  it("re-reads everything when a child asks for a refresh", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText("table-refresh"));

    await waitFor(() => expect(api.listBackups).toHaveBeenCalledTimes(2));
    expect(api.listAgents).toHaveBeenCalledTimes(2);
    expect(api.getActiveBackupJob).toHaveBeenCalledTimes(2);
  });

  it("re-reads everything after a successful create", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText("create-success"));

    await waitFor(() => expect(api.listBackups).toHaveBeenCalledTimes(2));
  });

  it("reports a load failure and still leaves the loading branch", async () => {
    api.listBackups.mockRejectedValue(new Error("network down"));

    await renderLoaded();

    expect(appMessage.message.error).toHaveBeenCalledWith("backup.loadFailed");
    // The list keeps its previous (empty) value, so the page is usable.
    expect(screen.getByTestId("backup-table").getAttribute("data-count")).toBe(
      "0",
    );
  });

  it("narrows the agent list to ids for the pre-restore snapshot", async () => {
    api.listAgents.mockResolvedValue({
      agents: [makeAgent("a1"), makeAgent("a2"), makeAgent("a3")],
    });

    await renderLoaded();

    expect(
      screen.getByTestId("silent-modal").getAttribute("data-agent-ids"),
    ).toBe("a1,a2,a3");
    expect(screen.getByTestId("create-modal").getAttribute("data-agents")).toBe(
      "a1,a2,a3",
    );
  });

  it("routes search text from the toolbar into the table", async () => {
    api.listBackups.mockResolvedValue([makeBackup("b1")]);
    await renderLoaded();
    expect(screen.getByTestId("backup-table").getAttribute("data-query")).toBe(
      "",
    );

    fireEvent.click(screen.getByText("toolbar-search"));

    expect(screen.getByTestId("backup-table").getAttribute("data-query")).toBe(
      "nightly",
    );
    expect(
      screen.getByTestId("backup-toolbar").getAttribute("data-query"),
    ).toBe("nightly");
  });

  it("hands the picked file to the import flow", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId("import-button"));

    expect(importFlow.handleImport).toHaveBeenCalledTimes(1);
    const picked = importFlow.handleImport.mock.calls[0][0] as File;
    expect(picked.name).toBe("backup.zip");
  });

  it("renders no restore dialog while no restore target is set", async () => {
    await renderLoaded();

    expect(screen.queryByTestId("restore-modal")).not.toBeInTheDocument();
  });

  it("mounts the restore dialog with the target and the agent list", async () => {
    api.listBackups.mockResolvedValue([makeBackup("b1")]);
    api.listAgents.mockResolvedValue({ agents: [makeAgent("a1")] });
    restoreFlow.restoreTarget = makeBackup("b1");

    await renderLoaded();

    const dialog = screen.getByTestId("restore-modal");
    expect(dialog.getAttribute("data-backup")).toBe("b1");
    expect(dialog.getAttribute("data-open")).toBe("true");
    expect(dialog.getAttribute("data-agents")).toBe("a1");
  });

  it("wires the restore dialog back to the flow and to a refresh", async () => {
    api.listBackups.mockResolvedValue([makeBackup("b1")]);
    restoreFlow.restoreTarget = makeBackup("b1");
    await renderLoaded();

    fireEvent.click(screen.getByText("restore-close"));
    expect(restoreFlow.setRestoreTarget).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText("restore-success"));
    await waitFor(() => expect(api.listBackups).toHaveBeenCalledTimes(2));
  });

  it("forwards the table restore request to the restore flow", async () => {
    api.listBackups.mockResolvedValue([makeBackup("b1")]);
    await renderLoaded();

    fireEvent.click(screen.getByText("table-restore"));

    expect(restoreFlow.handleRestore).toHaveBeenCalledTimes(1);
    expect((restoreFlow.handleRestore.mock.calls[0][0] as BackupMeta).id).toBe(
      "b1",
    );
  });

  it("wires the pre-restore confirm dialog to the flow", async () => {
    restoreFlow.preRestoreConfirmTarget = makeBackup("b5");
    await renderLoaded();

    const dialog = screen.getByTestId("pre-restore-modal");
    expect(dialog.getAttribute("data-target")).toBe("set");

    fireEvent.click(screen.getByText("pre-cancel"));
    expect(restoreFlow.cancelPreRestore).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("pre-no-backup"));
    expect(restoreFlow.confirmRestoreWithoutBackup).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("pre-yes-backup"));
    expect(restoreFlow.confirmRestoreWithBackup).toHaveBeenCalledTimes(1);
  });

  it("reports no pre-restore target while the flow is idle", async () => {
    await renderLoaded();

    expect(
      screen.getByTestId("pre-restore-modal").getAttribute("data-target"),
    ).toBe("null");
  });

  it("passes the pending pre-restore backup to the silent snapshot dialog", async () => {
    restoreFlow.preRestoreBackupTarget = makeBackup("b6");
    await renderLoaded();

    expect(screen.getByTestId("silent-modal").getAttribute("data-target")).toBe(
      "b6",
    );

    fireEvent.click(screen.getByText("silent-close"));
    expect(restoreFlow.onPreRestoreBackupClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("silent-success"));
    expect(restoreFlow.onPreRestoreBackupSuccess).toHaveBeenCalledTimes(1);
  });

  it("keeps the trust dialog closed with its documented fallbacks", async () => {
    await renderLoaded();

    const dialog = screen.getByTestId("trust-dialog");
    expect(dialog.getAttribute("data-open")).toBe("false");
    expect(dialog.getAttribute("data-mode")).toBe("foreign");
    expect(dialog.getAttribute("data-name")).toBe("unset");
    expect(dialog.getAttribute("data-loading")).toBe("false");
  });

  it("mirrors the import flow trust prompt in the trust dialog", async () => {
    importFlow.trustFileName = "imported.zip";
    importFlow.trustMode = "legacy";
    importFlow.trustLoading = true;

    await renderLoaded();

    const dialog = screen.getByTestId("trust-dialog");
    expect(dialog.getAttribute("data-open")).toBe("true");
    expect(dialog.getAttribute("data-mode")).toBe("legacy");
    expect(dialog.getAttribute("data-name")).toBe("imported.zip");
    expect(dialog.getAttribute("data-loading")).toBe("true");

    fireEvent.click(screen.getByText("trust-confirm"));
    expect(importFlow.handleTrustConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("trust-cancel"));
    expect(importFlow.clearTrust).toHaveBeenCalledTimes(1);
  });

  it("forwards the import conflict choice and cancel to the import flow", async () => {
    importFlow.conflictMeta = { incoming: "x.zip" };
    await renderLoaded();

    expect(screen.getByTestId("conflict-modal").getAttribute("data-meta")).toBe(
      JSON.stringify({ incoming: "x.zip" }),
    );

    fireEvent.click(screen.getByText("conflict-choice"));
    expect(importFlow.handleConflictChoice).toHaveBeenCalledWith("overwrite");
    fireEvent.click(screen.getByText("conflict-cancel"));
    expect(importFlow.clearConflict).toHaveBeenCalledTimes(1);
  });

  it("re-reads everything when the import flow reports success", async () => {
    await renderLoaded();

    // The page constructs the flow with `{ onSuccess: fetchData }`.
    expect(typeof importFlowOptions.onSuccess).toBe("function");
    await act(async () => {
      (importFlowOptions.onSuccess as () => void)();
    });

    expect(api.listBackups).toHaveBeenCalledTimes(2);
    expect(api.listAgents).toHaveBeenCalledTimes(2);
    expect(api.getActiveBackupJob).toHaveBeenCalledTimes(2);
  });
});
