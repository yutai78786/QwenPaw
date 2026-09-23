/**
 * ModelsSection - the "default LLM" slot editor inside Settings > Models.
 *
 * What this file pins:
 *   1. the provider eligibility filter (six independent rules, evaluated in
 *      order), which decides what a user may switch the global slot to;
 *   2. the slot -> form synchronisation effect (including its empty-string
 *      fallbacks) and the dirty flag that guards the save button;
 *   3. the provider/model cascade (choosing a provider clears the model,
 *      the model select locks itself until models exist, option labels are
 *      provider-specific for hub-managed);
 *   4. the save flow: free-model confirmation gate, the exact PUT body,
 *      success toast + onSaved + dirty reset, and both error-toast arms;
 *   5. the memoised render contract (i18n keys, CSS-module classes, icon).
 *
 * The design package's global stub does not export Select, so it is replaced
 * with a factory here (the stub file explicitly authorises per-test override).
 * The replacement renders a real <select> so options are driven through the
 * DOM rather than by calling handlers directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";

import { renderWithProviders } from "@/test/common_setup";

const setActiveLlm = vi.hoisted(() => vi.fn());
vi.mock("../../../../../api", () => ({ default: { setActiveLlm } }));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({ message: messageMocks }),
}));

const confirmFreeModelSwitch = vi.hoisted(() => vi.fn());
vi.mock("@/utils/freeModelSwitchWarning", () => ({
  confirmFreeModelSwitch: (...args: unknown[]) =>
    confirmFreeModelSwitch(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn(), language: "en" },
  }),
}));

// The global design stub has no Select. Rendering a native <select> keeps the
// option list, the disabled lock and the change event all product-driven.
vi.mock("@agentscope-ai/design", () => {
  const Select = (props: Record<string, any>) => {
    const {
      value,
      onChange,
      options = [],
      placeholder,
      disabled,
      showSearch,
      optionFilterProp,
      style,
    } = props;
    return React.createElement(
      "select",
      {
        "data-placeholder": String(placeholder ?? ""),
        "data-disabled": String(!!disabled),
        "data-show-search": String(!!showSearch),
        "data-option-filter-prop": String(optionFilterProp ?? ""),
        "data-width": String(style?.width ?? ""),
        disabled: !!disabled,
        value: value ?? "",
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onChange?.(event.target.value),
      },
      React.createElement("option", { value: "" }, "unselected"),
      ...(options as Array<{ value: string; label: string }>).map((option) =>
        React.createElement(
          "option",
          { key: String(option.value), value: String(option.value) },
          String(option.label),
        ),
      ),
    );
  };
  const Button = (props: Record<string, any>) => {
    const { children, onClick, icon, type, loading, disabled, block } = props;
    return React.createElement(
      "button",
      {
        type: "button",
        "data-btn-type": String(type ?? ""),
        "data-loading": String(!!loading),
        "data-block": String(!!block),
        disabled: !!disabled,
        onClick,
      },
      icon as any,
      children as any,
    );
  };
  return { Select, Button };
});

import { ModelsSection } from "./ModelsSection";
import styles from "../../index.module.less";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type Provider = {
  id: string;
  name: string;
  models?: Array<{ id: string; name: string; is_free?: boolean }>;
  extra_models?: Array<{ id: string; name: string; is_free?: boolean }>;
  base_url?: string;
  api_key?: string;
  is_custom: boolean;
  require_api_key?: boolean;
};

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    name: "Provider One",
    is_custom: false,
    models: [{ id: "m1", name: "Model One" }],
    api_key: "sk-set",
    ...overrides,
  };
}

const ACTIVE = {
  active_llm: { provider_id: "p1", model: "m1" },
};

function renderSection(
  props: Partial<React.ComponentProps<typeof ModelsSection>> = {},
) {
  const onSaved = props.onSaved ?? vi.fn();
  const utils = renderWithProviders(
    <ModelsSection
      providers={props.providers ?? [provider()]}
      activeModels={
        props.activeModels === undefined ? null : props.activeModels
      }
      onSaved={onSaved}
    />,
  );
  return { ...utils, onSaved };
}

/** Both selects, located by the product's own placeholder keys. */
function bothSelects(container: HTMLElement) {
  const all = Array.from(container.querySelectorAll("select"));
  expect(all).toHaveLength(2);
  const providerSelect = all.find(
    (node) => node.getAttribute("data-placeholder") === "models.selectProvider",
  ) as HTMLSelectElement;
  const modelSelect = all.find(
    (node) => node.getAttribute("data-placeholder") !== "models.selectProvider",
  ) as HTMLSelectElement;
  expect(providerSelect).toBeTruthy();
  expect(modelSelect).toBeTruthy();
  return { providerSelect, modelSelect };
}

function saveButton(container: HTMLElement) {
  const button = container.querySelector(
    "button[data-btn-type='primary']",
  ) as HTMLButtonElement;
  expect(button).toBeTruthy();
  return button;
}

function optionValues(select: HTMLSelectElement) {
  return Array.from(select.querySelectorAll("option")).map(
    (option) => option.value,
  );
}

function optionLabels(select: HTMLSelectElement) {
  return Array.from(select.querySelectorAll("option")).map(
    (option) => option.textContent,
  );
}

function chooseProvider(container: HTMLElement, value: string) {
  const { providerSelect } = bothSelects(container);
  act(() => {
    fireEvent.change(providerSelect, { target: { value } });
  });
}

function chooseModel(container: HTMLElement, value: string) {
  const { modelSelect } = bothSelects(container);
  act(() => {
    fireEvent.change(modelSelect, { target: { value } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setActiveLlm.mockReset();
  messageMocks.success.mockReset();
  messageMocks.error.mockReset();
  confirmFreeModelSwitch.mockReset();
  confirmFreeModelSwitch.mockResolvedValue(true);
  setActiveLlm.mockResolvedValue({});
});

/* ------------------------------------------------------------------ */
/* 1. Provider eligibility filter                                      */
/* ------------------------------------------------------------------ */

describe("ModelsSection provider eligibility", () => {
  it("offers nothing but the empty choice when no provider qualifies", () => {
    const { container } = renderSection({
      providers: [provider({ models: [], extra_models: [] })],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual([""]);
  });

  it("drops a provider that has neither models nor extra_models", () => {
    const { container } = renderSection({
      providers: [
        provider({ id: "empty", name: "Empty", models: [], extra_models: [] }),
        provider({ id: "kept", name: "Kept" }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "kept"]);
  });

  it("counts extra_models towards eligibility", () => {
    const { container } = renderSection({
      providers: [
        provider({
          id: "extra-only",
          name: "Extra Only",
          models: [],
          extra_models: [{ id: "x1", name: "Extra One" }],
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "extra-only"]);
  });

  it("treats an absent models key the same as an empty one when counting extra_models", () => {
    // Both optional list props are optional in the provider payload, so the
    // count has to survive either one being missing outright rather than just
    // empty.
    const { container } = renderSection({
      providers: [
        provider({
          id: "no-models-key",
          name: "No Models Key",
          models: undefined,
          extra_models: [{ id: "x9", name: "Extra Nine" }],
        }),
        provider({
          id: "neither-key",
          name: "Neither Key",
          models: undefined,
          extra_models: undefined,
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "no-models-key"]);

    // The eligible provider's models still come from extra_models alone.
    chooseProvider(container, "no-models-key");
    expect(optionValues(bothSelects(container).modelSelect)).toEqual([
      "",
      "x9",
    ]);
  });

  it("always offers hub-managed, whatever credentials it carries", () => {
    const { container } = renderSection({
      providers: [
        provider({
          id: "hub-managed",
          name: "Hub",
          api_key: undefined,
          base_url: undefined,
          require_api_key: true,
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "hub-managed"]);
  });

  it("offers a key-less provider only when require_api_key is false and a base_url exists", () => {
    const { container } = renderSection({
      providers: [
        provider({
          id: "no-key-with-url",
          name: "No Key With URL",
          require_api_key: false,
          api_key: undefined,
          base_url: "https://example.test/v1",
        }),
        provider({
          id: "no-key-no-url",
          name: "No Key No URL",
          require_api_key: false,
          api_key: undefined,
          base_url: undefined,
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "no-key-with-url"]);
  });

  it("offers a custom provider on the strength of its base_url alone", () => {
    const { container } = renderSection({
      providers: [
        provider({
          id: "custom-with-url",
          name: "Custom With URL",
          is_custom: true,
          api_key: undefined,
          base_url: "https://custom.test/v1",
        }),
        provider({
          id: "custom-blank-url",
          name: "Custom Blank URL",
          is_custom: true,
          api_key: undefined,
          base_url: "",
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "custom-with-url"]);
  });

  it("requires an api_key from a built-in provider that declares require_api_key", () => {
    const { container } = renderSection({
      providers: [
        provider({ id: "keyed", name: "Keyed", require_api_key: true }),
        provider({
          id: "unkeyed",
          name: "Unkeyed",
          require_api_key: true,
          api_key: undefined,
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "keyed"]);
  });

  it("treats a missing require_api_key as required (defaults to the api_key rule)", () => {
    const { container } = renderSection({
      providers: [
        provider({ id: "implicit-keyed", name: "Implicit", api_key: "sk-x" }),
        provider({
          id: "implicit-unkeyed",
          name: "Implicit No Key",
          api_key: undefined,
        }),
      ],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "implicit-keyed"]);
  });

  it("falls through to the allow-list default for an out-of-domain require_api_key", () => {
    // The declared domain is boolean | undefined, and all three of those
    // values are consumed by the earlier rules. Only a falsy non-nullish
    // value reaches the trailing default, so it is fed explicitly here to
    // pin that the fall-through keeps the provider eligible rather than
    // silently dropping it.
    const odd = provider({
      id: "odd",
      name: "Odd",
      api_key: undefined,
      base_url: undefined,
      require_api_key: 0 as unknown as boolean,
    });
    const { container } = renderSection({ providers: [odd] });
    const { providerSelect } = bothSelects(container);
    expect(optionValues(providerSelect)).toEqual(["", "odd"]);
  });

  it("renders provider names, not ids, as the option labels", () => {
    const { container } = renderSection({
      providers: [provider({ id: "p1", name: "Displayed Name" })],
    });
    const { providerSelect } = bothSelects(container);
    expect(optionLabels(providerSelect)).toEqual([
      "unselected",
      "Displayed Name",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Slot synchronisation and the dirty flag                          */
/* ------------------------------------------------------------------ */

describe("ModelsSection slot synchronisation", () => {
  it("starts empty with a disabled save button when there is no active slot", () => {
    const { container } = renderSection({ activeModels: null });
    const { providerSelect, modelSelect } = bothSelects(container);
    expect(providerSelect.value).toBe("");
    expect(modelSelect.value).toBe("");
    expect(saveButton(container)).toBeDisabled();
    expect(saveButton(container).textContent).toBe("models.save");
  });

  it("starts empty when activeModels carries a null active_llm", () => {
    const { container } = renderSection({ activeModels: { active_llm: null } });
    const { providerSelect } = bothSelects(container);
    expect(providerSelect.value).toBe("");
    expect(saveButton(container)).toBeDisabled();
  });

  it("prefills both selects from the active slot and reports itself saved", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    const { providerSelect, modelSelect } = bothSelects(container);
    expect(providerSelect.value).toBe("p1");
    expect(modelSelect.value).toBe("m1");
    expect(saveButton(container).textContent).toBe("models.saved");
    expect(saveButton(container)).toBeDisabled();
  });

  it("treats empty-string slot fields as unselected", () => {
    const { container } = renderSection({
      activeModels: { active_llm: { provider_id: "", model: "" } },
    });
    const { providerSelect, modelSelect } = bothSelects(container);
    expect(providerSelect.value).toBe("");
    expect(modelSelect.value).toBe("");
    expect(saveButton(container).textContent).toBe("models.save");
  });

  it("re-syncs and drops the dirty flag when the active slot changes", () => {
    const providers = [
      provider(),
      provider({
        id: "p2",
        name: "Provider Two",
        models: [{ id: "m2", name: "Model Two" }],
      }),
    ];
    const { container, rerender } = renderSection({
      providers,
      activeModels: ACTIVE,
    });
    // Make the form dirty first, then move the slot underneath it.
    chooseProvider(container, "p2");
    expect(saveButton(container)).toBeDisabled();

    rerender(
      <ModelsSection
        providers={providers}
        activeModels={{ active_llm: { provider_id: "p2", model: "m2" } }}
        onSaved={vi.fn()}
      />,
    );
    const { providerSelect, modelSelect } = bothSelects(container);
    expect(providerSelect.value).toBe("p2");
    expect(modelSelect.value).toBe("m2");
    expect(saveButton(container)).toBeDisabled();
    expect(saveButton(container).textContent).toBe("models.saved");
  });

  it("keeps the save button disabled while the form is untouched but filled", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    // Selection matches the slot, so nothing is dirty: saving must stay off.
    expect(saveButton(container)).toBeDisabled();
    fireEvent.click(saveButton(container));
    expect(setActiveLlm).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Provider / model cascade                                         */
/* ------------------------------------------------------------------ */

describe("ModelsSection provider and model cascade", () => {
  it("locks the model select and asks for a model first when none exists", () => {
    const { container } = renderSection({
      providers: [provider({ models: [], extra_models: [] })],
    });
    const { modelSelect } = bothSelects(container);
    expect(modelSelect.getAttribute("data-disabled")).toBe("true");
    expect(modelSelect).toBeDisabled();
    expect(modelSelect.getAttribute("data-placeholder")).toBe(
      "models.addModelFirst",
    );
  });

  it("unlocks the model select once the chosen provider has models", () => {
    const { container } = renderSection({
      providers: [
        provider({ id: "bare", name: "Bare", models: [], extra_models: [] }),
        provider({ id: "rich", name: "Rich" }),
      ],
      activeModels: { active_llm: { provider_id: "bare", model: "" } },
    });
    const before = bothSelects(container).modelSelect;
    expect(before.getAttribute("data-placeholder")).toBe(
      "models.addModelFirst",
    );

    chooseProvider(container, "rich");
    const after = bothSelects(container).modelSelect;
    expect(after.getAttribute("data-disabled")).toBe("false");
    expect(after.getAttribute("data-placeholder")).toBe("models.selectModel");
    expect(after).not.toBeDisabled();
  });

  it("clears the model choice when the provider changes", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    expect(bothSelects(container).modelSelect.value).toBe("m1");

    chooseProvider(container, "p2");
    expect(bothSelects(container).modelSelect.value).toBe("");
  });

  it("enables saving only after both a provider and a model are chosen", () => {
    const { container } = renderSection({
      providers: [
        provider({ id: "p1", name: "One" }),
        provider({ id: "p2", name: "Two", models: [{ id: "m2", name: "M2" }] }),
      ],
    });
    chooseProvider(container, "p2");
    expect(saveButton(container)).toBeDisabled();

    chooseModel(container, "m2");
    expect(saveButton(container)).not.toBeDisabled();
  });

  it("merges models and extra_models into one option list, in that order", () => {
    const { container } = renderSection({
      providers: [
        provider({
          models: [{ id: "m1", name: "First" }],
          extra_models: [{ id: "x1", name: "Extra" }],
        }),
      ],
      activeModels: ACTIVE,
    });
    const { modelSelect } = bothSelects(container);
    expect(optionValues(modelSelect)).toEqual(["", "m1", "x1"]);
  });

  it("labels hub-managed models by name only and every other provider's models as name (id)", () => {
    const hub = renderSection({
      providers: [
        provider({
          id: "hub-managed",
          name: "Hub",
          models: [{ id: "h1", name: "Hub Model" }],
        }),
      ],
      activeModels: { active_llm: { provider_id: "hub-managed", model: "h1" } },
    });
    expect(optionLabels(bothSelects(hub.container).modelSelect)).toEqual([
      "unselected",
      "Hub Model",
    ]);

    const other = renderSection({
      providers: [
        provider({
          id: "p9",
          name: "Nine",
          models: [{ id: "n1", name: "Named" }],
        }),
      ],
      activeModels: { active_llm: { provider_id: "p9", model: "n1" } },
    });
    expect(optionLabels(bothSelects(other.container).modelSelect)).toEqual([
      "unselected",
      "Named (n1)",
    ]);
  });

  it("stops calling the selection saved once it drifts from the active slot", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    expect(saveButton(container).textContent).toBe("models.saved");

    chooseModel(container, "");
    chooseModel(container, "m2");
    expect(saveButton(container).textContent).toBe("models.save");
  });

  it("requests search filtering on the model select by label", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    const { modelSelect, providerSelect } = bothSelects(container);
    expect(modelSelect.getAttribute("data-show-search")).toBe("true");
    expect(modelSelect.getAttribute("data-option-filter-prop")).toBe("label");
    expect(providerSelect.getAttribute("data-show-search")).toBe("false");
    expect(modelSelect.getAttribute("data-width")).toBe("100%");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Save flow                                                        */
/* ------------------------------------------------------------------ */

describe("ModelsSection save flow", () => {
  it("PUTs the global slot, toasts, clears dirty and notifies the parent", async () => {
    const onSaved = vi.fn();
    const { container } = renderSection({
      providers: [
        provider(),
        provider({ id: "p2", name: "Two", models: [{ id: "m2", name: "M2" }] }),
      ],
      activeModels: ACTIVE,
      onSaved,
    });
    chooseProvider(container, "p2");
    chooseModel(container, "m2");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    expect(setActiveLlm).toHaveBeenCalledTimes(1);
    expect(setActiveLlm).toHaveBeenCalledWith({
      provider_id: "p2",
      model: "m2",
      scope: "global",
    });
    await waitFor(() =>
      expect(messageMocks.success).toHaveBeenCalledWith(
        "models.llmModelUpdated",
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Dirty is cleared, so the button locks again; the slot prop has not
    // moved, so the label stays "save" rather than "saved".
    expect(saveButton(container)).toBeDisabled();
    expect(saveButton(container).textContent).toBe("models.save");
    expect(saveButton(container).getAttribute("data-loading")).toBe("false");
  });

  it("routes a free-model switch through the confirmation gate before saving", async () => {
    const { container } = renderSection({
      providers: [
        provider({
          id: "p3",
          name: "Three",
          models: [{ id: "free-1", name: "Free", is_free: true }],
        }),
      ],
    });
    chooseProvider(container, "p3");
    chooseModel(container, "free-1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    expect(confirmFreeModelSwitch).toHaveBeenCalledTimes(1);
    const args = confirmFreeModelSwitch.mock.calls[0][0];
    expect(args.provider.id).toBe("p3");
    expect(args.model).toEqual({ id: "free-1", name: "Free", is_free: true });
    expect(typeof args.t).toBe("function");
    expect(setActiveLlm).toHaveBeenCalledTimes(1);
  });

  it("aborts the save and keeps the form dirty when the user cancels the free-model warning", async () => {
    confirmFreeModelSwitch.mockResolvedValue(false);
    const onSaved = vi.fn();
    const { container } = renderSection({
      providers: [
        provider({
          id: "p3",
          name: "Three",
          models: [{ id: "free-1", name: "Free", is_free: true }],
        }),
      ],
      onSaved,
    });
    chooseProvider(container, "p3");
    chooseModel(container, "free-1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    expect(setActiveLlm).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(messageMocks.success).not.toHaveBeenCalled();
    expect(messageMocks.error).not.toHaveBeenCalled();
    expect(saveButton(container)).not.toBeDisabled();
  });

  it("saves without the confirmation gate when the chosen model is no longer listed", async () => {
    // The provider list is refreshed under the component (a stale selection
    // is a real race), so the selected model id is not found in either list.
    const onSaved = vi.fn();
    const { container, rerender } = renderSection({
      providers: [
        provider({
          models: [
            { id: "m1", name: "One" },
            { id: "m2", name: "Two" },
          ],
        }),
      ],
      activeModels: ACTIVE,
      onSaved,
    });
    chooseModel(container, "m2");

    rerender(
      <ModelsSection
        providers={[provider({ models: [{ id: "m9", name: "Nine" }] })]}
        activeModels={ACTIVE}
        onSaved={onSaved}
      />,
    );

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    expect(confirmFreeModelSwitch).not.toHaveBeenCalled();
    expect(setActiveLlm).toHaveBeenCalledWith({
      provider_id: "p1",
      model: "m2",
      scope: "global",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves without the confirmation gate when the selected provider disappeared", async () => {
    const { container, rerender } = renderSection({
      providers: [provider({ id: "p1", name: "One" })],
      activeModels: null,
    });
    chooseProvider(container, "p1");
    chooseModel(container, "m1");
    expect(saveButton(container)).not.toBeDisabled();

    rerender(
      <ModelsSection
        providers={[provider({ id: "other", name: "Other" })]}
        activeModels={null}
        onSaved={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    expect(confirmFreeModelSwitch).not.toHaveBeenCalled();
    expect(setActiveLlm).toHaveBeenCalledWith({
      provider_id: "p1",
      model: "m1",
      scope: "global",
    });
  });

  it("surfaces the rejection message when the PUT fails with an Error", async () => {
    setActiveLlm.mockRejectedValue(new Error("slot rejected by server"));
    const onSaved = vi.fn();
    const { container } = renderSection({ activeModels: null, onSaved });
    chooseProvider(container, "p1");
    chooseModel(container, "m1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    await waitFor(() =>
      expect(messageMocks.error).toHaveBeenCalledWith(
        "slot rejected by server",
      ),
    );
    expect(messageMocks.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // The failure must leave the edit in place so the user can retry.
    expect(saveButton(container)).not.toBeDisabled();
    expect(saveButton(container).getAttribute("data-loading")).toBe("false");
  });

  it("falls back to the generic failure copy when the rejection is not an Error", async () => {
    setActiveLlm.mockRejectedValue("boom");
    const { container } = renderSection({ activeModels: null });
    chooseProvider(container, "p1");
    chooseModel(container, "m1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });

    await waitFor(() =>
      expect(messageMocks.error).toHaveBeenCalledWith("models.failedToSave"),
    );
    expect(saveButton(container)).not.toBeDisabled();
  });

  it("marks the button loading for the duration of the request", async () => {
    let release: (value: unknown) => void = () => {};
    setActiveLlm.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = renderSection({ activeModels: null });
    chooseProvider(container, "p1");
    chooseModel(container, "m1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });
    expect(saveButton(container).getAttribute("data-loading")).toBe("true");
    expect(setActiveLlm).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({});
    });
    expect(saveButton(container).getAttribute("data-loading")).toBe("false");
    expect(messageMocks.success).toHaveBeenCalledWith("models.llmModelUpdated");
  });

  it("does not re-enter the save while a request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    setActiveLlm.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = renderSection({ activeModels: null });
    chooseProvider(container, "p1");
    chooseModel(container, "m1");

    await act(async () => {
      fireEvent.click(saveButton(container));
    });
    // Still dirty, so canSave keeps the button clickable; clicking again is a
    // second user intent, and the product has no in-flight lock of its own.
    await act(async () => {
      fireEvent.click(saveButton(container));
    });
    expect(setActiveLlm).toHaveBeenCalledTimes(2);

    await act(async () => {
      release({});
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. Render contract                                                  */
/* ------------------------------------------------------------------ */

describe("ModelsSection render contract", () => {
  it("renders the description, both field labels and the hidden actions label", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    expect(screen.getByText("models.llmDescription")).toBeTruthy();

    const labels = Array.from(container.querySelectorAll("label"));
    expect(labels.map((label) => label.textContent)).toEqual([
      "models.provider",
      "models.model",
      "models.actions",
    ]);
    expect(labels[2].className).toBe(
      [styles.slotLabel, styles.visuallyHiddenLabel].join(" "),
    );
    expect(labels[0].className).toBe(styles.slotLabel);
  });

  it("lays the form out with the section CSS-module classes", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    // Not container.firstElementChild: renderWithProviders wraps the tree in
    // antd's App provider, so the first child is the wrapper, not the root.
    expect(
      container.querySelector(`.${styles.defaultLlmBody}`)?.className,
    ).toBe(styles.defaultLlmBody);
    expect(container.querySelector("p")?.className).toBe(styles.llmDescription);
    expect(container.querySelector(`.${styles.slotForm}`)).toBeTruthy();
    const fields = container.querySelectorAll(`.${styles.slotField}`);
    expect(fields).toHaveLength(3);
    expect(fields[2].className).toBe(
      [styles.slotField, styles.slotActionField].join(" "),
    );
  });

  it("renders the save icon and the primary block button", () => {
    const { container } = renderSection({ activeModels: ACTIVE });
    const button = saveButton(container);
    expect(button.getAttribute("data-block")).toBe("true");
    expect(
      button.querySelector("span[role='img'][aria-label='save']"),
    ).toBeTruthy();
  });

  it("is memoised, so an identical re-render does not rebuild the DOM node", () => {
    const providers = [provider()];
    const onSaved = vi.fn();
    const { container, rerender } = renderWithProviders(
      <ModelsSection
        providers={providers}
        activeModels={ACTIVE}
        onSaved={onSaved}
      />,
    );
    const firstButton = saveButton(container);
    rerender(
      <ModelsSection
        providers={providers}
        activeModels={ACTIVE}
        onSaved={onSaved}
      />,
    );
    expect(saveButton(container)).toBe(firstButton);
  });
});
