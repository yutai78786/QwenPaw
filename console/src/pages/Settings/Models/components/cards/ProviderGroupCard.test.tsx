/**
 * ProviderGroupCard - the card that stands for a whole *group* of same-brand
 * provider variants (for example the Aliyun family: dashscope / open_platform
 * / coding_plan_cn ...) inside Settings > Models. Unlike the single-provider
 * card, it owns a segmented control that switches which variant is "active",
 * and every row below the header is derived from that one variant.
 *
 * What this file pins:
 *   1. the derived values: totalModels (models + extra_models of the ACTIVE
 *      variant only), liveCount (how many variants in the WHOLE group are
 *      configured, via the real getIsConfigured util) and hasFreeTier (some
 *      over the whole group), plus which of them drive the FREE tag and the
 *      Live badge;
 *   2. the segmented control: one row per variant, the label precedence
 *      (a known provider_variant maps through VARIANT_LABELS, an unknown one
 *      and a missing one both fall back to provider.name), which row carries
 *      the active class, which dot is "on" for a configured variant, and that
 *      clicking a row really re-derives the body from that variant;
 *   3. the body contract: the endpoint row falls back to an em dash, and the
 *      API-key field has exactly three mutually exclusive arms (a stored key +
 *      change link / "not required" / an editable password input);
 *   4. the placeholder precedence for the key input: api_key_prefixes joined
 *      when non-empty, else api_key_prefix, else the literal "sk-..." default
 *      - including that an EMPTY prefixes array must not win over the prefix;
 *   5. the save-key flow: the button is disabled for a blank/whitespace key so
 *      nothing can be sent, the trimmed value is what reaches the API, success
 *      surfaces a message, clears the input and notifies the parent, and both
 *      failure arms surface a message (Error.message vs the fallback i18n key
 *      for a non-Error rejection);
 *   6. the disable flow behind Modal.confirm: its full option bag (including
 *      the danger button props), that onOk blanks the key for the ACTIVE
 *      variant, and both error arms inside onOk;
 *   7. the action row: the danger button needs BOTH "configured" and "key is
 *      required" (three arms of one &&-chain), and every callback receives the
 *      very variant object it was rendered for - not group.providers[0];
 *   8. the activeIdx fallback: when the group shrinks under a selected index,
 *      the card falls back to the first variant instead of reading undefined.
 *
 * Two stubbing facts drive the design of this file (both probed, not assumed):
 *   - the global @agentscope-ai/design stub defines Modal.confirm as an EMPTY
 *     function, so without a factory override the disable dialog would never
 *     run and any assertion about it would silently pass while covering
 *     nothing. This file overrides the design module with importActual so
 *     Input.Password and Button keep their real stub behaviour (a genuine
 *     <input type="password"> and a genuine <button>) and only Modal.confirm
 *     becomes a spy whose captured options this file invokes.
 *   - the same stub's Button forwards `loading` straight onto a native
 *     <button>, and React refuses to write a non-boolean attribute: it warns
 *     ("Received `false` for a non-boolean attribute `loading`", stack frame
 *     src/test/design-mock.ts buttonLike) and omits it. So the in-flight
 *     visual state is NOT observable here - that warning is a test
 *     infrastructure artifact, the real design library consumes `loading`.
 *     The saving flag is therefore asserted through the call sequence (what
 *     the API saw, and in which order) rather than through the DOM; the visual
 *     state belongs to the E2E track.
 * getIsConfigured and ProviderIcon are deliberately left unmocked - both are
 * pure/presentational and already fully covered by their own files, and "which
 * variants count as live" is part of what this card renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import type { ProviderInfo } from "../../../../../api/types";

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  configureProvider: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@agentscope-ai/design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agentscope-ai/design",
  );
  return {
    ...actual,
    Modal: Object.assign(
      (props: Record<string, unknown>) =>
        React.createElement("div", props, props.children as never),
      {
        confirm: (options: unknown) => h.confirm(options),
        info: () => {},
        warning: () => {},
        error: () => {},
      },
    ),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../../../api/modules/provider", () => ({
  providerApi: {
    configureProvider: (...args: unknown[]) => h.configureProvider(...args),
  },
}));

vi.mock("../../../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({
    message: {
      success: (...args: unknown[]) => h.success(...args),
      error: (...args: unknown[]) => h.error(...args),
    },
  }),
}));

import { ProviderGroupCard } from "./ProviderGroupCard";
import type { ProviderGroup } from "../../utils";
import styles from "../../index.module.less";

/** A minimal but structurally complete ModelInfo, so counts stay readable. */
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
 * A complete ProviderInfo, so each test states only what it varies.
 * The defaults describe a configured built-in remote variant that has a key,
 * i.e. the shape the real page renders inside a "configured" group.
 */
function providerOf(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: "dashscope",
    name: "DashScope",
    api_key_prefix: "sk-",
    chat_model: "qwen-max",
    models: [modelOf("qwen-max")],
    extra_models: [],
    is_custom: false,
    is_local: false,
    support_model_discovery: true,
    support_connection_check: true,
    freeze_url: false,
    require_api_key: true,
    api_key: "sk-stored-key",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    generate_kwargs: {},
    provider_group: "aliyun",
    provider_group_name: "Aliyun",
    provider_variant: "dashscope",
    ...overrides,
  } as ProviderInfo;
}

/** A group is what the page hands over: a key, a display name, its variants. */
function groupOf(
  providers: ProviderInfo[],
  groupName = "Aliyun",
): ProviderGroup {
  return { groupKey: "aliyun", groupName, providers };
}

function renderGroup(providers: ProviderInfo[], groupName = "Aliyun") {
  const group = groupOf(providers, groupName);
  const onSaved = vi.fn();
  const onOpenConfig = vi.fn();
  const onOpenModels = vi.fn();
  const utils = render(
    <ProviderGroupCard
      group={group}
      onSaved={onSaved}
      onOpenConfig={onOpenConfig}
      onOpenModels={onOpenModels}
    />,
  );
  return { group, onSaved, onOpenConfig, onOpenModels, ...utils };
}

/** The default two-variant group used by most cases. */
function twoVariants(
  first: Partial<ProviderInfo> = {},
  second: Partial<ProviderInfo> = {},
) {
  return [
    providerOf({ id: "dashscope", provider_variant: "dashscope", ...first }),
    providerOf({
      id: "aliyun-codingplan",
      name: "Coding Plan",
      provider_variant: "coding_plan",
      ...second,
    }),
  ];
}

/** Every segmented-control row, in group order. */
function segments(container: HTMLElement): HTMLElement[] {
  const row = container.querySelector(`.${styles.groupSegmented}`);
  expect(row).not.toBeNull();
  return Array.from(row!.querySelectorAll(`.${styles.groupSegBtn}`));
}

/** The three body fields (Endpoint / API Key / Models), in DOM order. */
function fields(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(`.${styles.groupCardField}`));
}

function fieldByLabel(container: HTMLElement, label: string): HTMLElement {
  const hit = fields(container).find(
    (f) =>
      f.querySelector(`.${styles.groupCardFieldLabel}`)?.textContent === label,
  );
  expect(hit, `no field labelled ${label}`).toBeDefined();
  return hit!;
}

/** The editable key input; null whenever the card shows a different arm. */
function keyInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector('input[type="password"]');
}

/** The save button that sits next to the editable key input. */
function saveButton(container: HTMLElement): HTMLButtonElement {
  const wrap = container.querySelector(`.${styles.groupCardKeyInput}`);
  expect(wrap).not.toBeNull();
  const btn = wrap!.querySelector("button");
  expect(btn).not.toBeNull();
  return btn as HTMLButtonElement;
}

/** Every <button> in the action row, in DOM order. */
function actionButtons(container: HTMLElement): HTMLElement[] {
  const row = container.querySelector(`.${styles.groupCardActions}`);
  expect(row).not.toBeNull();
  return Array.from(row!.querySelectorAll("button"));
}

function actionLabels(container: HTMLElement): string[] {
  return actionButtons(container).map((b) => b.textContent ?? "");
}

/** The captured options of the single Modal.confirm call made so far. */
function confirmOptions(): Record<string, unknown> {
  expect(h.confirm).toHaveBeenCalledTimes(1);
  return h.confirm.mock.calls[0][0] as Record<string, unknown>;
}

/** The danger button in the action row, or null when it is not rendered. */
function disableButton(container: HTMLElement): HTMLElement | null {
  return container.querySelector(`.${styles.groupCardActBtnDanger}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.configureProvider.mockResolvedValue(undefined);
});

describe("header and derived values", () => {
  it("renders the group name and the icon of the FIRST variant", () => {
    const { container } = renderGroup(twoVariants());
    expect(
      container.querySelector(`.${styles.groupCardName}`)?.textContent,
    ).toBe("Aliyun");
    const img = container.querySelector("img");
    expect(img?.getAttribute("data-provider-id")).toBe("dashscope");
  });

  it("renders a group name given by the page", () => {
    const { container } = renderGroup(twoVariants(), "Custom Brand");
    expect(
      container.querySelector(`.${styles.groupCardName}`)?.textContent,
    ).toBe("Custom Brand");
  });

  it("falls back to a letter avatar when the first variant has no id", () => {
    // Pins the `?? ""` fallback on the icon prop. ProviderInfo.id is typed as
    // a required string, so no real provider can be key-less - this fixture
    // feeds the fallback the only value it exists for. Because the segmented
    // control uses `key={provider.id}`, a key-less variant also makes React
    // warn about list keys; that warning is a fixture artifact, so it is
    // silenced here rather than asserted on.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderGroup([
      providerOf({ id: undefined as unknown as string }),
      providerOf({ id: "aliyun-codingplan" }),
    ]);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container
        .querySelector(`.${styles.groupCardHeader} div`)
        ?.getAttribute("title"),
    ).toBe("");
    errSpy.mockRestore();
  });

  it("shows the FREE tag when ANY variant in the group is free tier", () => {
    const { container } = renderGroup(twoVariants({}, { is_free_tier: true }));
    expect(container.querySelector(`.${styles.freeTag}`)?.textContent).toBe(
      "FREE",
    );
  });

  it("hides the FREE tag when no variant is free tier", () => {
    const { container } = renderGroup(twoVariants());
    expect(container.querySelector(`.${styles.freeTag}`)).toBeNull();
  });

  it("counts live variants across the WHOLE group, not just the active one", () => {
    // First variant configured (has a key), second one not (key required but
    // empty) => exactly 1 Live.
    const { container } = renderGroup(twoVariants({}, { api_key: "" }));
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`)?.textContent,
    ).toBe("1 Live");
  });

  it("counts every configured variant in the badge", () => {
    const { container } = renderGroup(twoVariants());
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`)?.textContent,
    ).toBe("2 Live");
  });

  it("hides the Live badge entirely when no variant is configured", () => {
    const { container } = renderGroup(
      twoVariants({ api_key: "" }, { api_key: "" }),
    );
    expect(container.querySelector(`.${styles.groupCardLiveBadge}`)).toBeNull();
    expect(container.querySelector(`.${styles.groupCardPulse}`)).toBeNull();
  });

  it("treats a key-less variant as configured when the key is not required", () => {
    // getIsConfigured returns true for require_api_key === false, so the badge
    // counts it even though api_key is empty.
    const { container } = renderGroup([
      providerOf({ require_api_key: false, api_key: "" }),
      providerOf({
        id: "aliyun-codingplan",
        require_api_key: false,
        api_key: "",
      }),
    ]);
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`)?.textContent,
    ).toBe("2 Live");
  });
});

describe("the segmented control", () => {
  it("renders one row per variant in group order", () => {
    const { container } = renderGroup(twoVariants());
    expect(segments(container)).toHaveLength(2);
  });

  it.each([
    ["dashscope", "DashScope"],
    ["open_platform", "Open Platform"],
    ["open_platform_cn", "China"],
    ["open_platform_intl", "International"],
    ["coding_plan", "Coding Plan"],
    ["coding_plan_cn", "Coding (CN)"],
    ["coding_plan_intl", "Coding (Intl)"],
    ["token_plan", "Token Plan"],
    ["token_plan_intl", "Token (Intl)"],
    ["china", "China"],
    ["international", "International"],
  ])("maps the known variant %s to its fixed label", (variant, label) => {
    const { container } = renderGroup([
      providerOf({ provider_variant: variant, name: "Ignored Name" }),
      providerOf({ id: "other", provider_variant: "dashscope" }),
    ]);
    expect(segments(container)[0].textContent).toBe(label);
  });

  it("falls back to the provider name for an unknown variant", () => {
    const { container } = renderGroup([
      providerOf({ provider_variant: "brand_new_variant", name: "My Variant" }),
      providerOf({ id: "other", provider_variant: "dashscope" }),
    ]);
    expect(segments(container)[0].textContent).toBe("My Variant");
  });

  it("falls back to the provider name when the variant is absent", () => {
    const { container } = renderGroup([
      providerOf({ provider_variant: undefined, name: "No Variant" }),
      providerOf({ id: "other", provider_variant: "dashscope" }),
    ]);
    expect(segments(container)[0].textContent).toBe("No Variant");
  });

  it("falls back to the provider name when the variant is an empty string", () => {
    const { container } = renderGroup([
      providerOf({ provider_variant: "", name: "Empty Variant" }),
      providerOf({ id: "other", provider_variant: "dashscope" }),
    ]);
    expect(segments(container)[0].textContent).toBe("Empty Variant");
  });

  it("marks only the first row active on mount", () => {
    const { container } = renderGroup(twoVariants());
    const rows = segments(container);
    expect(rows[0].className).toContain(styles.groupSegBtnActive);
    expect(rows[1].className).not.toContain(styles.groupSegBtnActive);
  });

  it("marks the dot on for a configured variant and off for an unconfigured one", () => {
    const { container } = renderGroup(twoVariants({}, { api_key: "" }));
    const dots = segments(container).map(
      (s) => s.querySelector(`.${styles.groupSegDot}`)!,
    );
    expect(dots[0].className).toContain(styles.groupSegDotOn);
    expect(dots[0].className).not.toContain(styles.groupSegDotOff);
    expect(dots[1].className).toContain(styles.groupSegDotOff);
    expect(dots[1].className).not.toContain(styles.groupSegDotOn);
  });

  it("switches the active row when a segment is clicked", () => {
    const { container } = renderGroup(twoVariants());
    fireEvent.click(segments(container)[1]);
    const rows = segments(container);
    expect(rows[1].className).toContain(styles.groupSegBtnActive);
    expect(rows[0].className).not.toContain(styles.groupSegBtnActive);
  });

  it("re-derives the whole body from the newly selected variant", () => {
    const { container } = renderGroup(
      twoVariants(
        { base_url: "https://first.example/v1", api_key: "sk-first" },
        { base_url: "https://second.example/v1", api_key: "sk-second" },
      ),
    );
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://first.example/v1",
    );
    fireEvent.click(segments(container)[1]);
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://second.example/v1",
    );
    expect(fieldByLabel(container, "API Key").textContent).toContain(
      "sk-second",
    );
  });

  it("keeps the typed key out of the newly selected variant's row", () => {
    // The key input is shared state, so switching variants does not reset it;
    // this pins the actual behaviour instead of an imagined one.
    const { container } = renderGroup(
      twoVariants({ api_key: "" }, { api_key: "" }),
    );
    fireEvent.change(keyInput(container)!, { target: { value: "sk-typed" } });
    fireEvent.click(segments(container)[1]);
    expect(keyInput(container)!.value).toBe("sk-typed");
  });

  it("clicking the already active row keeps it active", () => {
    const { container } = renderGroup(twoVariants());
    fireEvent.click(segments(container)[0]);
    expect(segments(container)[0].className).toContain(
      styles.groupSegBtnActive,
    );
  });
});

describe("the body rows", () => {
  it("renders exactly three fields in a fixed order", () => {
    const { container } = renderGroup(twoVariants());
    expect(fields(container)).toHaveLength(3);
    expect(
      fields(container).map(
        (f) => f.querySelector(`.${styles.groupCardFieldLabel}`)?.textContent,
      ),
    ).toEqual(["Endpoint", "API Key", "Models"]);
  });

  it("shows the active variant's base_url", () => {
    const { container } = renderGroup(twoVariants());
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("falls back to an em dash when base_url is empty", () => {
    const { container } = renderGroup(twoVariants({ base_url: "" }));
    expect(fieldByLabel(container, "Endpoint").textContent).toContain("—");
  });

  it("shows the stored key plus a change link when a key exists", () => {
    const { container } = renderGroup(twoVariants());
    const field = fieldByLabel(container, "API Key");
    expect(field.textContent).toContain("sk-stored-key");
    expect(
      field.querySelector(`.${styles.groupCardChangeBtn}`)?.textContent,
    ).toBe("models.changeApiKey");
    expect(keyInput(container)).toBeNull();
  });

  it("calls onOpenConfig with the ACTIVE variant from the change link", () => {
    const { container, onOpenConfig } = renderGroup(twoVariants());
    fireEvent.click(segments(container)[1]);
    const second = groupOf(twoVariants()).providers[1];
    fireEvent.click(
      fieldByLabel(container, "API Key").querySelector(
        `.${styles.groupCardChangeBtn}`,
      )!,
    );
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
    expect(onOpenConfig.mock.calls[0][0].id).toBe(second.id);
  });

  it("shows the not-required arm when require_api_key is false", () => {
    const { container } = renderGroup(
      twoVariants({ api_key: "", require_api_key: false }),
    );
    const field = fieldByLabel(container, "API Key");
    expect(field.textContent).toContain("models.notRequired");
    expect(keyInput(container)).toBeNull();
    expect(field.querySelector(`.${styles.groupCardChangeBtn}`)).toBeNull();
  });

  it("prefers the stored key over the not-required arm", () => {
    // A variant can hold a key AND not require one; the stored key wins.
    const { container } = renderGroup(
      twoVariants({ api_key: "sk-kept", require_api_key: false }),
    );
    expect(fieldByLabel(container, "API Key").textContent).toContain("sk-kept");
    expect(fieldByLabel(container, "API Key").textContent).not.toContain(
      "models.notRequired",
    );
  });

  it("shows the editable input when a key is required and missing", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    expect(keyInput(container)).not.toBeNull();
    expect(
      fieldByLabel(container, "API Key").querySelector(
        `.${styles.groupCardChangeBtn}`,
      ),
    ).toBeNull();
    expect(fieldByLabel(container, "API Key").textContent).not.toContain(
      "models.notRequired",
    );
  });

  it("joins api_key_prefixes for the placeholder when the list is non-empty", () => {
    const { container } = renderGroup(
      twoVariants({ api_key: "", api_key_prefixes: ["sk-", "ak-"] }),
    );
    expect(keyInput(container)!.getAttribute("placeholder")).toBe(
      "sk-, ak-...",
    );
  });

  it("ignores an EMPTY api_key_prefixes list and uses api_key_prefix", () => {
    // `prefixes?.length` is 0 for an empty array, so the second arm must win.
    const { container } = renderGroup(
      twoVariants({ api_key: "", api_key_prefixes: [], api_key_prefix: "xr-" }),
    );
    expect(keyInput(container)!.getAttribute("placeholder")).toBe("xr-...");
  });

  it("falls back to the literal sk-... when neither prefix source exists", () => {
    const { container } = renderGroup(
      twoVariants({ api_key: "", api_key_prefix: "" }),
    );
    expect(keyInput(container)!.getAttribute("placeholder")).toBe("sk-...");
  });

  it("counts models plus extra_models of the active variant", () => {
    const { container } = renderGroup(
      twoVariants({
        models: [modelOf("a"), modelOf("b")],
        extra_models: [modelOf("c")],
      }),
    );
    expect(
      fieldByLabel(container, "Models").querySelector(
        `.${styles.groupCardFieldValue}`,
      )?.textContent,
    ).toBe('models.modelsCount|{"count":3}');
  });

  it("shows the no-models arm when both lists are empty", () => {
    const { container } = renderGroup(
      twoVariants({ models: [], extra_models: [] }),
    );
    expect(
      fieldByLabel(container, "Models").querySelector(
        `.${styles.groupCardFieldValue}`,
      )?.textContent,
    ).toBe("models.noModels");
  });

  it("recounts models after switching variant", () => {
    const { container } = renderGroup(
      twoVariants(
        { models: [modelOf("a")], extra_models: [] },
        { models: [], extra_models: [] },
      ),
    );
    expect(fieldByLabel(container, "Models").textContent).toContain(
      '{"count":1}',
    );
    fireEvent.click(segments(container)[1]);
    expect(fieldByLabel(container, "Models").textContent).toContain(
      "models.noModels",
    );
  });
});

describe("the save-key flow", () => {
  it("disables the save button while the input is empty", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    expect(saveButton(container)).toBeDisabled();
    expect(saveButton(container).textContent).toBe("models.saveApiKey");
  });

  it("disables the save button for a whitespace-only key", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "   " } });
    expect(saveButton(container)).toBeDisabled();
  });

  it("does not reach the API when the key is blank", () => {
    // The guard inside handleSaveKey and the button's disabled flag share the
    // same condition, so this pins the observable contract: a blank key can
    // never be sent, no matter how the click is delivered.
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    const input = keyInput(container)!;
    fireEvent.change(input, { target: { value: "   " } });
    const btn = saveButton(container);
    fireEvent.click(btn);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn.click();
    expect(h.configureProvider).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it("enables the save button as soon as a non-blank key is typed", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "sk-new" } });
    expect(saveButton(container)).toBeEnabled();
    expect(keyInput(container)!.value).toBe("sk-new");
  });

  it("sends the TRIMMED key for the active variant and reports success", async () => {
    const { container, onSaved } = renderGroup(
      twoVariants({ api_key: "" }, { api_key: "", id: "aliyun-codingplan" }),
    );
    fireEvent.click(segments(container)[1]);
    fireEvent.change(keyInput(container)!, {
      target: { value: "  sk-typed  " },
    });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(h.configureProvider).toHaveBeenCalledTimes(1);
    expect(h.configureProvider).toHaveBeenCalledWith("aliyun-codingplan", {
      api_key: "sk-typed",
    });
    expect(h.success).toHaveBeenCalledWith("models.saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
  });

  it("clears the input after a successful save", async () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "sk-typed" } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(keyInput(container)!.value).toBe(""));
    expect(saveButton(container)).toBeDisabled();
  });

  it("keeps the input when the save fails", async () => {
    h.configureProvider.mockRejectedValue(new Error("boom"));
    const { container, onSaved } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "sk-typed" } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(keyInput(container)!.value).toBe("sk-typed");
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("surfaces Error.message when the save rejects with an Error", async () => {
    h.configureProvider.mockRejectedValue(new Error("upstream 500"));
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "sk-typed" } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("upstream 500"));
  });

  it("surfaces the fallback i18n key when the save rejects with a non-Error", async () => {
    h.configureProvider.mockRejectedValue("plain string rejection");
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    fireEvent.change(keyInput(container)!, { target: { value: "sk-typed" } });
    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("models.failedToSave"),
    );
  });

  it("re-enables saving after a failure so a retry can be sent", async () => {
    h.configureProvider
      .mockRejectedValueOnce(new Error("first try fails"))
      .mockResolvedValueOnce(undefined);
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    const input = keyInput(container)!;
    fireEvent.change(input, { target: { value: "sk-1" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));

    // The in-flight flag must have been cleared, otherwise the retry below
    // would be the only way to observe it: a second click reaches the API.
    fireEvent.change(input, { target: { value: "sk-2" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(h.configureProvider).toHaveBeenCalledTimes(2);
    expect(h.configureProvider).toHaveBeenLastCalledWith("dashscope", {
      api_key: "sk-2",
    });
  });

  it("awaits the request before notifying the parent", async () => {
    // Order matters to the page: onSaved triggers a silent refresh, so it must
    // run only after the write actually landed.
    const calls: string[] = [];
    h.configureProvider.mockImplementation(async () => {
      calls.push("api");
    });
    const { container, onSaved } = renderGroup(twoVariants({ api_key: "" }));
    onSaved.mockImplementation(() => calls.push("onSaved"));
    h.success.mockImplementation(() => calls.push("success"));

    fireEvent.change(keyInput(container)!, { target: { value: "sk-x" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(calls).toContain("onSaved"));
    expect(calls).toEqual(["api", "success", "onSaved"]);
  });
});

describe("the action row", () => {
  it("renders Models and Settings buttons for every variant", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    expect(actionLabels(container)).toEqual([
      "models.models",
      "models.settings",
    ]);
  });

  it("calls onOpenModels with the ACTIVE variant", () => {
    const { container, onOpenModels } = renderGroup(twoVariants());
    fireEvent.click(segments(container)[1]);
    fireEvent.click(actionButtons(container)[0]);
    expect(onOpenModels).toHaveBeenCalledTimes(1);
    expect(onOpenModels.mock.calls[0][0].id).toBe("aliyun-codingplan");
  });

  it("calls onOpenConfig with the ACTIVE variant from Settings", () => {
    const { container, onOpenConfig } = renderGroup(twoVariants());
    fireEvent.click(segments(container)[1]);
    fireEvent.click(actionButtons(container)[1]);
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
    expect(onOpenConfig.mock.calls[0][0].id).toBe("aliyun-codingplan");
  });

  it("adds the danger button when the active variant is configured and needs a key", () => {
    const { container } = renderGroup(twoVariants());
    expect(disableButton(container)?.textContent).toBe("models.disableBtn");
    expect(actionLabels(container)).toEqual([
      "models.models",
      "models.settings",
      "models.disableBtn",
    ]);
  });

  it("hides the danger button when the active variant is not configured", () => {
    const { container } = renderGroup(twoVariants({ api_key: "" }));
    expect(disableButton(container)).toBeNull();
    expect(actionLabels(container)).toEqual([
      "models.models",
      "models.settings",
    ]);
  });

  it("hides the danger button when no key is required even if configured", () => {
    // require_api_key === false makes getIsConfigured true, so the SECOND
    // condition of the &&-chain is what suppresses the button here.
    const { container } = renderGroup(
      twoVariants({ require_api_key: false, api_key: "" }),
    );
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`),
    ).not.toBeNull();
    expect(disableButton(container)).toBeNull();
  });

  it("follows the active variant: danger appears only for a configured one", () => {
    const { container } = renderGroup(twoVariants({}, { api_key: "" }));
    expect(disableButton(container)).not.toBeNull();
    fireEvent.click(segments(container)[1]);
    expect(disableButton(container)).toBeNull();
    fireEvent.click(segments(container)[0]);
    expect(disableButton(container)).not.toBeNull();
  });
});

describe("the disable confirm flow", () => {
  function openConfirm(overrides: Partial<ProviderInfo> = {}) {
    const rendered = renderGroup(twoVariants(overrides));
    fireEvent.click(disableButton(rendered.container)!);
    return rendered;
  }

  it("passes the full option bag to Modal.confirm", () => {
    openConfirm();
    const options = confirmOptions();
    expect(options.title).toBe("models.disableProvider");
    expect(options.content).toBe(
      'models.disableProviderConfirm|{"name":"DashScope"}',
    );
    expect(options.okText).toBe("models.disableBtn");
    expect(options.cancelText).toBe("models.cancel");
    expect(options.okButtonProps).toEqual({ danger: true });
    expect(typeof options.onOk).toBe("function");
  });

  it("names the ACTIVE variant in the confirm content", () => {
    const { container } = renderGroup(
      twoVariants({}, { id: "aliyun-codingplan", name: "Coding Plan" }),
    );
    fireEvent.click(segments(container)[1]);
    fireEvent.click(disableButton(container)!);
    expect(confirmOptions().content).toBe(
      'models.disableProviderConfirm|{"name":"Coding Plan"}',
    );
  });

  it("blanks the key of the ACTIVE variant when onOk succeeds", async () => {
    const { container, onSaved } = renderGroup(
      twoVariants({}, { id: "aliyun-codingplan", name: "Coding Plan" }),
    );
    fireEvent.click(segments(container)[1]);
    fireEvent.click(disableButton(container)!);

    await act(async () => {
      await (confirmOptions().onOk as () => Promise<void>)();
    });

    expect(h.configureProvider).toHaveBeenCalledTimes(1);
    expect(h.configureProvider).toHaveBeenCalledWith("aliyun-codingplan", {
      api_key: "",
    });
    expect(h.success).toHaveBeenCalledWith(
      'models.providerDisabled|{"name":"Coding Plan"}',
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
  });

  it("surfaces Error.message when onOk rejects with an Error", async () => {
    h.configureProvider.mockRejectedValue(new Error("disable failed"));
    openConfirm();
    await act(async () => {
      await (confirmOptions().onOk as () => Promise<void>)();
    });
    expect(h.error).toHaveBeenCalledWith("disable failed");
    expect(h.success).not.toHaveBeenCalled();
  });

  it("surfaces the fallback i18n key when onOk rejects with a non-Error", async () => {
    h.configureProvider.mockRejectedValue({ code: 500 });
    const { onSaved } = openConfirm();
    await act(async () => {
      await (confirmOptions().onOk as () => Promise<void>)();
    });
    expect(h.error).toHaveBeenCalledWith("models.failedToSave");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not call the API until onOk is invoked", () => {
    openConfirm();
    expect(h.configureProvider).not.toHaveBeenCalled();
  });

  it("opens a fresh confirm dialog on every click", () => {
    const { container } = renderGroup(twoVariants());
    fireEvent.click(disableButton(container)!);
    fireEvent.click(disableButton(container)!);
    expect(h.confirm).toHaveBeenCalledTimes(2);
  });
});

describe("active-variant fallback", () => {
  it("falls back to the first variant when the group shrinks under the selection", () => {
    const three = [
      providerOf({ id: "dashscope", base_url: "https://first.example/v1" }),
      providerOf({
        id: "aliyun-codingplan",
        base_url: "https://second.example/v1",
      }),
      providerOf({
        id: "aliyun-tokenplan",
        base_url: "https://third.example/v1",
      }),
    ];
    const onSaved = vi.fn();
    const onOpenConfig = vi.fn();
    const onOpenModels = vi.fn();
    const { container, rerender } = render(
      <ProviderGroupCard
        group={groupOf(three)}
        onSaved={onSaved}
        onOpenConfig={onOpenConfig}
        onOpenModels={onOpenModels}
      />,
    );
    fireEvent.click(segments(container)[2]);
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://third.example/v1",
    );

    // The page can drop a variant after a silent refresh; the selected index
    // then points past the end and the card must fall back to providers[0].
    rerender(
      <ProviderGroupCard
        group={groupOf(three.slice(0, 2))}
        onSaved={onSaved}
        onOpenConfig={onOpenConfig}
        onOpenModels={onOpenModels}
      />,
    );
    expect(segments(container)).toHaveLength(2);
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://first.example/v1",
    );
    // The callbacks must also resolve to the fallback variant, not undefined.
    fireEvent.click(actionButtons(container)[0]);
    expect(onOpenModels.mock.calls[0][0].id).toBe("dashscope");
  });

  it("derives every row from the fallback variant", () => {
    const three = [
      providerOf({ id: "dashscope", models: [], extra_models: [] }),
      providerOf({ id: "aliyun-codingplan" }),
      providerOf({ id: "aliyun-tokenplan", models: [modelOf("m")] }),
    ];
    const onSaved = vi.fn();
    const { container, rerender } = render(
      <ProviderGroupCard
        group={groupOf(three)}
        onSaved={onSaved}
        onOpenConfig={vi.fn()}
        onOpenModels={vi.fn()}
      />,
    );
    fireEvent.click(segments(container)[2]);
    expect(fieldByLabel(container, "Models").textContent).toContain(
      '{"count":1}',
    );
    rerender(
      <ProviderGroupCard
        group={groupOf(three.slice(0, 1))}
        onSaved={onSaved}
        onOpenConfig={vi.fn()}
        onOpenModels={vi.fn()}
      />,
    );
    expect(segments(container)).toHaveLength(1);
    expect(fieldByLabel(container, "Models").textContent).toContain(
      "models.noModels",
    );
  });

  it("keeps working when the group shrinks to a single variant", () => {
    const { container, rerender } = render(
      <ProviderGroupCard
        group={groupOf(twoVariants())}
        onSaved={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenModels={vi.fn()}
      />,
    );
    fireEvent.click(segments(container)[1]);
    rerender(
      <ProviderGroupCard
        group={groupOf([
          providerOf({ id: "dashscope", base_url: "https://only.example/v1" }),
        ])}
        onSaved={vi.fn()}
        onOpenConfig={vi.fn()}
        onOpenModels={vi.fn()}
      />,
    );
    expect(segments(container)).toHaveLength(1);
    expect(segments(container)[0].className).not.toContain(
      styles.groupSegBtnActive,
    );
    expect(fieldByLabel(container, "Endpoint").textContent).toContain(
      "https://only.example/v1",
    );
  });
});
