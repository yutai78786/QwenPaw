// @vitest-environment jsdom
/**
 * PoolTransferModal tests - the user-visible contract of the dialog that moves
 * skills between the agent workspace and the shared pool.
 *
 * What is asserted is what a user sees and what the caller receives: which list
 * the dialog shows in each mode, which shortcut buttons each mode offers, how a
 * card click changes the selection, when confirm becomes usable, and the exact
 * name list handed back to onUpload / onDownload.
 *
 * Two stubs are supplied locally instead of relying on the shared design stub:
 *
 * 1. `Modal` - the shared stub renders a pass-through div that ignores `open`
 *    and never renders `footer`, so neither the closed state nor the cancel and
 *    confirm buttons would reach the DOM. The stub below renders nothing while
 *    closed, and renders title, children and footer.
 * 2. `Select` - rendered as a toggle button that flips the component's own
 *    `onOpenChange` and, once open, renders whatever `popupRender()` returns.
 *    That keeps the tag-filter path on real product code: the dropdown shown is
 *    the real `SkillFilterDropdown`, and clicking one of its tags drives the
 *    real setSearchTags -> useSkillFilter -> grid chain.
 *
 * The "select builtin" expectation is measured rather than assumed: the shared
 * `isSkillBuiltin` helper treats `builtin`, any `builtin:`-prefixed source and
 * `system` alike, so all three shapes are picked by that shortcut.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t, i18n: { language: "en" } }),
}));

vi.mock("@ant-design/icons", () => ({
  CheckOutlined: () => <span data-icon="check" />,
}));

vi.mock("@agentscope-ai/design", () => {
  const Modal = ({
    open,
    title,
    children,
    footer,
    onCancel,
    className,
  }: any) => {
    if (!open) return null;
    return (
      <div data-testid="modal" className={className}>
        <div data-testid="modal-title">{title}</div>
        {children}
        <div data-testid="modal-footer">{footer}</div>
        <button
          type="button"
          data-testid="modal-close-request"
          onClick={onCancel}
        >
          close
        </button>
      </div>
    );
  };
  const Button = ({
    children,
    onClick,
    disabled,
    size,
    type,
    className,
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-size={size}
      data-btn-type={type}
      className={className}
    >
      {children}
    </button>
  );
  const Tooltip = ({ children, title }: any) => (
    <span data-tooltip-title={title}>{children}</span>
  );
  const Select = ({ open, onOpenChange, popupRender, placeholder }: any) => (
    <div data-testid="tag-select" title={placeholder}>
      <button
        type="button"
        data-testid="tag-select-toggle"
        onClick={() => onOpenChange?.(!open)}
      >
        toggle-filter
      </button>
      {open ? (
        <div data-testid="tag-select-popup">{popupRender?.()}</div>
      ) : null}
    </div>
  );
  return { Modal, Button, Tooltip, Select };
});

import { PoolTransferModal } from "./PoolTransferModal";
import type { PoolSkillSpec, SkillSpec } from "../../../../api/types";
import styles from "../index.module.less";

type ModalProps = {
  mode: "upload" | "download" | null;
  skills: SkillSpec[];
  poolSkills: PoolSkillSpec[];
  onCancel: () => void;
  onUpload: (names: string[]) => Promise<void>;
  onDownload: (names: string[]) => Promise<void>;
};

function wsSkill(name: string, source = "workspace"): SkillSpec {
  return { name, source };
}

function poolSkill(
  name: string,
  source = "workspace",
  tags: string[] = [],
): PoolSkillSpec {
  return { name, source, tags };
}

const workspaceSkills = [wsSkill("alpha"), wsSkill("beta")];

const poolSkills = [
  poolSkill("p-builtin", "builtin", ["core"]),
  poolSkill("p-prefixed", "builtin:extra", ["core"]),
  poolSkill("p-system", "system", ["tools"]),
  poolSkill("p-user", "workspace", ["tools"]),
];

function makeProps(over: Partial<ModalProps> = {}): ModalProps {
  return {
    mode: "upload",
    skills: workspaceSkills,
    poolSkills,
    onCancel: vi.fn(),
    onUpload: vi.fn(async (_names: string[]) => {}),
    onDownload: vi.fn(async (_names: string[]) => {}),
    ...over,
  };
}

function renderModal(over: Partial<ModalProps> = {}) {
  const props = makeProps(over);
  const utils = render(<PoolTransferModal {...props} />);
  return { ...utils, props };
}

/** Every skill card the grid currently renders, in DOM order. */
function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll("div")).filter((div) =>
    (div.className || "").split(/\s+/).includes(styles.pickerCard),
  );
}

/** The skill name each card stands for, read from the tooltip title. */
function cardTitles(): string[] {
  return cards().map(
    (card) =>
      card
        .querySelector("[data-tooltip-title]")
        ?.getAttribute("data-tooltip-title") as string,
  );
}

function cardOf(name: string): HTMLElement {
  const card = cards().find(
    (c) =>
      c
        .querySelector("[data-tooltip-title]")
        ?.getAttribute("data-tooltip-title") === name,
  );
  if (!card) throw new Error(`no card rendered for ${name}`);
  return card;
}

/** Names of the cards currently carrying a check mark, sorted. */
function checkedNames(): string[] {
  return cards()
    .filter((card) => card.querySelector("[data-icon='check']"))
    .map(
      (card) =>
        card
          .querySelector("[data-tooltip-title]")
          ?.getAttribute("data-tooltip-title") as string,
    )
    .sort();
}

function clickShortcut(label: string): void {
  fireEvent.click(screen.getByText(label).closest("button") as HTMLElement);
}

function confirmButton(): HTMLButtonElement {
  return screen
    .getByText("common.confirm")
    .closest("button") as HTMLButtonElement;
}

afterEach(cleanup);

describe("PoolTransferModal - visibility, title and which list is shown", () => {
  it("renders nothing while no mode is active", () => {
    renderModal({ mode: null });
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  it("uses the upload title and lists the workspace skills in upload mode", () => {
    renderModal({ mode: "upload" });
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "skills.uploadToPool",
    );
    expect(cardTitles()).toEqual(["alpha", "beta"]);
  });

  it("uses the download title and lists the pool skills in download mode", () => {
    renderModal({ mode: "download" });
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "skills.downloadFromPool",
    );
    expect(cardTitles()).toEqual([
      "p-builtin",
      "p-prefixed",
      "p-system",
      "p-user",
    ]);
  });

  it("offers the builtin shortcut and the tag filter only in download mode", () => {
    renderModal({ mode: "upload" });
    expect(screen.queryByText("agent.selectBuiltin")).toBeNull();
    expect(screen.queryByTestId("tag-select")).toBeNull();
    expect(screen.getByText("skills.selectWorkspaceSkill")).toBeTruthy();
    cleanup();

    renderModal({ mode: "download" });
    expect(screen.getByText("agent.selectBuiltin")).toBeTruthy();
    expect(screen.getByTestId("tag-select")).toBeTruthy();
    expect(screen.getByText("skills.selectPoolItem")).toBeTruthy();
  });
});

describe("PoolTransferModal - selection", () => {
  it("keeps confirm disabled until a card is picked, then enables it", () => {
    renderModal();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(cardOf("alpha"));
    expect(confirmButton().disabled).toBe(false);
  });

  it("marks a card selected on click and unselected on the next click", () => {
    renderModal();
    expect(cardOf("alpha").querySelector("[data-icon='check']")).toBeNull();

    fireEvent.click(cardOf("alpha"));
    expect(cardOf("alpha").querySelector("[data-icon='check']")).toBeTruthy();
    expect(cardOf("alpha").className.split(/\s+/)).toContain(
      styles.pickerCardSelected,
    );
    expect(confirmButton().disabled).toBe(false);

    fireEvent.click(cardOf("alpha"));
    expect(cardOf("alpha").querySelector("[data-icon='check']")).toBeNull();
    expect(cardOf("alpha").className.split(/\s+/)).not.toContain(
      styles.pickerCardSelected,
    );
    expect(confirmButton().disabled).toBe(true);
  });

  it("select-all picks every listed card and clear empties the selection", () => {
    renderModal({ mode: "download" });
    clickShortcut("skills.selectAll");
    expect(checkedNames()).toEqual([
      "p-builtin",
      "p-prefixed",
      "p-system",
      "p-user",
    ]);
    expect(confirmButton().disabled).toBe(false);

    clickShortcut("skills.clearSelection");
    expect(checkedNames()).toEqual([]);
    expect(confirmButton().disabled).toBe(true);
  });

  it("select-builtin picks every builtin-family source and nothing else", () => {
    renderModal({ mode: "download" });
    clickShortcut("agent.selectBuiltin");
    expect(checkedNames()).toEqual(["p-builtin", "p-prefixed", "p-system"]);
  });

  it("leaves select-builtin disabled when the pool holds no builtin skill", () => {
    renderModal({
      mode: "download",
      poolSkills: [poolSkill("p-user", "workspace")],
    });
    const btn = screen
      .getByText("agent.selectBuiltin")
      .closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("narrows the listed cards to a tag picked in the filter dropdown", () => {
    renderModal({ mode: "download" });
    fireEvent.click(screen.getByTestId("tag-select-toggle"));
    // The popup is the product's own SkillFilterDropdown; its options are the
    // tags collected from the pool skills.
    expect(screen.getByTestId("tag-select-popup").textContent).toContain(
      "core",
    );
    fireEvent.click(screen.getByText("core"));
    expect(cardTitles()).toEqual(["p-builtin", "p-prefixed"]);

    // Select-all now only reaches the filtered cards.
    clickShortcut("skills.selectAll");
    expect(checkedNames()).toEqual(["p-builtin", "p-prefixed"]);
  });

  it("shows the no-tags placeholder when no pool skill carries a tag", () => {
    renderModal({
      mode: "download",
      poolSkills: [poolSkill("p-user", "workspace")],
    });
    fireEvent.click(screen.getByTestId("tag-select-toggle"));
    expect(screen.getByTestId("tag-select-popup").textContent).toBe(
      "skills.noTags",
    );
  });
});

describe("PoolTransferModal - what the caller receives", () => {
  it("reports the picked workspace skill names on upload", () => {
    const { props } = renderModal({ mode: "upload" });
    fireEvent.click(cardOf("beta"));
    fireEvent.click(confirmButton());
    expect(props.onUpload).toHaveBeenCalledWith(["beta"]);
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it("reports the picked pool skill names on download", () => {
    const { props } = renderModal({ mode: "download" });
    clickShortcut("agent.selectBuiltin");
    fireEvent.click(confirmButton());
    expect(props.onDownload).toHaveBeenCalledWith([
      "p-builtin",
      "p-prefixed",
      "p-system",
    ]);
    expect(props.onUpload).not.toHaveBeenCalled();
  });

  it("keeps the picked names in click order", () => {
    const { props } = renderModal({ mode: "download" });
    fireEvent.click(cardOf("p-user"));
    fireEvent.click(cardOf("p-builtin"));
    fireEvent.click(confirmButton());
    expect(props.onDownload).toHaveBeenCalledWith(["p-user", "p-builtin"]);
  });

  it("hands a cancel request to onCancel without reporting a selection", () => {
    const { props } = renderModal();
    clickShortcut("common.cancel");
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onUpload).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it("hands a close request to onCancel as well", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("modal-close-request"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("PoolTransferModal - reopening", () => {
  it("starts from an empty selection when it is opened again", () => {
    const { rerender } = render(
      <PoolTransferModal {...makeProps({ mode: "download" })} />,
    );
    clickShortcut("skills.selectAll");
    expect(checkedNames()).toHaveLength(4);

    rerender(<PoolTransferModal {...makeProps({ mode: null })} />);
    expect(screen.queryByTestId("modal")).toBeNull();

    rerender(<PoolTransferModal {...makeProps({ mode: "upload" })} />);
    expect(checkedNames()).toEqual([]);
    expect(confirmButton().disabled).toBe(true);
    // Upload mode lists the workspace skills, not the pool ones.
    expect(cardTitles()).toEqual(["alpha", "beta"]);
  });
});
