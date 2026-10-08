// @vitest-environment jsdom
/**
 * DetailDrawer tests - the market detail panel's user-visible contract: what it
 * renders when an item is selected versus nothing at all when it is not, the
 * fixed identity rows plus one row per stat entry, the stat value formatting
 * (number grouping, date localisation, raw fallback) and the label lookup that
 * falls back to the raw stat key, the author/version/description placeholders,
 * the source badge and icon delegation, and both footer callbacks.
 *
 * The shared design stub does not export Drawer (its export list is IconButton,
 * Dropdown, Button, Input, Switch, Modal, Tag, Tooltip, Form, InputNumber, Spin,
 * Tabs), so this suite provides one that renders nothing while closed and
 * forwards title, body, footer and onClose while open. Button is re-declared in
 * the same factory because a module mock replaces the whole module.
 *
 * SkillIcon and sourceLabel are the real implementations: they live in a file
 * that is already fully covered, and routing through them is part of what this
 * panel promises the user (a provider letter when there is no icon url).
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Button = ({ children, onClick, type }: any) => (
    <button type="button" onClick={onClick} data-btn-type={type}>
      {children}
    </button>
  );
  const Drawer = ({
    children,
    open,
    title,
    footer,
    onClose,
    width,
    placement,
  }: any) =>
    open ? (
      <div data-testid="drawer" data-width={width} data-placement={placement}>
        <div data-testid="drawer-title">{title}</div>
        <button data-testid="drawer-close" type="button" onClick={onClose}>
          close
        </button>
        <div data-testid="drawer-body">{children}</div>
        <div data-testid="drawer-footer">{footer}</div>
      </div>
    ) : null;
  return { Button, Drawer };
});

import { DetailDrawer } from "./DetailDrawer";
import type { MarketResult } from "../../../../api/modules/market";
import styles from "./DetailDrawer.module.less";

function makeItem(overrides: Partial<MarketResult> = {}): MarketResult {
  return {
    source: "qwenpaw",
    slug: "demo-skill",
    name: "Demo Skill",
    description: "A demo description",
    source_url: "https://example.com/demo",
    version: "1.2.3",
    author: "tester",
    icon_url: null,
    stats: null,
    ...overrides,
  };
}

function renderDrawer(
  item: MarketResult | null,
  callbacks: { onInstall?: () => void; onClose?: () => void } = {},
) {
  const onInstall = callbacks.onInstall ?? vi.fn();
  const onClose = callbacks.onClose ?? vi.fn();
  const utils = render(
    <DetailDrawer item={item} onInstall={onInstall} onClose={onClose} />,
  );
  return { ...utils, onInstall, onClose };
}

function rowKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(`.${styles.detailKey}`)).map(
    (n) => n.textContent ?? "",
  );
}

function rowValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(`.${styles.detailValue}`)).map(
    (n) => n.textContent ?? "",
  );
}

function valueFor(container: HTMLElement, key: string): string | undefined {
  const idx = rowKeys(container).indexOf(key);
  return idx < 0 ? undefined : rowValues(container)[idx];
}

describe("DetailDrawer - open versus closed", () => {
  it("renders nothing at all when no item is selected", () => {
    const { container } = renderDrawer(null);
    expect(container.innerHTML).toBe("");
  });

  it("renders the drawer with its title once an item is selected", () => {
    const { getByTestId } = renderDrawer(makeItem());
    expect(getByTestId("drawer-title").textContent).toBe("market.detail.title");
  });

  it("asks for a 520px right-hand drawer", () => {
    const { getByTestId } = renderDrawer(makeItem());
    const drawer = getByTestId("drawer");
    expect(drawer.getAttribute("data-width")).toBe("520");
    expect(drawer.getAttribute("data-placement")).toBe("right");
  });
});

describe("DetailDrawer - header identity block", () => {
  it("shows the skill name as the heading", () => {
    const { container } = renderDrawer(makeItem({ name: "Nightly Build" }));
    const title = container.querySelector(`.${styles.detailTitle}`);
    expect(title?.textContent).toBe("Nightly Build");
  });

  it("shows the mapped provider label in the source badge", () => {
    const { container } = renderDrawer(makeItem({ source: "modelscope" }));
    const badge = container.querySelector(`.${styles.sourceBadge}`);
    expect(badge?.textContent).toBe("ModelScope");
  });

  it("falls back to the raw source string for an unknown provider", () => {
    const { container } = renderDrawer(
      makeItem({ source: "internal-registry" }),
    );
    const badge = container.querySelector(`.${styles.sourceBadge}`);
    expect(badge?.textContent).toBe("internal-registry");
  });

  it("delegates to SkillIcon, which shows the provider letter when there is no icon url", () => {
    const { container } = renderDrawer(
      makeItem({ source: "qwenpaw", icon_url: null }),
    );
    const header = container.querySelector(`.${styles.detailHeader}`);
    expect(header?.querySelector("img")).toBeNull();
    expect(header?.textContent).toContain("Q");
  });

  it("delegates to SkillIcon, which shows the image when an icon url is present", () => {
    const { container } = renderDrawer(
      makeItem({ icon_url: "https://cdn/icon.png", name: "With Icon" }),
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn/icon.png");
    expect(img?.getAttribute("alt")).toBe("With Icon");
  });
});

describe("DetailDrawer - description", () => {
  it("shows the description when the provider supplied one", () => {
    const { container } = renderDrawer(
      makeItem({ description: "Does things" }),
    );
    const desc = container.querySelector(`.${styles.detailDescription}`);
    expect(desc?.textContent).toBe("Does things");
  });

  it("shows the placeholder when the description is null", () => {
    const { container } = renderDrawer(makeItem({ description: null }));
    const desc = container.querySelector(`.${styles.detailDescription}`);
    expect(desc?.textContent).toBe("market.noDescription");
  });
});

describe("DetailDrawer - fixed rows", () => {
  it("shows author, version, source url and slug in that order", () => {
    const { container } = renderDrawer(makeItem());
    expect(rowKeys(container)).toEqual([
      "market.detail.author",
      "market.detail.version",
      "market.detail.sourceUrl",
      "market.detail.slug",
    ]);
  });

  it("shows the author and version values as provided", () => {
    const { container } = renderDrawer(
      makeItem({ author: "alice", version: "9.9.9" }),
    );
    expect(valueFor(container, "market.detail.author")).toBe("alice");
    expect(valueFor(container, "market.detail.version")).toBe("9.9.9");
  });

  it("shows the missing placeholder for a null author", () => {
    const { container } = renderDrawer(makeItem({ author: null }));
    expect(valueFor(container, "market.detail.author")).toBe(
      "market.detail.missing",
    );
  });

  it("shows the missing placeholder for a null version", () => {
    const { container } = renderDrawer(makeItem({ version: null }));
    expect(valueFor(container, "market.detail.version")).toBe(
      "market.detail.missing",
    );
  });

  it("renders source url and slug as monospace code spans", () => {
    const { container } = renderDrawer(
      makeItem({ source_url: "https://a/b", slug: "a-b" }),
    );
    const codes = Array.from(container.querySelectorAll("code"));
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent).toBe("https://a/b");
    expect(codes[1].textContent).toBe("a-b");
    expect(codes[0].className).toBe(styles.mono);
  });
});

describe("DetailDrawer - stat rows", () => {
  it("adds no stat rows when the item carries no stats", () => {
    const { container } = renderDrawer(makeItem({ stats: null }));
    expect(rowKeys(container)).toHaveLength(4);
  });

  it("adds one row per stat entry after the fixed rows", () => {
    const { container } = renderDrawer(
      makeItem({ stats: { downloads: 7, stars: 3 } }),
    );
    expect(rowKeys(container)).toHaveLength(6);
    expect(rowKeys(container).slice(4)).toEqual([
      "market.stats.downloads",
      "market.stats.stars",
    ]);
  });

  it("translates a known stat key through its label map", () => {
    const { container } = renderDrawer(makeItem({ stats: { installs: 1 } }));
    expect(rowKeys(container)).toContain("market.stats.installs");
  });

  it("falls back to the raw stat key when the label map has no entry", () => {
    const { container } = renderDrawer(makeItem({ stats: { forks: 2 } }));
    expect(rowKeys(container)).toContain("forks");
    expect(valueFor(container, "forks")).toBe("2");
  });

  it("groups a numeric stat with the locale thousands separator", () => {
    const { container } = renderDrawer(
      makeItem({ stats: { downloads: 1234 } }),
    );
    expect(valueFor(container, "market.stats.downloads")).toBe("1,234");
  });

  it("shows a small number without a separator", () => {
    const { container } = renderDrawer(makeItem({ stats: { likes: 42 } }));
    expect(valueFor(container, "market.stats.likes")).toBe("42");
  });

  it("shows a string stat verbatim", () => {
    const { container } = renderDrawer(
      makeItem({ stats: { category: "tools" } }),
    );
    expect(valueFor(container, "market.stats.category")).toBe("tools");
  });

  it("localises updated_at when it holds a parseable date string", () => {
    const { container } = renderDrawer(
      makeItem({ stats: { updated_at: "2024-01-15T00:00:00Z" } }),
    );
    const shown = valueFor(container, "market.stats.updatedAt");
    expect(shown).toBe(new Date("2024-01-15T00:00:00Z").toLocaleDateString());
    expect(shown).not.toBe("2024-01-15T00:00:00Z");
  });

  it("shows updated_at verbatim when the date cannot be parsed", () => {
    // the guard on the parsed timestamp decides this arm
    const { container } = renderDrawer(
      makeItem({ stats: { updated_at: "not-a-date" } }),
    );
    expect(valueFor(container, "market.stats.updatedAt")).toBe("not-a-date");
  });

  it("groups updated_at as a number when the provider sends one", () => {
    // the date arm also requires a string, so a numeric updated_at skips it
    const { container } = renderDrawer(
      makeItem({ stats: { updated_at: 2000 } }),
    );
    expect(valueFor(container, "market.stats.updatedAt")).toBe("2,000");
  });

  it("keeps provider ordering for several stats at once", () => {
    const { container } = renderDrawer(
      makeItem({
        stats: { downloads: 1234, views: "many", updated_at: "not-a-date" },
      }),
    );
    expect(rowKeys(container).slice(4)).toEqual([
      "market.stats.downloads",
      "market.stats.views",
      "market.stats.updatedAt",
    ]);
    expect(rowValues(container).slice(4)).toEqual([
      "1,234",
      "many",
      "not-a-date",
    ]);
  });
});

describe("DetailDrawer - footer callbacks", () => {
  it("offers the primary install button while open", () => {
    const { getByTestId } = renderDrawer(makeItem());
    const btn = getByTestId("drawer-footer").querySelector("button");
    expect(btn?.textContent).toBe("common.save");
    expect(btn?.getAttribute("data-btn-type")).toBe("primary");
  });

  it("calls onInstall when the footer button is clicked", () => {
    const onInstall = vi.fn();
    const { getByTestId } = renderDrawer(makeItem(), { onInstall });
    fireEvent.click(getByTestId("drawer-footer").querySelector("button")!);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the drawer is dismissed", () => {
    const onClose = vi.fn();
    const { getByTestId } = renderDrawer(makeItem(), { onClose });
    fireEvent.click(getByTestId("drawer-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
