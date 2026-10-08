/**
 * Unit tests for the Hub governance model form field groups.
 *
 * Target under test: `src/pages/Hub/governance/ModelForms.tsx`, which exports
 * three named (not default) components that are meant to be rendered *inside*
 * a real antd `<Form>`:
 *   - `ConnectionFields` — provider preset picker, connection name, base URL /
 *     API key (delegated to `ProviderConnectionFields`), and an advanced
 *     `<details>` block holding the quota-scope picker plus `RateFields`.
 *   - `RateFields` — the two required numeric rate limits.
 *   - `ModelFields` — connection picker, the embedded
 *     `HubModelIdentityFields` block, the member-access switch that gates a
 *     multi-select, and another advanced `<details>` with `RateFields`.
 *
 * Harness notes (each one is a measured fact, not a guess):
 *
 * 1. A real `<Form>` is mandatory. Two of the three components call
 *    `Form.useFormInstance()` plus `Form.useWatch(...)`, and `useWatch` on a
 *    field that no `Form.Item` has registered always yields `undefined`. The
 *    `all_members` watch is what gates the `user_ids` block, so rendering the
 *    component standalone would silently exercise only one side of that branch.
 *
 * 2. The `react-i18next` stub returns *stable* references (`vi.hoisted`).
 *    The target itself has no `useEffect`/`useCallback`, but it renders the
 *    real `HubModelIdentityFields`, which does (`load` is a `useCallback`).
 *    An unstable `t` there would rebuild `load` on every render and can drive
 *    an update loop; keeping the stub stable costs nothing and removes the risk.
 *
 * 3. `governanceRequest` is mocked because the embedded
 *    `HubModelIdentityFields` issues real `fetch` calls (`.../discover`,
 *    `.../token-defaults`). Without the mock those requests reject inside an
 *    effect and surface as unhandled rejections unrelated to this target.
 *
 * 4. antd portals `Select` dropdowns to `document` level and, because jsdom
 *    never fires `animationend`, a closed dropdown keeps its leave-motion
 *    classes instead of disappearing. Every dropdown assertion therefore goes
 *    through `liveDropdowns()`, which filters on motion/hidden classes, and
 *    asserts that exactly one dropdown is live.
 *
 * 5. Assertions are written against user-visible outcomes (rendered option
 *    text, the resulting form values, the disabled state of an input) rather
 *    than implementation details. Numeric inputs are reached through
 *    `input[role="spinbutton"]` *scoped to a labelled form item*, because the
 *    same generic selector would otherwise also match rate fields rendered by
 *    a nested `RateFields` instance elsewhere in the tree.
 *
 * 6. Known stderr noise, *not* a defect: one run logs
 *    "Warning: `value` prop on `input` should not be null" from the embedded
 *    identity block. Its source is the shared test stub, which implements
 *    `InputNumber` as `React.createElement("input", { type: "number", ...props })`
 *    (see `src/test/design-mock.ts`) and therefore forwards a `null` value
 *    straight to a native input. The product component
 *    (`ModelTokenFields.tsx` `ContextLengthField`) types that prop
 *    `number | null` and passes it to the real antd `InputNumber`, which
 *    handles null — so the warning is a stub artefact. The shared stub is
 *    deliberately left untouched here.
 *
 *    This file is *not* what introduced that warning. Running the repo's
 *    pre-existing `src/pages/Settings/Models/components/modals/ModelConfigEditor.test.tsx`
 *    on its own logs the same warning once (it reaches the same stubbed
 *    `InputNumber` through `OutputTokenLimitField` in `ModelTokenFields.tsx`),
 *    and a coverage leg that excludes this file counts it once as well. Two
 *    independent sources therefore agree that the warning predates this suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  fireEvent,
  act,
  screen,
  waitFor,
} from "@testing-library/react";
import { Form } from "antd";
import type { FormInstance } from "antd";

const governanceRequest = vi.hoisted(() => vi.fn());

vi.mock("../../../api/modules/hubGovernance", () => ({
  governanceRequest,
}));

// Stable references on purpose — see harness note 2.
const i18nStub = vi.hoisted(() => {
  const stableT = (key: string, opts?: Record<string, unknown>) => {
    if (!opts) return key;
    const parts = Object.entries(opts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(",");
    return `${key}{${parts}}`;
  };
  const stableI18n = { language: "en-US" };
  return { stableT, stableI18n };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18nStub.stableT, i18n: i18nStub.stableI18n }),
  Trans: ({ children }: { children?: React.ReactNode }) => children,
}));

import { ConnectionFields, RateFields, ModelFields } from "./ModelForms";

type Conn = {
  id: string;
  name: string;
  quota_scope: string;
  provider_id?: string | null;
};

type Preset = {
  id: string;
  name: string;
  base_url?: string;
  base_url_options?: { label: string; value: string }[];
  freeze_url?: boolean;
  api_key_prefix?: string;
  api_key_prefixes?: string[];
  models?: unknown[];
};

const PRESET_OPENAI: Preset = {
  id: "openai",
  name: "OpenAI",
  base_url: "https://api.openai.com/v1",
  base_url_options: [],
};

const PRESET_FROZEN: Preset = {
  id: "frozen",
  name: "Frozen Provider",
  base_url: "https://frozen.example/v1",
  base_url_options: [],
  freeze_url: true,
  api_key_prefixes: ["fk-"],
};

const PRESET_MINIMAL: Preset = { id: "minimal", name: "Minimal" };

const USERS = [
  { user_id: "u1", username: "alice" },
  { user_id: "u2", username: "bob" },
];

/** Render children inside a real antd Form (+ App for message/confirm hosts). */
function Harness({
  children,
  onForm,
  initial,
}: {
  children: React.ReactNode;
  onForm?: (form: FormInstance) => void;
  initial?: Record<string, unknown>;
}) {
  const [form] = Form.useForm();
  if (onForm) onForm(form);
  return (
    <Form form={form} initialValues={initial}>
      {children}
    </Form>
  );
}

function renderConnection(props: {
  connections?: Conn[];
  connectionId?: string;
  independentScope?: string;
  presets?: Preset[];
  onForm?: (form: FormInstance) => void;
}) {
  return render(
    <Harness onForm={props.onForm}>
      <ConnectionFields
        connections={(props.connections ?? []) as never}
        connectionId={props.connectionId}
        independentScope={props.independentScope ?? "scope-independent"}
        presets={(props.presets ?? []) as never}
      />
    </Harness>,
  );
}

function renderModel(props: {
  connections?: Conn[];
  users?: { user_id: string; username: string }[];
  presets?: Preset[];
  saved?: never;
  onForm?: (form: FormInstance) => void;
  initial?: Record<string, unknown>;
}) {
  return render(
    <Harness onForm={props.onForm} initial={props.initial}>
      <ModelFields
        connections={(props.connections ?? []) as never}
        users={(props.users ?? []) as never}
        presets={(props.presets ?? []) as never}
        saved={props.saved}
      />
    </Harness>,
  );
}

/** Dropdowns that are not leaving/hidden — see harness note 4. */
function liveDropdowns(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ant-select-dropdown"),
  ).filter(
    (d) =>
      !d.className.includes("ant-slide-up-leave") &&
      !d.className.includes("-hidden"),
  );
}

/** Option texts of the single live dropdown (fails loudly if there are 0 or 2+). */
function liveOptionTexts(): string[] {
  const live = liveDropdowns();
  expect(live).toHaveLength(1);
  return Array.from(live[0].querySelectorAll(".ant-select-item-option")).map(
    (o) => o.textContent ?? "",
  );
}

/**
 * The *name* portion of each option label.
 *
 * Preset/connection options render `<ProviderIcon />{name}` inside one span.
 * For an unmapped provider `ProviderIcon` falls back to a single-letter avatar
 * (`getProviderLetter` = `providerId.charAt(0).toUpperCase()`), so a plain
 * `textContent` read concatenates the avatar glyph with the name — e.g.
 * "BBeta" for a connection named "Beta". That is a text-extraction artefact,
 * not duplicated rendering. Taking the label span's own text node yields just
 * the name, which is what a user actually reads when picking a provider.
 */
function liveOptionNames(): string[] {
  const live = liveDropdowns();
  expect(live).toHaveLength(1);
  return Array.from(live[0].querySelectorAll(".ant-select-item-option")).map(
    (option) => {
      const content = option.querySelector(".ant-select-item-option-content");
      const span = content?.firstElementChild;
      const textNodes = span
        ? Array.from(span.childNodes).filter(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          )
        : [];
      if (textNodes.length)
        return textNodes[textNodes.length - 1].textContent!.trim();
      return content?.textContent ?? "";
    },
  );
}

async function openNthSelect(index: number): Promise<void> {
  const selectors = document.querySelectorAll(".ant-select-selector");
  expect(selectors.length).toBeGreaterThan(index);
  await act(async () => {
    fireEvent.mouseDown(selectors[index]);
  });
}

async function clickLiveOption(index: number): Promise<void> {
  const live = liveDropdowns();
  expect(live).toHaveLength(1);
  const opts = live[0].querySelectorAll(".ant-select-item-option");
  expect(opts.length).toBeGreaterThan(index);
  await act(async () => {
    fireEvent.click(opts[index]);
  });
}

function labelOf(text: string): string {
  return Array.from(
    document.querySelectorAll(".ant-form-item-label label"),
  ).find((l) => l.textContent === text)
    ? text
    : "";
}

/** Form item element whose label text matches, for scoped queries. */
function itemByLabel(labelText: string): HTMLElement {
  const label = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-form-item-label label"),
  ).find((l) => l.textContent === labelText);
  if (!label) throw new Error(`label not rendered: ${labelText}`);
  const item = label.closest<HTMLElement>(".ant-form-item");
  if (!item) throw new Error(`form item not found for label: ${labelText}`);
  return item;
}

function spinValue(labelText: string): string {
  const input = itemByLabel(labelText).querySelector(
    "input[role='spinbutton']",
  );
  if (!input) throw new Error(`no spinbutton under label: ${labelText}`);
  return (input as HTMLInputElement).value;
}

function passwordInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("input[type='password']");
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  governanceRequest.mockReset();
  governanceRequest.mockResolvedValue([]);
});

describe("RateFields", () => {
  it("renders both required numeric limits with their labels", () => {
    render(
      <Harness>
        <RateFields />
      </Harness>,
    );

    expect(labelOf("hub.governance.models.rpm")).toBe(
      "hub.governance.models.rpm",
    );
    expect(labelOf("hub.governance.models.concurrency")).toBe(
      "hub.governance.models.concurrency",
    );
    expect(document.querySelectorAll("input[role='spinbutton']")).toHaveLength(
      2,
    );
  });

  it("shows a help tooltip icon on each rate field", () => {
    render(
      <Harness>
        <RateFields />
      </Harness>,
    );

    expect(document.querySelectorAll(".ant-form-item-tooltip")).toHaveLength(2);
  });

  it("accepts typed values and exposes them through the form", async () => {
    let form: FormInstance | undefined;
    render(
      <Harness onForm={(f) => (form = f)}>
        <RateFields />
      </Harness>,
    );

    const rpm = itemByLabel("hub.governance.models.rpm").querySelector(
      "input",
    )!;
    const conc = itemByLabel("hub.governance.models.concurrency").querySelector(
      "input",
    )!;
    await act(async () => {
      fireEvent.change(rpm, { target: { value: "30" } });
    });
    await act(async () => {
      fireEvent.change(conc, { target: { value: "4" } });
    });

    expect(form?.getFieldValue("requests_per_minute")).toBe(30);
    expect(form?.getFieldValue("concurrency")).toBe(4);
    // Also assert the DOM side so a form-only read cannot mask an input that
    // never took the typed value.
    expect(spinValue("hub.governance.models.rpm")).toBe("30");
    expect(spinValue("hub.governance.models.concurrency")).toBe("4");
  });

  it("keeps both fields required so an empty submit is rejected", async () => {
    let form: FormInstance | undefined;
    render(
      <Harness onForm={(f) => (form = f)}>
        <RateFields />
      </Harness>,
    );

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields();
      } catch (e) {
        caught = e;
      }
    });

    const names = (
      (caught as { errorFields?: { name: (string | number)[] }[] })
        ?.errorFields ?? []
    ).map((f) => f.name[0]);
    expect(names).toContain("requests_per_minute");
    expect(names).toContain("concurrency");
  });
});

describe("ConnectionFields — provider picker", () => {
  it("offers the custom-provider entry plus one entry per preset", async () => {
    renderConnection({ presets: [PRESET_OPENAI, PRESET_MINIMAL] });

    await openNthSelect(0);
    // The custom entry has no icon; "Minimal" is unmapped so its label carries
    // a letter avatar (see liveOptionNames), hence names rather than raw text.
    expect(liveOptionNames()).toEqual([
      "hub.governance.models.customProvider",
      "OpenAI",
      "Minimal",
    ]);
  });

  it("picking a preset fills name and base_url from that preset", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_OPENAI], onForm: (f) => (form = f) });

    await openNthSelect(0);
    await clickLiveOption(1);

    expect(form?.getFieldsValue()).toMatchObject({
      provider_id: "openai",
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
    });
  });

  it("picking a preset with no base_url falls back to an empty string", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_MINIMAL], onForm: (f) => (form = f) });

    await openNthSelect(0);
    await clickLiveOption(1);

    expect(form?.getFieldValue("provider_id")).toBe("minimal");
    expect(form?.getFieldValue("name")).toBe("Minimal");
    expect(form?.getFieldValue("base_url")).toBe("");
  });

  it("picking the custom provider clears name and base_url", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_OPENAI], onForm: (f) => (form = f) });

    await openNthSelect(0);
    await clickLiveOption(0);

    expect(form?.getFieldsValue()).toMatchObject({
      provider_id: "",
      name: "",
      base_url: "",
    });
  });

  it("auto-dedupe skips taken names until a free suffix is found", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      connections: [
        { id: "c1", name: "OpenAI", quota_scope: "s1" },
        { id: "c2", name: "OpenAI 2", quota_scope: "s1" },
      ],
      presets: [PRESET_OPENAI],
      onForm: (f) => (form = f),
    });

    await openNthSelect(0);
    await clickLiveOption(1);

    // "OpenAI" and "OpenAI 2" are both taken, so the third suffix wins.
    expect(form?.getFieldValue("name")).toBe("OpenAI 3");
  });

  it("auto-dedupe stops at the first free suffix", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      connections: [{ id: "c1", name: "OpenAI", quota_scope: "s1" }],
      presets: [PRESET_OPENAI],
      onForm: (f) => (form = f),
    });

    await openNthSelect(0);
    await clickLiveOption(1);

    expect(form?.getFieldValue("name")).toBe("OpenAI 2");
  });

  it("picking the custom provider while a name clash exists keeps it empty", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      connections: [{ id: "c1", name: "OpenAI", quota_scope: "s1" }],
      presets: [PRESET_OPENAI],
      onForm: (f) => (form = f),
    });

    await openNthSelect(0);
    // The custom entry has an empty value, so the while-loop guard (name must
    // be truthy) short-circuits and no suffixing happens.
    await clickLiveOption(0);

    expect(form?.getFieldValue("name")).toBe("");
  });

  it("clears api_key whenever the provider changes", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      presets: [PRESET_OPENAI, PRESET_MINIMAL],
      onForm: (f) => (form = f),
    });

    await act(async () => {
      form?.setFieldsValue({ api_key: "stale-secret" });
    });
    expect(form?.getFieldValue("api_key")).toBe("stale-secret");

    await openNthSelect(0);
    await clickLiveOption(1);

    expect(form?.getFieldValue("api_key")).toBeUndefined();
  });
});

describe("ConnectionFields — connectionId (editing an existing connection)", () => {
  it("disables the provider picker when editing", () => {
    renderConnection({
      connections: [{ id: "c1", name: "Alpha", quota_scope: "s" }],
      connectionId: "c1",
    });

    expect(
      document.querySelectorAll(".ant-select-disabled").length,
    ).toBeGreaterThanOrEqual(1);
    const providerItem = itemByLabel("models.provider");
    expect(providerItem.querySelector(".ant-select-disabled")).toBeTruthy();
  });

  it("leaves the provider picker enabled when creating", () => {
    renderConnection({ presets: [PRESET_OPENAI] });

    expect(
      itemByLabel("models.provider").querySelector(".ant-select-disabled"),
    ).toBeNull();
  });

  it("uses the keep-key placeholder while editing and the enter-key one while creating", () => {
    const { unmount } = renderConnection({
      connections: [{ id: "c1", name: "Alpha", quota_scope: "s" }],
      connectionId: "c1",
    });
    expect(passwordInput()?.placeholder).toBe("hub.governance.models.keepKey");
    unmount();

    renderConnection({ presets: [PRESET_OPENAI] });
    expect(passwordInput()?.placeholder).toBe("hub.governance.models.enterKey");
  });

  it("does not require the API key while editing but requires it when creating", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      connections: [{ id: "c1", name: "Alpha", quota_scope: "s" }],
      connectionId: "c1",
      onForm: (f) => (form = f),
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["api_key"]);
      } catch (e) {
        caught = e;
      }
    });
    // Editing: empty key is acceptable, so validation resolves (caught stays null).
    expect(caught).toBeNull();
    expect(form).toBeTruthy();
  });

  it("reports the API key as missing when creating with it left empty", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_OPENAI], onForm: (f) => (form = f) });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["api_key"]);
      } catch (e) {
        caught = e;
      }
    });

    const names = (
      (caught as { errorFields?: { name: (string | number)[] }[] })
        ?.errorFields ?? []
    ).map((f) => f.name[0]);
    expect(names).toContain("api_key");
  });
});

describe("ConnectionFields — base URL wiring driven by the selected preset", () => {
  it("freezes the base URL input for a freeze_url preset", async () => {
    renderConnection({ presets: [PRESET_FROZEN] });

    await openNthSelect(0);
    await clickLiveOption(1);
    await flush();

    const baseInput = itemByLabel("models.baseURL").querySelector("input");
    expect(baseInput?.getAttribute("disabled")).not.toBeNull();
    expect((baseInput as HTMLInputElement)?.value).toBe(
      "https://frozen.example/v1",
    );
  });

  it("keeps the base URL editable for a normal preset", async () => {
    renderConnection({ presets: [PRESET_OPENAI] });

    await openNthSelect(0);
    await clickLiveOption(1);
    await flush();

    const baseInput = itemByLabel("models.baseURL").querySelector("input");
    expect(baseInput?.getAttribute("disabled")).toBeNull();
  });

  it("falls back to the example placeholder when nothing is selected", () => {
    renderConnection({ presets: [] });

    // No provider selected => `preset` is undefined => placeholder default.
    expect(
      itemByLabel("models.baseURL").querySelector("input")?.placeholder,
    ).toBe("https://example.com/v1");
    expect(
      itemByLabel("models.baseURL")
        .querySelector("input")
        ?.getAttribute("disabled"),
    ).toBeNull();
  });

  it("passes the preset key prefixes into validation and rejects a wrong prefix", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_FROZEN], onForm: (f) => (form = f) });

    await openNthSelect(0);
    await clickLiveOption(1);
    await act(async () => {
      form?.setFieldsValue({ api_key: "sk-wrong-prefix" });
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["api_key"]);
      } catch (e) {
        caught = e;
      }
    });

    const errs = (
      (caught as { errorFields?: { errors: string[] }[] })?.errorFields ?? []
    ).flatMap((f) => f.errors);
    expect(errs.some((m) => m.startsWith("models.apiKeyShouldStart"))).toBe(
      true,
    );
  });

  it("accepts a key with the preset prefix", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [PRESET_FROZEN], onForm: (f) => (form = f) });

    await openNthSelect(0);
    await clickLiveOption(1);
    await act(async () => {
      form?.setFieldsValue({ api_key: "fk-correct" });
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["api_key"]);
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeNull();
    expect(form?.getFieldValue("api_key")).toBe("fk-correct");
  });

  it("skips prefix validation entirely when no preset is selected", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [], onForm: (f) => (form = f) });

    await act(async () => {
      form?.setFieldsValue({ api_key: "anything-goes" });
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["api_key"]);
      } catch (e) {
        caught = e;
      }
    });

    // validApiKeyPrefixes is [] here, so no prefix rule applies.
    expect(caught).toBeNull();
  });
});

describe("ConnectionFields — quota scope grouping", () => {
  it("lists the independent scope plus one entry per other connection's scope", async () => {
    renderConnection({
      connections: [
        { id: "c1", name: "Alpha", quota_scope: "shared-a" },
        { id: "c3", name: "Gamma", quota_scope: "shared-b" },
      ],
      presets: [],
    });

    await openNthSelect(1);
    expect(liveOptionTexts()).toEqual([
      "hub.governance.models.independentLimits",
      "Alpha",
      "Gamma",
    ]);
  });

  it("joins several connection names that share one scope", async () => {
    renderConnection({
      connections: [
        { id: "c1", name: "Alpha", quota_scope: "shared-a" },
        { id: "c2", name: "Beta", quota_scope: "shared-a" },
      ],
      presets: [],
    });

    await openNthSelect(1);
    expect(liveOptionTexts()).toEqual([
      "hub.governance.models.independentLimits",
      "Alpha / Beta",
    ]);
  });

  it("excludes the connection being edited from its own scope group", async () => {
    renderConnection({
      connections: [
        { id: "c1", name: "Alpha", quota_scope: "shared-a" },
        { id: "c2", name: "Beta", quota_scope: "shared-a" },
        { id: "c3", name: "Gamma", quota_scope: "shared-b" },
      ],
      connectionId: "c1",
      presets: [],
    });

    await openNthSelect(1);
    // "Alpha" is the edited connection, so shared-a only shows "Beta".
    expect(liveOptionTexts()).toEqual([
      "hub.governance.models.independentLimits",
      "Beta",
      "Gamma",
    ]);
  });

  it("offers only the independent scope when there are no other connections", async () => {
    renderConnection({ connections: [], presets: [] });

    await openNthSelect(1);
    expect(liveOptionTexts()).toEqual([
      "hub.governance.models.independentLimits",
    ]);
  });

  it("stores the chosen scope in the form", async () => {
    let form: FormInstance | undefined;
    renderConnection({
      connections: [{ id: "c9", name: "Omega", quota_scope: "shared-z" }],
      presets: [],
      onForm: (f) => (form = f),
    });

    await openNthSelect(1);
    await clickLiveOption(1);

    expect(form?.getFieldValue("quota_scope")).toBe("shared-z");
  });

  it("hides the advanced block behind a collapsible summary", () => {
    renderConnection({ presets: [] });

    const details = document.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0].querySelector("summary")?.textContent).toBe(
      "hub.governance.models.advancedLimits",
    );
    // RateFields lives inside that details block.
    expect(
      details[0].querySelectorAll("input[role='spinbutton']"),
    ).toHaveLength(2);
  });
});

describe("ConnectionFields — connection name field", () => {
  it("caps the connection name at 120 characters", () => {
    renderConnection({ presets: [] });

    expect(
      (
        itemByLabel("hub.governance.models.connectionName").querySelector(
          "input",
        ) as HTMLInputElement
      )?.maxLength,
    ).toBe(120);
  });

  it("requires a connection name", async () => {
    let form: FormInstance | undefined;
    renderConnection({ presets: [], onForm: (f) => (form = f) });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["name"]);
      } catch (e) {
        caught = e;
      }
    });

    const names = (
      (caught as { errorFields?: { name: (string | number)[] }[] })
        ?.errorFields ?? []
    ).map((f) => f.name[0]);
    expect(names).toContain("name");
  });
});

describe("ModelFields", () => {
  it("renders the model and member-access sections with their headings", () => {
    renderModel({ connections: [], users: [] });

    expect(
      Array.from(document.querySelectorAll("h3")).map((h) => h.textContent),
    ).toEqual([
      "hub.governance.models.modelSection",
      "hub.governance.users.modelAccess",
    ]);
  });

  it("lists connections in the provider picker using their names", async () => {
    renderModel({
      connections: [
        { id: "c1", name: "Alpha", quota_scope: "s", provider_id: "openai" },
        { id: "c2", name: "Beta", quota_scope: "s" },
      ],
      users: [],
      presets: [],
    });

    await openNthSelect(0);
    expect(liveOptionNames()).toEqual(["Alpha", "Beta"]);
  });

  it("still renders a connection whose provider_id is null", async () => {
    renderModel({
      connections: [
        { id: "c3", name: "NoProvider", quota_scope: "s", provider_id: null },
      ],
      users: [],
      presets: [],
    });

    await openNthSelect(0);
    expect(liveOptionNames()).toEqual(["NoProvider"]);
  });

  it("renders a first-letter avatar for providers with no mapped icon", async () => {
    renderModel({
      connections: [{ id: "c2", name: "Beta", quota_scope: "s" }],
      users: [],
      presets: [],
    });

    await openNthSelect(0);
    // `provider_id` is undefined here, so `ProviderIcon` receives `c.name`
    // ("Beta") and falls back to the letter avatar for its first character.
    // Read naively, `textContent` concatenates the glyph with the name.
    expect(liveOptionTexts()).toEqual(["BBeta"]);
    expect(liveOptionNames()).toEqual(["Beta"]);
  });

  it("clears upstream_model and name when the connection changes", async () => {
    let form: FormInstance | undefined;
    renderModel({
      connections: [
        { id: "c1", name: "Alpha", quota_scope: "s", provider_id: "openai" },
        { id: "c2", name: "Beta", quota_scope: "s" },
      ],
      users: [],
      presets: [],
      onForm: (f) => (form = f),
      initial: { connection_id: "c1", upstream_model: "gpt-4o", name: "kept" },
    });
    await flush();

    expect(form?.getFieldValue("upstream_model")).toBe("gpt-4o");
    // The embedded identity block derives `name` from the selected model on its
    // first pass (no `saved` model matches, so it falls back to the model id),
    // which overwrites the caller-supplied initial name. Assert the derived
    // value rather than the one passed in, so the derivation stays pinned.
    expect(form?.getFieldValue("name")).toBe("gpt-4o");

    await openNthSelect(0);
    await clickLiveOption(1);
    await flush();

    expect(form?.getFieldValue("connection_id")).toBe("c2");
    expect(form?.getFieldValue("upstream_model")).toBeUndefined();
    expect(form?.getFieldValue("name")).toBeUndefined();
  });

  it("shows the member multi-select while all_members is off", () => {
    renderModel({ connections: [], users: USERS, presets: [] });

    expect(
      screen.queryByText("hub.governance.models.selectedMembers"),
    ).toBeTruthy();
  });

  it("hides the member multi-select once all_members is switched on", async () => {
    renderModel({ connections: [], users: USERS, presets: [] });

    const toggle = document.querySelector("button[role='switch']");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle!);
    });

    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.queryByText("hub.governance.models.selectedMembers"),
    ).toBeNull();
  });

  it("restores the member multi-select when all_members is switched back off", async () => {
    let form: FormInstance | undefined;
    renderModel({
      connections: [],
      users: USERS,
      presets: [],
      onForm: (f) => (form = f),
      initial: { all_members: true },
    });

    expect(
      screen.queryByText("hub.governance.models.selectedMembers"),
    ).toBeNull();

    const toggle = document.querySelector("button[role='switch']");
    await act(async () => {
      fireEvent.click(toggle!);
    });

    expect(form?.getFieldValue("all_members")).toBe(false);
    expect(
      screen.queryByText("hub.governance.models.selectedMembers"),
    ).toBeTruthy();
  });

  it("lists usernames in the member picker", async () => {
    renderModel({ connections: [], users: USERS, presets: [] });

    const selectors = document.querySelectorAll(".ant-select-selector");
    await act(async () => {
      fireEvent.mouseDown(selectors[selectors.length - 1]);
    });

    expect(liveOptionTexts()).toEqual(["alice", "bob"]);
  });

  it("offers no member options when the user list is empty", async () => {
    renderModel({ connections: [], users: [], presets: [] });

    const selectors = document.querySelectorAll(".ant-select-selector");
    await act(async () => {
      fireEvent.mouseDown(selectors[selectors.length - 1]);
    });

    expect(liveOptionTexts()).toEqual([]);
  });

  it("stores the picked members in the form", async () => {
    let form: FormInstance | undefined;
    renderModel({
      connections: [],
      users: USERS,
      presets: [],
      onForm: (f) => (form = f),
    });

    const selectors = document.querySelectorAll(".ant-select-selector");
    await act(async () => {
      fireEvent.mouseDown(selectors[selectors.length - 1]);
    });
    await clickLiveOption(0);

    expect(form?.getFieldValue("user_ids")).toEqual(["u1"]);
  });

  it("requires a connection to be picked", async () => {
    let form: FormInstance | undefined;
    renderModel({
      connections: [{ id: "c1", name: "Alpha", quota_scope: "s" }],
      users: [],
      presets: [],
      onForm: (f) => (form = f),
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await form?.validateFields(["connection_id"]);
      } catch (e) {
        caught = e;
      }
    });

    const names = (
      (caught as { errorFields?: { name: (string | number)[] }[] })
        ?.errorFields ?? []
    ).map((f) => f.name[0]);
    expect(names).toContain("connection_id");
  });

  it("embeds the identity block and its advanced rate limits", () => {
    renderModel({ connections: [], users: [], presets: [] });

    // The embedded HubModelIdentityFields contributes its own items.
    expect(screen.queryByText("models.modelIdLabel")).toBeTruthy();
    const details = document.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0].querySelector("summary")?.textContent).toBe(
      "hub.governance.models.advancedSettings",
    );
    expect(
      details[0].querySelectorAll("input[role='spinbutton']"),
    ).toHaveLength(2);
  });

  it("forwards the saved model into the identity block without crashing", async () => {
    renderModel({
      connections: [{ id: "c1", name: "Alpha", quota_scope: "s" }],
      users: [],
      presets: [],
      saved: {
        id: "m1",
        connection_id: "c1",
        upstream_model: "gpt-4o",
        name: "Saved",
      } as never,
    });
    await flush();

    expect(
      screen.queryByText("hub.governance.models.modelSection"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(governanceRequest).not.toHaveBeenCalledWith(
        "admin/model-connections/undefined/discover",
        "POST",
      ),
    );
  });
});
