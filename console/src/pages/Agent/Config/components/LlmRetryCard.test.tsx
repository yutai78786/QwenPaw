/**
 * Unit tests for `LlmRetryCard` - the LLM retry tab of the Agent Config page,
 * rendered from `pages/Agent/Config/index.tsx:178`
 * (`<LlmRetryCard llmRetryEnabled={llmRetryEnabled} />`).
 *
 * Visible contract under test:
 *
 *   1. the enable switch plus three numeric settings, each bound to the field
 *      name the config payload uses;
 *   2. the three numeric controls are disabled exactly while retry is switched
 *      off at the *page* level (the prop is caller-supplied, so this is real
 *      behaviour a user can hit, not dead code);
 *   3. required + lower-bound rules with the messages the product declares;
 *   4. the cross-field rule between backoff cap and backoff base.
 *
 * Note on (4): this card's boundary runs the *opposite* way from the sibling
 * `LlmRateLimiterCard` acquire-timeout rule. Here the validator returns early
 * (i.e. passes) when `value >= backoffBase` and throws only when the cap is
 * strictly below the base - matching the message key
 * `llmBackoffCapGteBase` ("must be greater than or equal to the base delay",
 * `src/locales/en.json:2807`). Equality therefore *passes* here, which is
 * asserted explicitly; a spec that only checked "smaller fails" would miss an
 * accidental flip of `>=` to `>`.
 *
 * Harness notes (measured facts, matching the sibling specs):
 *
 * - A real antd `<Form>` is mandatory: the component calls
 *   `Form.useFormInstance()` and the cap rule reads `llm_backoff_base`
 *   through it. The global stub in `src/test/design-mock.ts` exposes only
 *   `Form.Item` / `Form.useForm`, so none of the validation logic would run
 *   against it. Same `vi.importActual<typeof import("antd")>("antd")` swap as
 *   `AgentLoopCard.render.test.tsx` / `ReMeLightMemoryCard.test.tsx` /
 *   `LlmRateLimiterCard.test.tsx`.
 * - The `react-i18next` stub returns *stable* references (`vi.hoisted`), and
 *   `t` returns the key verbatim so assertions pin the i18n key the product
 *   asks for rather than a rewordable English sentence.
 */

import { Form } from "@agentscope-ai/design";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { renderWithProviders } from "@/test/common_setup";
import { LlmRetryCard } from "./LlmRetryCard";

vi.mock("@agentscope-ai/design", async () =>
  vi.importActual<typeof import("antd")>("antd"),
);

// Stable stub instances: created once so every render sees identical object
// identities and the `rules` arrays are not rebuilt per render.
const i18nStub = vi.hoisted(() => ({
  t: (key: string, fallback?: string) => fallback ?? key,
  i18n: { resolvedLanguage: "en", language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => i18nStub,
}));

/** Field names exactly as declared in the target source. */
const FIELDS = {
  enabled: "llm_retry_enabled",
  maxRetries: "llm_max_retries",
  backoffBase: "llm_backoff_base",
  backoffCap: "llm_backoff_cap",
} as const;

/**
 * Accessible name of the enable switch, read from a real render dump rather
 * than guessed: antd appends the `Form.Item` tooltip icon's own `aria-label`
 * to the label text, so the switch's name is the label key plus
 * "question-circle".
 */
const SWITCH_NAME = "agentConfig.llmRetryEnabled question-circle";

const NUMERIC_LABELS = [
  "agentConfig.llmMaxRetries",
  "agentConfig.llmBackoffBase",
  "agentConfig.llmBackoffCap",
] as const;

type FormInstance = ReturnType<typeof Form.useForm>[0];

/**
 * Renders the card inside a real antd Form and hands the form instance out,
 * because the rules under test are driven through `form.validateFields()`.
 */
function Harness({
  onForm,
  initialValues,
  llmRetryEnabled,
}: {
  onForm?: (form: FormInstance) => void;
  initialValues?: Record<string, number | boolean>;
  llmRetryEnabled?: boolean;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    onForm?.(form);
  }, [form, onForm]);

  return (
    <Form form={form} initialValues={initialValues}>
      <LlmRetryCard llmRetryEnabled={llmRetryEnabled} />
    </Form>
  );
}

/** Runs validation and normalises both outcomes into a flat message list. */
async function collectErrors(
  form: FormInstance,
  names: string[],
): Promise<string[]> {
  return form
    .validateFields(names)
    .then(() => [] as string[])
    .catch((e: { errorFields?: Array<{ errors: string[] }> }) =>
      (e.errorFields ?? []).flatMap((f) => f.errors),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LlmRetryCard - exposed settings", () => {
  it("renders the card title, the enable switch and three labelled controls", () => {
    renderWithProviders(<Harness />);

    expect(screen.getByText("agentConfig.llmRetryTitle")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: SWITCH_NAME }),
    ).toBeInTheDocument();
    for (const label of NUMERIC_LABELS) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("binds every control to the field name the config payload uses", () => {
    let form: FormInstance | undefined;
    renderWithProviders(<Harness onForm={(f) => (form = f)} />);

    // `initialValues` on the real page are keyed by these names, so a renamed
    // field silently stops round-tripping the user's saved config.
    expect(form!.getFieldsError().map((e) => e.name.join("."))).toEqual([
      FIELDS.enabled,
      FIELDS.maxRetries,
      FIELDS.backoffBase,
      FIELDS.backoffCap,
    ]);
  });

  it("keeps the numeric controls enabled when the prop is omitted", () => {
    renderWithProviders(<Harness />);

    // The prop is declared as `llmRetryEnabled = true`, and that default is
    // what feeds the numeric controls' `disabled` flag - omitting it must not
    // grey them out.
    for (const label of NUMERIC_LABELS) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
  });

  it("drives the switch from the form field, not from the prop", () => {
    renderWithProviders(<Harness llmRetryEnabled />);

    // Two independent inputs reach this card: the prop gates the numeric
    // controls' `disabled`, while the switch reflects the registered
    // `llm_retry_enabled` field (via `valuePropName="checked"`). With no
    // initialValue the field is unset, so the switch renders off even though
    // the prop says retry is enabled - and the controls stay usable.
    expect(screen.getByRole("switch", { name: SWITCH_NAME })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    for (const label of NUMERIC_LABELS) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
  });

  it("renders the switch as checked when the field value says so", () => {
    renderWithProviders(
      <Harness initialValues={{ [FIELDS.enabled]: true }} llmRetryEnabled />,
    );

    expect(screen.getByRole("switch", { name: SWITCH_NAME })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("LlmRetryCard - page-level disable", () => {
  it("disables all three numeric controls while retry is off", () => {
    renderWithProviders(<Harness llmRetryEnabled={false} />);

    for (const label of NUMERIC_LABELS) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });

  it("enables all three numeric controls while retry is on", () => {
    renderWithProviders(<Harness llmRetryEnabled />);

    for (const label of NUMERIC_LABELS) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
  });

  it("leaves the retry switch itself usable while retry is off", () => {
    renderWithProviders(<Harness llmRetryEnabled={false} />);

    // Only the numeric settings are gated; the switch stays interactive so
    // the user can turn retry back on.
    expect(screen.getByRole("switch", { name: SWITCH_NAME })).toBeEnabled();
  });
});

describe("LlmRetryCard - required and lower-bound rules", () => {
  it("rejects every empty numeric setting with its own required message", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(<Harness onForm={(f) => (form = f)} />);

    const errors = await collectErrors(form!, [
      FIELDS.maxRetries,
      FIELDS.backoffBase,
      FIELDS.backoffCap,
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        "agentConfig.llmMaxRetriesRequired",
        "agentConfig.llmBackoffBaseRequired",
        "agentConfig.llmBackoffCapRequired",
      ]),
    );
    expect(errors).toHaveLength(3);
  });

  it.each([
    // [field, below-min value, expected message]
    [FIELDS.maxRetries, 0, "agentConfig.llmMaxRetriesMin"],
    [FIELDS.backoffBase, 0.05, "agentConfig.llmBackoffBaseMin"],
    [FIELDS.backoffCap, 0.4, "agentConfig.llmBackoffCapMin"],
  ])(
    "reports the declared range message when %s is below its minimum",
    async (field, value, message) => {
      let form: FormInstance | undefined;
      renderWithProviders(
        <Harness
          onForm={(f) => (form = f)}
          initialValues={{ [field]: value }}
        />,
      );

      const errors = await collectErrors(form!, [field]);

      expect(errors).toContain(message);
    },
  );

  it.each([
    [FIELDS.maxRetries, 1],
    [FIELDS.backoffBase, 0.1],
    [FIELDS.backoffCap, 0.5],
  ])("accepts %s exactly at its lower bound (%p)", async (field, value) => {
    let form: FormInstance | undefined;
    // A valid cap/base pair keeps the cross-field rule quiet so only the
    // lower-bound rule is exercised here.
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{
          [FIELDS.backoffBase]: 0.1,
          [FIELDS.backoffCap]: 0.5,
          [field]: value,
        }}
      />,
    );

    const errors = await collectErrors(form!, [field]);

    // `min` is inclusive, so the boundary value itself is legal.
    expect(errors).toHaveLength(0);
  });
});

describe("LlmRetryCard - backoff cap vs base", () => {
  it("passes when the cap is greater than the base", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 2, [FIELDS.backoffCap]: 30 }}
      />,
    );

    const errors = await collectErrors(form!, [FIELDS.backoffCap]);

    expect(errors).toHaveLength(0);
  });

  it("passes when the cap equals the base (this bound is inclusive)", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 5, [FIELDS.backoffCap]: 5 }}
      />,
    );

    const errors = await collectErrors(form!, [FIELDS.backoffCap]);

    // Opposite of the sibling rate-limiter card, where equality fails. The
    // message key itself says "greater than or equal to".
    expect(errors).toHaveLength(0);
  });

  it("fails when the cap is strictly below the base", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 10, [FIELDS.backoffCap]: 3 }}
      />,
    );

    const errors = await collectErrors(form!, [FIELDS.backoffCap]);

    expect(errors).toEqual(["agentConfig.llmBackoffCapGteBase"]);
  });

  it("skips the cross-field check while the base is still unset", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffCap]: 1 }}
      />,
    );

    const errors = await collectErrors(form!, [FIELDS.backoffCap]);

    // The validator bails out when a dependency is not a number yet, so a
    // half-filled form must not show the cap-vs-base complaint. The cap value
    // here sits above its own 0.5 floor, which isolates the cross-field rule
    // as the only thing that could produce an error.
    expect(errors).not.toContain("agentConfig.llmBackoffCapGteBase");
    expect(errors).toHaveLength(0);
  });

  it("reports only the required message when the cap itself is empty", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 60 }}
      />,
    );

    const errors = await collectErrors(form!, [FIELDS.backoffCap]);

    // `typeof value !== "number"` short-circuits the validator, so an empty
    // cap yields the required message and *not* the cross-field one.
    expect(errors).toEqual(["agentConfig.llmBackoffCapRequired"]);
  });

  it("re-validates the cap when the base is raised above it", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 2, [FIELDS.backoffCap]: 30 }}
      />,
    );

    expect(await collectErrors(form!, [FIELDS.backoffCap])).toHaveLength(0);

    const base = screen.getByLabelText("agentConfig.llmBackoffBase");
    await act(async () => {
      fireEvent.change(base, { target: { value: "60" } });
    });

    // `dependencies: ["llm_backoff_base"]` must pull the cap back into
    // validation on its own, otherwise the stale value stays invisible
    // until submit.
    await waitFor(() => {
      expect(form!.getFieldError(FIELDS.backoffCap)).toContain(
        "agentConfig.llmBackoffCapGteBase",
      );
    });
  });

  it("clears the cap error once the cap is raised back above the base", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.backoffBase]: 2, [FIELDS.backoffCap]: 30 }}
      />,
    );

    const base = screen.getByLabelText("agentConfig.llmBackoffBase");
    await act(async () => {
      fireEvent.change(base, { target: { value: "60" } });
    });
    await waitFor(() => {
      expect(form!.getFieldError(FIELDS.backoffCap)).toContain(
        "agentConfig.llmBackoffCapGteBase",
      );
    });

    const cap = screen.getByLabelText("agentConfig.llmBackoffCap");
    await act(async () => {
      fireEvent.change(cap, { target: { value: "120" } });
    });

    await waitFor(() => {
      expect(form!.getFieldError(FIELDS.backoffCap)).toHaveLength(0);
    });
  });
});

describe("LlmRetryCard - enable switch wiring", () => {
  it("writes the switch state into the form field", async () => {
    let form: FormInstance | undefined;
    renderWithProviders(
      <Harness
        onForm={(f) => (form = f)}
        initialValues={{ [FIELDS.enabled]: true }}
      />,
    );

    const toggle = screen.getByRole("switch", { name: SWITCH_NAME });
    await act(async () => {
      fireEvent.click(toggle);
    });

    // `valuePropName="checked"` is what makes a click land in the field value
    // rather than being ignored.
    expect(form!.getFieldValue(FIELDS.enabled)).toBe(false);
  });
});
