// @vitest-environment jsdom
/**
 * ResultCard tests - the market search result card's user-visible contract:
 * stats row derivation (downloads/installs fallback, number vs string
 * formatting, nullish filtering), description fallback, source badge and icon
 * delegation, hover-gated footer on desktop vs always-on footer on mobile
 * (including the resize listener and its cleanup), and click routing with the
 * footer's event-propagation guard.
 *
 * The shared design stub does not export Card, so this suite provides its own
 * that forwards the pointer handlers the component wires up. The stat rows are
 * counted through the CSS-module object (never a hardcoded hashed class name)
 * because the row label only reaches the DOM as a Tooltip title, which the
 * stub deliberately drops.
 *
 * Two arms of useIsMobile stay uncovered on purpose: both are server-side
 * rendering guards (`typeof window === "undefined"`), which can never be true
 * in a jsdom environment, so no passing test can reach them.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Card = ({
    children,
    onClick,
    onMouseEnter,
    onMouseLeave,
    className,
    style,
  }: any) => (
    <div
      data-testid="result-card"
      className={className}
      style={style}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
  const Button = ({ children, onClick, disabled, type, size }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-btn-type={type}
      data-btn-size={size}
    >
      {children}
    </button>
  );
  const Tooltip = ({ children }: any) => <>{children}</>;
  return { Card, Button, Tooltip };
});

import { ResultCard } from "./ResultCard";
import { sourceLabel } from "./SkillIcon";
import type { MarketResult } from "../../../../api/modules/market";
import styles from "./ResultCard.module.less";

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

function renderCard(
  overrides: Partial<MarketResult> = {},
  callbacks: { onInstall?: () => void; onOpenDetail?: () => void } = {},
) {
  const onInstall = callbacks.onInstall ?? vi.fn();
  const onOpenDetail = callbacks.onOpenDetail ?? vi.fn();
  const utils = render(
    <ResultCard
      item={makeItem(overrides)}
      onInstall={onInstall}
      onOpenDetail={onOpenDetail}
    />,
  );
  return { ...utils, onInstall, onOpenDetail };
}

function statItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(`.${styles.statItem}`));
}

/**
 * The declared stats type only allows string or number values, but the record
 * is deserialised from provider JSON and the component guards every value with
 * `??` and `!= null`. Those guards are the subject of the two tests below, so
 * the record is widened here to reach them.
 */
function nullishStats(
  values: Record<string, string | number | null | undefined>,
): MarketResult["stats"] {
  return values as MarketResult["stats"];
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });
}

const DESKTOP_WIDTH = 1024;
const MOBILE_WIDTH = 500;

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  vi.restoreAllMocks();
});

describe("ResultCard - identity block", () => {
  it("shows the skill name as the heading", () => {
    renderCard({ name: "Weather Tool" });
    expect(
      screen.getByRole("heading", { level: 3, name: "Weather Tool" }),
    ).toBeInTheDocument();
  });

  it("renders a name that is empty without throwing", () => {
    renderCard({ name: "" });
    expect(screen.getByTestId("result-card")).toBeInTheDocument();
  });

  it("maps a known source to its display label", () => {
    const { container } = renderCard({ source: "modelscope" });
    expect(container).toHaveTextContent(sourceLabel("modelscope"));
  });

  it("passes an unknown source through verbatim as the badge text", () => {
    const { container } = renderCard({ source: "some-new-hub" });
    expect(container).toHaveTextContent("some-new-hub");
  });

  it("shows the description when one is provided", () => {
    renderCard({ description: "Does useful things" });
    expect(screen.getByText("Does useful things")).toBeInTheDocument();
  });

  it("falls back to the no-description label when description is null", () => {
    renderCard({ description: null });
    expect(screen.getByText("market.noDescription")).toBeInTheDocument();
  });

  it("falls back to the no-description label when description is empty", () => {
    renderCard({ description: "" });
    expect(screen.getByText("market.noDescription")).toBeInTheDocument();
  });

  it("keeps a whitespace-only description instead of the fallback", () => {
    renderCard({ description: " " });
    expect(screen.queryByText("market.noDescription")).toBeNull();
  });
});

describe("ResultCard - icon delegation", () => {
  it("renders the remote icon image when icon_url is present", () => {
    renderCard({ icon_url: "https://cdn.example.com/a.png", name: "Iconic" });
    const img = screen.getByRole("img", { name: "Iconic" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("falls back to the provider letter tile when icon_url is null", () => {
    const { container } = renderCard({ icon_url: null, source: "clawhub" });
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("C");
  });

  it("switches to the provider letter tile after the image errors", () => {
    const { container } = renderCard({
      icon_url: "https://cdn.example.com/broken.png",
      source: "aliyun",
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as Element);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("A");
  });

  it("uses the puzzle fallback for an unknown source without an icon", () => {
    const { container } = renderCard({ icon_url: null, source: "mystery" });
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("\u{1f9e9}");
  });
});

describe("ResultCard - stats row", () => {
  it("shows a single dash row when stats is null", () => {
    const { container } = renderCard({ stats: null });
    const items = statItems(container);
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("-");
  });

  it("shows a single dash row when stats is an empty object", () => {
    const { container } = renderCard({ stats: {} });
    expect(statItems(container)).toHaveLength(1);
    expect(statItems(container)[0]).toHaveTextContent("-");
  });

  it("formats a numeric download count with locale grouping", () => {
    const { container } = renderCard({ stats: { downloads: 1234 } });
    expect(container).toHaveTextContent((1234).toLocaleString());
  });

  it("renders zero downloads as zero rather than the dash fallback", () => {
    const { container } = renderCard({ stats: { downloads: 0 } });
    expect(statItems(container)).toHaveLength(1);
    expect(statItems(container)[0]).toHaveTextContent("0");
  });

  it("prefers downloads over installs when both are present", () => {
    const { container } = renderCard({
      stats: { downloads: 9, installs: 4 },
    });
    expect(statItems(container)[0]).toHaveTextContent("9");
    expect(container).not.toHaveTextContent("4");
  });

  it("falls back to installs when downloads is absent", () => {
    const { container } = renderCard({ stats: { installs: 7 } });
    expect(statItems(container)[0]).toHaveTextContent("7");
  });

  it("treats a nullish downloads value as missing and uses installs", () => {
    const { container } = renderCard({
      stats: nullishStats({ downloads: null, installs: 3 }),
    });
    expect(statItems(container)[0]).toHaveTextContent("3");
  });

  it("passes a preformatted string count through unchanged", () => {
    const { container } = renderCard({ stats: { downloads: "1.2k" } });
    expect(statItems(container)[0]).toHaveTextContent("1.2k");
  });

  it("renders all four rows in a stable order when every stat is present", () => {
    const { container } = renderCard({
      stats: { downloads: 10, stars: 20, likes: 30, views: 40 },
    });
    const values = statItems(container).map((el) => el.textContent);
    expect(values).toEqual(["10", "20", "30", "40"]);
  });

  it("drops the stars, likes and views rows when they are absent", () => {
    const { container } = renderCard({ stats: { downloads: 1 } });
    expect(statItems(container)).toHaveLength(1);
  });

  it("keeps a zero-valued star count but drops a null view count", () => {
    const { container } = renderCard({
      stats: nullishStats({ stars: 0, views: null, likes: undefined }),
    });
    const items = statItems(container);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("-");
    expect(items[1]).toHaveTextContent("0");
  });

  it("renders one icon per stat row", () => {
    const { container } = renderCard({
      stats: { downloads: 1, stars: 2, likes: 3, views: 4 },
    });
    expect(container.querySelectorAll("svg")).toHaveLength(4);
  });
});

describe("ResultCard - footer visibility on desktop", () => {
  it("hides the install button until the card is hovered", () => {
    renderCard();
    expect(screen.queryByText("common.save")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("result-card"));
    expect(screen.getByText("common.save")).toBeInTheDocument();
  });

  it("hides the install button again when the pointer leaves", () => {
    renderCard();
    const card = screen.getByTestId("result-card");
    fireEvent.mouseEnter(card);
    expect(screen.getByText("common.save")).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    expect(screen.queryByText("common.save")).toBeNull();
  });

  it("calls onOpenDetail when the card body is clicked", () => {
    const { onOpenDetail } = renderCard();
    fireEvent.click(screen.getByTestId("result-card"));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("calls onInstall and not onOpenDetail when the button is clicked", () => {
    const { onInstall, onOpenDetail } = renderCard();
    fireEvent.mouseEnter(screen.getByTestId("result-card"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("does not open the detail when a key is pressed inside the footer", () => {
    const { onOpenDetail } = renderCard();
    fireEvent.mouseEnter(screen.getByTestId("result-card"));
    const footer = screen.getByText("common.save").closest("div");
    fireEvent.keyDown(footer as Element);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("marks the install button as a small primary action", () => {
    renderCard();
    fireEvent.mouseEnter(screen.getByTestId("result-card"));
    const button = screen.getByText("common.save");
    expect(button.getAttribute("data-btn-type")).toBe("primary");
    expect(button.getAttribute("data-btn-size")).toBe("small");
  });
});

describe("ResultCard - mobile viewport", () => {
  it("shows the install button without hovering on a narrow viewport", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderCard();
    expect(screen.getByText("common.save")).toBeInTheDocument();
  });

  it("treats exactly 768px as mobile", () => {
    setViewportWidth(768);
    renderCard();
    expect(screen.getByText("common.save")).toBeInTheDocument();
  });

  it("treats 769px as desktop", () => {
    setViewportWidth(769);
    renderCard();
    expect(screen.queryByText("common.save")).toBeNull();
  });

  it("reveals the footer when the viewport shrinks past the breakpoint", () => {
    const { container } = renderCard();
    expect(screen.queryByText("common.save")).toBeNull();
    setViewportWidth(MOBILE_WIDTH);
    fireEvent(window, new Event("resize"));
    expect(screen.getByText("common.save")).toBeInTheDocument();
    expect(container).toBeInTheDocument();
  });

  it("hides the footer again when the viewport grows back", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderCard();
    expect(screen.getByText("common.save")).toBeInTheDocument();
    setViewportWidth(DESKTOP_WIDTH);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByText("common.save")).toBeNull();
  });

  it("stops reporting the viewport once unmounted", () => {
    const { unmount } = renderCard();
    unmount();
    expect(() => {
      setViewportWidth(MOBILE_WIDTH);
      fireEvent(window, new Event("resize"));
    }).not.toThrow();
  });
});

describe("ResultCard - memoisation contract", () => {
  it("still renders correctly when the identical props are supplied again", () => {
    const item = makeItem({ name: "Stable" });
    const onInstall = vi.fn();
    const onOpenDetail = vi.fn();
    const { rerender } = render(
      <ResultCard
        item={item}
        onInstall={onInstall}
        onOpenDetail={onOpenDetail}
      />,
    );
    rerender(
      <ResultCard
        item={item}
        onInstall={onInstall}
        onOpenDetail={onOpenDetail}
      />,
    );
    expect(screen.getByRole("heading", { name: "Stable" })).toBeInTheDocument();
  });

  it("picks up a changed item on rerender", () => {
    const onInstall = vi.fn();
    const onOpenDetail = vi.fn();
    const { rerender } = render(
      <ResultCard
        item={makeItem({ name: "First" })}
        onInstall={onInstall}
        onOpenDetail={onOpenDetail}
      />,
    );
    rerender(
      <ResultCard
        item={makeItem({ name: "Second" })}
        onInstall={onInstall}
        onOpenDetail={onOpenDetail}
      />,
    );
    expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("keeps a pointer cursor style on the card shell", () => {
    renderCard();
    expect(screen.getByTestId("result-card").style.cursor).toBe("pointer");
  });
});
