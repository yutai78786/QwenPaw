/**
 * OpenRouterFilterSection - the "Add Models" drawer inside the remote model
 * management modal (Settings > Models > OpenRouter). It owns three filter
 * facets (provider series, input modality, free-only), a provider search box
 * that scopes two of the bulk actions, and the discovered-model result list
 * whose rows carry per-modality icons and derived pricing text.
 *
 * What this file pins:
 *   1. the collapse toggle: the panel exists only while showFilters is true,
 *      the expanded modifier class tracks that same flag, clicking the toggle
 *      delegates upward, and the provider search query survives a
 *      collapse/expand round trip because the state lives in this component
 *      and not in the panel subtree;
 *   2. the provider search: the query is trimmed and lower-cased before it is
 *      matched, an empty (or whitespace-only) query means "no filtering"
 *      rather than "match nothing", a query with no hit renders the empty
 *      state, and the two bulk buttons are disabled exactly while the
 *      filtered set is empty;
 *   3. select-all and clear are scoped to the FILTERED set: select all merges
 *      the filtered providers into the current selection (deduplicated, with
 *      a selection outside the filter preserved), clear removes only the
 *      filtered ones;
 *   4. the two toggle handlers are idempotent on the "already selected" arm:
 *      they hand back the very same array instance instead of a new one with a
 *      duplicate, which is what keeps the parent from re-rendering churn;
 *   5. the modality facet: four fixed options in a fixed order, each label
 *      carrying its own icon, each switch toggling only its own value;
 *   6. the free-only switch forwards the raw boolean in both directions;
 *   7. the result list: rendered only for a non-empty discovery, one row per
 *      model, and every Add button hands back the model object of ITS OWN row
 *      (not row 0) and is disabled while a save is in flight;
 *   8. the free tag: rendered only for is_free models, and its inline style is
 *      the three literals merged with freeTagStyle where freeTagStyle wins;
 *   9. the meta row icons: one icon per present input modality in source
 *      order, plus the output-image icon carrying its own class, and nothing
 *      at all when the modality arrays are absent from the payload;
 *  10. ModelPricing: no pricing object, or a pricing object without `prompt`,
 *      renders nothing; `prompt` alone renders the input price only;
 *      `completion` adds the output price; both are the string value parsed as
 *      a float and scaled to a price per million with two decimals;
 *  11. which labels carry a literal English fallback when i18n returns an
 *      empty string, and which ones do not.
 *
 * Three stubbing facts drive the design of this file (all probed, not
 * assumed):
 *   - vite.config.ts aliases the WHOLE @agentscope-ai/icons package to
 *     src/test/icons-mock.ts, and that shared stub does not export the six
 *     Spark* icons this component imports (SparkImageuploadLine,
 *     SparkAudiouploadLine, SparkVideouploadLine, SparkFilePdfLine,
 *     SparkTextLine, SparkTextImageLine). Importing them would yield
 *     undefined and the render would throw. This file therefore installs a
 *     LOCAL Proxy-based mock that keeps every real stub export and only
 *     answers the missing Spark* names, stamping each placeholder with the
 *     icon name it stands for. That keeps the assertions about WHICH icon a
 *     row shows meaningful, and it touches no shared file. The same local
 *     technique is already used by src/pages/Chat/HostBubbles.render.test.tsx.
 *   - the shared design stub renders Switch as a real
 *     <input type="checkbox" role="switch"> that calls onChange with
 *     e.target.checked, Button as a real <button> that forwards className and
 *     disabled and drops `icon` into the children, Input as a real <input>,
 *     and Tag as a pass-through <div> that keeps `style`. So this file drives
 *     switches with real click events and reads classes and disabled flags
 *     off real DOM nodes.
 *   - that same Button forwards `loading` onto a native <button>, and React
 *     refuses to write a non-boolean attribute: it warns and omits it. The
 *     in-flight visual state of the fetch button is therefore NOT observable
 *     here (the warning is a test infrastructure artifact, the real design
 *     library consumes `loading`), so this file asserts the fetch button
 *     through its callback and never through a loading attribute.
 *
 * Nothing is mocked in the product path itself: this component takes every
 * value and every callback as props, so the fixtures below are the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React, { type ComponentProps } from "react";
import type { ExtendedModelInfo } from "../../../../../api/types";

const h = vi.hoisted(() => ({
  /** Keys whose t() call must answer "" so the literal fallbacks get taken. */
  emptyKeys: new Set<string>(),
  /** One stable placeholder component per missing Spark* icon name. */
  sparkPlaceholders: new Map<
    string,
    (props: Record<string, unknown>) => React.ReactElement
  >(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      h.emptyKeys.has("*") || h.emptyKeys.has(key) ? "" : key,
    i18n: { language: "en" },
  }),
}));

// Local, additive mock: keep every export of the shared icons stub and only
// answer the six Spark* names that stub does not export. Each placeholder is
// stamped with the icon name so a row's icon list can be asserted exactly.
vi.mock("@agentscope-ai/icons", async (importOriginal) => {
  const icons = await importOriginal<Record<string, unknown>>();
  const placeholderFor = (name: string) => {
    const cached = h.sparkPlaceholders.get(name);
    if (cached) {
      return cached;
    }
    // Props must be forwarded: the real icons accept className/style, and
    // the output-modality icon is identified by a class of its own.
    const component = (props: Record<string, unknown>) => (
      <span data-spark-icon={name} {...props} />
    );
    h.sparkPlaceholders.set(name, component);
    return component;
  };
  return new Proxy(icons, {
    has: (target, key) =>
      Reflect.has(target, key) || String(key).startsWith("Spark"),
    get: (target, key) =>
      Reflect.get(target, key) ??
      (String(key).startsWith("Spark")
        ? placeholderFor(String(key))
        : undefined),
  });
});

import { OpenRouterFilterSection } from "./OpenRouterFilterSection";
import styles from "./OpenRouterFilterSection.module.less";

/** The four modality options in source order, with the icon each one shows. */
const MODALITY_ROWS: Array<{ value: string; labelKey: string; icon: string }> =
  [
    {
      value: "image",
      labelKey: "models.modalityVision",
      icon: "SparkImageuploadLine",
    },
    {
      value: "audio",
      labelKey: "models.modalityAudio",
      icon: "SparkAudiouploadLine",
    },
    {
      value: "video",
      labelKey: "models.modalityVideo",
      icon: "SparkVideouploadLine",
    },
    {
      value: "file",
      labelKey: "models.modalityFile",
      icon: "SparkFilePdfLine",
    },
  ];

function makeModel(
  overrides: Partial<ExtendedModelInfo> = {},
): ExtendedModelInfo {
  return {
    id: "m1",
    name: "Model One",
    provider: "openai",
    input_modalities: ["text"],
    output_modalities: ["text"],
    pricing: {},
    is_free: false,
    ...overrides,
  } as ExtendedModelInfo;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    showFilters: true,
    availableSeries: ["openai", "anthropic", "google"],
    selectedSeries: [] as string[],
    selectedInputModalities: [] as string[],
    showFreeOnly: false,
    loadingFilters: false,
    discoveredModels: [] as ExtendedModelInfo[],
    saving: false,
    freeTagStyle: {} as React.CSSProperties,
    onToggleFilters: vi.fn(),
    onSelectedSeriesChange: vi.fn(),
    onSelectedInputModalitiesChange: vi.fn(),
    onShowFreeOnlyChange: vi.fn(),
    onFetchModels: vi.fn(),
    onAddModel: vi.fn(),
    ...overrides,
  };
}

type Props = ReturnType<typeof makeProps>;

/** The component contract: spreading a fixture needs this, not `never`. */
type SectionProps = ComponentProps<typeof OpenRouterFilterSection>;

function renderSection(overrides: Record<string, unknown> = {}) {
  const props = makeProps(overrides) as unknown as Props;
  const view = render(<OpenRouterFilterSection {...(props as SectionProps)} />);
  return { ...view, props, container: view.container };
}

/** The collapse/expand toggle is the only button outside the panel. */
function toggleButton(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.${styles.toggleButton}`,
  );
  if (!found) throw new Error("toggle button not rendered");
  return found;
}

function panel(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.${styles.panel}`);
}

function providerRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`.${styles.providerRow}`),
  );
}

/** The switch belonging to a provider row, by the provider name it displays. */
function providerSwitch(
  container: HTMLElement,
  provider: string,
): HTMLInputElement {
  const row = providerRows(container).find(
    (r) => r.querySelector(`.${styles.providerName}`)?.textContent === provider,
  );
  if (!row) throw new Error(`provider row not rendered: ${provider}`);
  const sw = row.querySelector<HTMLInputElement>('[role="switch"]');
  if (!sw) throw new Error(`provider switch not rendered: ${provider}`);
  return sw;
}

function modalityRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`.${styles.modalitySwitchRow}`),
  );
}

function modalitySwitch(
  container: HTMLElement,
  index: number,
): HTMLInputElement {
  const row = modalityRows(container)[index];
  if (!row) throw new Error(`modality row not rendered at ${index}`);
  const sw = row.querySelector<HTMLInputElement>('[role="switch"]');
  if (!sw) throw new Error(`modality switch not rendered at ${index}`);
  return sw;
}

function freeOnlySwitch(container: HTMLElement): HTMLInputElement {
  const row = container.querySelector<HTMLElement>(`.${styles.freeOnlyRow}`);
  if (!row) throw new Error("free-only row not rendered");
  const sw = row.querySelector<HTMLInputElement>('[role="switch"]');
  if (!sw) throw new Error("free-only switch not rendered");
  return sw;
}

/** The two bulk buttons live in the provider controls block, in source order. */
function bulkButtons(container: HTMLElement): HTMLButtonElement[] {
  const controls = container.querySelector<HTMLElement>(
    `.${styles.providerControls}`,
  );
  if (!controls) throw new Error("provider controls not rendered");
  return Array.from(controls.querySelectorAll<HTMLButtonElement>("button"));
}

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `.${styles.providerSearchInput}`,
  );
  if (!input) throw new Error("provider search input not rendered");
  return input;
}

function fetchButton(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.${styles.fetchButton}`,
  );
  if (!found) throw new Error("fetch button not rendered");
  return found;
}

function modelRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`.${styles.modelRow}`),
  );
}

/** Icon names rendered inside an element, in DOM order. */
function sparkIcons(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll("[data-spark-icon]")).map((node) =>
    node.getAttribute("data-spark-icon"),
  ) as string[];
}

function freeTag(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(`.${styles.modelNameRow} > div`);
}

function priceOf(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(`.${styles.price}`);
}

beforeEach(() => {
  h.emptyKeys.clear();
});

describe("OpenRouterFilterSection collapse toggle", () => {
  it("renders only the toggle button while collapsed", () => {
    const { container } = renderSection({ showFilters: false });

    expect(panel(container)).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(providerRows(container)).toHaveLength(0);
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("renders the whole panel once expanded", () => {
    const { container } = renderSection({ showFilters: true });

    expect(panel(container)).not.toBeNull();
    // 3 providers + 4 modalities + 1 free-only switch.
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(8);
    // toggle + select all + clear + fetch (no result rows yet).
    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("tracks the expanded modifier class off the same flag", () => {
    const collapsed = renderSection({ showFilters: false });
    const expanded = renderSection({ showFilters: true });

    expect(toggleButton(collapsed.container).className.split(" ")).toEqual([
      styles.toggleButton,
      "",
    ]);
    expect(toggleButton(expanded.container).className.split(" ")).toEqual([
      styles.toggleButton,
      styles.toggleButtonExpanded,
    ]);
  });

  it("delegates the toggle upward without touching any filter value", () => {
    const { container, props } = renderSection({ showFilters: false });

    fireEvent.click(toggleButton(container));

    expect(props.onToggleFilters).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
    expect(props.onSelectedInputModalitiesChange).not.toHaveBeenCalled();
    expect(props.onShowFreeOnlyChange).not.toHaveBeenCalled();
  });

  it("shows the add-models label on the toggle", () => {
    const { container } = renderSection();

    expect(toggleButton(container).textContent).toBe("models.addModels");
  });

  it("keeps the provider search query across a collapse and expand", () => {
    const props = makeProps({ showFilters: true });
    const { container, rerender } = render(
      <OpenRouterFilterSection {...(props as SectionProps)} />,
    );

    fireEvent.change(searchInput(container), { target: { value: "anth" } });
    expect(providerRows(container)).toHaveLength(1);

    rerender(
      <OpenRouterFilterSection
        {...({ ...props, showFilters: false } as SectionProps)}
      />,
    );
    expect(panel(container)).toBeNull();

    rerender(
      <OpenRouterFilterSection
        {...({ ...props, showFilters: true } as SectionProps)}
      />,
    );
    // The query is state of this component, not of the panel subtree.
    expect(searchInput(container).value).toBe("anth");
    expect(providerRows(container)).toHaveLength(1);
  });
});

describe("OpenRouterFilterSection provider search", () => {
  it("renders one row per available series when nothing is typed", () => {
    const { container } = renderSection();

    expect(providerRows(container).map((r) => r.textContent)).toEqual([
      "openai",
      "anthropic",
      "google",
    ]);
    expect(searchInput(container).value).toBe("");
  });

  it("matches case-insensitively and on substrings", () => {
    const { container } = renderSection();

    fireEvent.change(searchInput(container), { target: { value: "OPEN" } });

    expect(providerRows(container).map((r) => r.textContent)).toEqual([
      "openai",
    ]);
  });

  it("trims surrounding whitespace before matching", () => {
    const { container } = renderSection();

    fireEvent.change(searchInput(container), {
      target: { value: "  google  " },
    });

    expect(providerRows(container).map((r) => r.textContent)).toEqual([
      "google",
    ]);
  });

  it("treats a whitespace-only query as no filtering at all", () => {
    const { container } = renderSection();

    fireEvent.change(searchInput(container), { target: { value: "   " } });

    // Not the empty state: the trimmed query is empty, so nothing is filtered.
    expect(container.querySelector(`.${styles.providerEmpty}`)).toBeNull();
    expect(providerRows(container)).toHaveLength(3);
    expect(bulkButtons(container).map((b) => b.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("renders the empty state and disables both bulk buttons on no hit", () => {
    const { container } = renderSection();

    fireEvent.change(searchInput(container), { target: { value: "zzz" } });

    expect(providerRows(container)).toHaveLength(0);
    expect(
      container.querySelector(`.${styles.providerEmpty}`)?.textContent,
    ).toBe("models.noMatchingProviders");
    expect(bulkButtons(container).map((b) => b.disabled)).toEqual([true, true]);
  });

  it("re-enables both bulk buttons once a hit comes back", () => {
    const { container } = renderSection();
    const input = searchInput(container);

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(bulkButtons(container).map((b) => b.disabled)).toEqual([true, true]);

    fireEvent.change(input, { target: { value: "goo" } });
    expect(providerRows(container).map((r) => r.textContent)).toEqual([
      "google",
    ]);
    expect(bulkButtons(container).map((b) => b.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("renders the empty state when there is no series to pick from", () => {
    const { container } = renderSection({ availableSeries: [] });

    expect(providerRows(container)).toHaveLength(0);
    expect(
      container.querySelector(`.${styles.providerEmpty}`)?.textContent,
    ).toBe("models.noMatchingProviders");
    expect(bulkButtons(container).map((b) => b.disabled)).toEqual([true, true]);
  });

  it("carries the search placeholder", () => {
    const { container } = renderSection();

    expect(searchInput(container).placeholder).toBe(
      "models.searchProviderPlaceholder",
    );
  });
});

describe("OpenRouterFilterSection select all and clear", () => {
  it("selects every series when nothing is filtered and nothing selected", () => {
    const { container, props } = renderSection();

    fireEvent.click(bulkButtons(container)[0]);

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "anthropic",
      "google",
    ]);
  });

  it("merges without duplicating an already selected series", () => {
    const { container, props } = renderSection({ selectedSeries: ["openai"] });

    fireEvent.click(bulkButtons(container)[0]);

    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "anthropic",
      "google",
    ]);
  });

  it("keeps a selection that the current filter hides", () => {
    const { container, props } = renderSection({ selectedSeries: ["google"] });

    // "a" hides google but matches openai and anthropic.
    fireEvent.change(searchInput(container), { target: { value: "a" } });
    expect(providerRows(container).map((r) => r.textContent)).toEqual([
      "openai",
      "anthropic",
    ]);

    fireEvent.click(bulkButtons(container)[0]);

    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "google",
      "openai",
      "anthropic",
    ]);
  });

  it("clears every series when nothing is filtered", () => {
    const { container, props } = renderSection({
      selectedSeries: ["openai", "google"],
    });

    fireEvent.click(bulkButtons(container)[1]);

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([]);
  });

  it("clears only the series the current filter shows", () => {
    const { container, props } = renderSection({
      selectedSeries: ["google", "openai", "anthropic"],
    });

    fireEvent.change(searchInput(container), { target: { value: "a" } });
    fireEvent.click(bulkButtons(container)[1]);

    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual(["google"]);
  });

  it("hands back an empty array when clearing an already empty selection", () => {
    const { container, props } = renderSection({ selectedSeries: [] });

    fireEvent.click(bulkButtons(container)[1]);

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([]);
  });
});

describe("OpenRouterFilterSection provider switches", () => {
  it("reflects the incoming selection in the checked flags", () => {
    const { container } = renderSection({ selectedSeries: ["anthropic"] });

    expect(
      providerRows(container).map(
        (row) =>
          row.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
      ),
    ).toEqual([false, true, false]);
  });

  it("appends a series that is not selected yet", () => {
    const { container, props } = renderSection({ selectedSeries: ["openai"] });

    fireEvent.click(providerSwitch(container, "google"));

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "google",
    ]);
  });

  it("never hands back a duplicate when the series is already selected", () => {
    // The switch for a selected series renders checked, so turning it off is
    // the only DOM-reachable outcome (see the next test): this pins that the
    // resulting array drops the entry once and keeps the other one.
    const { container, props } = renderSection({
      selectedSeries: ["openai", "google"],
    });

    fireEvent.click(providerSwitch(container, "openai"));

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual(["google"]);
  });

  it("hands back the very same array instance when the switch reports a state the parent never adopted", () => {
    // handleToggleProvider has a defensive arm: called with checked=true for a
    // series that is ALREADY in selectedSeries it returns the identical array
    // instead of appending a duplicate. The row's rendered checked flag and
    // that guard read the same expression (selectedSeries.includes(provider)),
    // so a plain controlled click always reports the opposite of the current
    // state and never enters the arm.
    //
    // The arm IS reachable from the DOM though, because the component is fully
    // controlled: push the DOM node off first (through a change event, which
    // also updates React's value tracker) and then click it. The click then
    // reports checked=true while the parent prop still lists the series, which
    // is exactly the stale-state case the arm defends against. The next test
    // pins the one sequence that does NOT work and why.
    const selectedSeries = ["openai", "google"];
    const { container, props } = renderSection({ selectedSeries });
    const sw = providerSwitch(container, "openai");
    expect(sw.checked).toBe(true);

    fireEvent.change(sw, { target: { checked: false } });
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    // Identity, not just equality: no new array and no duplicate entry.
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toBe(selectedSeries);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "google",
    ]);
  });

  it("does not deliver anything when the DOM node is forced off behind React's value tracker", () => {
    // Probed, not assumed: writing `checked` through the native setter leaves
    // React's _valueTracker still holding the old value, so the following
    // click looks like "no change" to React and no onChange is dispatched at
    // all (the node ends up checked again and zero callbacks run). That is why
    // the arm above has to be reached through fireEvent.change, which updates
    // the tracker the way React expects.
    const selectedSeries = ["openai", "google"];
    const { container, props } = renderSection({ selectedSeries });
    const sw = providerSwitch(container, "openai");

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "checked",
    )?.set;
    expect(typeof nativeSetter).toBe("function");
    nativeSetter?.call(sw, false);
    expect(sw.checked).toBe(false);

    fireEvent.click(sw);

    expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
    // Negative control: the DOM node did flip back, so the click itself was
    // delivered - what was swallowed is the change event, not the click.
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual(["google"]);
  });

  it("removes a series when its switch is turned off", () => {
    const { container, props } = renderSection({
      selectedSeries: ["openai", "google"],
    });

    const sw = providerSwitch(container, "openai");
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);

    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual(["google"]);
  });

  it("drives only the row that was clicked", () => {
    const { container, props } = renderSection({
      selectedSeries: ["openai", "anthropic", "google"],
    });

    fireEvent.click(providerSwitch(container, "anthropic"));

    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "google",
    ]);
  });

  it("toggles a series that only the current filter shows", () => {
    const { container, props } = renderSection({ selectedSeries: ["openai"] });

    fireEvent.change(searchInput(container), { target: { value: "anth" } });
    fireEvent.click(providerSwitch(container, "anthropic"));

    expect(props.onSelectedSeriesChange.mock.calls[0][0]).toEqual([
      "openai",
      "anthropic",
    ]);
  });
});

describe("OpenRouterFilterSection modality facet", () => {
  it("renders four fixed options in source order with their own icon", () => {
    const { container } = renderSection();
    const rows = modalityRows(container);

    expect(rows).toHaveLength(4);
    rows.forEach((row, index) => {
      const expected = MODALITY_ROWS[index];
      expect(sparkIcons(row)).toEqual([expected.icon]);
      expect(row.textContent).toContain(expected.labelKey);
    });
  });

  it("reflects the incoming modality selection in the checked flags", () => {
    const { container } = renderSection({
      selectedInputModalities: ["video", "file"],
    });

    expect(
      modalityRows(container).map(
        (row) =>
          row.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
      ),
    ).toEqual([false, false, true, true]);
  });

  it("appends a modality that is not selected yet", () => {
    const { container, props } = renderSection({
      selectedInputModalities: ["image"],
    });

    fireEvent.click(modalitySwitch(container, 1));

    expect(props.onSelectedInputModalitiesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toEqual([
      "image",
      "audio",
    ]);
  });

  it("never hands back a duplicate when the modality is already selected", () => {
    // Same shape as the provider facet: the rendered checked flag and the
    // handler's guard read the same expression
    // (selectedInputModalities.includes(option.value)), so a controlled click
    // on a selected row can only report "off".
    const { container, props } = renderSection({
      selectedInputModalities: ["image", "audio"],
    });

    fireEvent.click(modalitySwitch(container, 0));

    expect(props.onSelectedInputModalitiesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toEqual([
      "audio",
    ]);
  });

  it("hands back the very same array instance when the switch reports a stale modality state", () => {
    // The modality facet mirrors the provider facet: the defensive identity
    // arm of handleToggleModality is unreachable with a plain controlled click
    // (rendered checked and the guard both read
    // selectedInputModalities.includes(option.value)) but reachable by pushing
    // the DOM node off first and then clicking it.
    const selectedInputModalities = ["image", "audio"];
    const { container, props } = renderSection({ selectedInputModalities });
    const sw = modalitySwitch(container, 0);
    expect(sw.checked).toBe(true);

    fireEvent.change(sw, { target: { checked: false } });
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);

    expect(props.onSelectedInputModalitiesChange).toHaveBeenCalledTimes(1);
    expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toBe(
      selectedInputModalities,
    );
    expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toEqual([
      "image",
      "audio",
    ]);
  });

  it("removes a modality when its switch is turned off", () => {
    const { container, props } = renderSection({
      selectedInputModalities: ["image", "audio"],
    });

    fireEvent.click(modalitySwitch(container, 1));

    expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toEqual([
      "image",
    ]);
  });

  it.each(MODALITY_ROWS.map((row, index) => [row.value, index] as const))(
    "toggles only %s and never the provider selection",
    (value, index) => {
      const { container, props } = renderSection({
        selectedSeries: ["openai"],
        selectedInputModalities: [],
      });

      fireEvent.click(modalitySwitch(container, index));

      expect(props.onSelectedInputModalitiesChange.mock.calls[0][0]).toEqual([
        value,
      ]);
      expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
    },
  );

  it("leaves the provider and free-only facets untouched", () => {
    const { container, props } = renderSection({ showFreeOnly: true });

    fireEvent.click(modalitySwitch(container, 0));

    expect(props.onShowFreeOnlyChange).not.toHaveBeenCalled();
    expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
  });
});

describe("OpenRouterFilterSection free-only switch", () => {
  it("reflects the incoming flag", () => {
    expect(
      freeOnlySwitch(renderSection({ showFreeOnly: true }).container).checked,
    ).toBe(true);
    expect(
      freeOnlySwitch(renderSection({ showFreeOnly: false }).container).checked,
    ).toBe(false);
  });

  it("forwards the raw boolean in both directions", () => {
    const on = renderSection({ showFreeOnly: false });
    fireEvent.click(freeOnlySwitch(on.container));
    expect(on.props.onShowFreeOnlyChange).toHaveBeenCalledTimes(1);
    expect(on.props.onShowFreeOnlyChange.mock.calls[0][0]).toBe(true);

    const off = renderSection({ showFreeOnly: true });
    fireEvent.click(freeOnlySwitch(off.container));
    expect(off.props.onShowFreeOnlyChange).toHaveBeenCalledTimes(1);
    expect(off.props.onShowFreeOnlyChange.mock.calls[0][0]).toBe(false);
  });

  it("shows its label next to the switch", () => {
    const { container } = renderSection();

    expect(
      container.querySelector(`.${styles.freeOnlyLabel}`)?.textContent,
    ).toBe("models.filterFreeOnly");
  });
});

describe("OpenRouterFilterSection fetch button", () => {
  it("delegates the fetch upward and touches no filter value", () => {
    const { container, props } = renderSection();

    fireEvent.click(fetchButton(container));

    expect(props.onFetchModels).toHaveBeenCalledTimes(1);
    expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
    expect(props.onSelectedInputModalitiesChange).not.toHaveBeenCalled();
    expect(props.onShowFreeOnlyChange).not.toHaveBeenCalled();
  });

  it("stays clickable while a fetch is already in flight", () => {
    // `loading` is forwarded onto a native <button> by the shared stub and
    // React omits it, so the in-flight visual state is not observable here.
    // What the product guarantees is that loading does NOT disable the button.
    const { container, props } = renderSection({ loadingFilters: true });

    const button = fetchButton(container);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("loading")).toBeNull();

    fireEvent.click(button);
    expect(props.onFetchModels).toHaveBeenCalledTimes(1);
  });

  it("renders the facet labels above it", () => {
    const { container } = renderSection();
    const labels = Array.from(
      container.querySelectorAll(`.${styles.filterLabel}`),
    ).map((node) => node.textContent);

    expect(labels).toEqual([
      "models.filterByProvider",
      "models.filterByModality",
    ]);
  });
});

describe("OpenRouterFilterSection result list", () => {
  it("renders nothing for an empty discovery", () => {
    const { container } = renderSection({ discoveredModels: [] });

    expect(container.querySelector(`.${styles.results}`)).toBeNull();
    expect(modelRows(container)).toHaveLength(0);
  });

  it("renders a titled row per discovered model", () => {
    const models = [
      makeModel({ id: "a", name: "Alpha", provider: "openai" }),
      makeModel({ id: "b", name: "Beta", provider: "anthropic" }),
    ];
    const { container } = renderSection({ discoveredModels: models });

    expect(
      container.querySelector(`.${styles.resultsTitle}`)?.textContent,
    ).toBe("models.discovered");
    expect(modelRows(container)).toHaveLength(2);
    expect(
      modelRows(container).map(
        (row) =>
          row.querySelector(`.${styles.modelNameRow} > span`)?.textContent,
      ),
    ).toEqual(["Alpha", "Beta"]);
    expect(
      modelRows(container).map(
        (row) => row.querySelector(`.${styles.modelMeta} > span`)?.textContent,
      ),
    ).toEqual(["openai", "anthropic"]);
  });

  it("hands every Add button the model object of its own row", () => {
    const models = [
      makeModel({ id: "a", name: "Alpha" }),
      makeModel({ id: "b", name: "Beta" }),
      makeModel({ id: "c", name: "Gamma" }),
    ];
    const { container, props } = renderSection({ discoveredModels: models });
    const rows = modelRows(container);

    fireEvent.click(rows[2].querySelector("button")!);
    expect(props.onAddModel).toHaveBeenCalledTimes(1);
    expect(props.onAddModel.mock.calls[0][0]).toBe(models[2]);

    fireEvent.click(rows[0].querySelector("button")!);
    expect(props.onAddModel).toHaveBeenCalledTimes(2);
    expect(props.onAddModel.mock.calls[1][0]).toBe(models[0]);
  });

  it("labels every Add button", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel(), makeModel({ id: "b" })],
    });

    expect(
      modelRows(container).map(
        (row) => row.querySelector("button")?.textContent,
      ),
    ).toEqual(["models.add", "models.add"]);
  });

  it("disables every Add button while a save is in flight", () => {
    const models = [makeModel({ id: "a" }), makeModel({ id: "b" })];

    const idle = renderSection({ discoveredModels: models, saving: false });
    expect(
      modelRows(idle.container).map((r) => r.querySelector("button")!.disabled),
    ).toEqual([false, false]);

    const busy = renderSection({ discoveredModels: models, saving: true });
    expect(
      modelRows(busy.container).map((r) => r.querySelector("button")!.disabled),
    ).toEqual([true, true]);
  });

  it("still reports a clicked row while a save is in flight is impossible", () => {
    // A disabled button never dispatches, so the guard is the DOM itself.
    const models = [makeModel({ id: "a" })];
    const { container, props } = renderSection({
      discoveredModels: models,
      saving: true,
    });

    fireEvent.click(modelRows(container)[0].querySelector("button")!);

    expect(props.onAddModel).not.toHaveBeenCalled();
  });
});

describe("OpenRouterFilterSection free tag", () => {
  it("renders the tag only for a free model", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({ id: "free", name: "Free One", is_free: true }),
        makeModel({ id: "paid", name: "Paid One", is_free: false }),
      ],
    });
    const rows = modelRows(container);

    expect(freeTag(rows[0])?.textContent).toBe("models.free");
    expect(freeTag(rows[1])).toBeNull();
  });

  it("omits the tag when the flag is absent from the payload", () => {
    const model = makeModel({ id: "x" });
    delete (model as Partial<ExtendedModelInfo>).is_free;
    const { container } = renderSection({ discoveredModels: [model] });

    expect(freeTag(modelRows(container)[0])).toBeNull();
  });

  it("puts the gift icon inside the tag", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "free", is_free: true })],
    });
    const tag = freeTag(modelRows(container)[0])!;

    // The antd icon comes from the real package, so it renders an anticon span.
    expect(tag.querySelector(".anticon")).not.toBeNull();
    expect(tag.textContent).toBe("models.free");
  });

  it("merges the three literals with freeTagStyle, and freeTagStyle wins", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "free", is_free: true })],
      freeTagStyle: { fontSize: 20, color: "rgb(9, 9, 9)" },
    });
    const tag = freeTag(modelRows(container)[0])!;

    expect(tag.style.lineHeight).toBe("16px");
    expect(tag.style.marginRight).toBe("0px");
    // Both of these come from freeTagStyle, overriding the literals.
    expect(tag.style.fontSize).toBe("20px");
    expect(tag.style.color).toBe("rgb(9, 9, 9)");
  });

  it("keeps the literals when freeTagStyle is empty", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "free", is_free: true })],
      freeTagStyle: {},
    });
    const tag = freeTag(modelRows(container)[0])!;

    expect(tag.style.fontSize).toBe("11px");
    expect(tag.style.lineHeight).toBe("16px");
    expect(tag.style.marginRight).toBe("0px");
  });
});

describe("OpenRouterFilterSection meta row icons", () => {
  it("renders one icon per present input modality in source order", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({
          id: "all",
          input_modalities: ["file", "video", "audio", "image", "text"],
          output_modalities: [],
        }),
      ],
    });

    // Source order of the conditionals, not the order of the payload array.
    expect(sparkIcons(modelRows(container)[0])).toEqual([
      "SparkTextLine",
      "SparkImageuploadLine",
      "SparkAudiouploadLine",
      "SparkVideouploadLine",
      "SparkFilePdfLine",
    ]);
  });

  it("renders only the icons whose modality is present", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({
          id: "text-image",
          input_modalities: ["text", "image"],
          output_modalities: [],
        }),
      ],
    });

    expect(sparkIcons(modelRows(container)[0])).toEqual([
      "SparkTextLine",
      "SparkImageuploadLine",
    ]);
  });

  it("adds the output image icon with its own class", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({
          id: "out",
          input_modalities: ["text"],
          output_modalities: ["image"],
        }),
      ],
    });
    const row = modelRows(container)[0];

    expect(sparkIcons(row)).toEqual(["SparkTextLine", "SparkTextImageLine"]);
    const outputIcon = row.querySelector(`.${styles.outputModalityIcon}`);
    expect(outputIcon?.getAttribute("data-spark-icon")).toBe(
      "SparkTextImageLine",
    );
  });

  it("ignores an output modality other than image", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({
          id: "audio-out",
          input_modalities: [],
          output_modalities: ["audio", "video", "file", "text"],
        }),
      ],
    });

    expect(sparkIcons(modelRows(container)[0])).toEqual([]);
  });

  it("renders no icon when both modality arrays are absent from the payload", () => {
    // ExtendedModelInfo declares both arrays, but they are read through an
    // optional chain because the API payload may omit them. This pins that
    // defensive arm: no icons, no throw.
    const model = makeModel({ id: "bare" });
    delete (model as Partial<ExtendedModelInfo>).input_modalities;
    delete (model as Partial<ExtendedModelInfo>).output_modalities;
    const { container } = renderSection({ discoveredModels: [model] });
    const row = modelRows(container)[0];

    expect(sparkIcons(row)).toEqual([]);
    expect(row.querySelector(`.${styles.modelMeta} > span`)?.textContent).toBe(
      "openai",
    );
  });

  it("shows the provider name first in the meta row", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "p", provider: "deepseek" })],
    });

    expect(
      modelRows(container)[0].querySelector(`.${styles.modelMeta}`)
        ?.textContent,
    ).toContain("deepseek");
  });
});

describe("OpenRouterFilterSection model pricing", () => {
  it("renders nothing when the model carries no pricing object", () => {
    const model = makeModel({ id: "none" });
    delete (model as Partial<ExtendedModelInfo>).pricing;
    const { container } = renderSection({ discoveredModels: [model] });

    expect(priceOf(modelRows(container)[0])).toBeNull();
  });

  it("renders nothing for an empty pricing object", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "empty", pricing: {} })],
    });

    expect(priceOf(modelRows(container)[0])).toBeNull();
  });

  it("renders nothing when only the completion price is present", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({ id: "out-only", pricing: { completion: "0.00001" } }),
      ],
    });

    // `prompt` gates the whole widget, so a completion price alone shows
    // nothing rather than a dangling output price.
    expect(priceOf(modelRows(container)[0])).toBeNull();
  });

  it("scales the prompt price to a per-million figure with two decimals", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({ id: "prompt-only", pricing: { prompt: "0.0000025" } }),
      ],
    });
    const price = priceOf(modelRows(container)[0])!;

    expect(price.textContent).toBe("$2.50models.perMillionIn");
    expect(price.querySelector("span")).toBeNull();
  });

  it("appends the completion price as a separate span", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({
          id: "both",
          pricing: { prompt: "0.0000025", completion: "0.00001" },
        }),
      ],
    });
    const price = priceOf(modelRows(container)[0])!;

    expect(price.textContent).toBe(
      "$2.50models.perMillionIn · $10.00models.perMillionOut",
    );
    expect(price.querySelector("span")?.textContent).toBe(
      " · $10.00models.perMillionOut",
    );
  });

  it("renders a zero prompt price instead of hiding the widget", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({ id: "zero", pricing: { prompt: "0", completion: "0" } }),
      ],
    });
    const price = priceOf(modelRows(container)[0])!;

    // "0" is a truthy string, so the gate passes and both prices show.
    expect(price.textContent).toBe(
      "$0.00models.perMillionIn · $0.00models.perMillionOut",
    );
  });

  it("parses an integer-looking price string", () => {
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "int", pricing: { prompt: "3" } })],
    });

    expect(priceOf(modelRows(container)[0])?.textContent).toBe(
      "$3000000.00models.perMillionIn",
    );
  });

  it("falls back to NaN formatting for a price that is not a number", () => {
    // The product parses with parseFloat and no guard, so a malformed price
    // from the API surfaces as NaN in the label. This pins current behaviour.
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "bad", pricing: { prompt: "free" } })],
    });

    expect(priceOf(modelRows(container)[0])?.textContent).toBe(
      "$NaNmodels.perMillionIn",
    );
  });

  it("renders its own translation hook result", () => {
    const { container } = renderSection({
      discoveredModels: [
        makeModel({ id: "t", pricing: { prompt: "0.000001" } }),
      ],
    });

    expect(priceOf(modelRows(container)[0])?.textContent).toBe(
      "$1.00models.perMillionIn",
    );
  });
});

describe("OpenRouterFilterSection i18n fallbacks", () => {
  it("falls back to the literal label for the seven keys that have one", () => {
    h.emptyKeys.add("*");
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "a" })],
    });

    expect(toggleButton(container).textContent).toBe("Add Models");
    expect(
      Array.from(container.querySelectorAll(`.${styles.filterLabel}`)).map(
        (node) => node.textContent,
      ),
    ).toEqual(["Provider:", "Input Modality:"]);
    expect(
      container.querySelector(`.${styles.freeOnlyLabel}`)?.textContent,
    ).toBe("Free Models Only:");
    expect(fetchButton(container).textContent).toBe("Filter Models");
    expect(
      container.querySelector(`.${styles.resultsTitle}`)?.textContent,
    ).toBe("Available Models:");
    expect(modelRows(container)[0].querySelector("button")?.textContent).toBe(
      "Add",
    );
  });

  it("has no fallback for the provider facet labels", () => {
    h.emptyKeys.add("*");
    const { container } = renderSection({ availableSeries: [] });

    // These four go straight to the DOM with no literal, so an untranslated
    // bundle leaves them empty rather than showing English.
    expect(searchInput(container).placeholder).toBe("");
    expect(bulkButtons(container).map((b) => b.textContent)).toEqual(["", ""]);
    expect(
      container.querySelector(`.${styles.providerEmpty}`)?.textContent,
    ).toBe("");
  });

  it("has no fallback for the modality option labels", () => {
    h.emptyKeys.add("*");
    const { container } = renderSection();

    // The label JSX puts a literal space between the icon and the text, so an
    // untranslated bundle leaves that single space rather than nothing at all.
    expect(modalityRows(container).map((row) => row.textContent)).toEqual([
      " ",
      " ",
      " ",
      " ",
    ]);
    // The icons are not translation driven, so they survive an empty bundle.
    expect(sparkIcons(modalityRows(container)[0])).toEqual([
      "SparkImageuploadLine",
    ]);
  });

  it("has no fallback for the free tag text", () => {
    h.emptyKeys.add("*");
    const { container } = renderSection({
      discoveredModels: [makeModel({ id: "free", is_free: true })],
    });

    expect(freeTag(modelRows(container)[0])?.textContent).toBe("");
  });

  it("takes the fallback for one key only when just that key is empty", () => {
    h.emptyKeys.add("models.addModels");
    const { container } = renderSection();

    expect(toggleButton(container).textContent).toBe("Add Models");
    expect(fetchButton(container).textContent).toBe("models.filterModels");
  });
});

describe("OpenRouterFilterSection isolation between facets", () => {
  it("routes each interaction to exactly one callback", () => {
    const { container, props } = renderSection({
      availableSeries: ["openai"],
      selectedSeries: ["openai"],
      discoveredModels: [makeModel({ id: "a" })],
    });

    fireEvent.click(providerSwitch(container, "openai"));
    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);

    fireEvent.click(modalitySwitch(container, 0));
    expect(props.onSelectedInputModalitiesChange).toHaveBeenCalledTimes(1);

    fireEvent.click(freeOnlySwitch(container));
    expect(props.onShowFreeOnlyChange).toHaveBeenCalledTimes(1);

    fireEvent.click(fetchButton(container));
    expect(props.onFetchModels).toHaveBeenCalledTimes(1);

    fireEvent.click(modelRows(container)[0].querySelector("button")!);
    expect(props.onAddModel).toHaveBeenCalledTimes(1);

    fireEvent.click(toggleButton(container));
    expect(props.onToggleFilters).toHaveBeenCalledTimes(1);

    // Bulk actions were not used above.
    expect(props.onSelectedSeriesChange).toHaveBeenCalledTimes(1);
  });

  it("never calls the parent when only the search query changes", () => {
    const { container, props } = renderSection();

    fireEvent.change(searchInput(container), { target: { value: "open" } });
    fireEvent.change(searchInput(container), { target: { value: "" } });

    expect(props.onSelectedSeriesChange).not.toHaveBeenCalled();
    expect(props.onSelectedInputModalitiesChange).not.toHaveBeenCalled();
    expect(props.onShowFreeOnlyChange).not.toHaveBeenCalled();
    expect(props.onFetchModels).not.toHaveBeenCalled();
    expect(props.onAddModel).not.toHaveBeenCalled();
    expect(props.onToggleFilters).not.toHaveBeenCalled();
  });

  it("renders the whole panel with every facet at its empty extreme", () => {
    const { container } = renderSection({
      availableSeries: [],
      selectedSeries: [],
      selectedInputModalities: [],
      discoveredModels: [],
    });

    expect(panel(container)).not.toBeNull();
    expect(providerRows(container)).toHaveLength(0);
    expect(modalityRows(container)).toHaveLength(4);
    expect(modelRows(container)).toHaveLength(0);
    expect(container.querySelector(`.${styles.results}`)).toBeNull();
  });
});
