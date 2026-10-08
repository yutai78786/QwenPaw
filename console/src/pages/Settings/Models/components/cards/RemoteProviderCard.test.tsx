/**
 * RemoteProviderCard - the card for a remote (non-local) LLM provider shown
 * inside Settings > Models.
 *
 * What this file pins:
 *   1. the derived flags: isManaged (id === "hub-managed"), needsOAuth (three
 *      conditions ANDed), isConfigured (via the real getIsConfigured util),
 *      hasModels (models + extra_models), and isAvailable which alone drives
 *      the Live badge;
 *   2. the header contract: provider tag has exactly three arms (organization
 *      / custom / none) and they are mutually exclusive, the FREE tag depends
 *      on is_free_tier alone, and the Live badge requires BOTH configured and
 *      non-empty model count;
 *   3. the body contract: the endpoint row is suppressed for hub-managed,
 *      base_url falls back to an em dash, and the API-key field has exactly
 *      three arms (a stored key + change link / "not required" / an editable
 *      password input) that are mutually exclusive;
 *   4. the placeholder precedence for the key input: api_key_prefixes joined,
 *      else api_key_prefix, else the literal "sk-..." default;
 *   5. the save-key flow: the button is disabled for a blank/whitespace key,
 *      the trimmed value is what gets sent, success clears the input and calls
 *      onSaved, and both failure arms surface a message (Error.message vs the
 *      fallback i18n key for a non-Error rejection); the loading flag is set
 *      while the request is in flight and always cleared afterwards;
 *   6. the two Modal.confirm flows (delete for custom providers, disable for
 *      built-in ones) including their danger button props, and both error arms
 *      inside each onOk handler;
 *   7. the action row: which buttons appear for which provider shape, the
 *      mutually exclusive delete-vs-disable pair, and that every callback
 *      receives the very provider object it was rendered with;
 *   8. the OAuth modal wiring: it starts closed, "connect" opens it, and its
 *      onSuccess additionally notifies the parent via onSaved while onCancel
 *      only closes it.
 *
 * Two stubbing facts drive the design of this file (both probed, not assumed):
 *   - the global @agentscope-ai/design stub defines Modal.confirm as an EMPTY
 *     function, so without a factory override the delete/disable confirm
 *     dialogs would never run and any assertion about them would silently pass
 *     while covering nothing. This file overrides the design module with
 *     importActual so Input.Password and Button keep their real stub behaviour
 *     (a genuine <input type="password"> and a genuine <button>) and only
 *     Modal.confirm becomes a spy whose captured options this file invokes.
 *   - HubProviderUsage is stubbed out: it owns a 30s polling contract that is
 *     covered by its own test file, and running it here would add timers to
 *     unrelated cases.
 * getIsConfigured and ProviderIcon are deliberately left unmocked - both are
 * pure/presentational, and "which providers count as configured" is part of
 * what this card renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import type { ProviderInfo } from "../../../../../api/types";

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  deleteCustomProvider: vi.fn(),
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

vi.mock("../../../../../api", () => ({
  __esModule: true,
  default: {
    deleteCustomProvider: (...args: unknown[]) =>
      h.deleteCustomProvider(...args),
  },
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

vi.mock("./HubProviderUsage", () => ({
  __esModule: true,
  default: () => React.createElement("div", { "data-testid": "hub-usage" }),
}));

/**
 * A thin observable replacement for the real OAuth modal: it mirrors the
 * `open` prop into a data attribute and exposes the two callbacks as buttons,
 * so the wiring can be asserted without pulling in its polling machinery.
 */
vi.mock("../../../../Chat/ModelSelector/OAuthConfirmModal", () => ({
  OAuthConfirmModal: (props: {
    open: boolean;
    providerId: string;
    providerName: string;
    onSuccess: () => void;
    onCancel: () => void;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "oauth-modal",
        "data-open": String(props.open),
        "data-provider-id": props.providerId,
        "data-provider-name": props.providerName,
      },
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "oauth-success",
          onClick: props.onSuccess,
        },
        "ok",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "oauth-cancel",
          onClick: props.onCancel,
        },
        "cancel",
      ),
    ),
}));

import { RemoteProviderCard } from "./RemoteProviderCard";
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
 * The defaults describe a configured built-in remote provider with a key.
 */
function providerOf(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: "openai",
    name: "OpenAI",
    api_key_prefix: "sk-",
    chat_model: "gpt-4o",
    models: [modelOf("gpt-4o")],
    extra_models: [],
    is_custom: false,
    is_local: false,
    support_model_discovery: true,
    support_connection_check: true,
    freeze_url: false,
    require_api_key: true,
    api_key: "sk-stored-key",
    base_url: "https://api.openai.com/v1",
    generate_kwargs: {},
    ...overrides,
  } as ProviderInfo;
}

function renderCard(overrides: Partial<ProviderInfo> = {}) {
  const provider = providerOf(overrides);
  const onSaved = vi.fn();
  const onOpenConfig = vi.fn();
  const onOpenModels = vi.fn();
  const utils = render(
    <RemoteProviderCard
      provider={provider}
      onSaved={onSaved}
      onOpenConfig={onOpenConfig}
      onOpenModels={onOpenModels}
    />,
  );
  return { provider, onSaved, onOpenConfig, onOpenModels, ...utils };
}

/**
 * Renders the card inside a clickable wrapper. The card itself has no React
 * click handler of its own, so `e.stopPropagation()` in the product code is
 * only observable against a parent handler - which is exactly what it guards.
 * Returns the parent's spy so bubbling can be asserted per element.
 */
function renderCardInClickableParent(overrides: Partial<ProviderInfo> = {}) {
  const provider = providerOf(overrides);
  const onParentClick = vi.fn();
  const onSaved = vi.fn();
  const onOpenConfig = vi.fn();
  const onOpenModels = vi.fn();
  const utils = render(
    <div onClick={onParentClick} data-testid="parent">
      <RemoteProviderCard
        provider={provider}
        onSaved={onSaved}
        onOpenConfig={onOpenConfig}
        onOpenModels={onOpenModels}
      />
    </div>,
  );
  return {
    provider,
    onParentClick,
    onSaved,
    onOpenConfig,
    onOpenModels,
    ...utils,
  };
}

/** The captured options of the single Modal.confirm call made so far. */
function confirmOptions(): Record<string, unknown> {
  expect(h.confirm).toHaveBeenCalledTimes(1);
  return h.confirm.mock.calls[0][0] as Record<string, unknown>;
}

/** Every <button> inside the action row, in DOM order. */
function actionButtons(): HTMLElement[] {
  const row = document.querySelector(`.${styles.groupCardActions}`);
  expect(row).not.toBeNull();
  return Array.from(row!.querySelectorAll("button"));
}

function actionLabels(): string[] {
  return actionButtons().map((b) => b.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteCustomProvider.mockResolvedValue(undefined);
  h.configureProvider.mockResolvedValue(undefined);
});

describe("derived flags and the header", () => {
  it("renders the provider name and the icon for its id", () => {
    const { container } = renderCard({ id: "openai", name: "OpenAI" });
    expect(
      container.querySelector(`.${styles.groupCardName}`)?.textContent,
    ).toBe("OpenAI");
    const img = container.querySelector("img");
    expect(img?.getAttribute("data-provider-id")).toBe("openai");
  });

  it("shows the organization tag for the hub-managed id", () => {
    const { container } = renderCard({ id: "hub-managed", name: "Org" });
    expect(container.querySelector(`.${styles.customTag}`)?.textContent).toBe(
      "hub.governance.provider.organization",
    );
  });

  it("shows the custom tag for a custom provider", () => {
    const { container } = renderCard({ is_custom: true });
    expect(container.querySelector(`.${styles.customTag}`)?.textContent).toBe(
      "models.custom",
    );
  });

  it("shows no tag at all for a built-in non-managed provider", () => {
    const { container } = renderCard({ is_custom: false, id: "openai" });
    expect(container.querySelectorAll(`.${styles.customTag}`)).toHaveLength(0);
  });

  it("prefers the organization tag over the custom tag when both apply", () => {
    const { container } = renderCard({ id: "hub-managed", is_custom: true });
    const tags = container.querySelectorAll(`.${styles.customTag}`);
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("hub.governance.provider.organization");
  });

  it("shows the FREE tag only when is_free_tier is set", () => {
    const { container } = renderCard({ is_free_tier: true });
    expect(container.querySelector(`.${styles.freeTag}`)?.textContent).toBe(
      "FREE",
    );
  });

  it.each([
    ["absent", {}],
    ["false", { is_free_tier: false }],
  ])("omits the FREE tag when is_free_tier is %s", (_label, extra) => {
    const { container } = renderCard(extra);
    expect(container.querySelector(`.${styles.freeTag}`)).toBeNull();
  });

  it("shows the Live badge when configured and it has models", () => {
    const { container } = renderCard();
    const badge = container.querySelector(`.${styles.groupCardLiveBadge}`);
    expect(badge?.textContent).toBe("Live");
    expect(badge?.querySelector(`.${styles.groupCardPulse}`)).not.toBeNull();
  });

  it("hides the Live badge when the model count is zero", () => {
    const { container } = renderCard({ models: [], extra_models: [] });
    expect(container.querySelector(`.${styles.groupCardLiveBadge}`)).toBeNull();
  });

  it("hides the Live badge when the provider is not configured", () => {
    const { container } = renderCard({ require_api_key: true, api_key: "" });
    expect(container.querySelector(`.${styles.groupCardLiveBadge}`)).toBeNull();
  });

  it("counts built-in and user-added models together for the Live badge", () => {
    const { container } = renderCard({
      models: [],
      extra_models: [modelOf("added")],
    });
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`),
    ).not.toBeNull();
  });

  it("treats a provider that does not require a key as configured", () => {
    const { container } = renderCard({
      require_api_key: false,
      api_key: "",
      models: [modelOf("m")],
    });
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`),
    ).not.toBeNull();
  });

  it("treats the local provider id as configured even without a key", () => {
    const { container } = renderCard({
      id: "qwenpaw-local",
      require_api_key: true,
      api_key: "",
      models: [modelOf("m")],
    });
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`),
    ).not.toBeNull();
  });

  it("treats a custom provider with a base_url as configured", () => {
    const { container } = renderCard({
      is_custom: true,
      require_api_key: true,
      api_key: "",
      base_url: "https://example.com/v1",
      models: [modelOf("m")],
    });
    expect(
      container.querySelector(`.${styles.groupCardLiveBadge}`),
    ).not.toBeNull();
  });
});

describe("body: endpoint row", () => {
  it("renders the endpoint label and the base_url for a remote provider", () => {
    const { container } = renderCard({ base_url: "https://api.openai.com/v1" });
    const labels = Array.from(
      container.querySelectorAll(`.${styles.groupCardFieldLabel}`),
    ).map((n) => n.textContent);
    expect(labels).toEqual(["Endpoint", "API Key", "Models"]);
    expect(
      container.querySelector(`.${styles.groupCardMono}`)?.textContent,
    ).toContain("https://api.openai.com/v1");
  });

  it("falls back to an em dash when base_url is empty", () => {
    const { container } = renderCard({ base_url: "" });
    expect(
      container.querySelector(`.${styles.groupCardMono}`)?.textContent,
    ).toContain("—");
  });

  it("suppresses the whole endpoint row for the hub-managed provider", () => {
    const { container } = renderCard({ id: "hub-managed" });
    const labels = Array.from(
      container.querySelectorAll(`.${styles.groupCardFieldLabel}`),
    ).map((n) => n.textContent);
    expect(labels).toEqual(["Models"]);
    expect(labels).not.toContain("Endpoint");
    expect(labels).not.toContain("API Key");
  });
});

describe("body: API key field has three mutually exclusive arms", () => {
  it("shows the stored key and a change link when a key is present", () => {
    const { container, onOpenConfig, provider } = renderCard({
      api_key: "sk-stored-key",
    });
    const mono = container.querySelectorAll(`.${styles.groupCardMono}`)[1];
    expect(mono.textContent).toContain("sk-stored-key");
    expect(
      mono.querySelector(`.${styles.groupCardChangeBtn}`)?.textContent,
    ).toBe("models.changeApiKey");
    expect(container.querySelector(`.${styles.groupCardKeyInput}`)).toBeNull();
    expect(screen.queryByText("models.notRequired")).toBeNull();
    fireEvent.click(mono.querySelector(`.${styles.groupCardChangeBtn}`)!);
    expect(onOpenConfig).toHaveBeenCalledWith(provider);
  });

  /**
   * The editable input is the LAST arm of a three-way ternary, so it needs
   * both "no stored key" and "require_api_key is not exactly false". An
   * explicit false belongs to the not-required arm instead (asserted below),
   * which is why this case only varies the absent/undefined shape.
   */
  it.each([
    ["undefined", { require_api_key: undefined }],
    ["absent", {}],
  ])("shows the editable input when require_api_key is %s", (_label, extra) => {
    const { container } = renderCard({
      api_key: "",
      ...extra,
    } as Partial<ProviderInfo>);
    expect(
      container.querySelector(`.${styles.groupCardKeyInput}`),
    ).not.toBeNull();
    expect(screen.queryByText("models.notRequired")).toBeNull();
    expect(container.querySelectorAll(`.${styles.groupCardMono}`)).toHaveLength(
      1,
    );
  });

  it("shows the not-required text when require_api_key is exactly false", () => {
    const { container } = renderCard({
      api_key: "",
      require_api_key: false,
    });
    expect(screen.getByText("models.notRequired")).toBeTruthy();
    expect(container.querySelector(`.${styles.groupCardKeyInput}`)).toBeNull();
  });

  it("prefers the stored key over the not-required arm", () => {
    renderCard({ api_key: "sk-x", require_api_key: false });
    expect(screen.queryByText("models.notRequired")).toBeNull();
    expect(screen.getByText("sk-x")).toBeTruthy();
  });

  it("renders a genuine password input", () => {
    const { container } = renderCard({ api_key: "", require_api_key: true });
    const input = container.querySelector(`.${styles.groupCardKeyInput} input`);
    expect(input?.getAttribute("type")).toBe("password");
  });
});

describe("body: key placeholder precedence", () => {
  it("joins api_key_prefixes when the list is non-empty", () => {
    const { container } = renderCard({
      api_key: "",
      require_api_key: true,
      api_key_prefixes: ["sk-", "pk-"],
      api_key_prefix: "ignored-",
    });
    expect(
      container.querySelector(`.${styles.groupCardKeyInput} input`),
    ).toHaveAttribute("placeholder", "sk-, pk-...");
  });

  it("falls back to api_key_prefix when the list is empty", () => {
    const { container } = renderCard({
      api_key: "",
      require_api_key: true,
      api_key_prefixes: [],
      api_key_prefix: "sk-ant-",
    });
    expect(
      container.querySelector(`.${styles.groupCardKeyInput} input`),
    ).toHaveAttribute("placeholder", "sk-ant-...");
  });

  it("falls back to api_key_prefix when the list is absent", () => {
    const { container } = renderCard({
      api_key: "",
      require_api_key: true,
      api_key_prefix: "hf_",
    });
    expect(
      container.querySelector(`.${styles.groupCardKeyInput} input`),
    ).toHaveAttribute("placeholder", "hf_...");
  });

  it("uses the literal sk-... default when neither prefix source exists", () => {
    const { container } = renderCard({
      api_key: "",
      require_api_key: true,
      api_key_prefix: "",
    });
    expect(
      container.querySelector(`.${styles.groupCardKeyInput} input`),
    ).toHaveAttribute("placeholder", "sk-...");
  });
});

describe("body: models row", () => {
  it("reports the summed model count", () => {
    renderCard({
      models: [modelOf("a"), modelOf("b")],
      extra_models: [modelOf("c")],
    });
    expect(screen.getByText('models.modelsCount|{"count":3}')).toBeTruthy();
    expect(screen.queryByText("models.noModels")).toBeNull();
  });

  it("reports no models when both lists are empty", () => {
    renderCard({ models: [], extra_models: [] });
    expect(screen.getByText("models.noModels")).toBeTruthy();
  });

  it("counts extra_models alone as having models", () => {
    renderCard({ models: [], extra_models: [modelOf("x")] });
    expect(screen.getByText('models.modelsCount|{"count":1}')).toBeTruthy();
  });
});

describe("body: hub-managed extras", () => {
  it("mounts the hub usage widget only for the hub-managed provider", () => {
    renderCard({ id: "hub-managed" });
    expect(screen.getByTestId("hub-usage")).toBeTruthy();
  });

  it("does not mount the hub usage widget for a normal provider", () => {
    renderCard({ id: "openai" });
    expect(screen.queryAllByTestId("hub-usage")).toHaveLength(0);
  });
});

describe("save key flow", () => {
  function keyInput(container: HTMLElement) {
    const input = container.querySelector(
      `.${styles.groupCardKeyInput} input`,
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    return input;
  }

  function saveButton(container: HTMLElement) {
    const btn = Array.from(
      container.querySelectorAll(`.${styles.groupCardKeyInput} button`),
    ).find((b) => b.textContent === "models.saveApiKey");
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  }

  it("disables save for an empty key", () => {
    const { container } = renderCard({ api_key: "", require_api_key: true });
    expect(saveButton(container).disabled).toBe(true);
  });

  it.each([
    [" ", "one space"],
    ["\t\n", "tab and newline"],
  ])("disables save for a whitespace-only key (%s)", async (raw) => {
    const { container } = renderCard({ api_key: "", require_api_key: true });
    fireEvent.change(keyInput(container), { target: { value: raw } });
    expect(saveButton(container).disabled).toBe(true);
  });

  it("enables save once a non-blank key is typed", () => {
    const { container } = renderCard({ api_key: "", require_api_key: true });
    expect(saveButton(container).disabled).toBe(true);
    fireEvent.change(keyInput(container), { target: { value: "sk-new" } });
    expect(saveButton(container).disabled).toBe(false);
  });

  it("sends the trimmed key, clears the input and notifies the parent", async () => {
    const { container, onSaved } = renderCard({
      api_key: "",
      require_api_key: true,
      id: "deepseek",
    });
    fireEvent.change(keyInput(container), { target: { value: "  sk-new  " } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.configureProvider).toHaveBeenCalledTimes(1));
    expect(h.configureProvider).toHaveBeenCalledWith("deepseek", {
      api_key: "sk-new",
    });
    expect(h.success).toHaveBeenCalledWith("models.saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
    await waitFor(() => expect(keyInput(container).value).toBe(""));
  });

  it("does not bubble the click to the card when saving", async () => {
    const { container, onParentClick } = renderCardInClickableParent({
      api_key: "",
      require_api_key: true,
    });
    // Negative control: the Models button has no stopPropagation in the
    // product code, so it MUST reach the parent - otherwise the assertion
    // below would pass for the wrong reason (parent never notified at all).
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.models")!,
    );
    expect(onParentClick).toHaveBeenCalledTimes(1);
    onParentClick.mockClear();
    fireEvent.change(keyInput(container), { target: { value: "sk-1" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.configureProvider).toHaveBeenCalledTimes(1));
    expect(onParentClick).not.toHaveBeenCalled();
  });

  /**
   * The design stub's Button drops the `loading` prop entirely (probed: a
   * static `loading={true}` renders as a bare `<button>` with no attribute),
   * so "in flight" cannot be asserted through the DOM. The observable
   * contract is the call sequence instead: the request has gone out while no
   * outcome has been reported yet, and the outcome lands only after it
   * settles. Asserting a loading attribute here would pass unconditionally.
   */
  it("reports no outcome until the in-flight request settles", async () => {
    let release: () => void = () => {};
    h.configureProvider.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const { container, onSaved } = renderCard({
      api_key: "",
      require_api_key: true,
    });
    fireEvent.change(keyInput(container), { target: { value: "sk-slow" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.configureProvider).toHaveBeenCalledTimes(1));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(h.success).toHaveBeenCalledWith("models.saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("surfaces Error.message and reports no success", async () => {
    h.configureProvider.mockRejectedValue(new Error("boom-402"));
    const { container, onSaved } = renderCard({
      api_key: "",
      require_api_key: true,
    });
    fireEvent.change(keyInput(container), { target: { value: "sk-bad" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.error).toHaveBeenCalledWith("boom-402");
    expect(h.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(keyInput(container).value).toBe("sk-bad");
  });

  it("falls back to the i18n key when the rejection is not an Error", async () => {
    h.configureProvider.mockRejectedValue("plain string");
    const { container } = renderCard({ api_key: "", require_api_key: true });
    fireEvent.change(keyInput(container), { target: { value: "sk-bad" } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.error).toHaveBeenCalledWith("models.failedToSave");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an object", { code: "E" }],
  ])(
    "treats a non-Error rejection (%s) as the fallback message",
    async (_l, v) => {
      h.configureProvider.mockRejectedValue(v);
      const { container } = renderCard({ api_key: "", require_api_key: true });
      fireEvent.change(keyInput(container), { target: { value: "sk-bad" } });
      fireEvent.click(saveButton(container));
      await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
      expect(h.error).toHaveBeenCalledWith("models.failedToSave");
    },
  );
});

describe("delete flow (custom provider)", () => {
  function deleteButton() {
    const btn = actionButtons().find((b) => b.textContent === "common.delete");
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  }

  it("opens a danger confirm dialog carrying the provider name", () => {
    renderCard({ is_custom: true, name: "My Provider" });
    fireEvent.click(deleteButton());
    const options = confirmOptions();
    expect(options.title).toBe("models.deleteProvider");
    expect(options.content).toBe(
      'models.deleteProviderConfirm|{"name":"My Provider"}',
    );
    expect(options.okText).toBe("common.delete");
    expect(options.cancelText).toBe("models.cancel");
    expect(options.okButtonProps).toEqual({ danger: true });
    expect(h.deleteCustomProvider).not.toHaveBeenCalled();
  });

  it("deletes by id, reports success and notifies the parent on onOk", async () => {
    const { onSaved } = renderCard({ is_custom: true, id: "custom/7" });
    fireEvent.click(deleteButton());
    await (confirmOptions().onOk as () => Promise<void>)();
    expect(h.deleteCustomProvider).toHaveBeenCalledWith("custom/7");
    expect(h.success).toHaveBeenCalledWith(
      'models.providerDeleted|{"name":"OpenAI"}',
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
  });

  it("surfaces Error.message when the delete fails", async () => {
    h.deleteCustomProvider.mockRejectedValue(new Error("gone-wrong"));
    const { onSaved } = renderCard({ is_custom: true });
    fireEvent.click(deleteButton());
    await (confirmOptions().onOk as () => Promise<void>)();
    expect(h.error).toHaveBeenCalledWith("gone-wrong");
    expect(h.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an object", { status: 500 }],
  ])(
    "falls back to the i18n key for a non-Error delete rejection (%s)",
    async (_l, v) => {
      h.deleteCustomProvider.mockRejectedValue(v);
      const { onSaved } = renderCard({ is_custom: true });
      fireEvent.click(deleteButton());
      await (confirmOptions().onOk as () => Promise<void>)();
      expect(h.error).toHaveBeenCalledWith("models.providerDeleteFailed");
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it("does not bubble the delete click to the card", () => {
    const { onParentClick } = renderCardInClickableParent({
      is_custom: true,
    });
    // Negative control, same rationale as in the save flow.
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.models")!,
    );
    expect(onParentClick).toHaveBeenCalledTimes(1);
    onParentClick.mockClear();
    fireEvent.click(deleteButton());
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

describe("disable flow (built-in provider)", () => {
  function disableButton() {
    const btn = actionButtons().find(
      (b) => b.textContent === "models.disableBtn",
    );
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  }

  it("opens a danger confirm dialog for disabling", () => {
    renderCard({ is_custom: false, api_key: "sk-x", name: "OpenAI" });
    fireEvent.click(disableButton());
    const options = confirmOptions();
    expect(options.title).toBe("models.disableProvider");
    expect(options.content).toBe(
      'models.disableProviderConfirm|{"name":"OpenAI"}',
    );
    expect(options.okText).toBe("models.disableBtn");
    expect(options.cancelText).toBe("models.cancel");
    expect(options.okButtonProps).toEqual({ danger: true });
    expect(h.configureProvider).not.toHaveBeenCalled();
  });

  it("clears the api key, reports success and notifies the parent", async () => {
    const { onSaved } = renderCard({
      is_custom: false,
      api_key: "sk-x",
      id: "openai",
    });
    fireEvent.click(disableButton());
    await (confirmOptions().onOk as () => Promise<void>)();
    expect(h.configureProvider).toHaveBeenCalledWith("openai", {
      api_key: "",
    });
    expect(h.success).toHaveBeenCalledWith(
      'models.providerDisabled|{"name":"OpenAI"}',
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
  });

  it("surfaces Error.message when disabling fails", async () => {
    h.configureProvider.mockRejectedValue(new Error("nope-403"));
    const { onSaved } = renderCard({ is_custom: false, api_key: "sk-x" });
    fireEvent.click(disableButton());
    await (confirmOptions().onOk as () => Promise<void>)();
    expect(h.error).toHaveBeenCalledWith("nope-403");
    expect(h.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "bad"],
    ["undefined", undefined],
  ])(
    "falls back to the i18n key for a non-Error disable rejection (%s)",
    async (_l, v) => {
      h.configureProvider.mockRejectedValue(v);
      const { onSaved } = renderCard({ is_custom: false, api_key: "sk-x" });
      fireEvent.click(disableButton());
      await (confirmOptions().onOk as () => Promise<void>)();
      expect(h.error).toHaveBeenCalledWith("models.failedToSave");
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it("does not bubble the disable click to the card", () => {
    const { onParentClick } = renderCardInClickableParent({
      is_custom: false,
      api_key: "sk-x",
    });
    // Negative control, same rationale as in the save flow.
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.models")!,
    );
    expect(onParentClick).toHaveBeenCalledTimes(1);
    onParentClick.mockClear();
    fireEvent.click(disableButton());
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("hides disable when the provider is not configured", () => {
    renderCard({
      is_custom: false,
      require_api_key: true,
      api_key: "",
      base_url: "https://x/v1",
    });
    expect(actionLabels()).not.toContain("models.disableBtn");
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("hides disable when require_api_key is exactly false", () => {
    renderCard({ is_custom: false, require_api_key: false, api_key: "" });
    expect(actionLabels()).not.toContain("models.disableBtn");
  });
});

describe("action row composition", () => {
  it("shows models and settings but no delete/disable for a plain provider", () => {
    renderCard({
      is_custom: false,
      require_api_key: true,
      api_key: "",
      base_url: "https://x/v1",
    });
    expect(actionLabels()).toEqual(["models.models", "models.settings"]);
  });

  it("shows delete instead of disable for a custom provider", () => {
    renderCard({ is_custom: true, api_key: "sk-x" });
    expect(actionLabels()).toContain("common.delete");
    expect(actionLabels()).not.toContain("models.disableBtn");
  });

  it("shows disable instead of delete for a configured built-in", () => {
    renderCard({ is_custom: false, api_key: "sk-x" });
    expect(actionLabels()).toContain("models.disableBtn");
    expect(actionLabels()).not.toContain("common.delete");
  });

  it("hides settings and delete/disable entirely for hub-managed", () => {
    renderCard({ id: "hub-managed", is_custom: true });
    expect(actionLabels()).toEqual(["models.models"]);
  });

  it("marks the danger buttons with the danger class", () => {
    const { container } = renderCard({ is_custom: true });
    const danger = container.querySelectorAll(
      `.${styles.groupCardActBtnDanger}`,
    );
    expect(danger).toHaveLength(1);
    expect(danger[0].textContent).toBe("common.delete");
  });

  it("adds connect ahead of the other buttons when OAuth is needed", () => {
    renderCard({
      supports_oauth: true,
      api_key: "",
      oauth_connected: false,
      require_api_key: true,
      base_url: "https://x/v1",
      is_custom: false,
    });
    expect(actionLabels()).toEqual([
      "models.connect",
      "models.models",
      "models.settings",
    ]);
  });

  it.each([
    [
      "supports_oauth is false",
      { supports_oauth: false, api_key: "", oauth_connected: false },
    ],
    [
      "a key is already stored",
      { supports_oauth: true, api_key: "sk-x", oauth_connected: false },
    ],
    [
      "oauth is already connected",
      { supports_oauth: true, api_key: "", oauth_connected: true },
    ],
    ["supports_oauth is absent", { api_key: "", oauth_connected: false }],
  ])("omits connect when %s", (_label, extra) => {
    renderCard(extra as Partial<ProviderInfo>);
    expect(actionLabels()).not.toContain("models.connect");
  });

  it("passes the very provider object to the models callback", () => {
    const { provider, onOpenModels } = renderCard({ id: "zhipu" });
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.models")!,
    );
    expect(onOpenModels).toHaveBeenCalledTimes(1);
    expect(onOpenModels.mock.calls[0][0]).toBe(provider);
  });

  it("passes the very provider object to the settings callback", () => {
    const { provider, onOpenConfig } = renderCard({ id: "zhipu" });
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.settings")!,
    );
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
    expect(onOpenConfig.mock.calls[0][0]).toBe(provider);
  });

  it("does not call any parent callback on plain render", () => {
    const { onSaved, onOpenConfig, onOpenModels } = renderCard();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenConfig).not.toHaveBeenCalled();
    expect(onOpenModels).not.toHaveBeenCalled();
  });
});

describe("OAuth modal wiring", () => {
  it("starts closed and carries the provider identity", () => {
    renderCard({ id: "anthropic", name: "Anthropic" });
    const modal = screen.getByTestId("oauth-modal");
    expect(modal.getAttribute("data-open")).toBe("false");
    expect(modal.getAttribute("data-provider-id")).toBe("anthropic");
    expect(modal.getAttribute("data-provider-name")).toBe("Anthropic");
  });

  it("opens when connect is clicked", () => {
    renderCard({
      supports_oauth: true,
      api_key: "",
      oauth_connected: false,
      require_api_key: true,
      base_url: "https://x/v1",
    });
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.connect")!,
    );
    expect(screen.getByTestId("oauth-modal").getAttribute("data-open")).toBe(
      "true",
    );
  });

  it("closes and notifies the parent when the modal succeeds", () => {
    const { onSaved } = renderCard({
      supports_oauth: true,
      api_key: "",
      oauth_connected: false,
      require_api_key: true,
      base_url: "https://x/v1",
    });
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.connect")!,
    );
    fireEvent.click(screen.getByTestId("oauth-success"));
    expect(screen.getByTestId("oauth-modal").getAttribute("data-open")).toBe(
      "false",
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("closes without notifying the parent when the modal is cancelled", () => {
    const { onSaved } = renderCard({
      supports_oauth: true,
      api_key: "",
      oauth_connected: false,
      require_api_key: true,
      base_url: "https://x/v1",
    });
    fireEvent.click(
      actionButtons().find((b) => b.textContent === "models.connect")!,
    );
    fireEvent.click(screen.getByTestId("oauth-cancel"));
    expect(screen.getByTestId("oauth-modal").getAttribute("data-open")).toBe(
      "false",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the modal closed when no OAuth button exists", () => {
    renderCard({ supports_oauth: false });
    expect(screen.getByTestId("oauth-modal").getAttribute("data-open")).toBe(
      "false",
    );
    expect(actionLabels()).not.toContain("models.connect");
  });

  it("still renders the modal for the hub-managed provider", () => {
    renderCard({ id: "hub-managed", supports_oauth: false });
    expect(screen.getByTestId("oauth-modal")).toBeTruthy();
  });
});

describe("card shell", () => {
  it("wraps everything in the glass card class", () => {
    const { container } = renderCard();
    expect(container.firstElementChild?.className).toBe(styles.groupCardGlass);
  });

  it("renders header, content and actions in order, then the OAuth modal", () => {
    const { container } = renderCard();
    const kids = Array.from(
      (container.firstElementChild as HTMLElement).children,
    );
    // The OAuth modal is a sibling of the three sections (not nested inside
    // the actions row), so the shell has exactly four children.
    expect(kids).toHaveLength(4);
    expect(kids.slice(0, 3).map((c) => c.className)).toEqual([
      styles.groupCardHeader,
      styles.groupCardContent,
      styles.groupCardActions,
    ]);
    expect(kids[3].getAttribute("data-testid")).toBe("oauth-modal");
  });
});
