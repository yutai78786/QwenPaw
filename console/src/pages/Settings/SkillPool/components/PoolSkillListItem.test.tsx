// @vitest-environment jsdom
/**
 * PoolSkillListItem tests - the skill pool list row's user-visible contract:
 * the automation tag derived from builtin/custom source plus the auto_sync and
 * auto_update flags, the builtin and version badges, the sync-status label and
 * its tone class, the optional last-updated row, the description fallback,
 * tag chips, and click routing (batch mode toggles selection, normal mode
 * opens the editor) with the propagation guards on the checkbox and the two
 * action buttons.
 *
 * The shared design stub does not export Checkbox and its Button drops the
 * danger flag, so this suite supplies its own. The relative timestamp itself
 * is deliberately NOT asserted: dayjs formats it from the runtime locale and
 * ICU data, so pinning the string would be locale-dependent.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("@ant-design/icons", () => {
  const make = (name: string) => () => <span data-icon={name} />;
  return {
    CalendarFilled: make("CalendarFilled"),
    CodeFilled: make("CodeFilled"),
    EyeFilled: make("EyeFilled"),
    EyeInvisibleOutlined: make("EyeInvisibleOutlined"),
    FileExcelFilled: make("FileExcelFilled"),
    FileImageFilled: make("FileImageFilled"),
    FilePdfFilled: make("FilePdfFilled"),
    FilePptFilled: make("FilePptFilled"),
    FileTextFilled: make("FileTextFilled"),
    FileWordFilled: make("FileWordFilled"),
    FileZipFilled: make("FileZipFilled"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Button = ({ children, onClick, disabled, danger }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-danger={danger ? "true" : "false"}
    >
      {children}
    </button>
  );
  const Checkbox = ({ checked, onClick }: any) => (
    <input
      type="checkbox"
      data-testid="select-checkbox"
      checked={!!checked}
      onClick={onClick}
      readOnly
    />
  );
  return { Button, Checkbox };
});

import { PoolSkillListItem } from "./PoolSkillListItem";
import type { PoolSkillSpec } from "../../../../api/types";
import styles from "../index.module.less";

function makeSkill(overrides: Partial<PoolSkillSpec> = {}): PoolSkillSpec {
  return {
    name: "demo-skill",
    description: "A demo skill",
    source: "custom",
    ...overrides,
  };
}

function renderRow(
  skillOverrides: Partial<PoolSkillSpec> = {},
  props: {
    isSelected?: boolean;
    batchModeEnabled?: boolean;
  } = {},
) {
  const skill = makeSkill(skillOverrides);
  const onToggleSelect = vi.fn();
  const onEdit = vi.fn();
  const onBroadcast = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <PoolSkillListItem
      skill={skill}
      isSelected={props.isSelected ?? false}
      batchModeEnabled={props.batchModeEnabled ?? false}
      onToggleSelect={onToggleSelect}
      onEdit={onEdit}
      onBroadcast={onBroadcast}
      onDelete={onDelete}
    />,
  );
  return {
    ...utils,
    skill,
    onToggleSelect,
    onEdit,
    onBroadcast,
    onDelete,
  };
}

function rowClasses(container: HTMLElement): string[] {
  return (container.firstElementChild?.className || "")
    .split(/\s+/)
    .filter(Boolean);
}

describe("PoolSkillListItem - automation tag", () => {
  it("labels a custom skill with auto_sync as auto-sync", () => {
    renderRow({ source: "custom", auto_sync: true });
    expect(screen.getByText("skillPool.autoSync")).toBeInTheDocument();
  });

  it("shows no automation tag for a custom skill without auto_sync", () => {
    renderRow({ source: "custom", auto_sync: false });
    expect(screen.queryByText("skillPool.autoSync")).toBeNull();
    expect(screen.queryByText("skillPool.automationBoth")).toBeNull();
  });

  it("shows no automation tag when auto_sync is absent on a custom skill", () => {
    const { container } = renderRow({ source: "custom" });
    expect(container.querySelector(`.${styles.automationTag}`)).toBeNull();
  });

  it("labels a builtin skill with both flags on as automation-both", () => {
    renderRow({ source: "builtin", auto_sync: true, auto_update: true });
    expect(screen.getByText("skillPool.automationBoth")).toBeInTheDocument();
  });

  it("labels a builtin skill with only auto_update as builtin-auto-update", () => {
    renderRow({ source: "builtin", auto_sync: false, auto_update: true });
    expect(screen.getByText("skillPool.builtinAutoUpdate")).toBeInTheDocument();
  });

  it("labels a builtin skill with only auto_sync as auto-sync", () => {
    renderRow({ source: "builtin", auto_sync: true, auto_update: false });
    expect(screen.getByText("skillPool.autoSync")).toBeInTheDocument();
    expect(screen.queryByText("skillPool.builtinAutoUpdate")).toBeNull();
  });

  it("shows no automation tag for a builtin skill with both flags off", () => {
    renderRow({ source: "builtin", auto_sync: false, auto_update: false });
    expect(screen.queryByText("skillPool.automationBoth")).toBeNull();
    expect(screen.queryByText("skillPool.autoSync")).toBeNull();
  });

  it("treats a namespaced builtin source as builtin", () => {
    renderRow({ source: "builtin:pack", auto_sync: true, auto_update: true });
    expect(screen.getByText("skillPool.automationBoth")).toBeInTheDocument();
  });

  it("treats the system source as builtin", () => {
    renderRow({ source: "system", auto_sync: true, auto_update: true });
    expect(screen.getByText("skillPool.builtin")).toBeInTheDocument();
  });
});

describe("PoolSkillListItem - badges and labels", () => {
  it("shows the builtin badge for a builtin skill", () => {
    renderRow({ source: "builtin" });
    expect(screen.getByText("skillPool.builtin")).toBeInTheDocument();
  });

  it("omits the builtin badge for a custom skill", () => {
    renderRow({ source: "custom" });
    expect(screen.queryByText("skillPool.builtin")).toBeNull();
  });

  it("shows the version badge with the version text", () => {
    const { container } = renderRow({ version_text: "2.0.1" });
    expect(container).toHaveTextContent("skillPool.version: 2.0.1");
  });

  it("omits the version badge when version_text is empty", () => {
    const { container } = renderRow({ version_text: "" });
    expect(container).not.toHaveTextContent("skillPool.version");
  });

  it("omits the version badge when version_text is absent", () => {
    const { container } = renderRow({});
    expect(container).not.toHaveTextContent("skillPool.version");
  });

  it("shows the skill name", () => {
    renderRow({ name: "pdf-extractor" });
    expect(screen.getByText("pdf-extractor")).toBeInTheDocument();
  });

  it("renders a name containing chinese characters verbatim", () => {
    renderRow({ name: "\u6587\u4ef6\u8bfb\u53d6\u5668" });
    expect(
      screen.getByText("\u6587\u4ef6\u8bfb\u53d6\u5668"),
    ).toBeInTheDocument();
  });
});

describe("PoolSkillListItem - sync status", () => {
  const cases: Array<[string, string, string]> = [
    ["synced", "skillPool.statusUpToDate", "synced"],
    ["outdated", "skillPool.statusOutdated", "outdated"],
    ["not_synced", "skillPool.statusNotSynced", "neutral"],
    ["conflict", "skillPool.statusConflict", "neutral"],
  ];

  it.each(cases)(
    "maps sync_status %s to its label and tone class",
    (status, label, tone) => {
      const { container } = renderRow({
        sync_status: status as PoolSkillSpec["sync_status"],
      });
      expect(container).toHaveTextContent(label);
      const toneKey = tone as keyof typeof styles;
      expect(container.querySelector(`.${styles[toneKey]}`)).not.toBeNull();
    },
  );

  it("shows a dash for an unknown sync status", () => {
    const { container } = renderRow({ sync_status: "" });
    expect(container).toHaveTextContent("-");
    expect(container.querySelector(`.${styles.neutral}`)).not.toBeNull();
  });

  it("shows a dash when sync_status is absent", () => {
    const { container } = renderRow({});
    expect(container.querySelector(`.${styles.neutral}`)).not.toBeNull();
  });
});

describe("PoolSkillListItem - optional rows", () => {
  it("shows the last-updated label when a timestamp is present", () => {
    const { container } = renderRow({ last_updated: "2026-09-01T10:00:00Z" });
    expect(container).toHaveTextContent("skills.lastUpdated");
    expect(container.querySelector(`.${styles.listItemTime}`)).not.toBeNull();
  });

  it("omits the last-updated row when the timestamp is absent", () => {
    const { container } = renderRow({});
    expect(container).not.toHaveTextContent("skills.lastUpdated");
    expect(container.querySelector(`.${styles.listItemTime}`)).toBeNull();
  });

  it("omits the last-updated row when the timestamp is empty", () => {
    const { container } = renderRow({ last_updated: "" });
    expect(container.querySelector(`.${styles.listItemTime}`)).toBeNull();
  });

  it("shows the description when one is provided", () => {
    renderRow({ description: "Extracts text from pdf files" });
    expect(
      screen.getByText("Extracts text from pdf files"),
    ).toBeInTheDocument();
  });

  it("falls back to a dash when the description is empty", () => {
    const { container } = renderRow({ description: "" });
    expect(
      container.querySelector(`.${styles.listItemDesc}`),
    ).toHaveTextContent("-");
  });

  it("falls back to a dash when the description is absent", () => {
    const { container } = renderRow({ description: undefined });
    expect(
      container.querySelector(`.${styles.listItemDesc}`),
    ).toHaveTextContent("-");
  });

  it("renders one chip per tag", () => {
    const { container } = renderRow({ tags: ["pdf", "ocr", "\u6587\u6863"] });
    const chips = container.querySelectorAll(`.${styles.tagChip}`);
    expect(chips).toHaveLength(3);
    expect(chips[2]).toHaveTextContent("\u6587\u6863");
  });

  it("renders no chip container when tags are absent", () => {
    const { container } = renderRow({});
    expect(container.querySelector(`.${styles.tagChips}`)).toBeNull();
  });

  it("renders no chip container when tags are empty", () => {
    const { container } = renderRow({ tags: [] });
    expect(container.querySelector(`.${styles.tagChips}`)).toBeNull();
  });

  it("shows the emoji when the skill declares one", () => {
    const { container } = renderRow({ emoji: "\u{1f4d8}" });
    expect(container).toHaveTextContent("\u{1f4d8}");
  });

  it("falls back to a file-type icon when there is no emoji", () => {
    const { container } = renderRow({ name: "notes.md" });
    expect(container.querySelector("[data-icon]")).not.toBeNull();
  });
});

describe("PoolSkillListItem - selection state", () => {
  it("applies the selected class when the row is selected", () => {
    const { container } = renderRow({}, { isSelected: true });
    expect(rowClasses(container)).toContain(styles.selectedListItem);
  });

  it("omits the selected class when the row is not selected", () => {
    const { container } = renderRow({}, { isSelected: false });
    expect(rowClasses(container)).not.toContain(styles.selectedListItem);
    expect(rowClasses(container)).toContain(styles.skillListItem);
  });

  it("renders no checkbox outside batch mode", () => {
    renderRow({}, { batchModeEnabled: false });
    expect(screen.queryByTestId("select-checkbox")).toBeNull();
  });

  it("renders an unchecked checkbox in batch mode when not selected", () => {
    renderRow({}, { batchModeEnabled: true, isSelected: false });
    expect(screen.getByTestId("select-checkbox")).not.toBeChecked();
  });

  it("renders a checked checkbox in batch mode when selected", () => {
    renderRow({}, { batchModeEnabled: true, isSelected: true });
    expect(screen.getByTestId("select-checkbox")).toBeChecked();
  });
});

describe("PoolSkillListItem - click routing", () => {
  it("opens the editor when the row is clicked in normal mode", () => {
    const { container, onEdit, onToggleSelect, skill } = renderRow();
    fireEvent.click(container.firstElementChild as Element);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(skill);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it("toggles selection when the row is clicked in batch mode", () => {
    const { container, onEdit, onToggleSelect, skill } = renderRow(
      {},
      { batchModeEnabled: true },
    );
    fireEvent.click(container.firstElementChild as Element);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith(skill.name);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("toggles selection from the checkbox without opening the editor", () => {
    const { onToggleSelect, onEdit } = renderRow(
      {},
      { batchModeEnabled: true },
    );
    fireEvent.click(screen.getByTestId("select-checkbox"));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("broadcasts the skill from the broadcast button", () => {
    const { onBroadcast, onEdit, skill } = renderRow();
    fireEvent.click(screen.getByText("skillPool.broadcast"));
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    expect(onBroadcast).toHaveBeenCalledWith(skill);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("deletes the skill from the danger delete button", () => {
    const { onDelete, onEdit, skill } = renderRow();
    const button = screen.getByText("skillPool.delete");
    expect(button.getAttribute("data-danger")).toBe("true");
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(skill);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("accepts an async delete handler without throwing", async () => {
    const skill = makeSkill({ name: "async-skill" });
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <PoolSkillListItem
        skill={skill}
        isSelected={false}
        batchModeEnabled={false}
        onToggleSelect={vi.fn()}
        onEdit={vi.fn()}
        onBroadcast={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("skillPool.delete"));
    await Promise.resolve();
    expect(onDelete).toHaveBeenCalledWith(skill);
  });

  it("marks the broadcast button as non-danger", () => {
    renderRow();
    expect(
      screen.getByText("skillPool.broadcast").getAttribute("data-danger"),
    ).toBe("false");
  });

  it("disables both action buttons in batch mode", () => {
    renderRow({}, { batchModeEnabled: true });
    expect(screen.getByText("skillPool.broadcast")).toBeDisabled();
    expect(screen.getByText("skillPool.delete")).toBeDisabled();
  });

  it("does not broadcast or delete from a disabled button in batch mode", () => {
    const { onBroadcast, onDelete } = renderRow({}, { batchModeEnabled: true });
    fireEvent.click(screen.getByText("skillPool.broadcast"));
    fireEvent.click(screen.getByText("skillPool.delete"));
    expect(onBroadcast).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("enables both action buttons in normal mode", () => {
    renderRow({}, { batchModeEnabled: false });
    expect(screen.getByText("skillPool.broadcast")).toBeEnabled();
    expect(screen.getByText("skillPool.delete")).toBeEnabled();
  });
});
