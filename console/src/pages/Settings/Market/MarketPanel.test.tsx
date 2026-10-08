// @vitest-environment jsdom
/**
 * MarketPanel tests - the embeddable skill-market browser's user-visible
 * contract: the category chip strip (always-prepended "all" chip, selection
 * routing, scroll-geometry driven arrow buttons and their listener/observer
 * cleanup), the multi-select source picker (availability filtering of the
 * selected keys, disabled options, and the unavailable-reason tooltip with its
 * fallback label), search and browse hint derivation, the four
 * loading/error/empty render states, result-card install and detail-drawer
 * routing, the three load-more arms (blocked button, auto-load sentinel, end of
 * list), and the memoized install queue panel.
 *
 * The shared design stub does not export Select, so this suite provides its own
 * that renders the option list it is handed (same approach as the Card stub in
 * ResultCard.test.tsx). useMarketSearch is replaced by a plain state object
 * because the panel's contract is "render whatever the hook reports, and route
 * user intent back to it"; the hook itself is covered by useMarketSearch.test.ts.
 * ResultCard / DetailDrawer / QueueItem / EmptyState are stubbed for the same
 * reason - each already has its own suite under ./components, and re-testing
 * them here would only duplicate it.
 *
 * Two arms stay uncovered on purpose: the `if (!viewport) return;` guards inside
 * updateScrollState, scrollCategories and the chips effect. React attaches the
 * viewport ref before any of those can run, so reaching the null branch would
 * require detaching the node mid-render - a state the product cannot produce.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MarketCategory,
  MarketProviderInfo,
  MarketResult,
  MarketSearchError,
} from "../../../api/modules/market";
import type { MarketSearchState } from "./useMarketSearch";
import type { InstallQueueItem } from "./useMarketInstall";
import styles from "./index.module.less";

const h = vi.hoisted(() => ({
  // Deterministic translation stub: interpolation params are folded into the
  // returned key so hint text can be asserted exactly rather than by substring.
  stableT: (key: string, arg?: unknown) => {
    if (typeof arg === "string") return `${key}::${arg}`;
    if (arg && typeof arg === "object") {
      const parts = Object.entries(arg as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${String(v)}`);
      return `${key}::${parts.join(",")}`;
    }
    return key;
  },
  marketState: {} as unknown as MarketSearchState,
  observers: [] as {
    callback: IntersectionObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    nodes: Element[];
  }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: { language: "en" } }),
}));

vi.mock("./useMarketSearch", () => ({
  useMarketSearch: () => h.marketState,
}));

vi.mock("./components", () => ({
  ResultCard: ({ item, onInstall, onOpenDetail }: any) => (
    <div
      data-testid="result-card"
      data-source={item.source}
      data-slug={item.slug}
    >
      <button type="button" data-testid="card-install" onClick={onInstall} />
      <button type="button" data-testid="card-detail" onClick={onOpenDetail} />
    </div>
  ),
  DetailDrawer: ({ item, onInstall, onClose }: any) => (
    <div data-testid="detail-drawer" data-slug={item ? item.slug : ""}>
      <button type="button" data-testid="detail-install" onClick={onInstall} />
      <button type="button" data-testid="detail-close" onClick={onClose} />
    </div>
  ),
  QueueItem: ({ item, onCancel, onRetry }: any) => (
    <div data-testid="queue-item" data-id={item.id} data-status={item.status}>
      <button
        type="button"
        data-testid="queue-cancel"
        onClick={() => onCancel(item.id)}
      />
      <button
        type="button"
        data-testid="queue-retry"
        onClick={() => onRetry(item.id)}
      />
    </div>
  ),
  EmptyState: ({ text, children }: any) => (
    <div data-testid="empty-state" data-text={text}>
      {children}
    </div>
  ),
}));

vi.mock("@agentscope-ai/design", () => {
  // `loading` is absorbed here rather than spread onto the DOM node, which
  // would otherwise warn about a non-boolean attribute.
  const Button = ({
    children,
    onClick,
    disabled,
    size,
    type,
    icon,
    className,
    title,
    loading,
    ...rest
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      data-btn-size={size}
      data-btn-type={type}
      data-icon={icon ? "yes" : "no"}
      data-loading={loading ? "yes" : "no"}
      className={className}
      title={title}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
  const Input = Object.assign((props: any) => <input {...props} />, {
    Search: ({
      allowClear,
      onChange,
      value,
      placeholder,
      className,
      ...rest
    }: any) => (
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        className={className}
        data-allow-clear={allowClear ? "yes" : "no"}
        onChange={onChange}
        {...rest}
      />
    ),
  });
  // Not exported by the shared stub; renders the option list it is handed so
  // availability, disabled state and tooltip titles are all observable.
  const Select = ({
    value,
    options,
    onChange,
    mode,
    className,
    popupClassName,
  }: any) => (
    <div
      data-testid="provider-select"
      data-mode={mode}
      data-value={JSON.stringify(value)}
      className={`${className} ${popupClassName}`}
    >
      {options.map((option: any, index: number) => (
        <div
          key={String(option.value)}
          data-testid="provider-option"
          data-option-value={option.value}
          data-option-disabled={option.disabled ? "yes" : "no"}
          data-index={index}
        >
          {typeof option.label === "string" ? (
            <span data-testid="option-plain-label">{option.label}</span>
          ) : (
            option.label
          )}
        </div>
      ))}
      <button
        type="button"
        data-testid="provider-change"
        onClick={() => onChange(["github", "clawhub"])}
      />
    </div>
  );
  const Tooltip = ({ title, children }: any) => (
    <span data-testid="option-tooltip" data-tooltip-title={title}>
      {children}
    </span>
  );
  return { Button, Input, Select, Tooltip };
});

// The refresh button lives in the antd namespace (the rest of the toolbar uses
// the design system), so its stub renders the icon node the component passes
// down instead of only flagging its presence.
vi.mock("antd", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    icon,
    className,
    type,
    ...rest
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-btn-type={type}
      data-icon={icon ? "yes" : "no"}
      {...rest}
    >
      {icon}
      {children}
    </button>
  ),
}));

vi.mock("lucide-react", () => {
  const make = (name: string) =>
    function Icon() {
      return <span data-testid={`icon-${name}`} />;
    };
  return {
    ChevronLeft: make("chevron-left"),
    ChevronRight: make("chevron-right"),
    RefreshCw: make("refresh"),
  };
});

import { InstallQueuePanel, MarketPanel } from "./MarketPanel";

type ResizeObserverMock = ReturnType<typeof vi.fn>;

interface ResizeObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeResult(overrides: Partial<MarketResult> = {}): MarketResult {
  return {
    source: "qwenpaw",
    slug: "alpha",
    name: "Alpha",
    description: "first",
    source_url: "https://example.test/alpha",
    version: "1.0.0",
    author: "ann",
    icon_url: null,
    stats: null,
    ...overrides,
  };
}

function makeProvider(
  overrides: Partial<MarketProviderInfo> = {},
): MarketProviderInfo {
  return {
    key: "qwenpaw",
    label: "QwenPaw",
    available: true,
    reason: null,
    supports_browse: true,
    ...overrides,
  };
}

function makeMarketState(
  overrides: Partial<MarketSearchState> = {},
): MarketSearchState {
  const base = {
    providers: [makeProvider()],
    selectedProviderKeys: new Set<string>(["qwenpaw"]),
    setSelectedProviders: vi.fn(),
    categories: [] as MarketCategory[],
    category: "",
    setCategory: vi.fn(),
    query: "",
    setQuery: vi.fn(),
    results: [] as MarketResult[],
    errors: [] as MarketSearchError[],
    globalError: null as string | null,
    loading: false,
    totalCount: 0,
    hasMore: false,
    loadMore: vi.fn(),
    autoLoadMore: vi.fn(),
    autoLoadBlocked: false,
    refresh: vi.fn(),
    retry: vi.fn(),
  };
  return { ...base, ...overrides } as MarketSearchState;
}

function useMarket(overrides: Partial<MarketSearchState> = {}) {
  h.marketState = makeMarketState(overrides);
  return h.marketState;
}

function makeInstall() {
  return {
    queue: [] as InstallQueueItem[],
    enqueue: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    clearFinished: vi.fn(),
  };
}

function makeQueueItem(
  overrides: Partial<InstallQueueItem> = {},
): InstallQueueItem {
  return {
    id: "q1",
    result: makeResult(),
    target: "workspace",
    status: "queued",
    message: "",
    ...overrides,
  };
}

/** Viewport geometry is read-only in jsdom, so the three scroll metrics and
 * scrollBy are installed directly on the node the chips strip renders. */
function instrumentViewport(
  node: Element,
  geometry: { scrollLeft: number; clientWidth: number; scrollWidth: number },
) {
  Object.defineProperty(node, "scrollLeft", {
    value: geometry.scrollLeft,
    configurable: true,
  });
  Object.defineProperty(node, "clientWidth", {
    value: geometry.clientWidth,
    configurable: true,
  });
  Object.defineProperty(node, "scrollWidth", {
    value: geometry.scrollWidth,
    configurable: true,
  });
  (node as HTMLElement).scrollBy = vi.fn();
  return (node as HTMLElement).scrollBy as ReturnType<typeof vi.fn>;
}

function getViewport() {
  return screen.getByRole("group", { name: "market.categoryPlaceholder" });
}

/** setup.ts installs ResizeObserver as a vi.fn whose implementation returns a
 * fresh object per construction, so the instances the component creates are
 * read back from that mock's results. The incomplete-variant entries (a throw
 * instead of a return) are filtered out to keep the value type honest. */
function resizeObserverInstances(): ResizeObserverInstance[] {
  const ro = globalThis.ResizeObserver as unknown as ResizeObserverMock;
  return ro.mock.results
    .filter((r) => r.type === "return" && r.value !== undefined)
    .map((r) => r.value as ResizeObserverInstance);
}

function triggerSentinel(isIntersecting: boolean) {
  const last = h.observers[h.observers.length - 1];
  act(() => {
    last.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      last as unknown as IntersectionObserver,
    );
  });
}

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();
  nodes: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    // Instances are appended here because the component constructs the observer
    // inside an effect, so the suite can only reach it through this list.
    h.observers.push(this as unknown as (typeof h.observers)[number]);
  }
}

beforeEach(() => {
  h.observers = [];
  (globalThis.ResizeObserver as unknown as ResizeObserverMock).mockClear();
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarketPanel category chips", () => {
  it("prepends the all chip and marks only the active category pressed", () => {
    useMarket({
      categories: [
        { id: "agent", label: "Agent" },
        { id: "data", label: "Data" },
      ],
      category: "data",
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const chips = screen.getAllByRole("button", {
      name: /market\.categoryAll|Agent|Data/,
    });
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.textContent)).toEqual([
      "market.categoryAll",
      "Agent",
      "Data",
    ]);
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(chips[2].className.split(" ")).toContain(styles.categoryChipActive);
    expect(chips[0].className.split(" ")).not.toContain(
      styles.categoryChipActive,
    );
  });

  it("routes the clicked category id to setCategory, including the empty all id", () => {
    const market = useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(market.setCategory).toHaveBeenCalledTimes(1);
    expect(market.setCategory).toHaveBeenCalledWith("agent");

    fireEvent.click(screen.getByRole("button", { name: "market.categoryAll" }));
    expect(market.setCategory).toHaveBeenCalledTimes(2);
    expect(market.setCategory).toHaveBeenLastCalledWith("");
  });

  it("keeps both arrow buttons disabled while the strip fits the viewport", () => {
    useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    instrumentViewport(getViewport(), {
      scrollLeft: 0,
      clientWidth: 400,
      scrollWidth: 400,
    });
    fireEvent.scroll(getViewport());

    expect(screen.getByLabelText("common.back")).toBeDisabled();
    expect(screen.getByLabelText("common.next::Next")).toBeDisabled();
  });

  it("enables both arrow buttons once the strip is scrolled into the middle", () => {
    useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    instrumentViewport(getViewport(), {
      scrollLeft: 50,
      clientWidth: 100,
      scrollWidth: 400,
    });
    fireEvent.scroll(getViewport());

    expect(screen.getByLabelText("common.back")).toBeEnabled();
    expect(screen.getByLabelText("common.next::Next")).toBeEnabled();
  });

  it("scrolls by exactly one client width in the clicked direction with smooth behavior", () => {
    useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const scrollBy = instrumentViewport(getViewport(), {
      scrollLeft: 100,
      clientWidth: 120,
      scrollWidth: 600,
    });
    fireEvent.scroll(getViewport());

    fireEvent.click(screen.getByLabelText("common.next::Next"));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ left: 120, behavior: "smooth" });

    fireEvent.click(screen.getByLabelText("common.back"));
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -120,
      behavior: "smooth",
    });
  });

  it("measures the strip on mount through a resize observer and disconnects it on unmount", () => {
    useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    const view = render(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );

    const created = resizeObserverInstances();
    expect(created).toHaveLength(1);
    expect(created[0].observe).toHaveBeenCalledTimes(1);
    expect(created[0].disconnect).not.toHaveBeenCalled();

    view.unmount();
    expect(created[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the chip strip when the category list changes, dropping the old observer", () => {
    const market = useMarket({ categories: [{ id: "agent", label: "Agent" }] });
    const install = makeInstall();
    const view = render(
      <MarketPanel installTarget="workspace" install={install} />,
    );
    const first = resizeObserverInstances();

    h.marketState = makeMarketState({
      ...market,
      categories: [
        { id: "agent", label: "Agent" },
        { id: "data", label: "Data" },
      ],
    });
    view.rerender(<MarketPanel installTarget="workspace" install={install} />);

    const all = resizeObserverInstances();
    expect(all).toHaveLength(2);
    expect(first[0].disconnect).toHaveBeenCalledTimes(1);
    const chips = screen.getAllByRole("button", {
      name: /market\.categoryAll|Agent|Data/,
    });
    expect(chips.map((c) => c.textContent)).toEqual([
      "market.categoryAll",
      "Agent",
      "Data",
    ]);
  });
});

describe("MarketPanel source picker", () => {
  const providers = [
    makeProvider({ key: "qwenpaw", label: "QwenPaw" }),
    makeProvider({
      key: "github",
      label: "GitHub",
      available: false,
      reason: "token missing",
    }),
    makeProvider({
      key: "clawhub",
      label: "ClawHub",
      available: false,
      reason: null,
    }),
  ];

  it("filters the selected keys down to providers that are still available", () => {
    useMarket({
      providers,
      selectedProviderKeys: new Set(["qwenpaw", "github", "gone"]),
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const select = screen.getByTestId("provider-select");
    expect(select.getAttribute("data-mode")).toBe("multiple");
    expect(JSON.parse(select.getAttribute("data-value") || "[]")).toEqual([
      "qwenpaw",
    ]);
  });

  it("marks unavailable providers disabled and shows their reason as a tooltip title", () => {
    useMarket({ providers, selectedProviderKeys: new Set(["qwenpaw"]) });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const options = screen.getAllByTestId("provider-option");
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.getAttribute("data-option-disabled"))).toEqual([
      "no",
      "yes",
      "yes",
    ]);
    expect(options[0].textContent).toBe("QwenPaw");
    expect(within(options[0]).queryByTestId("option-tooltip")).toBeNull();

    expect(
      within(options[1])
        .getByTestId("option-tooltip")
        .getAttribute("data-tooltip-title"),
    ).toBe("token missing");
    expect(within(options[1]).getByText("GitHub")).toBeInTheDocument();
  });

  it("falls back to the generic unavailable label when a provider reports no reason", () => {
    useMarket({ providers, selectedProviderKeys: new Set(["qwenpaw"]) });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const options = screen.getAllByTestId("provider-option");
    expect(
      within(options[2])
        .getByTestId("option-tooltip")
        .getAttribute("data-tooltip-title"),
    ).toBe("market.providerUnavailable");
  });

  it("routes the picked key list to setSelectedProviders", () => {
    const market = useMarket({
      providers,
      selectedProviderKeys: new Set(["qwenpaw"]),
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    fireEvent.click(screen.getByTestId("provider-change"));
    expect(market.setSelectedProviders).toHaveBeenCalledTimes(1);
    expect(market.setSelectedProviders).toHaveBeenCalledWith([
      "github",
      "clawhub",
    ]);
  });

  it("disables the refresh button while loading and routes its click to refresh", () => {
    const loading = useMarket({ loading: true });
    const view = render(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(screen.getByLabelText("common.refresh")).toBeDisabled();

    const idle = useMarket({ loading: false });
    view.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    const button = screen.getByLabelText("common.refresh");
    expect(button).toBeEnabled();
    expect(button.getAttribute("data-icon")).toBe("yes");
    expect(screen.getByTestId("icon-refresh")).toBeInTheDocument();

    fireEvent.click(button);
    expect(loading.refresh).not.toHaveBeenCalled();
    expect(idle.refresh).toHaveBeenCalledTimes(1);
  });

  it("routes the typed search text to setQuery and echoes it back as the input value", () => {
    const market = useMarket({ query: "voice" });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const input = screen.getByLabelText("market.searchPlaceholder");
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("data-allow-clear", "yes");
    expect(input).toHaveValue("voice");

    fireEvent.change(input, { target: { value: "voice clone" } });
    expect(market.setQuery).toHaveBeenCalledTimes(1);
    expect(market.setQuery).toHaveBeenCalledWith("voice clone");
  });
});

describe("MarketPanel hints and errors", () => {
  it("shows the trimmed keyword and the provider-reported total while searching", () => {
    useMarket({ query: "  voice  ", totalCount: 7, results: [makeResult()] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    expect(
      screen.getByText("market.searchResult::count=7,keyword=voice"),
    ).toBeInTheDocument();
  });

  it("hides the search hint while loading, on a global error, or with a blank query", () => {
    const loading = render(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    h.marketState = makeMarketState({ query: "voice", loading: true });
    loading.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(
      screen.queryByText("market.searchResult::count=0,keyword=voice"),
    ).toBeNull();

    h.marketState = makeMarketState({ query: "voice", globalError: "boom" });
    loading.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(
      screen.queryByText("market.searchResult::count=0,keyword=voice"),
    ).toBeNull();

    h.marketState = makeMarketState({ query: "   " });
    loading.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(screen.queryByText(/market\.searchResult/)).toBeNull();
  });

  it("lists only available, non-browsing, selected providers in the browse hint", () => {
    useMarket({
      providers: [
        makeProvider({ key: "a", label: "Alpha", supports_browse: false }),
        makeProvider({ key: "b", label: "Beta", supports_browse: false }),
        makeProvider({
          key: "c",
          label: "Gamma",
          supports_browse: false,
          available: false,
        }),
        makeProvider({ key: "d", label: "Delta", supports_browse: true }),
        makeProvider({ key: "e", label: "Eps", supports_browse: false }),
      ],
      selectedProviderKeys: new Set(["a", "b", "c", "d", "e"]),
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    expect(
      screen.getByText("market.browseHint::providers=Alpha, Beta, Eps"),
    ).toBeInTheDocument();
  });

  it("suppresses the browse hint once a query or a category is active", () => {
    const view = render(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    h.marketState = makeMarketState({
      providers: [
        makeProvider({ key: "a", label: "Alpha", supports_browse: false }),
      ],
      selectedProviderKeys: new Set(["a"]),
      query: "voice",
    });
    view.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(screen.queryByText(/market\.browseHint/)).toBeNull();

    h.marketState = makeMarketState({
      providers: [
        makeProvider({ key: "a", label: "Alpha", supports_browse: false }),
      ],
      selectedProviderKeys: new Set(["a"]),
      category: "agent",
    });
    view.rerender(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );
    expect(screen.queryByText(/market\.browseHint/)).toBeNull();
  });

  it("renders the global error text verbatim in its own row", () => {
    useMarket({ globalError: "market unreachable" });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    expect(screen.getByText("market unreachable")).toBeInTheDocument();
  });

  it("labels per-provider errors with the known provider label and the raw key otherwise", () => {
    useMarket({
      providers: [makeProvider({ key: "qwenpaw", label: "QwenPaw" })],
      errors: [
        { provider: "qwenpaw", message: "timeout" },
        { provider: "unknown-src", message: "403" },
      ],
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    // The row's own text nodes hold ": <message>"; textContent folds in the
    // provider label rendered by the nested <strong>.
    const rows = screen.getAllByText(/timeout|403/);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("QwenPaw: timeout");
    expect(rows[1].textContent).toBe("unknown-src: 403");
  });
});

describe("MarketPanel result states", () => {
  it("shows the loading empty state while the first page is in flight", () => {
    useMarket({ loading: true, results: [] });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const empty = screen.getByTestId("empty-state");
    expect(empty.getAttribute("data-text")).toBe("common.loading");
    expect(empty.querySelectorAll("button")).toHaveLength(0);
  });

  it("offers a retry action when there are no results but at least one error", () => {
    const market = useMarket({
      results: [],
      errors: [{ provider: "qwenpaw", message: "timeout" }],
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const empty = screen.getByTestId("empty-state");
    expect(empty.getAttribute("data-text")).toBe("market.noResults");
    const retry = within(empty).getByRole("button", { name: "market.retry" });
    fireEvent.click(retry);
    expect(market.retry).toHaveBeenCalledTimes(1);
  });

  it("offers the same retry action when only a global error is present", () => {
    const market = useMarket({ results: [], globalError: "boom" });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const empty = screen.getByTestId("empty-state");
    fireEvent.click(
      within(empty).getByRole("button", { name: "market.retry" }),
    );
    expect(market.retry).toHaveBeenCalledTimes(1);
  });

  it("shows a bare no-results empty state when nothing matched and nothing failed", () => {
    useMarket({ results: [], errors: [], globalError: null });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const empty = screen.getByTestId("empty-state");
    expect(empty.getAttribute("data-text")).toBe("market.noResults");
    expect(empty.querySelectorAll("button")).toHaveLength(0);
  });

  it("renders one card per result and keeps the loading spinner out of the grid", () => {
    useMarket({
      loading: true,
      results: [
        makeResult({ source: "qwenpaw", slug: "alpha" }),
        makeResult({ source: "github", slug: "beta", name: "Beta" }),
        makeResult({ source: "github", slug: "gamma", name: "Gamma" }),
      ],
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const cards = screen.getAllByTestId("result-card");
    expect(cards).toHaveLength(3);
    expect(
      cards.map(
        (c) =>
          `${c.getAttribute("data-source")}:${c.getAttribute("data-slug")}`,
      ),
    ).toEqual(["qwenpaw:alpha", "github:beta", "github:gamma"]);
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("enqueues the clicked card as a single-item batch against the host target", () => {
    const install = makeInstall();
    const item = makeResult({ source: "github", slug: "beta" });
    useMarket({ results: [item] });
    render(<MarketPanel installTarget="pool" install={install} />);

    fireEvent.click(screen.getByTestId("card-install"));
    expect(install.enqueue).toHaveBeenCalledTimes(1);
    expect(install.enqueue).toHaveBeenCalledWith([item], "pool");
  });

  it("routes card detail clicks into the drawer and installs from there once", () => {
    const install = makeInstall();
    const item = makeResult({ slug: "alpha" });
    useMarket({ results: [item] });
    render(<MarketPanel installTarget="workspace" install={install} />);

    expect(screen.getByTestId("detail-drawer").getAttribute("data-slug")).toBe(
      "",
    );

    fireEvent.click(screen.getByTestId("card-detail"));
    expect(screen.getByTestId("detail-drawer").getAttribute("data-slug")).toBe(
      "alpha",
    );

    fireEvent.click(screen.getByTestId("detail-install"));
    expect(install.enqueue).toHaveBeenCalledTimes(1);
    expect(install.enqueue).toHaveBeenCalledWith([item], "workspace");
    // The drawer closes itself after a successful install.
    expect(screen.getByTestId("detail-drawer").getAttribute("data-slug")).toBe(
      "",
    );
  });

  it("closes the drawer without enqueuing anything", () => {
    const install = makeInstall();
    useMarket({ results: [makeResult({ slug: "alpha" })] });
    render(<MarketPanel installTarget="workspace" install={install} />);

    fireEvent.click(screen.getByTestId("card-detail"));
    fireEvent.click(screen.getByTestId("detail-close"));

    expect(screen.getByTestId("detail-drawer").getAttribute("data-slug")).toBe(
      "",
    );
    expect(install.enqueue).not.toHaveBeenCalled();
  });

  it("ignores a drawer install when no item is open", () => {
    const install = makeInstall();
    useMarket({ results: [] });
    render(<MarketPanel installTarget="workspace" install={install} />);

    fireEvent.click(screen.getByTestId("detail-install"));
    expect(install.enqueue).not.toHaveBeenCalled();
    expect(screen.getByTestId("detail-drawer").getAttribute("data-slug")).toBe(
      "",
    );
  });
});

describe("MarketPanel load-more", () => {
  it("shows an explicit load-more button once auto loading is blocked", () => {
    const market = useMarket({
      results: [makeResult()],
      hasMore: true,
      autoLoadBlocked: true,
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    const button = screen.getByRole("button", { name: "market.loadMore" });
    fireEvent.click(button);
    expect(market.loadMore).toHaveBeenCalledTimes(1);
    expect(market.autoLoadMore).not.toHaveBeenCalled();
    expect(screen.queryByText("common.loading")).toBeNull();
  });

  it("auto loads when the sentinel becomes visible and keeps the button out of the DOM", () => {
    const market = useMarket({
      results: [makeResult()],
      hasMore: true,
      autoLoadBlocked: false,
    });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    expect(h.observers).toHaveLength(1);
    expect(h.observers[0].observe).toHaveBeenCalledTimes(1);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "market.loadMore" }),
    ).toBeNull();

    triggerSentinel(false);
    expect(market.autoLoadMore).not.toHaveBeenCalled();

    triggerSentinel(true);
    expect(market.autoLoadMore).toHaveBeenCalledTimes(1);
  });

  it("disconnects the sentinel observer on unmount", () => {
    useMarket({ results: [makeResult()], hasMore: true });
    const view = render(
      <MarketPanel installTarget="workspace" install={makeInstall()} />,
    );

    expect(h.observers[0].disconnect).not.toHaveBeenCalled();
    view.unmount();
    expect(h.observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("replaces the sentinel with an end-of-list note when nothing is left to load", () => {
    useMarket({ results: [makeResult()], hasMore: false });
    render(<MarketPanel installTarget="workspace" install={makeInstall()} />);

    expect(screen.getByText("market.noMoreResults")).toBeInTheDocument();
    expect(h.observers).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "market.loadMore" }),
    ).toBeNull();
  });
});

describe("InstallQueuePanel", () => {
  it("renders the queue header with its clear-completed action", () => {
    render(
      <InstallQueuePanel
        queue={[]}
        onClearCompleted={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("market.installQueue")).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "market.clearCompleted" });
    expect(clear.getAttribute("data-btn-size")).toBe("small");
  });

  it("routes clear-completed to the host callback", () => {
    const onClearCompleted = vi.fn();
    render(
      <InstallQueuePanel
        queue={[]}
        onClearCompleted={onClearCompleted}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "market.clearCompleted" }),
    );
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("renders one row per queued install and keeps its status visible", () => {
    const queue = [
      makeQueueItem({ id: "q1", status: "installing" }),
      makeQueueItem({ id: "q2", status: "failed" }),
      makeQueueItem({ id: "q3", status: "completed" }),
    ];
    render(
      <InstallQueuePanel
        queue={queue}
        onClearCompleted={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const rows = screen.getAllByTestId("queue-item");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
      "installing",
      "failed",
      "completed",
    ]);
  });

  it("forwards the row id to the host cancel and retry callbacks", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    render(
      <InstallQueuePanel
        queue={[makeQueueItem({ id: "q2", status: "failed" })]}
        onClearCompleted={vi.fn()}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByTestId("queue-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("q2");

    fireEvent.click(screen.getByTestId("queue-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("q2");
  });
});
