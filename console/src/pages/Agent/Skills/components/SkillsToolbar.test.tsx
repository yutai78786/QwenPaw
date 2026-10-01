// @vitest-environment jsdom
/**
 * SkillsToolbar - the toolbar above the skills grid, rendered from
 * `pages/Agent/Skills/index.tsx:189` (imported at `:11`) and only mounted when
 * the page is done loading and has at least one skill.
 *
 * Visible contract under test:
 *
 *   1. the search box is controlled by `searchQuery` and reports the raw event
 *      value (no trim, no lowercasing) through `onSearchChange`;
 *   2. the tag filter forwards ALL of its state to the caller: `value` is
 *      `searchTags` untouched, `onChange` is `onTagsChange` itself (so the
 *      updater-function form a `Dispatch<SetStateAction>` accepts is preserved),
 *      `open` mirrors `filterOpen`, and `onOpenChange` is `onFilterOpenChange`;
 *   3. the popup has exactly two mutually exclusive arms, switched solely by
 *      `allTags.length > 0`: the real `SkillFilterDropdown` (which must receive
 *      the same three values it was rendered with plus the page stylesheet) or
 *      the translated "no tags" placeholder;
 *   4. the view toggle is two buttons whose active class is driven ONLY by
 *      `viewMode` - list activates the first and deactivates the second, card
 *      does the reverse - and each click reports its own literal mode, so a
 *      swapped pair of handlers is caught by the argument, not by the class;
 *   5. the two icon-only buttons carry their hints as `title` attributes with
 *      the translated keys, and their icons stay distinguishable.
 *
 * Harness notes (measured, not assumed):
 *
 * - The shared `src/test/design-mock.ts` stub does NOT export `Select` (probed:
 *   it exports IconButton / Dropdown / Button / Input / Switch / Modal / Tag /
 *   Tooltip / Form / InputNumber / Spin / Tabs), so this file overrides the
 *   design module with `importActual` - `Input` keeps its real stub behaviour
 *   (a genuine `<input>`) and only `Select` becomes a widget that hands back the
 *   props the product passed. The shared stub is untouched.
 * - `SkillFilterDropdown` is replaced with a recorder that hands the props it
 *   receives back to the test. That is the only way to assert the prop mapping
 *   in (3); it is already covered by its own rendering paths elsewhere, and
 *   `src/test/design-mock.ts` must not grow a `Select` for this file's sake.
 * - Icon classes probed: `anticon-unordered-list` and `anticon-appstore`.
 * - `t` returns the key verbatim and records its call order. Keys checked
 *   present in `src/locales/en.json`: `skills.searchPlaceholder`,
 *   `skills.filterByTag`, `skills.noTags`, `skills.listView`,
 *   `skills.gridView`.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => {
    h.tCalls.push(key);
    return key;
  },
  stableI18n: { language: "en" },
  tCalls: [] as string[],
  // Props the stubbed Select received on its most recent render.
  selectProps: null as Record<string, unknown> | null,
  // Props the stubbed SkillFilterDropdown received on its most recent render.
  dropdownProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

/**
 * Records everything the product handed to the tag filter. The widget keeps
 * `popupRender` reachable through a button so the popup arm can be rendered on
 * demand, exactly like the real one does when it opens.
 */
vi.mock("@agentscope-ai/design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agentscope-ai/design",
  );
  const Select = (props: Record<string, unknown>) => {
    h.selectProps = props;
    const [popupOpen, setPopupOpen] = React.useState(false);
    return (
      <div
        data-testid="tag-select"
        className={String(props.className ?? "")}
        data-mode={String(props.mode)}
        data-allow-clear={String(Boolean(props.allowClear))}
        data-max-tag-count={String(props.maxTagCount)}
        data-open={String(props.open)}
        data-placeholder={String(props.placeholder)}
        data-value={JSON.stringify(props.value)}
      >
        <button
          type="button"
          data-testid="tag-select-toggle"
          onClick={() =>
            (props.onOpenChange as (open: boolean) => void)?.(
              !(props.open as boolean),
            )
          }
        >
          toggle
        </button>
        <button
          type="button"
          data-testid="tag-select-render-popup"
          onClick={() => setPopupOpen((v) => !v)}
        >
          popup
        </button>
        {popupOpen ? (
          <div data-testid="tag-select-popup">
            {(props.popupRender as () => React.ReactNode)()}
          </div>
        ) : null}
        <span data-testid="tag-select-not-found">
          {props.notFoundContent as React.ReactNode}
        </span>
      </div>
    );
  };
  return { ...actual, Select };
});

/** Hands the dropdown's props back so the mapping in (3) is observable. */
vi.mock("./SkillFilterDropdown", () => ({
  SkillFilterDropdown: (props: Record<string, unknown>) => {
    h.dropdownProps = props;
    return <div data-testid="skill-filter-dropdown" />;
  },
  // The product does not use it here, but the module also exports the constant;
  // keeping it present avoids a partial-mock import error in other suites.
  TAG_PREFIX: "tag:",
}));

import { SkillsToolbar } from "./SkillsToolbar";
import styles from "../index.module.less";

type Props = React.ComponentProps<typeof SkillsToolbar>;

function propsOf(overrides: Partial<Props> = {}): Props {
  return {
    searchQuery: "",
    onSearchChange: vi.fn(),
    searchTags: [],
    onTagsChange: vi.fn(),
    allTags: [],
    filterOpen: false,
    onFilterOpenChange: vi.fn(),
    viewMode: "card",
    onViewModeChange: vi.fn(),
    ...overrides,
  } as Props;
}

function renderBar(overrides: Partial<Props> = {}) {
  const props = propsOf(overrides);
  const utils = render(<SkillsToolbar {...props} />);
  return { props, ...utils };
}

const toggleButtons = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll(`.${styles.viewToggle} button`),
  ) as HTMLElement[];

beforeEach(() => {
  h.tCalls.length = 0;
  h.selectProps = null;
  h.dropdownProps = null;
});

afterEach(() => {
  cleanup();
});

describe("SkillsToolbar search box", () => {
  it("is controlled by searchQuery and asks for the translated placeholder", () => {
    const { container } = renderBar({ searchQuery: "harvest" });
    const input = container.querySelector(`.${styles.searchInput}`)!;
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).value).toBe("harvest");
    expect(input.getAttribute("placeholder")).toBe("skills.searchPlaceholder");
  });

  it("reports the raw event value through onSearchChange", () => {
    const onSearchChange = vi.fn();
    const { container } = renderBar({
      searchQuery: "",
      onSearchChange,
      allTags: [],
    });
    fireEvent.change(container.querySelector(`.${styles.searchInput}`)!, {
      target: { value: "  Padded Name " },
    });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange.mock.calls[0][0]).toBe("  Padded Name ");
  });
});

describe("SkillsToolbar tag filter wiring", () => {
  it("hands its whole state over to the caller untouched", () => {
    const searchTags = ["tag:alpha"];
    const onTagsChange = vi.fn();
    const onFilterOpenChange = vi.fn();
    renderBar({
      searchTags,
      onTagsChange,
      filterOpen: true,
      onFilterOpenChange,
      allTags: [],
    });
    const select = h.selectProps!;
    expect(select.mode).toBe("multiple");
    expect(select.allowClear).toBe(true);
    expect(select.maxTagCount).toBe("responsive");
    expect(select.placeholder).toBe("skills.filterByTag");
    expect(select.className).toBe(styles.tagSelect);
    // Identity, not a copy: the caller's own array and its own setter.
    expect(select.value).toBe(searchTags);
    expect(select.onChange).toBe(onTagsChange);
    expect(select.open).toBe(true);
    expect(select.onOpenChange).toBe(onFilterOpenChange);
  });

  it("mirrors a closed filterOpen into the widget", () => {
    renderBar({ filterOpen: false, allTags: [] });
    expect(h.selectProps!.open).toBe(false);
  });

  it("forwards the widget's open toggle to onFilterOpenChange", () => {
    const onFilterOpenChange = vi.fn();
    const { getByTestId } = renderBar({
      filterOpen: false,
      onFilterOpenChange,
      allTags: [],
    });
    fireEvent.click(getByTestId("tag-select-toggle"));
    expect(onFilterOpenChange).toHaveBeenCalledTimes(1);
    expect(onFilterOpenChange.mock.calls[0][0]).toBe(true);
  });

  it("accepts the updater form the Dispatch setter allows", () => {
    const onTagsChange = vi.fn();
    renderBar({ searchTags: [], onTagsChange, allTags: [] });
    const updater = (prev: string[]) => [...prev, "tag:beta"];
    (h.selectProps!.onChange as (v: unknown) => void)(updater);
    expect(onTagsChange).toHaveBeenCalledTimes(1);
    expect(onTagsChange.mock.calls[0][0]).toBe(updater);
  });

  it("passes an empty notFoundContent so the widget shows no default empty text", () => {
    const { getByTestId } = renderBar({ allTags: [] });
    expect(getByTestId("tag-select-not-found").textContent).toBe("");
  });
});

describe("SkillsToolbar popup arms", () => {
  it("renders the real dropdown with the same values it was given", () => {
    const allTags = ["alpha", "beta"];
    const searchTags = ["tag:alpha"];
    const onTagsChange = vi.fn();
    const { getByTestId } = renderBar({
      allTags,
      searchTags,
      onTagsChange,
      filterOpen: false,
    });
    fireEvent.click(getByTestId("tag-select-render-popup"));
    expect(getByTestId("skill-filter-dropdown")).not.toBeNull();
    const dropdown = h.dropdownProps!;
    expect(dropdown.allTags).toBe(allTags);
    expect(dropdown.searchTags).toBe(searchTags);
    expect(dropdown.setSearchTags).toBe(onTagsChange);
    expect(dropdown.styles).toBe(styles);
  });

  it("renders the translated no-tags placeholder when allTags is empty", () => {
    const { getByTestId, queryByTestId } = renderBar({ allTags: [] });
    fireEvent.click(getByTestId("tag-select-render-popup"));
    expect(queryByTestId("skill-filter-dropdown")).toBeNull();
    expect(getByTestId("tag-select-popup").textContent).toBe("skills.noTags");
  });

  it("switches to the dropdown as soon as one tag appears", () => {
    const { getByTestId, queryByTestId } = renderBar({ allTags: ["only"] });
    fireEvent.click(getByTestId("tag-select-render-popup"));
    expect(queryByTestId("skill-filter-dropdown")).not.toBeNull();
    expect(getByTestId("tag-select-popup").textContent).toBe("");
  });
});

describe("SkillsToolbar view toggle", () => {
  it("marks only the list button active in list mode", () => {
    const { container } = renderBar({ viewMode: "list" });
    const [list, card] = toggleButtons(container);
    expect(list.className).toContain(styles.viewToggleBtnActive);
    expect(card.className).not.toContain(styles.viewToggleBtnActive);
    expect(list.className).toContain(styles.viewToggleBtn);
  });

  it("marks only the card button active in card mode", () => {
    const { container } = renderBar({ viewMode: "card" });
    const [list, card] = toggleButtons(container);
    expect(card.className).toContain(styles.viewToggleBtnActive);
    expect(list.className).not.toContain(styles.viewToggleBtnActive);
  });

  it("reports its own literal mode from each button", () => {
    const onViewModeChange = vi.fn();
    const { container } = renderBar({ viewMode: "card", onViewModeChange });
    const [list, card] = toggleButtons(container);
    fireEvent.click(list);
    expect(onViewModeChange.mock.calls[0][0]).toBe("list");
    fireEvent.click(card);
    expect(onViewModeChange.mock.calls[1][0]).toBe("card");
    expect(onViewModeChange).toHaveBeenCalledTimes(2);
  });

  it("does not report a mode on its own", () => {
    const onViewModeChange = vi.fn();
    renderBar({ viewMode: "list", onViewModeChange });
    expect(onViewModeChange).not.toHaveBeenCalled();
  });

  it("keeps the two buttons distinguishable by icon and by title", () => {
    const { container } = renderBar({ viewMode: "card" });
    const [list, card] = toggleButtons(container);
    expect(list.title).toBe("skills.listView");
    expect(card.title).toBe("skills.gridView");
    expect(list.querySelector(".anticon-unordered-list")).not.toBeNull();
    expect(card.querySelector(".anticon-appstore")).not.toBeNull();
  });
});

describe("SkillsToolbar layout", () => {
  it("keeps the search pair and the toggle in their own containers", () => {
    const { container } = renderBar({ allTags: [] });
    const search = container.querySelector(`.${styles.searchContainer}`)!;
    expect(search.querySelectorAll("input")).toHaveLength(1);
    expect(search.querySelector(`.${styles.tagSelect}`)).not.toBeNull();
    const right = container.querySelector(`.${styles.toolbarRight}`)!;
    expect(right.querySelectorAll(`.${styles.viewToggle} button`)).toHaveLength(
      2,
    );
    expect(container.querySelector(`.${styles.toolbar}`)).not.toBeNull();
  });

  // Four labels, not five: `skills.noTags` is only asked for inside the empty
  // popup arm, which this render never opens (see the popup suite above).
  it("asks for its four labels in DOM order", () => {
    renderBar({ allTags: [] });
    expect(h.tCalls).toEqual([
      "skills.searchPlaceholder",
      "skills.filterByTag",
      "skills.listView",
      "skills.gridView",
    ]);
  });
});
