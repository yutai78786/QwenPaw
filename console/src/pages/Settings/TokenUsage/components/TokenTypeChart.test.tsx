/**
 * TokenTypeChart - the llm/tool split trend card on the Token Usage page.
 * Real caller: `src/pages/Settings/TokenUsage/index.tsx:17` (barrel import)
 * rendered at `:266` as `<TokenTypeChart chartConfig={tokenTypeConfig} />`.
 *
 * The only decision this component makes is the null-guard: `tokenTypeConfig`
 * comes from `useTokenTypeConfig`, which returns `null` when the fetched
 * breakdown is empty (hook source line 32). So "no data" must render NOTHING
 * rather than an empty chart card - the page already has its own EmptyState
 * for that case, and a stray blank card would be the visible symptom.
 *
 * Both sides of that guard are asserted here (guard taken AND guard not
 * taken), because a regression that renders an empty card is exactly the kind
 * of change that leaves coverage at 100% if only the happy path is tested.
 *
 * Harness notes:
 *   - `@ant-design/plots` is stubbed with prop capture rather than aliased:
 *     `vite.config.ts` deliberately keeps large vendor packages out of the
 *     unit-test transform, and the real `Line` needs a canvas that jsdom does
 *     not provide. The stub records the spread config so the test can assert
 *     the chart receives the caller's config VERBATIM (a chart that silently
 *     drops xField/yField renders blank while still "passing" a shallow
 *     render test).
 *   - `@agentscope-ai/design` gets its own stub because the shared
 *     `src/test/design-mock.ts` does not export `Card` at all, and that shared
 *     stub must not be modified. The stub renders `title` and `className`
 *     into observable positions.
 *   - `styles` is the real CSS-module map (probe-verified: `chartCard`
 *     resolves to `_chartCard_f1bb75`, a non-empty string), so the class
 *     assertions below would fail loudly if the module ever stopped exporting
 *     those keys instead of passing by comparing undefined to undefined.
 *   - The i18n stub returns the key itself, so the assertions pin the KEY the
 *     product asked for, not an English sentence that could be reworded
 *     without any behaviour change. The key and its default were both read
 *     off the source: `src/locales/en.json:2265` holds
 *     `"tokenTypeChart": "Token Type Trend"`, matching the fallback literal.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const lineCalls = vi.hoisted(() => ({ list: [] as unknown[] }));
const tCalls = vi.hoisted(() => ({ list: [] as unknown[][] }));

vi.mock("@ant-design/plots", () => ({
  Line: (props: unknown) => {
    lineCalls.list.push(props);
    return React.createElement("div", { "data-role": "line-chart" });
  },
}));

vi.mock("@agentscope-ai/design", () => ({
  Card: ({
    children,
    title,
    className,
  }: {
    children?: React.ReactNode;
    title?: React.ReactNode;
    className?: string;
  }) =>
    React.createElement(
      "div",
      { "data-role": "card", className },
      React.createElement("div", { "data-role": "card-title" }, title),
      children,
    ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (...args: unknown[]) => {
      tCalls.list.push(args);
      return args[0];
    },
  }),
}));

import { TokenTypeChart } from "./TokenTypeChart";
import styles from "../index.module.less";

/** Shape mirrors what `useTokenTypeConfig` returns (hook lines 78+). */
const CONFIG = {
  data: [
    { date: "2026-10-01", type: "llm", value: 120 },
    { date: "2026-10-01", type: "tool", value: 30 },
  ],
  xField: "date",
  yField: "value",
  colorField: "type",
  smooth: true,
};

const CHART_STUB = '[data-role="line-chart"]';
const CARD_STUB = '[data-role="card"]';
const TITLE_STUB = '[data-role="card-title"]';

describe("TokenTypeChart - the null guard", () => {
  it("renders nothing at all when chartConfig is null", () => {
    const { container } = render(<TokenTypeChart chartConfig={null} />);
    expect(container.querySelector(CARD_STUB)).toBeNull();
    expect(container.querySelector(CHART_STUB)).toBeNull();
    // The component returns null, so the container must be literally empty.
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when chartConfig is undefined", () => {
    const { container } = render(<TokenTypeChart chartConfig={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("does not touch the charting library on the guarded path", () => {
    lineCalls.list.length = 0;
    render(<TokenTypeChart chartConfig={null} />);
    expect(lineCalls.list.length).toBe(0);
  });

  it("renders the card when a config is present", () => {
    const { container } = render(<TokenTypeChart chartConfig={CONFIG} />);
    expect(container.querySelector(CARD_STUB)).toBeTruthy();
  });
});

describe("TokenTypeChart - the card chrome", () => {
  it("applies the CSS-module card class", () => {
    const { container } = render(<TokenTypeChart chartConfig={CONFIG} />);
    // Probe-verified non-empty; a missing export would make this fail.
    expect(styles.chartCard.length).toBeGreaterThan(0);
    expect(container.querySelector(CARD_STUB)?.className).toBe(
      styles.chartCard,
    );
  });

  it("wraps the title in the CSS-module title class", () => {
    render(<TokenTypeChart chartConfig={CONFIG} />);
    const title = screen.getByText("tokenUsage.tokenTypeChart");
    expect(title.tagName).toBe("SPAN");
    expect(title.className).toBe(styles.chartTitle);
  });

  it("asks i18n for the product's own key plus the English default", () => {
    tCalls.list.length = 0;
    render(<TokenTypeChart chartConfig={CONFIG} />);
    const chartCall = tCalls.list.find(
      (a) => a[0] === "tokenUsage.tokenTypeChart",
    );
    expect(chartCall).toBeTruthy();
    expect(chartCall?.[1]).toBe("Token Type Trend");
  });

  it("renders exactly one title and one chart", () => {
    const { container } = render(<TokenTypeChart chartConfig={CONFIG} />);
    expect(container.querySelectorAll(TITLE_STUB).length).toBe(1);
    expect(container.querySelectorAll(CHART_STUB).length).toBe(1);
  });
});

describe("TokenTypeChart - the config is handed to the chart verbatim", () => {
  it("spreads every config field into the Line chart", () => {
    lineCalls.list.length = 0;
    render(<TokenTypeChart chartConfig={CONFIG} />);
    expect(lineCalls.list.length).toBe(1);
    const props = lineCalls.list[0] as Record<string, unknown>;
    // A chart with dropped axis fields renders blank while still mounting.
    expect(props.xField).toBe("date");
    expect(props.yField).toBe("value");
    expect(props.colorField).toBe("type");
    expect(props.smooth).toBe(true);
  });

  it("passes the data array through by identity", () => {
    lineCalls.list.length = 0;
    render(<TokenTypeChart chartConfig={CONFIG} />);
    const props = lineCalls.list[0] as { data: unknown };
    expect(props.data).toBe(CONFIG.data);
    expect((props.data as unknown[]).length).toBe(2);
  });

  it("does not invent fields the caller never supplied", () => {
    lineCalls.list.length = 0;
    render(<TokenTypeChart chartConfig={CONFIG} />);
    const props = lineCalls.list[0] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(Object.keys(CONFIG).sort());
  });

  it("re-renders with the new config when the caller swaps it", () => {
    lineCalls.list.length = 0;
    const next = { ...CONFIG, smooth: false };
    const { rerender } = render(<TokenTypeChart chartConfig={CONFIG} />);
    rerender(<TokenTypeChart chartConfig={next} />);
    expect(lineCalls.list.length).toBe(2);
    const last = lineCalls.list[1] as Record<string, unknown>;
    expect(last.smooth).toBe(false);
    expect(last.xField).toBe("date");
  });
});
