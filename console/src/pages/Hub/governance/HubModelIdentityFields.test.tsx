/**
 * Unit tests for HubModelIdentityFields, the hub-governance managed-model
 * identity block.
 *
 * Two infrastructure decisions are load bearing for the assertions below:
 *
 * 1. The harness registers `connection_id` as a hidden field. The component
 *    reads it with `Form.useWatch("connection_id", form)`, and rc-field-form
 *    only notifies watchers for registered fields, so an unregistered
 *    `connection_id` stays undefined no matter what `initialValues` says. The
 *    real parent (`ModelFields` in ./ModelForms.tsx) registers it with a
 *    `Form.Item name="connection_id"`, so this mirrors production rather than
 *    working around it.
 * 2. `@agentscope-ai/design` is bridged to the real antd `InputNumber` and
 *    `Button`. The global stub renders `InputNumber` as a bare
 *    `input[type=number]`, which hands the raw DOM event to `onChange`
 *    instead of a number; the sibling token fields therefore could not write
 *    a usable value into the form and every numeric assertion would have been
 *    measuring the stub.
 *
 * The sibling components are deliberately NOT mocked: they are part of what
 * this block renders, and stubbing them would turn most branch assertions
 * into assertions about the stubs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form, Input } from "antd";

import type { ModelInfo } from "../../../api/types";
import type {
  ManagedModel,
  ModelConnection,
  ModelProviderPreset,
} from "../../../api/modules/hubGovernance";

const governanceRequest = vi.hoisted(() => vi.fn());

vi.mock("../../../api/modules/hubGovernance", () => ({
  governanceRequest,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@agentscope-ai/design", async (importOriginal) => {
  const antd = await import("antd");
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    InputNumber: antd.InputNumber,
    Button: antd.Button,
  };
});

import { HubModelIdentityFields } from "./HubModelIdentityFields";
import styles from "./governance.module.less";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeConnection(
  id: string,
  extra: Partial<ModelConnection> = {},
): ModelConnection {
  return {
    id,
    provider_id: "p1",
    name: id,
    base_url: "https://example.com/v1",
    enabled: true,
    quota_scope: "all",
    requests_per_minute: 60,
    concurrency: 4,
    has_key: true,
    revision: 1,
    ...extra,
  } as ModelConnection;
}

function makePreset(models: ModelInfo[]): ModelProviderPreset {
  return {
    id: "p1",
    name: "preset1",
    base_url: "",
    api_key_prefix: "",
    freeze_url: false,
    base_url_options: [],
    models,
  } as ModelProviderPreset;
}

function makeSaved(extra: Partial<ManagedModel> = {}): ManagedModel {
  return {
    id: "mm1",
    name: "Saved Name",
    description: "",
    connection_id: "c1",
    upstream_model: "m1",
    enabled: true,
    all_members: true,
    user_ids: [],
    input_token_limit: 1234,
    output_token_limit: 99,
    output_limit_field: "field",
    budget_verified: false,
    supports_image: false,
    requests_per_minute: 60,
    concurrency: 4,
    revision: 3,
    ...extra,
  } as ManagedModel;
}

const DEFAULTS_OK = {
  input_token_limit: 4096,
  output_token_limit: 512,
  input_limit_known: true,
  output_limit_known: true,
};

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let formRef: ReturnType<typeof Form.useForm>[0] | null = null;

interface HarnessProps {
  connections?: ModelConnection[];
  presets?: ModelProviderPreset[];
  saved?: ManagedModel;
  initialValues?: Record<string, unknown>;
}

function Harness({
  connections = [makeConnection("c1")],
  presets = [makePreset([])],
  saved,
  initialValues,
}: HarnessProps) {
  const [form] = Form.useForm();
  formRef = form;
  return (
    <Form form={form} initialValues={initialValues}>
      <Form.Item name="connection_id" hidden>
        <Input />
      </Form.Item>
      <HubModelIdentityFields
        connections={connections}
        presets={presets}
        saved={saved}
      />
    </Form>
  );
}

function renderHarness(props: HarnessProps = {}) {
  return render(<Harness {...props} />);
}

/** Flushes pending microtasks inside act without advancing fake timers. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Advances fake timers and flushes the microtasks they schedule. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function fieldValue(name: string) {
  return formRef?.getFieldValue(name);
}

function allValues() {
  return formRef?.getFieldsValue(true) ?? {};
}

function refreshButton() {
  return screen.getByLabelText(
    "hub.governance.models.refreshProviderModels",
  ) as HTMLButtonElement;
}

function modelCombobox() {
  return document.querySelector("#upstream_model") as HTMLInputElement;
}

function openDropdown() {
  fireEvent.mouseDown(
    document.querySelector(".ant-select-selector") as Element,
  );
}

function optionTexts() {
  return Array.from(document.querySelectorAll(".ant-select-item-option")).map(
    (option) => option.textContent,
  );
}

function definitionValues() {
  return Array.from(document.querySelectorAll("dd")).map(
    (dd) => dd.textContent,
  );
}

function spinButtons(scope?: ParentNode) {
  return Array.from(
    (scope ?? document).querySelectorAll("input[role='spinbutton']"),
  ) as HTMLInputElement[];
}

/**
 * The response-limit details block renders its own numeric field with the same
 * aria-label as the inline fallback, so counts taken from the document would
 * mix the two. Scope every manual-field assertion to this block instead.
 */
function manualFieldsBlock() {
  return document.querySelector(`.${styles.missingCapabilities}`);
}

function manualFieldLabels() {
  const block = manualFieldsBlock();
  return block
    ? spinButtons(block).map((i) => i.getAttribute("aria-label"))
    : [];
}

function capabilitiesBlocks() {
  return document.querySelectorAll(`.${styles.capabilities}`).length;
}

/** Routes discover and token-defaults calls through separate implementations. */
function stubGovernance(options: {
  discover?: (connectionId: string) => Promise<ModelInfo[]>;
  defaults?: (modelId: string) => Promise<Record<string, unknown>>;
}) {
  governanceRequest.mockReset();
  governanceRequest.mockImplementation((path: string) => {
    const discover = path.match(
      /^admin\/model-connections\/([^/]+)\/discover$/,
    );
    if (discover)
      return (options.discover ?? (async () => []))(discover[1]) as Promise<
        ModelInfo[]
      >;
    const defaults = path.match(
      /^admin\/model-connections\/([^/]+)\/token-defaults\?model_id=(.+)$/,
    );
    if (defaults)
      return (options.defaults ?? (async () => DEFAULTS_OK))(
        decodeURIComponent(defaults[2]),
      ) as Promise<Record<string, unknown>>;
    throw new Error(`unexpected governance path: ${path}`);
  });
}

function discoveredPaths() {
  return governanceRequest.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  formRef = null;
  governanceRequest.mockReset();
  governanceRequest.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// no connection selected
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields without a selected connection", () => {
  it("disables the refresh action and issues no discover request", async () => {
    stubGovernance({});
    renderHarness();
    await flush();

    expect(refreshButton().disabled).toBe(true);
    expect(discoveredPaths()).toEqual([]);
  });

  it("renders no capability panel, no alert and no hidden limit value", async () => {
    stubGovernance({});
    renderHarness();
    await flush();

    expect(capabilitiesBlocks()).toBe(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(fieldValue("input_token_limit")).toBeUndefined();
    expect(fieldValue("supports_image")).toBeNull();
  });

  it("keeps the refresh action disabled after a click attempt", async () => {
    stubGovernance({});
    renderHarness();
    await flush();

    fireEvent.click(refreshButton());
    await flush();

    expect(discoveredPaths()).toEqual([]);
  });

  it("does not render the response limit details", async () => {
    stubGovernance({});
    renderHarness();
    await flush();

    expect(
      document.querySelectorAll(`.${styles.advancedSettings}`).length,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// catalog discovery
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields catalog discovery", () => {
  it("enables the refresh action and discovers once a connection is selected", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() =>
      expect(discoveredPaths()).toEqual([
        "admin/model-connections/c1/discover",
      ]),
    );

    expect(refreshButton().disabled).toBe(false);
  });

  it("posts to the connection-scoped discover endpoint", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest.mock.calls).toHaveLength(1));

    expect(governanceRequest.mock.calls[0]).toEqual([
      "admin/model-connections/c1/discover",
      "POST",
    ]);
  });

  it("labels an option by its id when name and id are equal", async () => {
    stubGovernance({
      discover: async () => [
        { id: "same-name", name: "same-name" } as ModelInfo,
      ],
    });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());
    openDropdown();
    await waitFor(() => expect(optionTexts()).toEqual(["same-name"]));
  });

  it('labels an option "name · id" when the two differ', async () => {
    stubGovernance({
      discover: async () => [
        { id: "diff-id", name: "Pretty Name" } as ModelInfo,
      ],
    });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());
    openDropdown();
    await waitFor(() =>
      expect(optionTexts()).toEqual(["Pretty Name · diff-id"]),
    );
  });

  it("filters the offered options by the typed fragment", async () => {
    stubGovernance({
      discover: async () => [
        { id: "same-name", name: "same-name" } as ModelInfo,
        { id: "diff-id", name: "Pretty Name" } as ModelInfo,
      ],
    });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());
    await userEvent.type(modelCombobox(), "diff");
    await waitFor(() =>
      expect(optionTexts()).toEqual(["Pretty Name · diff-id"]),
    );
  });

  it("falls back to the provider preset catalog while discovery is in flight", async () => {
    vi.useFakeTimers();
    let releaseDiscover: ((models: ModelInfo[]) => void) | undefined;
    stubGovernance({
      discover: () =>
        new Promise<ModelInfo[]>((resolve) => {
          releaseDiscover = resolve;
        }),
    });
    renderHarness({
      presets: [
        makePreset([{ id: "preset-model", name: "preset-model" } as ModelInfo]),
      ],
      initialValues: { connection_id: "c1" },
    });
    await advance(0);
    openDropdown();
    await advance(0);

    expect(optionTexts()).toEqual(["preset-model"]);

    await act(async () => {
      releaseDiscover?.([]);
      await Promise.resolve();
    });
    await advance(0);

    // Once the server catalog arrives it wins, even when it is empty.
    expect(optionTexts()).toEqual([]);
  });

  it("prefers a preset catalog when the connection has no matching preset", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({
      connections: [makeConnection("c1", { provider_id: "ghost" })],
      presets: [
        makePreset([{ id: "unreachable", name: "unreachable" } as ModelInfo]),
      ],
      initialValues: { connection_id: "c1", upstream_model: "unreachable" },
    });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());
    openDropdown();
    await waitFor(() => expect(optionTexts()).toEqual([]));

    // The model id survives even though no preset supplies its metadata.
    expect(fieldValue("upstream_model")).toBe("unreachable");
    expect(capabilitiesBlocks()).toBe(1);
  });

  it("re-discovers when the refresh action is clicked", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(discoveredPaths()).toHaveLength(1));

    fireEvent.click(refreshButton());
    await waitFor(() => expect(discoveredPaths()).toHaveLength(2));
    expect(discoveredPaths()[1]).toBe("admin/model-connections/c1/discover");
  });

  it("re-discovers against the new connection when the selection changes", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async (connectionId) =>
        connectionId === "c1"
          ? ([{ id: "a1", name: "A One" }] as ModelInfo[])
          : ([{ id: "b1", name: "B One" }] as ModelInfo[]),
    });
    renderHarness({
      connections: [makeConnection("c1"), makeConnection("c2")],
      initialValues: { connection_id: "c1" },
    });
    await advance(0);

    await act(async () => {
      formRef?.setFieldsValue({ connection_id: "c2" });
    });
    await advance(0);

    expect(discoveredPaths()).toEqual([
      "admin/model-connections/c1/discover",
      "admin/model-connections/c2/discover",
    ]);
  });

  it("ignores a stale discovery response from the previous connection", async () => {
    vi.useFakeTimers();
    let releaseFirst: ((models: ModelInfo[]) => void) | undefined;
    stubGovernance({
      discover: (connectionId) =>
        connectionId === "c1"
          ? new Promise<ModelInfo[]>((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve([{ id: "b1", name: "B One" }] as ModelInfo[]),
    });
    renderHarness({
      connections: [makeConnection("c1"), makeConnection("c2")],
      initialValues: { connection_id: "c1" },
    });
    await advance(0);

    await act(async () => {
      formRef?.setFieldsValue({ connection_id: "c2" });
    });
    await advance(0);

    // The late c1 response must not overwrite the c2 catalog.
    await act(async () => {
      releaseFirst?.([{ id: "a1", name: "A One" }] as ModelInfo[]);
      await Promise.resolve();
    });
    await advance(0);
    openDropdown();
    await advance(0);

    expect(optionTexts()).toEqual(["B One · b1"]);
  });

  it("shows an alert when discovery rejects", async () => {
    stubGovernance({
      discover: async () => {
        throw new Error("boom");
      },
    });
    renderHarness({ initialValues: { connection_id: "c1" } });

    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toBe(
      "hub.governance.models.discoveryFailed",
    );
  });

  it("clears a previous alert when the next discovery succeeds", async () => {
    let shouldFail = true;
    stubGovernance({
      discover: async () => {
        if (shouldFail) throw new Error("boom");
        return [] as ModelInfo[];
      },
    });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(1));

    shouldFail = false;
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  });

  it("ignores a stale rejection after the connection changed", async () => {
    vi.useFakeTimers();
    let rejectFirst: ((reason: unknown) => void) | undefined;
    stubGovernance({
      discover: (connectionId) =>
        connectionId === "c1"
          ? new Promise<ModelInfo[]>((_resolve, reject) => {
              rejectFirst = reject;
            })
          : Promise.resolve([] as ModelInfo[]),
    });
    renderHarness({
      connections: [makeConnection("c1"), makeConnection("c2")],
      initialValues: { connection_id: "c1" },
    });
    await advance(0);

    await act(async () => {
      formRef?.setFieldsValue({ connection_id: "c2" });
    });
    await advance(0);

    await act(async () => {
      rejectFirst?.(new Error("late"));
      await Promise.resolve();
    });
    await advance(0);

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("does not request anything after unmount", async () => {
    vi.useFakeTimers();
    stubGovernance({ discover: async () => [] });
    const view = renderHarness({ initialValues: { connection_id: "c1" } });
    await advance(0);
    expect(discoveredPaths()).toHaveLength(1);

    view.unmount();
    await advance(500);

    expect(discoveredPaths()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// token defaults
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields token defaults", () => {
  it("requests nothing until a model is chosen", async () => {
    vi.useFakeTimers();
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await advance(1000);

    expect(discoveredPaths()).toEqual(["admin/model-connections/c1/discover"]);
  });

  it("debounces the defaults request and encodes the model id", async () => {
    vi.useFakeTimers();
    stubGovernance({ discover: async () => [] });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "a b/c" },
    });
    await advance(0);
    expect(discoveredPaths()).toHaveLength(1);

    await advance(149);
    expect(discoveredPaths()).toHaveLength(1);

    await advance(1);
    expect(discoveredPaths()).toEqual([
      "admin/model-connections/c1/discover",
      "admin/model-connections/c1/token-defaults?model_id=a%20b%2Fc",
    ]);
  });

  it("seeds both limits from the resolved defaults", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "plain", name: "plain" } as ModelInfo],
      defaults: async () => ({ ...DEFAULTS_OK }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "plain" },
    });
    await advance(300);

    expect(fieldValue("input_token_limit")).toBe(4096);
    expect(fieldValue("output_token_limit")).toBe(512);
    expect(definitionValues()).toEqual(["4,096", "512"]);
  });

  it("marks the block failed when the defaults request rejects", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => {
        throw new Error("nope");
      },
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    // The rejection is surfaced through the same `failed` flag the discovery
    // failure uses, so the alert copy is the discovery one.
    await advance(300);
    await flush();

    expect(screen.queryAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "hub.governance.models.discoveryFailed",
    );
  });

  it("cancels the pending defaults request on unmount", async () => {
    vi.useFakeTimers();
    stubGovernance({ discover: async () => [] });
    const view = renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(0);

    view.unmount();
    await advance(500);

    expect(discoveredPaths()).toEqual(["admin/model-connections/c1/discover"]);
  });

  it("drops a defaults response that belongs to a previous identity", async () => {
    vi.useFakeTimers();
    // Each model id gets its own resolver so the stale response can be
    // released on purpose while a newer request is still pending.
    const resolvers = new Map<
      string,
      (value: Record<string, unknown>) => void
    >();
    stubGovernance({
      discover: async () => [],
      defaults: (modelId) =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolvers.set(modelId, resolve);
        }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "old" },
    });
    await advance(160);
    expect(resolvers.has("old")).toBe(true);

    await act(async () => {
      formRef?.setFieldsValue({ upstream_model: "new" });
    });
    await advance(160);
    expect(resolvers.has("new")).toBe(true);

    // The stale payload was fetched for "old"; the block must not adopt it.
    await act(async () => {
      resolvers.get("old")?.({ ...DEFAULTS_OK });
      await Promise.resolve();
    });
    await advance(0);

    expect(fieldValue("input_token_limit")).toBeUndefined();
    expect(definitionValues()).toEqual(["models.unknown", "models.unknown"]);

    // The current identity still gets seeded once its own response lands.
    await act(async () => {
      resolvers.get("new")?.({ ...DEFAULTS_OK });
      await Promise.resolve();
    });
    await advance(0);

    expect(fieldValue("input_token_limit")).toBe(4096);
  });

  it("notes estimated limits when only some defaults are known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    const note = screen.getByRole("note");
    expect(note.textContent).toBe("hub.governance.models.estimatedTokenLimits");
    expect(note.className).toContain(styles.catalogStatus);
  });

  it("omits the estimate note when both limits are known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(screen.queryAllByRole("note")).toHaveLength(0);
  });

  it("omits the estimate note when no defaults resolved at all", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        {
          id: "known",
          name: "known",
          max_input_length_auto_detected: 8,
          max_output_length: 9,
        } as ModelInfo,
      ],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "known" },
    });
    await advance(300);

    expect(screen.queryAllByRole("note")).toHaveLength(0);
    expect(definitionValues()).toEqual(["8", "9"]);
  });
});

// ---------------------------------------------------------------------------
// capability summary
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields capability summary", () => {
  it("renders no capability panel while no model is selected", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());

    expect(capabilitiesBlocks()).toBe(0);
    expect(screen.queryByText("hub.governance.models.capabilities")).toBeNull();
  });

  it("shows the unknown placeholder for both limits when nothing is known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "mystery" },
    });
    await advance(300);

    expect(definitionValues()).toEqual(["models.unknown", "models.unknown"]);
  });

  it("prefers the catalog capability over the resolved default", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        {
          id: "m1",
          name: "M One",
          max_input_length_auto_detected: 1000,
          max_output_length: 2000,
        } as ModelInfo,
      ],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: 512,
        input_limit_known: true,
        output_limit_known: true,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(definitionValues()).toEqual(["1,000", "2,000"]);
    expect(fieldValue("input_token_limit")).toBe(1000);
    expect(fieldValue("output_token_limit")).toBe(2000);
  });

  it("shows an estimated output limit while still treating it as unknown", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 7000,
        output_token_limit: 8000,
        input_limit_known: true,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    // The summary always prints the estimate, while the `known` flags decide
    // whether a manual field is offered.
    expect(definitionValues()).toEqual(["7,000", "8,000"]);
    expect(fieldValue("input_token_limit")).toBe(7000);
    expect(fieldValue("output_token_limit")).toBe(8000);
    expect(manualFieldLabels()).toEqual(["models.maxTokensLabel"]);
    expect(screen.queryAllByRole("note")).toHaveLength(1);
  });

  it("renders the not-probed tag when the catalog says nothing", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(document.querySelector(`.${styles.heading}`)?.textContent).toContain(
      "models.tagNotProbed",
    );
  });

  it("renders the vision tag for an image-capable catalog entry", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        { id: "vis", name: "vis", supports_image: true } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "vis" },
    });
    await advance(300);

    expect(document.querySelector(`.${styles.heading}`)?.textContent).toContain(
      "models.tagVision",
    );
    expect(fieldValue("supports_image")).toBe(true);
  });

  it("falls back to the saved capability when the catalog has none", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
      saved: makeSaved({ supports_image: true }),
    });
    await advance(300);

    expect(fieldValue("supports_image")).toBe(true);
  });

  it("ignores a saved capability belonging to a different model", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
      saved: makeSaved({ upstream_model: "other", supports_image: true }),
    });
    await advance(300);

    expect(fieldValue("supports_image")).toBeNull();
  });

  it("ignores a saved capability belonging to a different connection", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      connections: [makeConnection("c1"), makeConnection("c2")],
      initialValues: { connection_id: "c1", upstream_model: "m1" },
      saved: makeSaved({ connection_id: "c2", supports_image: true }),
    });
    await advance(300);

    expect(fieldValue("supports_image")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// automatic seeding
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields automatic seeding", () => {
  it("seeds the display name from the catalog entry", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(fieldValue("name")).toBe("M One");
  });

  it("falls back to the model id when the catalog entry has no name", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "bare", name: "" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "bare" },
    });
    await advance(300);

    expect(fieldValue("name")).toBe("bare");
  });

  it("restores every saved value when editing a matching managed model", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: 512,
        input_limit_known: true,
        output_limit_known: true,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
      saved: makeSaved(),
    });
    await advance(300);

    expect(allValues()).toMatchObject({
      name: "Saved Name",
      input_token_limit: 1234,
      output_token_limit: 99,
      supports_image: false,
    });
  });

  it("ignores saved values that belong to a different model", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: 512,
        input_limit_known: true,
        output_limit_known: true,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
      saved: makeSaved({ upstream_model: "other" }),
    });
    await advance(300);

    expect(fieldValue("name")).toBe("M One");
    expect(fieldValue("input_token_limit")).toBe(4096);
    expect(fieldValue("output_token_limit")).toBe(512);
  });

  it("keeps a limit the member typed after the defaults arrived", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: 512,
        input_limit_known: true,
        output_limit_known: true,
      }),
    });
    const view = renderHarness({
      presets: [makePreset([{ id: "m1", name: "M One" } as ModelInfo])],
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);
    expect(fieldValue("input_token_limit")).toBe(4096);

    // A later parent re-render (here: the saved model arrives) must not
    // overwrite what the member typed in the meantime.
    await act(async () => {
      formRef?.setFieldValue("input_token_limit", 5000);
    });
    view.rerender(
      <Harness
        presets={[makePreset([{ id: "m1", name: "M One" } as ModelInfo])]}
        initialValues={{ connection_id: "c1", upstream_model: "m1" }}
        saved={makeSaved({ input_token_limit: 1234, output_token_limit: 99 })}
      />,
    );
    await advance(0);

    expect(fieldValue("input_token_limit")).toBe(5000);
  });

  it("keeps a display name the member typed", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [{ id: "m1", name: "M One" } as ModelInfo],
      defaults: async () => DEFAULTS_OK,
    });
    const view = renderHarness({
      presets: [makePreset([{ id: "m1", name: "M One" } as ModelInfo])],
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);
    expect(fieldValue("name")).toBe("M One");

    await act(async () => {
      formRef?.setFieldValue("name", "Typed By Member");
    });
    view.rerender(
      <Harness
        presets={[makePreset([{ id: "m1", name: "M One" } as ModelInfo])]}
        initialValues={{ connection_id: "c1", upstream_model: "m1" }}
        saved={makeSaved({ name: "Other Saved" })}
      />,
    );
    await advance(0);

    expect(fieldValue("name")).toBe("Typed By Member");
  });

  it("re-seeds the name when the selected model changes", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        { id: "m1", name: "M One" } as ModelInfo,
        { id: "m2", name: "M Two" } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);
    expect(fieldValue("name")).toBe("M One");

    await act(async () => {
      formRef?.setFieldsValue({ upstream_model: "m2" });
    });
    await advance(300);

    expect(fieldValue("name")).toBe("M Two");
  });
});

// ---------------------------------------------------------------------------
// manual limit fields and skeleton
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields manual limit fields", () => {
  it("offers both manual inputs when neither limit is known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    const inputs = spinButtons(manualFieldsBlock() ?? undefined);
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual([
      "models.maxInputLengthLabel",
      "models.maxTokensLabel",
    ]);
    expect(manualFieldsBlock()).not.toBeNull();
  });

  it("offers only the output field when the input limit is known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: null,
        input_limit_known: true,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(manualFieldLabels()).toEqual(["models.maxTokensLabel"]);
  });

  it("offers only the input field when the output limit is known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: 512,
        input_limit_known: false,
        output_limit_known: true,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(manualFieldLabels()).toEqual(["models.maxInputLengthLabel"]);
  });

  it("offers no manual input when both limits are known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(manualFieldsBlock()).toBeNull();
    expect(manualFieldLabels()).toEqual([]);
    // The response-limit details block is a separate field and stays visible.
    expect(
      document.querySelectorAll(`.${styles.advancedSettings}`).length,
    ).toBe(1);
  });

  it("writes a typed input limit into the form", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    const [inputField, outputField] = spinButtons(manualFieldsBlock()!);
    await act(async () => {
      fireEvent.change(inputField, { target: { value: "5000" } });
    });
    await act(async () => {
      fireEvent.change(outputField, { target: { value: "777" } });
    });

    expect(fieldValue("input_token_limit")).toBe(5000);
    expect(fieldValue("output_token_limit")).toBe(777);
  });

  it("shows the reset action only once an output limit is set", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(screen.queryAllByLabelText("models.resetMaxTokens")).toHaveLength(0);

    await act(async () => {
      fireEvent.change(spinButtons(manualFieldsBlock()!)[1], {
        target: { value: "777" },
      });
    });

    expect(screen.queryAllByLabelText("models.resetMaxTokens")).toHaveLength(1);
  });

  it("clears the output limit when the reset action is used", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    await act(async () => {
      fireEvent.change(spinButtons(manualFieldsBlock()!)[1], {
        target: { value: "777" },
      });
    });
    expect(fieldValue("output_token_limit")).toBe(777);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("models.resetMaxTokens"));
    });

    expect(fieldValue("output_token_limit")).toBeNull();
  });

  it("shows a skeleton while an unknown model is being discovered", async () => {
    vi.useFakeTimers();
    let releaseDiscover: ((models: ModelInfo[]) => void) | undefined;
    stubGovernance({
      discover: () =>
        new Promise<ModelInfo[]>((resolve) => {
          releaseDiscover = resolve;
        }),
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "unknown-yet" },
    });
    await advance(300);

    expect(document.querySelectorAll(".ant-skeleton")).toHaveLength(1);
    // While the skeleton stands in, the inline fallback fields are not
    // rendered at all.
    expect(manualFieldsBlock()).toBeNull();
    expect(manualFieldLabels()).toEqual([]);

    await act(async () => {
      releaseDiscover?.([{ id: "unknown-yet", name: "Late" } as ModelInfo]);
      await Promise.resolve();
    });
    await advance(0);

    expect(document.querySelectorAll(".ant-skeleton")).toHaveLength(0);
    expect(fieldValue("name")).toBe("Late");
  });

  it("shows no skeleton once the catalog knows the model", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        {
          id: "known",
          name: "known",
          max_input_length_auto_detected: 10,
          max_output_length: 20,
        } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "known" },
    });
    await advance(300);

    expect(document.querySelectorAll(".ant-skeleton")).toHaveLength(0);
    expect(manualFieldsBlock()).toBeNull();
    // The catalog supplies both limits, so only the details field remains.
    expect(spinButtons()).toHaveLength(1);
    expect(spinButtons()[0].getAttribute("aria-label")).toBe(
      "models.maxTokensLabel",
    );
  });
});

// ---------------------------------------------------------------------------
// response limit details
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields response limit details", () => {
  it("renders the details block only when the output limit is known", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        { id: "m1", name: "M One", max_output_length: 2000 } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    const details = document.querySelector(`.${styles.advancedSettings}`);
    expect(details?.tagName).toBe("DETAILS");
    expect(details?.querySelector("summary")?.textContent).toBe(
      "hub.governance.models.responseLimit",
    );
    expect(spinButtons(details!)).toHaveLength(1);
    expect(spinButtons(details!)[0].getAttribute("aria-valuemax")).toBe("2000");
  });

  it("hides the details block while the output limit is unknown", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: null,
        input_limit_known: true,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(
      document.querySelectorAll(`.${styles.advancedSettings}`).length,
    ).toBe(0);
  });

  it("hides the details block when no model is selected", async () => {
    stubGovernance({ discover: async () => [] });
    renderHarness({ initialValues: { connection_id: "c1" } });
    await waitFor(() => expect(governanceRequest).toHaveBeenCalled());

    expect(
      document.querySelectorAll(`.${styles.advancedSettings}`).length,
    ).toBe(0);
  });

  it("falls back to the known capability when the reset action is used", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        { id: "m1", name: "M One", max_output_length: 2000 } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    // The seeded value equals the known capability, so the details field
    // starts empty instead of repeating it.
    expect(spinButtons()[0].value).toBe("");
    expect(fieldValue("output_token_limit")).toBe(2000);

    await act(async () => {
      fireEvent.change(spinButtons()[0], { target: { value: "1500" } });
    });
    expect(fieldValue("output_token_limit")).toBe(1500);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("models.resetMaxTokens"));
    });

    expect(fieldValue("output_token_limit")).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// hidden validation fields
// ---------------------------------------------------------------------------

describe("HubModelIdentityFields hidden validation fields", () => {
  it("rejects an input limit below the configured minimum", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        {
          id: "m1",
          name: "M One",
          max_input_length_auto_detected: 1000,
        } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    await act(async () => {
      formRef?.setFieldValue("input_token_limit", 10);
    });
    const result = await formRef
      ?.validateFields(["input_token_limit"])
      .then(() => "resolved")
      .catch(() => "rejected");

    expect(result).toBe("rejected");
    expect(formRef?.getFieldError("input_token_limit")).toEqual([
      "hub.governance.models.completeCapabilities",
    ]);
  });

  it("accepts an input limit at the known capability", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        {
          id: "m1",
          name: "M One",
          max_input_length_auto_detected: 1000,
        } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    await expect(
      formRef?.validateFields(["input_token_limit"]),
    ).resolves.toBeTruthy();
  });

  it("requires an input limit and reports the missing value", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: null,
        output_token_limit: null,
        input_limit_known: false,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);
    // The all-null defaults leave an explicit null rather than an absent key.
    expect(fieldValue("input_token_limit")).toBeNull();

    await formRef?.validateFields(["input_token_limit"]).catch(() => undefined);

    expect(formRef?.getFieldError("input_token_limit")).toEqual([
      "hub.governance.models.completeCapabilities",
    ]);
  });

  it("caps the output limit at the fallback when the capability is unknown", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: null,
        input_limit_known: true,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    await act(async () => {
      formRef?.setFieldValue("output_token_limit", 2000000);
    });
    await formRef
      ?.validateFields(["output_token_limit"])
      .catch(() => undefined);

    expect(formRef?.getFieldError("output_token_limit")).toEqual([
      "hub.governance.models.completeCapabilities",
    ]);
  });

  it("accepts an output limit within the fallback range", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [],
      defaults: async () => ({
        input_token_limit: 4096,
        output_token_limit: null,
        input_limit_known: true,
        output_limit_known: false,
      }),
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    await act(async () => {
      formRef?.setFieldValue("output_token_limit", 512);
    });
    await expect(
      formRef?.validateFields(["output_token_limit"]),
    ).resolves.toBeTruthy();
  });

  it("keeps the capability flag in its own hidden field", async () => {
    vi.useFakeTimers();
    stubGovernance({
      discover: async () => [
        { id: "m1", name: "M One", supports_image: true } as ModelInfo,
      ],
      defaults: async () => DEFAULTS_OK,
    });
    renderHarness({
      initialValues: { connection_id: "c1", upstream_model: "m1" },
    });
    await advance(300);

    expect(fieldValue("supports_image")).toBe(true);
    await expect(
      formRef?.validateFields(["supports_image"]),
    ).resolves.toBeTruthy();
  });
});
