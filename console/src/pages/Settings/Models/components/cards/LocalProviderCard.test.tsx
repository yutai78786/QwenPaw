// @vitest-environment jsdom
/**
 * LocalProviderCard - the card that stands for the built-in in-process model
 * provider ("qwenpaw-local") inside Settings > Models. It is reached through
 * `cards/ProviderCard.tsx:20-23`, which routes `provider.id === "qwenpaw-local"`
 * here and every other provider to RemoteProviderCard, so this file is the only
 * coverage of the local branch of that switch.
 *
 * Visible contract under test:
 *
 *   1. `totalCount` is the sum of BOTH model arrays (`models` + `extra_models`),
 *      so a provider that only has user-added models still counts as ready;
 *   2. `statusReady` is `totalCount > 0` and it alone drives the Live badge -
 *      the badge is absent (not merely empty) when the count is zero, and its
 *      text is the count followed by the literal "Live" (the literal is NOT
 *      translated, same as ProviderGroupCard and RemoteProviderCard);
 *   3. the header always shows the provider icon at size 36, the provider name,
 *      and the local tag, regardless of readiness;
 *   4. the body has exactly two fields - Type (a translated label plus the
 *      translated "embedded" value in the mono slot) and Models, whose label is
 *      the literal "Models" and whose VALUE has two mutually exclusive arms:
 *      the translated count (with the interpolation argument the product
 *      passes) when there is at least one model, otherwise the translated
 *      "download first" hint;
 *   5. the single action button hands the very provider object it was rendered
 *      with back to `onOpenModels` - identity, not a copy;
 *   6. the component is `React.memo` WITHOUT a custom comparator: a re-render
 *      with prop-identical references does not re-run the body, while a
 *      structurally equal but newly allocated provider does. Both directions are
 *      pinned so that adding a comparator (or dropping the memo) shows up.
 *
 * Harness notes (measured, not assumed):
 *
 * - `ProviderIcon` is deliberately left unmocked, matching the two sibling card
 *   suites: "which icon does this provider get" is part of what the header
 *   renders, and for `qwenpaw-local` `providerIcon()` returns a real CDN URL, so
 *   the icon renders as an <img> carrying `data-provider-id` and the size.
 * - `t` returns the key verbatim and records its interpolation options, so
 *   assertions pin the i18n key the product asked for plus the `count` it
 *   passed. Keys checked present in `src/locales/en.json`: `models.local`,
 *   `models.localType`, `models.localEmbedded`, `models.modelsCount`,
 *   `models.localDownloadFirst`, `models.models`.
 * - The render counter used for the memo cases counts `t` calls, because `t` is
 *   invoked by the body itself (`useTranslation` + five labels).
 * - `src/test/design-mock.ts` is untouched; this card needs no design stub
 *   because it only renders plain elements.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo } from "../../../../../api/types";

const h = vi.hoisted(() => ({
  // Records EVERY call (not just the last one) and doubles as the render
  // counter for the React.memo cases below.
  stableT: (key: string, options?: Record<string, unknown>) => {
    h.tCalls.push([key, options ?? null]);
    return key;
  },
  stableI18n: { language: "en" },
  tCalls: [] as Array<[string, Record<string, unknown> | null]>,
}));

/** The interpolation options the product passed for one specific i18n key. */
function optionsForKey(key: string): Record<string, unknown> | null {
  const hits = h.tCalls.filter(([k]) => k === key);
  if (hits.length === 0) throw new Error(`t was never called with ${key}`);
  return hits[0][1];
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

import { LocalProviderCard } from "./LocalProviderCard";
import styles from "../../index.module.less";

function modelOf(id: string) {
  return {
    id,
    name: id,
    supports_multimodal: null,
    supports_image: null,
    supports_video: null,
    max_input_length: 1000,
    generate_kwargs: {},
    relay_reasoning: false,
    thinking_enabled: null,
  } as unknown as ProviderInfo["models"][number];
}

/**
 * A complete ProviderInfo shaped like the local provider. Each test states only
 * what it varies; `id` defaults to the value ProviderCard switches on.
 */
function providerOf(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: "qwenpaw-local",
    name: "QwenPaw Local",
    api_key_prefix: "",
    chat_model: "",
    models: [modelOf("builtin-a")],
    extra_models: [],
    is_custom: false,
    is_local: true,
    support_model_discovery: false,
    support_connection_check: false,
    freeze_url: true,
    require_api_key: false,
    api_key: "",
    base_url: "",
    generate_kwargs: {},
    ...overrides,
  } as ProviderInfo;
}

function renderCard(
  overrides: Partial<ProviderInfo> = {},
  onOpenModels = vi.fn(),
) {
  const provider = providerOf(overrides);
  const utils = render(
    <LocalProviderCard provider={provider} onOpenModels={onOpenModels} />,
  );
  return { provider, onOpenModels, ...utils };
}

const badgeOf = (container: HTMLElement) =>
  container.querySelector(`.${styles.groupCardLiveBadge}`);

/** The two body fields, in DOM order, as [label, fieldElement] pairs. */
function fieldsOf(container: HTMLElement): Array<[string, Element]> {
  return Array.from(
    container.querySelectorAll(`.${styles.groupCardField}`),
  ).map((field) => [
    field.querySelector(`.${styles.groupCardFieldLabel}`)?.textContent ?? "",
    field,
  ]);
}

beforeEach(() => {
  h.tCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("LocalProviderCard header", () => {
  it("renders the provider icon at size 36 for the provider it was given", () => {
    const { container } = renderCard();
    const img = container.querySelector("img[data-provider-id]");
    expect(img?.getAttribute("data-provider-id")).toBe("qwenpaw-local");
    expect(img?.getAttribute("width")).toBe("36");
    expect(img?.getAttribute("height")).toBe("36");
  });

  it("shows the provider name and the translated local tag", () => {
    const { container } = renderCard({ name: "Embedded Runner" });
    expect(
      container.querySelector(`.${styles.groupCardName}`)?.textContent,
    ).toBe("Embedded Runner");
    expect(container.querySelector(`.${styles.localTag}`)?.textContent).toBe(
      "models.local",
    );
  });

  it("keeps the local tag and the name even when no model is available", () => {
    const { container } = renderCard({ models: [], extra_models: [] });
    expect(container.querySelector(`.${styles.localTag}`)).not.toBeNull();
    expect(
      container.querySelector(`.${styles.groupCardName}`)?.textContent,
    ).toBe("QwenPaw Local");
  });
});

describe("LocalProviderCard readiness", () => {
  it("counts models and extra_models together for the Live badge", () => {
    const { container } = renderCard({
      models: [modelOf("a"), modelOf("b")],
      extra_models: [modelOf("c")],
    });
    expect(badgeOf(container)?.textContent).toBe("3 Live");
  });

  it("counts extra_models alone as ready", () => {
    const { container } = renderCard({
      models: [],
      extra_models: [modelOf("only-user-added")],
    });
    expect(badgeOf(container)?.textContent).toBe("1 Live");
  });

  it("hides the Live badge entirely when both arrays are empty", () => {
    const { container } = renderCard({ models: [], extra_models: [] });
    expect(badgeOf(container)).toBeNull();
  });

  it("renders the pulse dot inside the badge only together with the badge", () => {
    const ready = renderCard({ models: [modelOf("a")], extra_models: [] });
    expect(
      badgeOf(ready.container)?.querySelector(`.${styles.groupCardPulse}`),
    ).not.toBeNull();

    const notReady = renderCard({ models: [], extra_models: [] });
    expect(badgeOf(notReady.container)).toBeNull();
    expect(
      notReady.container.querySelectorAll(`.${styles.groupCardPulse}`),
    ).toHaveLength(0);
  });
});

describe("LocalProviderCard body", () => {
  it("renders exactly two fields: the translated Type and the Models row", () => {
    const { container } = renderCard();
    expect(fieldsOf(container).map(([label]) => label)).toEqual([
      "models.localType",
      "Models",
    ]);
  });

  it("puts the embedded description in the mono slot", () => {
    const { container } = renderCard();
    expect(
      container.querySelector(`.${styles.groupCardMono}`)?.textContent,
    ).toBe("models.localEmbedded");
  });

  it("shows the translated model count with the count it derived", () => {
    const { container } = renderCard({
      models: [modelOf("a"), modelOf("b")],
      extra_models: [modelOf("c"), modelOf("d")],
    });
    const modelsField = fieldsOf(container)[1][1];
    expect(
      modelsField.querySelector(`.${styles.groupCardFieldValue}`)?.textContent,
    ).toBe("models.modelsCount");
    expect(optionsForKey("models.modelsCount")).toEqual({ count: 4 });
  });

  it("switches to the download-first hint when nothing is available", () => {
    const { container } = renderCard({ models: [], extra_models: [] });
    const modelsField = fieldsOf(container)[1][1];
    expect(
      modelsField.querySelector(`.${styles.groupCardFieldValue}`)?.textContent,
    ).toBe("models.localDownloadFirst");
    // The two value arms are mutually exclusive: the count key is never asked
    // for in this state, so a stale interpolation cannot leak into the hint.
    expect(h.tCalls.some(([k]) => k === "models.modelsCount")).toBe(false);
  });

  it("asks for the count with exactly one model too", () => {
    renderCard({ models: [], extra_models: [modelOf("single")] });
    expect(optionsForKey("models.modelsCount")).toEqual({ count: 1 });
  });
});

describe("LocalProviderCard actions", () => {
  it("renders one action button with the translated models label", () => {
    const { container } = renderCard();
    const buttons = Array.from(
      container.querySelectorAll(`.${styles.groupCardActions} button`),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("models.models");
    expect(buttons[0].className).toContain(styles.groupCardActBtn);
  });

  it("hands the very provider object it was rendered with to onOpenModels", () => {
    const onOpenModels = vi.fn();
    const { container, provider } = renderCard(
      { models: [modelOf("a")], extra_models: [modelOf("b")] },
      onOpenModels,
    );
    const button = container.querySelector(
      `.${styles.groupCardActions} button`,
    )!;
    fireEvent.click(button);
    expect(onOpenModels).toHaveBeenCalledTimes(1);
    expect(onOpenModels.mock.calls[0][0]).toBe(provider);
  });

  it("does not call onOpenModels on its own", () => {
    const onOpenModels = vi.fn();
    renderCard({}, onOpenModels);
    expect(onOpenModels).not.toHaveBeenCalled();
  });
});

describe("LocalProviderCard memoisation", () => {
  it("does not re-run the body when both props keep their identity", () => {
    const provider = providerOf();
    const onOpenModels = vi.fn();
    const view = render(
      <LocalProviderCard provider={provider} onOpenModels={onOpenModels} />,
    );
    const afterMount = h.tCalls.length;
    expect(afterMount).toBeGreaterThan(0);

    view.rerender(
      <LocalProviderCard provider={provider} onOpenModels={onOpenModels} />,
    );
    expect(h.tCalls).toHaveLength(afterMount);
  });

  it("does re-run the body for a newly allocated but equal provider", () => {
    const provider = providerOf();
    const onOpenModels = vi.fn();
    const view = render(
      <LocalProviderCard provider={provider} onOpenModels={onOpenModels} />,
    );
    const afterMount = h.tCalls.length;

    view.rerender(
      <LocalProviderCard
        provider={{ ...provider }}
        onOpenModels={onOpenModels}
      />,
    );
    expect(h.tCalls.length).toBeGreaterThan(afterMount);
  });
});
