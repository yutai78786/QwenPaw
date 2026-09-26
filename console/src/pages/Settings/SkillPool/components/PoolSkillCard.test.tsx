// @vitest-environment jsdom
/**
 * PoolSkillCard tests - the skill pool card's user-visible contract.
 *
 * What is covered and why it is covered this way:
 *
 * 1. The shared design stub (src/test/design-mock.ts) exports neither `Card`
 *    nor `Checkbox`, both of which this component imports. Importing them
 *    from the shared stub would yield `undefined` and React would refuse to
 *    render, so this suite supplies its own `vi.mock` factory. The shared
 *    stub is deliberately left untouched: other suites depend on it.
 * 2. The stub `Button` drops unknown props, so the factory here maps the
 *    props this card actually passes (`danger`, `loading`) onto `data-*`
 *    attributes. That keeps React from warning about unknown DOM attributes
 *    and lets the assertions read them back.
 * 3. The component calls `dayjs(...).fromNow()` but does not register the
 *    `relativeTime` plugin itself - the application entry does it globally
 *    (src/App.tsx calls `dayjs.extend(relativeTime)`) and this card is only
 *    reachable through the lazily loaded settings route. The plugin is
 *    therefore registered here, matching what the repository already does in
 *    src/pages/Agent/Skills/components/SkillCard.test.tsx. This is not a
 *    product finding: at runtime the plugin is always present.
 * 4. The relative timestamp is asserted by recomputing it in the test with
 *    the same fixture constant, not by pinning a literal such as
 *    "25 days ago". The literal depends on the runtime clock and locale. The
 *    fixture is deliberately ~25 days old so the day-granularity output
 *    cannot flip between the two calls.
 * 5. The mobile layout is driven by a `matchMedia` listener that the shared
 *    setup replaces with an inert `vi.fn()` whose `addEventListener` records
 *    nothing, so the shared stub can never fire a change event. This suite
 *    installs its own double that keeps a real listener list. Both paths are
 *    covered: `matches` already true at mount, and a change event after
 *    mount. The listener removal on unmount is asserted too, because a leak
 *    there is silent in the UI.
 * 6. Footer visibility has three independent triggers (`isHover`,
 *    `batchModeEnabled`, `isMobile`) OR-ed together. Each one is exercised on
 *    its own plus the all-false case, because a regression in any single
 *    trigger still leaves the footer reachable through the others and the UI
 *    would look fine.
 * 7. jsdom dispatches click events on `disabled` buttons and lets them bubble
 *    to the card, real browsers do not. Measured here: clicking the three
 *    disabled footer buttons in batch mode made the card's own click handler
 *    run. That count is a jsdom artifact, so this suite asserts only that the
 *    disabled buttons do not invoke their own handlers, and never asserts
 *    anything about bubbling from a disabled control.
 * 8. The automation button carries `aria-pressed` with three distinct shapes
 *    (`"mixed"`, `"true"`, `"false"`) because React serialises the boolean
 *    forms to strings. The assertions compare the attribute strings, which is
 *    what an assistive-technology consumer reads.
 * 9. Class assertions go through the imported CSS module object rather than
 *    literal hashed names, so a rename in the stylesheet breaks the test at
 *    compile time instead of silently passing.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

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
    FileExcelFilled: make("FileExcelFilled"),
    FileImageFilled: make("FileImageFilled"),
    FilePdfFilled: make("FilePdfFilled"),
    FilePptFilled: make("FilePptFilled"),
    FileTextFilled: make("FileTextFilled"),
    FileWordFilled: make("FileWordFilled"),
    FileZipFilled: make("FileZipFilled"),
    SyncOutlined: make("SyncOutlined"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Button = ({
    children,
    onClick,
    icon,
    danger,
    loading,
    disabled,
    ...rest
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-danger={danger ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
  const Card = ({
    children,
    onClick,
    onMouseEnter,
    onMouseLeave,
    className,
    style,
  }: any) => (
    <div
      data-testid="pool-card"
      className={className}
      style={style}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
  const Checkbox = ({ checked, onClick }: any) => (
    <input
      type="checkbox"
      data-testid="pool-checkbox"
      checked={!!checked}
      readOnly
      onClick={onClick}
    />
  );
  const Tooltip = ({ children, title }: any) => (
    <div data-tooltip-title={title}>{children}</div>
  );
  return { Button, Card, Checkbox, Tooltip };
});

import { PoolSkillCard } from "./PoolSkillCard";
import styles from "../index.module.less";
import type { PoolSkillSpec } from "../../../../api/types";

/** ~25 days before 2026-09-26, day granularity, stable across both calls. */
const LAST_UPDATED = "2026-09-01T10:00:00Z";

const makeSkill = (over: Partial<PoolSkillSpec> = {}): PoolSkillSpec => ({
  name: "alpha-skill",
  description: "does things",
  source: "builtin",
  sync_status: "synced",
  tags: ["t1", "t2"],
  version_text: "1.2.3",
  last_updated: LAST_UPDATED,
  emoji: "\u{1F9EA}",
  auto_sync: true,
  auto_update: true,
  ...over,
});

type Handlers = {
  onToggleSelect: ReturnType<typeof vi.fn<(name: string) => void>>;
  onEdit: ReturnType<typeof vi.fn<(skill: PoolSkillSpec) => void>>;
  onBroadcast: ReturnType<typeof vi.fn<(skill: PoolSkillSpec) => void>>;
  onDelete: ReturnType<typeof vi.fn<(skill: PoolSkillSpec) => void>>;
  onAutomationQuickAction: ReturnType<
    typeof vi.fn<(skill: PoolSkillSpec) => void | Promise<void>>
  >;
};

const makeHandlers = (): Handlers => ({
  onToggleSelect: vi.fn<(name: string) => void>(),
  onEdit: vi.fn<(skill: PoolSkillSpec) => void>(),
  onBroadcast: vi.fn<(skill: PoolSkillSpec) => void>(),
  onDelete: vi.fn<(skill: PoolSkillSpec) => void>(),
  onAutomationQuickAction:
    vi.fn<(skill: PoolSkillSpec) => void | Promise<void>>(),
});

/**
 * matchMedia double that keeps a real listener list, so the component's
 * mobile branch can be driven by a change event. The shared setup stub
 * records nothing and can never fire.
 */
const installMatchMedia = (matches: boolean) => {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(
    (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (
        _type: string,
        cb: (e: { matches: boolean }) => void,
      ) => listeners.push(cb),
      removeEventListener: (
        _type: string,
        cb: (e: { matches: boolean }) => void,
      ) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    }),
  );
  return listeners;
};

const card = () => screen.getByTestId("pool-card");
const footer = () => document.querySelector(`.${styles.cardFooter}`);
const checkbox = () => screen.queryByTestId("pool-checkbox");

const automationButton = () => {
  const node = footer()?.querySelector(`.${styles.automationButton}`);
  return node as HTMLButtonElement | null;
};

const footerButtonByText = (key: string) => {
  const nodes = Array.from(footer()?.querySelectorAll("button") ?? []);
  return (nodes.find((n) => n.textContent === key) ??
    null) as HTMLButtonElement | null;
};

const renderCard = (
  skill: PoolSkillSpec,
  props: {
    isSelected?: boolean;
    batchModeEnabled?: boolean;
    automationPending?: boolean;
  } = {},
  handlers: Handlers = makeHandlers(),
) => {
  const utils = render(
    <PoolSkillCard
      skill={skill}
      isSelected={props.isSelected ?? false}
      batchModeEnabled={props.batchModeEnabled ?? false}
      {...(props.automationPending === undefined
        ? {}
        : { automationPending: props.automationPending })}
      {...handlers}
    />,
  );
  return { ...utils, handlers };
};

/** Opens the footer through the hover trigger, which the desktop layout uses. */
const hover = () => fireEvent.mouseEnter(card());

beforeEach(() => {
  // Default to the desktop viewport. The mobile cases install their own
  // double with `matches: true` after this one runs.
  installMatchMedia(false);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PoolSkillCard sync status badge", () => {
  it("maps synced to the up-to-date label and the synced tone class", () => {
    renderCard(makeSkill({ sync_status: "synced" }));
    const badge = document.querySelector(`.${styles.statusBadge}`);
    expect(badge?.textContent).toBe("skillPool.statusUpToDate");
    expect(badge?.className).toContain(styles.status_synced);
    expect(badge?.className).not.toContain(styles.status_outdated);
    expect(badge?.querySelector(`.${styles.statusDot}`)).not.toBeNull();
  });

  it("maps outdated to the outdated label and tone", () => {
    renderCard(makeSkill({ sync_status: "outdated" }));
    const badge = document.querySelector(`.${styles.statusBadge}`);
    expect(badge?.textContent).toBe("skillPool.statusOutdated");
    expect(badge?.className).toContain(styles.status_outdated);
  });

  it("maps not_synced to the not-synced label with the neutral tone", () => {
    renderCard(makeSkill({ sync_status: "not_synced" }));
    const badge = document.querySelector(`.${styles.statusBadge}`);
    expect(badge?.textContent).toBe("skillPool.statusNotSynced");
    expect(badge?.className).toContain(styles.status_neutral);
  });

  it("maps conflict to the conflict label with the neutral tone", () => {
    renderCard(makeSkill({ sync_status: "conflict" }));
    const badge = document.querySelector(`.${styles.statusBadge}`);
    expect(badge?.textContent).toBe("skillPool.statusConflict");
    expect(badge?.className).toContain(styles.status_neutral);
  });

  it("falls back to a dash label when sync_status is absent", () => {
    renderCard(makeSkill({ sync_status: undefined }));
    const badge = document.querySelector(`.${styles.statusBadge}`);
    expect(badge?.textContent).toBe("-");
    expect(badge?.className).toContain(styles.status_neutral);
  });

  it("renders the badge in the top-right slot next to the icon", () => {
    renderCard(makeSkill());
    const right = document.querySelector(`.${styles.cardTopRight}`);
    expect(right).not.toBeNull();
    expect(right?.querySelector(`.${styles.statusBadge}`)).not.toBeNull();
    expect(
      document
        .querySelector(`.${styles.cardTopRow}`)
        ?.querySelector(`.${styles.fileIcon}`),
    ).not.toBeNull();
  });
});

describe("PoolSkillCard source tag", () => {
  it("labels a builtin source", () => {
    renderCard(makeSkill({ source: "builtin" }));
    expect(document.querySelector(`.${styles.builtinTag}`)?.textContent).toBe(
      "skillPool.builtin",
    );
    expect(document.querySelector(`.${styles.customTag}`)).toBeNull();
  });

  it("labels a builtin: prefixed source as builtin too", () => {
    renderCard(makeSkill({ source: "builtin:core" }));
    expect(document.querySelector(`.${styles.builtinTag}`)).not.toBeNull();
    expect(document.querySelector(`.${styles.customTag}`)).toBeNull();
  });

  it("labels a system source as builtin", () => {
    renderCard(makeSkill({ source: "system" }));
    expect(document.querySelector(`.${styles.builtinTag}`)).not.toBeNull();
  });

  it("labels a custom source", () => {
    renderCard(makeSkill({ source: "custom" }));
    expect(document.querySelector(`.${styles.customTag}`)?.textContent).toBe(
      "skillPool.custom",
    );
    expect(document.querySelector(`.${styles.builtinTag}`)).toBeNull();
  });

  it("keeps the name and the tags inside one title row", () => {
    renderCard(makeSkill({ name: "alpha-skill" }));
    const title = document.querySelector(`.${styles.skillTitle}`);
    expect(title?.textContent).toContain("alpha-skill");
    expect(title?.textContent).toContain("skillPool.builtin");
    expect(document.querySelector(`.${styles.titleRow}`)).not.toBeNull();
  });

  it("exposes the full name as a tooltip on the title row", () => {
    renderCard(makeSkill({ name: "alpha-skill" }));
    const titles = Array.from(
      document.querySelectorAll("[data-tooltip-title]"),
    ).map((n) => n.getAttribute("data-tooltip-title"));
    expect(titles).toContain("alpha-skill");
  });
});

describe("PoolSkillCard automation tag", () => {
  it("shows the auto-sync tag for a custom skill with auto_sync on", () => {
    renderCard(makeSkill({ source: "custom", auto_sync: true }));
    expect(
      document.querySelector(`.${styles.automationTag}`)?.textContent,
    ).toBe("skillPool.autoSync");
    const titles = Array.from(
      document.querySelectorAll("[data-tooltip-title]"),
    ).map((n) => n.getAttribute("data-tooltip-title"));
    expect(titles).toContain("skillPool.autoSyncFlow");
  });

  it("hides the tag for a custom skill with auto_sync off", () => {
    renderCard(makeSkill({ source: "custom", auto_sync: false }));
    expect(document.querySelector(`.${styles.automationTag}`)).toBeNull();
  });

  it("shows both-automations for a builtin with sync and update on", () => {
    renderCard(makeSkill({ auto_sync: true, auto_update: true }));
    expect(
      document.querySelector(`.${styles.automationTag}`)?.textContent,
    ).toBe("skillPool.automationBoth");
    const titles = Array.from(
      document.querySelectorAll("[data-tooltip-title]"),
    ).map((n) => n.getAttribute("data-tooltip-title"));
    expect(titles).toContain(
      "skillPool.builtinAutoUpdateFlow; skillPool.autoSyncFlow",
    );
  });

  it("shows the auto-sync tag for a builtin mixed with only sync on", () => {
    renderCard(makeSkill({ auto_sync: true, auto_update: false }));
    expect(
      document.querySelector(`.${styles.automationTag}`)?.textContent,
    ).toBe("skillPool.autoSync");
    const titles = Array.from(
      document.querySelectorAll("[data-tooltip-title]"),
    ).map((n) => n.getAttribute("data-tooltip-title"));
    expect(titles).toContain("skillPool.autoSyncFlow");
  });

  it("shows the auto-update tag for a builtin mixed with only update on", () => {
    renderCard(makeSkill({ auto_sync: false, auto_update: true }));
    expect(
      document.querySelector(`.${styles.automationTag}`)?.textContent,
    ).toBe("skillPool.builtinAutoUpdate");
    const titles = Array.from(
      document.querySelectorAll("[data-tooltip-title]"),
    ).map((n) => n.getAttribute("data-tooltip-title"));
    expect(titles).toContain("skillPool.builtinAutoUpdateFlow");
  });

  it("hides the tag for a builtin with both automations off", () => {
    renderCard(makeSkill({ auto_sync: false, auto_update: false }));
    expect(document.querySelector(`.${styles.automationTag}`)).toBeNull();
  });
});

describe("PoolSkillCard automation quick action button", () => {
  it("reads as mixed and stays default-styled for a builtin mixed state", () => {
    renderCard(makeSkill({ auto_sync: true, auto_update: false }));
    hover();
    const btn = automationButton();
    expect(btn?.getAttribute("aria-pressed")).toBe("mixed");
    expect(btn?.getAttribute("aria-label")).toBe(
      "skillPool.automationMixedHint",
    );
    expect(btn?.getAttribute("type")).toBe("default");
    expect(btn?.className).toContain(styles.automationMixedButton);
  });

  it("reads as pressed and primary for the both-automations state", () => {
    renderCard(makeSkill({ auto_sync: true, auto_update: true }));
    hover();
    const btn = automationButton();
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.getAttribute("aria-label")).toBe(
      "skillPool.automationDisableHint",
    );
    expect(btn?.getAttribute("type")).toBe("primary");
    expect(btn?.className).not.toContain(styles.automationMixedButton);
  });

  it("reads as unpressed for a builtin with both automations off", () => {
    renderCard(makeSkill({ auto_sync: false, auto_update: false }));
    hover();
    const btn = automationButton();
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
    expect(btn?.getAttribute("aria-label")).toBe(
      "skillPool.automationEnableHint",
    );
    expect(btn?.getAttribute("type")).toBe("default");
  });

  it("reads as pressed and offers to disable for a custom auto_sync skill", () => {
    renderCard(makeSkill({ source: "custom", auto_sync: true }));
    hover();
    const btn = automationButton();
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.getAttribute("aria-label")).toBe(
      "skillPool.autoSyncDisableHint",
    );
    expect(btn?.getAttribute("type")).toBe("primary");
  });

  it("reads as unpressed and offers to enable for a custom skill", () => {
    renderCard(makeSkill({ source: "custom", auto_sync: false }));
    hover();
    const btn = automationButton();
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
    expect(btn?.getAttribute("aria-label")).toBe(
      "skillPool.autoSyncEnableHint",
    );
  });

  it("is not loading and not disabled by default", () => {
    renderCard(makeSkill());
    hover();
    const btn = automationButton();
    expect(btn?.dataset.loading).toBe("false");
    expect(btn?.disabled).toBe(false);
  });

  it("passes the pending flag through as loading and disables itself", () => {
    renderCard(makeSkill(), { automationPending: true });
    hover();
    const btn = automationButton();
    expect(btn?.dataset.loading).toBe("true");
    expect(btn?.disabled).toBe(true);
  });

  it("calls the quick action with the skill and leaves the card click alone", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill);
    hover();
    fireEvent.click(automationButton()!);
    expect(handlers.onAutomationQuickAction).toHaveBeenCalledTimes(1);
    expect(handlers.onAutomationQuickAction).toHaveBeenCalledWith(skill);
    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(handlers.onToggleSelect).not.toHaveBeenCalled();
  });

  it("does not invoke the quick action while it is pending", () => {
    const { handlers } = renderCard(makeSkill(), { automationPending: true });
    hover();
    fireEvent.click(automationButton()!);
    expect(handlers.onAutomationQuickAction).not.toHaveBeenCalled();
  });

  it("does not invoke the quick action in batch mode", () => {
    const { handlers } = renderCard(makeSkill(), { batchModeEnabled: true });
    expect(automationButton()?.disabled).toBe(true);
    fireEvent.click(automationButton()!);
    expect(handlers.onAutomationQuickAction).not.toHaveBeenCalled();
  });

  it("carries a per-skill test id and a sync icon", () => {
    renderCard(makeSkill({ name: "alpha-skill" }));
    hover();
    expect(screen.queryByTestId("skill-automation-alpha-skill")).not.toBeNull();
    expect(
      automationButton()?.querySelector('[data-icon="SyncOutlined"]'),
    ).not.toBeNull();
  });
});

describe("PoolSkillCard footer visibility", () => {
  it("hides the footer on a desktop card that is not hovered", () => {
    renderCard(makeSkill());
    expect(footer()).toBeNull();
    expect(screen.queryByTestId("skill-automation-alpha-skill")).toBeNull();
  });

  it("shows the footer on hover and hides it again when the pointer leaves", () => {
    renderCard(makeSkill());
    hover();
    expect(footer()).not.toBeNull();
    fireEvent.mouseLeave(card());
    expect(footer()).toBeNull();
  });

  it("shows the footer in batch mode without any hover", () => {
    renderCard(makeSkill(), { batchModeEnabled: true });
    expect(footer()).not.toBeNull();
  });

  it("shows the footer when the viewport is already mobile at mount", () => {
    installMatchMedia(true);
    renderCard(makeSkill());
    expect(footer()).not.toBeNull();
  });

  it("shows the footer when the viewport becomes mobile after mount", () => {
    const listeners = installMatchMedia(false);
    renderCard(makeSkill());
    expect(footer()).toBeNull();
    expect(listeners).toHaveLength(1);
    act(() => {
      listeners.forEach((cb) => cb({ matches: true }));
    });
    expect(footer()).not.toBeNull();
  });

  it("hides the footer again when the viewport goes back to desktop", () => {
    const listeners = installMatchMedia(false);
    renderCard(makeSkill());
    act(() => {
      listeners.forEach((cb) => cb({ matches: true }));
    });
    expect(footer()).not.toBeNull();
    act(() => {
      listeners.forEach((cb) => cb({ matches: false }));
    });
    expect(footer()).toBeNull();
  });

  it("subscribes with the documented mobile query and unsubscribes on unmount", () => {
    const listeners = installMatchMedia(false);
    const { unmount } = renderCard(makeSkill());
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 768px)");
    expect(listeners).toHaveLength(1);
    unmount();
    expect(listeners).toHaveLength(0);
  });

  it("renders the three footer actions in a stable order", () => {
    renderCard(makeSkill());
    hover();
    const labels = Array.from(footer()!.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent,
    );
    expect(labels).toEqual([
      "skillPool.automationDisableHint",
      "skillPool.broadcast",
      "skillPool.delete",
    ]);
  });
});

describe("PoolSkillCard optional rows", () => {
  it("renders the version row when version_text is present", () => {
    renderCard(makeSkill({ version_text: "1.2.3" }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    const version = rows.find(
      (r) => r.textContent?.includes("skillPool.version"),
    );
    expect(version).toBeDefined();
    expect(
      version?.querySelector(`.${styles.metaInfoValue}`)?.textContent,
    ).toBe("1.2.3");
    expect(
      version?.querySelector(`.${styles.metaInfoLabel}`)?.textContent,
    ).toBe("skillPool.version");
  });

  it("omits the version row when version_text is empty", () => {
    renderCard(makeSkill({ version_text: "" }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    expect(rows.some((r) => r.textContent?.includes("skillPool.version"))).toBe(
      false,
    );
  });

  it("omits the version row when version_text is absent", () => {
    renderCard(makeSkill({ version_text: undefined }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    expect(rows.some((r) => r.textContent?.includes("skillPool.version"))).toBe(
      false,
    );
  });

  it("renders the last-updated row as a dayjs relative timestamp", () => {
    renderCard(makeSkill({ last_updated: LAST_UPDATED }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    const updated = rows.find(
      (r) => r.textContent?.includes("skills.lastUpdated"),
    );
    expect(updated).toBeDefined();
    const value = updated?.querySelector(`.${styles.metaInfoValue}`);
    expect(value?.textContent).toBe(dayjs(LAST_UPDATED).fromNow());
    expect(value?.textContent).not.toBe("Invalid Date");
    expect(value?.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("omits the last-updated row when the field is empty", () => {
    renderCard(makeSkill({ last_updated: "" }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    expect(
      rows.some((r) => r.textContent?.includes("skills.lastUpdated")),
    ).toBe(false);
  });

  it("omits the last-updated row when the field is absent", () => {
    renderCard(makeSkill({ last_updated: undefined }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    expect(
      rows.some((r) => r.textContent?.includes("skills.lastUpdated")),
    ).toBe(false);
  });

  it("always renders the tags row", () => {
    renderCard(makeSkill({ tags: ["t1"] }));
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    expect(rows.some((r) => r.textContent?.includes("skills.tags"))).toBe(true);
  });

  it("renders one chip per tag", () => {
    renderCard(makeSkill({ tags: ["t1", "t2", "t3"] }));
    const chips = Array.from(document.querySelectorAll(`.${styles.tagChip}`));
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.textContent)).toEqual(["t1", "t2", "t3"]);
    expect(document.querySelector(`.${styles.tagChips}`)).not.toBeNull();
  });

  it("renders a dash instead of chips for an empty tag list", () => {
    renderCard(makeSkill({ tags: [] }));
    expect(document.querySelectorAll(`.${styles.tagChip}`)).toHaveLength(0);
    expect(document.querySelector(`.${styles.tagChips}`)).toBeNull();
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    const tagsRow = rows.find((r) => r.textContent?.includes("skills.tags"));
    expect(tagsRow?.textContent).toBe("skills.tags-");
  });

  it("renders a dash instead of chips when tags are absent", () => {
    renderCard(makeSkill({ tags: undefined }));
    expect(document.querySelectorAll(`.${styles.tagChip}`)).toHaveLength(0);
    const rows = Array.from(
      document.querySelectorAll(`.${styles.metaInfoRow}`),
    );
    const tagsRow = rows.find((r) => r.textContent?.includes("skills.tags"));
    expect(tagsRow?.textContent).toBe("skills.tags-");
  });

  it("renders the description when present", () => {
    renderCard(makeSkill({ description: "does things" }));
    expect(
      document.querySelector(`.${styles.descriptionText}`)?.textContent,
    ).toBe("does things");
    expect(
      document.querySelector(`.${styles.descriptionSection}`),
    ).not.toBeNull();
  });

  it("falls back to a dash for an empty description", () => {
    renderCard(makeSkill({ description: "" }));
    expect(
      document.querySelector(`.${styles.descriptionText}`)?.textContent,
    ).toBe("-");
  });

  it("falls back to a dash when the description is absent", () => {
    renderCard(makeSkill({ description: undefined }));
    expect(
      document.querySelector(`.${styles.descriptionText}`)?.textContent,
    ).toBe("-");
  });
});

describe("PoolSkillCard visual", () => {
  it("renders the emoji inside the styled wrapper when one is given", () => {
    renderCard(makeSkill({ emoji: "\u{1F9EA}" }));
    const emoji = document.querySelector(`.${styles.skillEmoji}`);
    expect(emoji?.textContent).toBe("\u{1F9EA}");
    expect(document.querySelector(`.${styles.fileIcon}`)).not.toBeNull();
  });

  it("falls back to a file-type icon when no emoji is given", () => {
    renderCard(makeSkill({ emoji: "" }));
    expect(document.querySelector(`.${styles.skillEmoji}`)).toBeNull();
    expect(
      document
        .querySelector(`.${styles.fileIcon}`)
        ?.querySelector("[data-icon]"),
    ).not.toBeNull();
  });

  it("falls back to a file-type icon when the emoji field is absent", () => {
    renderCard(makeSkill({ emoji: undefined }));
    expect(document.querySelector(`.${styles.fileIcon}`)?.textContent).toBe("");
  });
});

describe("PoolSkillCard selection", () => {
  it("adds the selected class only when selected", () => {
    const { rerender } = renderCard(makeSkill(), { isSelected: true });
    expect(card().className).toContain(styles.skillCard);
    expect(card().className).toContain(styles.selectedCard);
    rerender(
      <PoolSkillCard
        skill={makeSkill()}
        isSelected={false}
        batchModeEnabled={false}
        {...makeHandlers()}
      />,
    );
    expect(card().className).toContain(styles.skillCard);
    expect(card().className).not.toContain(styles.selectedCard);
  });

  it("hides the checkbox outside batch mode", () => {
    renderCard(makeSkill(), { batchModeEnabled: false });
    expect(checkbox()).toBeNull();
  });

  it("shows an unchecked checkbox in batch mode when not selected", () => {
    renderCard(makeSkill(), { batchModeEnabled: true, isSelected: false });
    expect(checkbox()).not.toBeNull();
    expect((checkbox() as HTMLInputElement).checked).toBe(false);
  });

  it("shows a checked checkbox in batch mode when selected", () => {
    renderCard(makeSkill(), { batchModeEnabled: true, isSelected: true });
    expect((checkbox() as HTMLInputElement).checked).toBe(true);
  });

  it("marks the card as clickable through an inline cursor style", () => {
    renderCard(makeSkill());
    expect(card().style.cursor).toBe("pointer");
  });
});

describe("PoolSkillCard click routing", () => {
  it("opens the editor when the card is clicked outside batch mode", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill);
    fireEvent.click(card());
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onEdit).toHaveBeenCalledWith(skill);
    expect(handlers.onToggleSelect).not.toHaveBeenCalled();
  });

  it("toggles selection instead of editing when clicked in batch mode", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill, { batchModeEnabled: true });
    fireEvent.click(card());
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSelect).toHaveBeenCalledWith(skill.name);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("toggles selection from the checkbox without opening the editor", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill, { batchModeEnabled: true });
    fireEvent.click(checkbox()!);
    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSelect).toHaveBeenCalledWith(skill.name);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("broadcasts from the footer button without opening the editor", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill);
    hover();
    fireEvent.click(footerButtonByText("skillPool.broadcast")!);
    expect(handlers.onBroadcast).toHaveBeenCalledTimes(1);
    expect(handlers.onBroadcast).toHaveBeenCalledWith(skill);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("deletes from the footer button without opening the editor", () => {
    const skill = makeSkill();
    const { handlers } = renderCard(skill);
    hover();
    fireEvent.click(footerButtonByText("skillPool.delete")!);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledWith(skill);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("marks only the delete button as destructive", () => {
    renderCard(makeSkill());
    hover();
    expect(footerButtonByText("skillPool.delete")?.dataset.danger).toBe("true");
    expect(footerButtonByText("skillPool.broadcast")?.dataset.danger).toBe(
      "false",
    );
  });

  it("disables both text actions in batch mode and does not call them", () => {
    const { handlers } = renderCard(makeSkill(), { batchModeEnabled: true });
    const broadcast = footerButtonByText("skillPool.broadcast");
    const remove = footerButtonByText("skillPool.delete");
    expect(broadcast?.disabled).toBe(true);
    expect(remove?.disabled).toBe(true);
    fireEvent.click(broadcast!);
    fireEvent.click(remove!);
    expect(handlers.onBroadcast).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it("keeps both text actions enabled outside batch mode", () => {
    renderCard(makeSkill());
    hover();
    expect(footerButtonByText("skillPool.broadcast")?.disabled).toBe(false);
    expect(footerButtonByText("skillPool.delete")?.disabled).toBe(false);
  });

  it("exposes the action labels through the translation keys", () => {
    renderCard(makeSkill());
    hover();
    expect(footerButtonByText("skillPool.broadcast")?.textContent).toBe(
      "skillPool.broadcast",
    );
    expect(footerButtonByText("skillPool.delete")?.textContent).toBe(
      "skillPool.delete",
    );
  });
});
