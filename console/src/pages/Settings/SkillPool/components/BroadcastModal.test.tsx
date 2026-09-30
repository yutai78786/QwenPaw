// @vitest-environment jsdom
/**
 * BroadcastModal tests - the user-visible contract of the dialog that pushes
 * pool skills out to one or more agent workspaces.
 *
 * What is asserted is what a user sees and what the caller receives: the two
 * pickers (pool skills, then workspaces), the labels each workspace card gets,
 * which shortcut buttons exist, when the dialog's confirm becomes usable, what
 * reopening does to a half-filled selection, and the exact pair of name lists
 * handed back to onConfirm.
 *
 * Confirm being gated on BOTH pickers is the dialog's central rule: a skill
 * selection alone, or a workspace selection alone, must leave it disabled.
 *
 * Two stubs are supplied locally instead of relying on the shared design stub:
 *
 * 1. `Modal` - the shared stub renders a pass-through div that ignores `open`,
 *    never renders the title and drops `okButtonProps`, so neither the closed
 *    state nor the disabled-confirm rule would be observable. The stub below
 *    renders nothing while closed and wires `okButtonProps.disabled` onto a real
 *    button element. jsdom, like a browser, does not dispatch click events on a
 *    disabled button, so the disabled state is asserted on the attribute.
 * 2. `Select` - rendered as a toggle button that flips the component's own
 *    `onOpenChange` and, once open, renders whatever `popupRender()` returns, so
 *    the tag filter drives the real SkillFilterDropdown -> useSkillFilter chain.
 *
 * One divergence between this dialog and its sibling is documented where it is
 * asserted (see the "select-builtin" test below); it is left as measured and is
 * recorded separately rather than silently normalised by the test.
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
    onOk,
    onCancel,
    okButtonProps,
  }: any) => {
    if (!open) return null;
    const ok = okButtonProps ?? {};
    return (
      <div data-testid="modal">
        <div data-testid="modal-title">{title}</div>
        {children}
        <button
          type="button"
          data-testid="modal-ok"
          disabled={!!ok.disabled}
          onClick={onOk}
        >
          ok
        </button>
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
  const Button = ({ children, onClick, size, type }: any) => (
    <button
      type="button"
      data-size={size}
      data-btn-type={type}
      onClick={onClick}
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

import { BroadcastModal } from "./BroadcastModal";
import type {
  PoolSkillSpec,
  WorkspaceSkillSummary,
} from "../../../../api/types";
import styles from "../../../Agent/Skills/index.module.less";

function poolSkill(
  name: string,
  source = "workspace",
  tags: string[] = [],
): PoolSkillSpec {
  return { name, source, tags };
}

const skills = [
  poolSkill("p-builtin", "builtin", ["core"]),
  poolSkill("p-prefixed", "builtin:extra", ["core"]),
  poolSkill("p-system", "system", ["tools"]),
  poolSkill("p-user", "workspace", ["tools"]),
];

const workspaces: WorkspaceSkillSummary[] = [
  { agent_id: "default", agent_name: "Default Agent", skill_names: [] },
  { agent_id: "helper", agent_name: "Helper Agent", skill_names: [] },
  { agent_id: "unnamed", skill_names: [] },
];

type ModalProps = {
  open: boolean;
  skills: PoolSkillSpec[];
  workspaces: WorkspaceSkillSummary[];
  initialSkillNames: string[];
  onCancel: () => void;
  onConfirm: (names: string[], ids: string[]) => Promise<void>;
};

function makeProps(over: Partial<ModalProps> = {}): ModalProps {
  return {
    open: true,
    skills,
    workspaces,
    initialSkillNames: [],
    onCancel: vi.fn(),
    onConfirm: vi.fn(async (_names: string[], _ids: string[]) => {}),
    ...over,
  };
}

function renderModal(over: Partial<ModalProps> = {}) {
  const props = makeProps(over);
  const utils = render(<BroadcastModal {...props} />);
  return { ...utils, props };
}

/** Every picker card in DOM order; the skill grid comes before the workspace grid. */
function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll("div")).filter((div) =>
    (div.className || "").split(/\s+/).includes(styles.pickerCard),
  );
}

function cardLabel(card: HTMLElement): string {
  return card.querySelector("[data-tooltip-title]")?.textContent ?? "";
}

function cardTooltip(card: HTMLElement): string {
  return (
    card
      .querySelector("[data-tooltip-title]")
      ?.getAttribute("data-tooltip-title") ?? ""
  );
}

function checkedCards(): HTMLElement[] {
  return cards().filter((card) => card.querySelector("[data-icon='check']"));
}

function checkedNames(): string[] {
  return checkedCards().map(cardLabel).sort();
}

function cardByLabel(label: string): HTMLElement {
  const card = cards().find((c) => cardLabel(c) === label);
  if (!card) throw new Error(`no card labelled ${label}`);
  return card;
}

function clickShortcut(label: string, occurrence = 0): void {
  const matches = screen.getAllByText(label);
  fireEvent.click(matches[occurrence].closest("button") as HTMLElement);
}

function okButton(): HTMLButtonElement {
  return screen.getByTestId("modal-ok");
}

/** Select one skill and one workspace so confirm becomes usable. */
function pickOneOfEach(): void {
  fireEvent.click(cardByLabel("p-user"));
  fireEvent.click(cardByLabel("Helper Agent"));
}

afterEach(cleanup);

describe("BroadcastModal - visibility and layout", () => {
  it("renders nothing while closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  it("shows both pickers, skills first and workspaces second", () => {
    renderModal();
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "skillPool.broadcast",
    );
    expect(cards().map(cardLabel)).toEqual([
      "p-builtin",
      "p-prefixed",
      "p-system",
      "p-user",
      "agent.defaultDisplayName",
      "Helper Agent",
      "unnamed",
    ]);
  });

  it("labels the default workspace through i18n and falls back to the id", () => {
    renderModal();
    // agent_id "default" carrying the placeholder name is localised.
    expect(cardTooltip(cardByLabel("agent.defaultDisplayName"))).toBe(
      "ID: default",
    );
    // A missing agent_name falls back to the agent id.
    expect(cardTooltip(cardByLabel("unnamed"))).toBe("ID: unnamed");
  });

  it("keeps a customised default agent name instead of localising it", () => {
    renderModal({
      workspaces: [
        { agent_id: "default", agent_name: "My Main Agent", skill_names: [] },
      ],
    });
    expect(
      cards()
        .filter((card) => cardTooltip(card).startsWith("ID:"))
        .map(cardLabel),
    ).toEqual(["My Main Agent"]);
  });

  it("exposes the agent id in each workspace card tooltip", () => {
    renderModal();
    expect(cardTooltip(cardByLabel("Helper Agent"))).toBe("ID: helper");
    expect(cardTooltip(cardByLabel("unnamed"))).toBe("ID: unnamed");
  });
});

describe("BroadcastModal - confirm gating", () => {
  it("stays disabled with nothing selected", () => {
    renderModal();
    expect(okButton().disabled).toBe(true);
  });

  it("stays disabled when only skills are selected", () => {
    renderModal();
    fireEvent.click(cardByLabel("p-user"));
    expect(checkedNames()).toEqual(["p-user"]);
    expect(okButton().disabled).toBe(true);
  });

  it("stays disabled when only workspaces are selected", () => {
    renderModal();
    fireEvent.click(cardByLabel("Helper Agent"));
    expect(okButton().disabled).toBe(true);
  });

  it("becomes usable once both a skill and a workspace are selected", () => {
    renderModal();
    pickOneOfEach();
    expect(okButton().disabled).toBe(false);
  });

  it("drops a skill from the selection when its card is clicked again", () => {
    renderModal();
    fireEvent.click(cardByLabel("p-system"));
    fireEvent.click(cardByLabel("p-user"));
    expect(checkedNames()).toEqual(["p-system", "p-user"]);
    fireEvent.click(cardByLabel("p-system"));
    expect(checkedNames()).toEqual(["p-user"]);
    expect(
      cardByLabel("p-system").querySelector("[data-icon='check']"),
    ).toBeNull();
  });

  it("goes back to disabled when the workspace selection is dropped", () => {
    renderModal();
    pickOneOfEach();
    expect(okButton().disabled).toBe(false);
    fireEvent.click(cardByLabel("Helper Agent"));
    expect(okButton().disabled).toBe(true);
  });
});

describe("BroadcastModal - selection shortcuts", () => {
  it("select-all picks every listed pool skill", () => {
    renderModal();
    clickShortcut("agent.selectAll");
    expect(checkedNames()).toEqual([
      "p-builtin",
      "p-prefixed",
      "p-system",
      "p-user",
    ]);
  });

  it("all-workspaces picks every workspace and clear empties it", () => {
    renderModal();
    const checkedWorkspaces = () =>
      cards()
        .filter((card) => cardTooltip(card).startsWith("ID:"))
        .filter((card) => card.querySelector("[data-icon='check']"))
        .map(cardTooltip)
        .sort();

    clickShortcut("skillPool.allWorkspaces");
    expect(checkedWorkspaces()).toEqual([
      "ID: default",
      "ID: helper",
      "ID: unnamed",
    ]);

    // The workspace picker's own clear shortcut is the second one with that label.
    clickShortcut("skills.clearSelection", 1);
    expect(checkedWorkspaces()).toEqual([]);
  });

  it("clear-selection empties the skill picker", () => {
    renderModal();
    clickShortcut("agent.selectAll");
    expect(checkedNames()).toHaveLength(4);
    clickShortcut("skills.clearSelection");
    expect(checkedNames()).toEqual([]);
    expect(okButton().disabled).toBe(true);
  });

  /**
   * Measured behaviour: this dialog treats only `source === "builtin"` as
   * builtin, while its sibling PoolTransferModal uses the shared
   * `isSkillBuiltin` helper, which also counts `builtin:`-prefixed and `system`
   * sources. Both shortcuts carry the same label, so the two dialogs answer the
   * same click differently. The assertion below pins what the product does today
   * and is deliberately not widened to the sibling's definition; whether that
   * difference is intended is recorded for the product owner rather than
   * settled here.
   */
  it("select-builtin picks only the exact builtin source", () => {
    renderModal();
    clickShortcut("agent.selectBuiltin");
    expect(checkedNames()).toEqual(["p-builtin"]);
  });

  it("narrows the skill grid to a tag picked in the filter dropdown", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("tag-select-toggle"));
    expect(screen.getByTestId("tag-select-popup").textContent).toContain(
      "core",
    );
    fireEvent.click(screen.getByText("core"));
    expect(
      cards()
        .map(cardLabel)
        .filter((label) => label.startsWith("p-")),
    ).toEqual(["p-builtin", "p-prefixed"]);
  });

  it("makes select-all reach only the filtered skills", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("tag-select-toggle"));
    fireEvent.click(screen.getByText("tools"));
    clickShortcut("agent.selectAll");
    expect(checkedNames()).toEqual(["p-system", "p-user"]);
  });

  it("shows the no-tags placeholder when no pool skill carries a tag", () => {
    renderModal({ skills: [poolSkill("p-user", "workspace")] });
    fireEvent.click(screen.getByTestId("tag-select-toggle"));
    expect(screen.getByTestId("tag-select-popup").textContent).toBe(
      "skills.noTags",
    );
  });
});

describe("BroadcastModal - what the caller receives", () => {
  it("reports the picked skill names and workspace ids on confirm", () => {
    const { props } = renderModal();
    pickOneOfEach();
    fireEvent.click(okButton());
    expect(props.onConfirm).toHaveBeenCalledWith(["p-user"], ["helper"]);
  });

  it("reports several skills and several workspaces in click order", () => {
    const { props } = renderModal();
    fireEvent.click(cardByLabel("p-system"));
    fireEvent.click(cardByLabel("p-builtin"));
    fireEvent.click(cardByLabel("unnamed"));
    fireEvent.click(cardByLabel("Helper Agent"));
    fireEvent.click(okButton());
    expect(props.onConfirm).toHaveBeenCalledWith(
      ["p-system", "p-builtin"],
      ["unnamed", "helper"],
    );
  });

  it("hands a close request to onCancel and reports nothing", () => {
    const { props } = renderModal();
    pickOneOfEach();
    fireEvent.click(screen.getByTestId("modal-close-request"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
    // Cancelling also drops the half-filled selection.
    expect(checkedNames()).toEqual([]);
  });
});

describe("BroadcastModal - reopening", () => {
  it("reseeds skills from the caller and drops the workspace choice", () => {
    const { rerender } = render(
      <BroadcastModal {...makeProps({ initialSkillNames: ["p-system"] })} />,
    );
    expect(checkedNames()).toEqual(["p-system"]);
    fireEvent.click(cardByLabel("Helper Agent"));
    expect(okButton().disabled).toBe(false);

    rerender(<BroadcastModal {...makeProps({ open: false })} />);
    expect(screen.queryByTestId("modal")).toBeNull();

    rerender(
      <BroadcastModal
        {...makeProps({ open: true, initialSkillNames: ["p-user"] })}
      />,
    );
    // The skill selection follows the caller's new starting point and the
    // workspace picker is empty again, so confirm is gated once more.
    expect(checkedNames()).toEqual(["p-user"]);
    expect(okButton().disabled).toBe(true);
  });

  it("starts empty when the caller passes no initial skills", () => {
    renderModal({ initialSkillNames: [] });
    expect(checkedNames()).toEqual([]);
    expect(okButton().disabled).toBe(true);
  });
});
