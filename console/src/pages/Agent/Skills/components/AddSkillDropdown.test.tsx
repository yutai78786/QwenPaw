// @vitest-environment jsdom
/**
 * AddSkillDropdown - the single entry point for every way of adding a skill.
 * Rendered from two places whose prop sets DIFFER, which is the reason this
 * suite pins both shapes:
 *   - `pages/Agent/Skills/components/HeaderActions.tsx:149` (imported at `:11`)
 *     passes `onFromPool` and `uploading`;
 *   - `pages/Settings/SkillPool/index.tsx:151` (imported at `:17`) passes
 *     NEITHER - the pool page is already the pool, so "load from pool" must not
 *     be offered there, and it drives the zip input itself.
 *
 * Until now this component had no suite of its own: `HeaderActions.test.tsx`
 * replaces it with a recorder (its harness notes say so verbatim), so the menu
 * wiring below was asserted only on the stub side while the component body was
 * never executed. This file is that missing coverage.
 *
 * Visible contract under test:
 *
 *   1. the trigger is a primary button labelled with the translated
 *      `skills.addSkill` key and carrying the plus icon;
 *   2. `uploading` drives BOTH the trigger's loading flag and the zip entry's
 *      disabled flag, and neither while idle - one flag, two observable effects;
 *   3. the menu holds five clickable entries in a FIXED order (create /
 *      from-pool / upload-zip / from-url / market), each labelled with its own
 *      i18n key and its own icon, and each wired to the right callback. The
 *      three names cross over (`onFromPool` -> download-from-pool label,
 *      `onUploadZip` -> upload-via-zip, `onFromUrl` -> import-hub), so asserting
 *      labels alone would let a swap through;
 *   4. omitting `onFromPool` removes that entry ENTIRELY (the menu drops from
 *      five entries to four) rather than rendering it disabled - the pool page
 *      must not show a dead button;
 *   5. a divider sits between the last import entry and the market entry, so the
 *      market is visually separated from the ways of bringing a skill in;
 *   6. the dropdown opens to `bottomRight`, matching the header layout it lives
 *      in;
 *   7. every label comes from i18n, including the market entry which lives in a
 *      DIFFERENT namespace (`market.browseMarket`) than the other four
 *      (`skills.*`) - pinned because a namespace typo would render a raw key.
 *
 * Harness notes (measured facts):
 *
 * - the shared design stub renders `Dropdown` as a pass-through div, so the
 *   `menu` prop arrives in the DOM as the string "[object Object]" and NO entry
 *   is ever rendered (probe: `src/__probe_b94b.test.tsx`, output
 *   `/tmp/b94_probe2.txt`). It also drops `loading` on the trigger button
 *   (probe: the `loading` attribute reads back null). Both `Dropdown` and
 *   `Button` are therefore replaced by a local factory that renders the menu it
 *   was handed as real buttons and reports the props the trigger received.
 *   `src/test/design-mock.ts` is untouched.
 * - the menu factory renders each entry as a button carrying `data-key`, and the
 *   divider as an element carrying `data-divider`, so order and position are
 *   readable from the DOM instead of being inferred from a captured object.
 * - antd icons are NOT aliased away in `vite.config.ts` (only
 *   `@agentscope-ai/icons` is), so they render for real. Probe output gives the
 *   icon names asserted below: `plus` / `download` / `upload` / `import` /
 *   `appstore`, each as `role="img"` with `aria-label` equal to that name.
 * - `t` returns the key verbatim, so assertions pin the i18n key the product
 *   asks for. Keys checked present in `src/locales/en.json`: `skills.addSkill`
 *   ("Add Skill"), `skills.createSkill`, `skills.downloadFromPool`,
 *   `skills.uploadZip`, `skills.importHub`, `market.browseMarket`.
 * - entries are located by `data-key` and the trigger by its stub marker, because
 *   the antd icon inside each button contributes its own `aria-label` to the
 *   computed accessible name (probe `/tmp/b94_probe3.txt`: a bare-label lookup
 *   finds 0 buttons, an "<icon> <label>" lookup finds exactly 1). The computed
 *   names are still pinned, in the accessibility describe block.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string, options?: Record<string, unknown>) => {
    h.tCalls.push([key, options ?? null]);
    return key;
  },
  stableI18n: { language: "en" },
  tCalls: [] as Array<[string, Record<string, unknown> | null]>,
  triggerProps: null as Record<string, unknown> | null,
  dropdownProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("@agentscope-ai/design", () => {
  const React = require("react") as typeof import("react");

  const Dropdown = (props: Record<string, unknown>) => {
    h.dropdownProps = props;
    const menu = (props.menu ?? {}) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = menu.items ?? [];
    return React.createElement(
      "div",
      { "data-stub": "dropdown", "data-placement": props.placement ?? null },
      React.createElement(
        "ul",
        { "data-stub": "menu" },
        items.map((item, index) => {
          if (item.type === "divider") {
            return React.createElement("li", {
              key: `divider-${index}`,
              "data-divider": "true",
            });
          }
          return React.createElement(
            "li",
            { key: String(item.key) },
            React.createElement(
              "button",
              {
                type: "button",
                "data-key": String(item.key),
                disabled: item.disabled === true,
                onClick: () =>
                  (item.onClick as (() => void) | undefined)?.call(null),
              },
              item.icon as never,
              item.label as never,
            ),
          );
        }),
      ),
      props.children as never,
    );
  };

  const Button = (props: Record<string, unknown>) => {
    h.triggerProps = props;
    return React.createElement(
      "button",
      {
        type: "button",
        "data-stub": "trigger",
        "data-btn-type": (props.type as string) ?? null,
        "data-loading": props.loading === true ? "true" : "false",
        onClick: props.onClick as (() => void) | undefined,
      },
      props.icon as never,
      props.children as never,
    );
  };

  return { Dropdown, Button };
});

import { AddSkillDropdown } from "./AddSkillDropdown";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    onCreate: vi.fn(),
    onUploadZip: vi.fn(),
    onFromUrl: vi.fn(),
    onBrowseMarket: vi.fn(),
    ...overrides,
  };
}

type Props = ReturnType<typeof makeProps>;

function renderDropdown(overrides: Record<string, unknown> = {}) {
  const props = makeProps(overrides);
  const utils = render(<AddSkillDropdown {...(props as Props)} />);
  return { ...props, ...utils };
}

/**
 * The trigger button. It is located by the stub marker rather than by its
 * accessible name: the antd icon inside contributes its own aria-label to the
 * computed name (probe: `/tmp/b94_probe3.txt`, `PROBE_NAME_ONLY 0` for the bare
 * label and `PROBE_NAME_ICON_PREFIX 1` for "plus skills.addSkill"), so a
 * name-only lookup depends on the icon package internals. That name is still
 * asserted below, in the accessibility case.
 */
const trigger = () => {
  const el = document.querySelector<HTMLButtonElement>('[data-stub="trigger"]');
  if (!el) throw new Error("trigger button was not rendered");
  return el;
};

/** One menu entry by its product-assigned key. */
function entryOf(key: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
  if (!el) throw new Error(`no menu entry with key ${key}`);
  return el;
}

/** The menu entries in DOM order, as [key, element] pairs. */
function entries(): Array<[string, HTMLButtonElement]> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-key]"),
  ).map((el) => [el.getAttribute("data-key") ?? "", el]);
}

/** The rendered menu as a key sequence, with the divider shown as "|". */
function menuShape(): string[] {
  const menu = document.querySelector('[data-stub="menu"]');
  if (!menu) throw new Error("menu was not rendered");
  return Array.from(menu.children).map((child) =>
    child.hasAttribute("data-divider")
      ? "|"
      : child.querySelector("[data-key]")?.getAttribute("data-key") ?? "?",
  );
}

/** The antd icon name rendered inside an element, or null when there is none. */
function iconNameOf(el: Element | null): string | null {
  const img = el?.querySelector('[role="img"]');
  return img?.getAttribute("aria-label") ?? null;
}

beforeEach(() => {
  h.tCalls.length = 0;
  h.triggerProps = null;
  h.dropdownProps = null;
});

afterEach(() => {
  cleanup();
});

describe("AddSkillDropdown trigger", () => {
  it("renders a primary trigger labelled with the translated add-skill key", () => {
    renderDropdown();
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger().getAttribute("data-btn-type")).toBe("primary");
    expect(trigger().textContent).toContain("skills.addSkill");
  });

  it("puts the plus icon on the trigger", () => {
    renderDropdown();
    expect(iconNameOf(trigger())).toBe("plus");
  });

  it("reports loading on the trigger while uploading and not while idle", () => {
    renderDropdown({ uploading: true });
    expect(trigger().getAttribute("data-loading")).toBe("true");
    expect(h.triggerProps?.loading).toBe(true);
    cleanup();

    renderDropdown({ uploading: false });
    expect(trigger().getAttribute("data-loading")).toBe("false");
    expect(h.triggerProps?.loading).toBe(false);
  });

  it("treats an omitted uploading prop as not loading", () => {
    renderDropdown();
    expect(trigger().getAttribute("data-loading")).toBe("false");
    expect(h.triggerProps?.loading).toBeUndefined();
  });
});

describe("AddSkillDropdown menu shape", () => {
  it("lists the five entries in a fixed order with the divider before market", () => {
    renderDropdown({ onFromPool: vi.fn() });
    expect(menuShape()).toEqual([
      "create",
      "from-pool",
      "upload-zip",
      "from-url",
      "|",
      "market",
    ]);
  });

  it("drops the from-pool entry entirely when the caller omits onFromPool", () => {
    renderDropdown();
    expect(menuShape()).toEqual([
      "create",
      "upload-zip",
      "from-url",
      "|",
      "market",
    ]);
    expect(document.querySelector('[data-key="from-pool"]')).toBeNull();
  });

  it("never renders from-pool as a disabled leftover when it is omitted", () => {
    renderDropdown();
    const keys = entries().map(([key]) => key);
    expect(keys).not.toContain("from-pool");
    expect(keys.length).toBe(4);
  });

  it("renders exactly one divider, between from-url and market", () => {
    renderDropdown({ onFromPool: vi.fn() });
    const dividers = document.querySelectorAll("[data-divider]");
    expect(dividers.length).toBe(1);
    const shape = menuShape();
    expect(shape[shape.indexOf("|") - 1]).toBe("from-url");
    expect(shape[shape.indexOf("|") + 1]).toBe("market");
  });

  it("opens the dropdown to bottomRight", () => {
    renderDropdown();
    expect(
      document
        .querySelector('[data-stub="dropdown"]')
        ?.getAttribute("data-placement"),
    ).toBe("bottomRight");
    const menu = (h.dropdownProps?.menu ?? {}) as { items?: unknown[] };
    expect(Array.isArray(menu.items)).toBe(true);
  });
});

describe("AddSkillDropdown entry wiring", () => {
  it("fires onCreate from the create entry", () => {
    const { onCreate } = renderDropdown({ onFromPool: vi.fn() });
    fireEvent.click(entryOf("create"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("fires onFromPool from the entry labelled download-from-pool", () => {
    const onFromPool = vi.fn();
    renderDropdown({ onFromPool });
    fireEvent.click(entryOf("from-pool"));
    expect(onFromPool).toHaveBeenCalledTimes(1);
  });

  it("fires onUploadZip from the entry labelled upload-via-zip", () => {
    const { onUploadZip } = renderDropdown({ onFromPool: vi.fn() });
    fireEvent.click(entryOf("upload-zip"));
    expect(onUploadZip).toHaveBeenCalledTimes(1);
  });

  it("fires onFromUrl from the entry labelled import-hub", () => {
    const { onFromUrl } = renderDropdown({ onFromPool: vi.fn() });
    fireEvent.click(entryOf("from-url"));
    expect(onFromUrl).toHaveBeenCalledTimes(1);
  });

  it("fires onBrowseMarket from the entry in the market namespace", () => {
    const { onBrowseMarket } = renderDropdown({ onFromPool: vi.fn() });
    fireEvent.click(entryOf("market"));
    expect(onBrowseMarket).toHaveBeenCalledTimes(1);
  });

  it("keeps every callback on its own entry, so a crossover would fail", () => {
    const onCreate = vi.fn();
    const onFromPool = vi.fn();
    const onUploadZip = vi.fn();
    const onFromUrl = vi.fn();
    const onBrowseMarket = vi.fn();
    renderDropdown({
      onCreate,
      onFromPool,
      onUploadZip,
      onFromUrl,
      onBrowseMarket,
    });

    const byKey = new Map(entries());
    fireEvent.click(byKey.get("from-url") as HTMLElement);
    fireEvent.click(byKey.get("upload-zip") as HTMLElement);

    expect(onFromUrl).toHaveBeenCalledTimes(1);
    expect(onUploadZip).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onFromPool).not.toHaveBeenCalled();
    expect(onBrowseMarket).not.toHaveBeenCalled();
  });

  it("gives each entry its own icon", () => {
    renderDropdown({ onFromPool: vi.fn() });
    const byKey = new Map(entries());
    expect(iconNameOf(byKey.get("create") ?? null)).toBe("plus");
    expect(iconNameOf(byKey.get("from-pool") ?? null)).toBe("download");
    expect(iconNameOf(byKey.get("upload-zip") ?? null)).toBe("upload");
    expect(iconNameOf(byKey.get("from-url") ?? null)).toBe("import");
    expect(iconNameOf(byKey.get("market") ?? null)).toBe("appstore");
  });
});

describe("AddSkillDropdown uploading guard", () => {
  it("disables only the zip entry while uploading", () => {
    renderDropdown({ onFromPool: vi.fn(), uploading: true });
    const byKey = new Map(entries());
    expect((byKey.get("upload-zip") as HTMLButtonElement).disabled).toBe(true);
    for (const key of ["create", "from-pool", "from-url", "market"]) {
      expect(
        (byKey.get(key) as HTMLButtonElement).disabled,
        `entry ${key}`,
      ).toBe(false);
    }
  });

  it("leaves every entry enabled while idle", () => {
    renderDropdown({ onFromPool: vi.fn(), uploading: false });
    for (const [key, el] of entries()) {
      expect(el.disabled, `entry ${key}`).toBe(false);
    }
  });

  it("treats an omitted uploading prop as enabled everywhere", () => {
    renderDropdown();
    for (const [key, el] of entries()) {
      expect(el.disabled, `entry ${key}`).toBe(false);
    }
  });

  it("blocks the zip callback while the entry is disabled", () => {
    const onUploadZip = vi.fn();
    renderDropdown({ onUploadZip, onFromPool: vi.fn(), uploading: true });
    const zip = entryOf("upload-zip");
    fireEvent.click(zip);
    expect(onUploadZip).not.toHaveBeenCalled();
  });
});

describe("AddSkillDropdown accessible names", () => {
  it("exposes the trigger under a name that includes its icon and its label", () => {
    renderDropdown();
    // Measured, not inferred: the antd icon contributes its aria-label to the
    // computed accessible name, so the name is "<icon> <label>".
    expect(
      screen.getAllByRole("button", { name: "plus skills.addSkill" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "skills.addSkill" }),
    ).toBeNull();
    expect(trigger().textContent).toContain("skills.addSkill");
  });

  it("gives each entry a distinct accessible name built from its icon and label", () => {
    renderDropdown({ onFromPool: vi.fn() });
    const expected: Array<[string, string]> = [
      ["create", "plus skills.createSkill"],
      ["from-pool", "download skills.downloadFromPool"],
      ["upload-zip", "upload skills.uploadZip"],
      ["from-url", "import skills.importHub"],
      ["market", "appstore market.browseMarket"],
    ];
    for (const [key, name] of expected) {
      expect(
        screen.getAllByRole("button", { name }),
        `entry ${key}`,
      ).toHaveLength(1);
      expect(entryOf(key).textContent).toContain(name.split(" ")[1]);
    }
  });
});

describe("AddSkillDropdown labels", () => {
  it("asks i18n for the trigger key and the four skills-namespace entry keys", () => {
    renderDropdown();
    const keys = h.tCalls.map(([key]) => key);
    expect(keys).toEqual([
      "skills.createSkill",
      "skills.uploadZip",
      "skills.importHub",
      "market.browseMarket",
      "skills.addSkill",
    ]);
  });

  it("adds the download-from-pool key only when the caller supplies onFromPool", () => {
    renderDropdown({ onFromPool: vi.fn() });
    const keys = h.tCalls.map(([key]) => key);
    expect(keys).toEqual([
      "skills.createSkill",
      "skills.downloadFromPool",
      "skills.uploadZip",
      "skills.importHub",
      "market.browseMarket",
      "skills.addSkill",
    ]);
    expect(keys.filter((k) => k === "skills.downloadFromPool").length).toBe(1);
  });

  it("passes no interpolation options for any label", () => {
    renderDropdown({ onFromPool: vi.fn() });
    for (const [key, options] of h.tCalls) {
      expect(options, `key ${key}`).toBeNull();
    }
  });
});
