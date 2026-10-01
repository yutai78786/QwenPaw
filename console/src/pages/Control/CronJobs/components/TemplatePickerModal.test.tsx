// @vitest-environment jsdom
/**
 * TemplatePickerModal tests - the visible contract of the cron template picker.
 *
 * Design decisions:
 *
 * 1. The shared design stub (src/test/design-mock.ts) exports no `Select`, and
 *    its `Modal` is a pass-through that renders children even when closed. Both
 *    are shared with every other suite, so this suite supplies its own
 *    `vi.mock` factory and leaves the shared stub untouched.
 * 2. The `Modal` stub deliberately keeps rendering children while recording the
 *    `visible` prop it was handed. Hiding the children inside the stub would
 *    make the "closed shows nothing" case assert the stub instead of the
 *    product; whether antd hides an invisible modal is antd's business. What
 *    this component owns is deriving `visible` from its `open` prop, and that
 *    is what gets asserted.
 * 3. `CRON_TEMPLATES` is NOT mocked. The real product data is the point: the
 *    category filter, the payload shape and the `timezone` plumbing can only be
 *    proven against the templates the user really sees.
 * 4. `t` returns the key, so assertions read the i18n keys the product chose
 *    rather than translated strings that depend on locale.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const modal = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Modal = (props: Record<string, unknown>) => {
    modal.lastProps = props;
    return (
      <div
        data-testid="template-modal"
        data-visible={String(props.visible)}
        data-width={String(props.width)}
        data-footer={String(props.footer)}
      >
        <button
          type="button"
          data-testid="modal-cancel"
          onClick={() => (props.onCancel as () => void)?.()}
        />
        {props.title as never}
        {props.children as never}
      </div>
    );
  };
  type Option = { value: string; label: string };
  const Select = ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: Option[];
    onChange: (next: string) => void;
  }) => (
    <select
      data-testid="category-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  const Button = ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
  return { Modal, Select, Button };
});

import { TemplatePickerModal } from "./TemplatePickerModal";
import { CRON_TEMPLATES, type CronTemplateDefinition } from "./templates";

/** Title keys of the real templates in one category, in array order. */
function titleKeysOf(category: "cron" | "once"): string[] {
  return CRON_TEMPLATES.filter(
    (template) => template.category === category,
  ).map((template) => template.titleKey);
}

/** Every "use template" button, in document order. */
function useButtons(): HTMLElement[] {
  return screen.getAllByText("cronJobs.useTemplate");
}

function renderModal(
  overrides: {
    open?: boolean;
    timezone?: string;
    onCancel?: () => void;
    onUseTemplate?: (values: Record<string, unknown>) => void;
  } = {},
) {
  const props = {
    open: true,
    timezone: "Asia/Shanghai",
    onCancel: vi.fn(),
    onUseTemplate: vi.fn(),
    ...overrides,
  };
  return { ...render(<TemplatePickerModal {...props} />), props };
}

afterEach(() => {
  modal.lastProps = null;
  cleanup();
});

describe("TemplatePickerModal - chrome", () => {
  it("derives the modal visibility straight from the open prop, both ways", () => {
    renderModal({ open: true });
    expect(screen.getByTestId("template-modal")).toHaveAttribute(
      "data-visible",
      "true",
    );
    cleanup();

    renderModal({ open: false });
    // The component still owns the decision; hiding is antd's job.
    expect(screen.getByTestId("template-modal")).toHaveAttribute(
      "data-visible",
      "false",
    );
  });

  it("titles the dialog, drops the default footer and fixes its width", () => {
    renderModal();
    expect(screen.getByText("cronJobs.templateModalTitle")).toBeInTheDocument();
    const widget = screen.getByTestId("template-modal");
    expect(widget).toHaveAttribute("data-footer", "null");
    expect(widget).toHaveAttribute("data-width", "860");
  });

  it("explains what the dialog is for", () => {
    renderModal();
    expect(
      screen.getByText("cronJobs.templateModalDescription"),
    ).toBeInTheDocument();
  });

  it("routes the modal close gesture to onCancel", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("modal-cancel"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("TemplatePickerModal - category selector", () => {
  it("offers exactly the two schedule types, recurring first, and starts on it", () => {
    renderModal();
    const select = screen.getByTestId("category-select");
    const values = Array.from(select.querySelectorAll("option")).map((option) =>
      option.getAttribute("value"),
    );
    expect(values).toEqual(["cron", "once"]);
    expect(select).toHaveValue("cron");
    expect(
      screen.getByText("cronJobs.scheduleTypeRecurring"),
    ).toBeInTheDocument();
    expect(screen.getByText("cronJobs.scheduleTypeOnce")).toBeInTheDocument();
  });

  it("lists every recurring template and no scheduled one on first paint", () => {
    renderModal();
    const cronKeys = titleKeysOf("cron");
    const onceKeys = titleKeysOf("once");
    expect(cronKeys.length).toBeGreaterThan(0);
    expect(useButtons()).toHaveLength(cronKeys.length);
    for (const key of cronKeys) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    for (const key of onceKeys) {
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
  });

  it("swaps the grid to the scheduled templates when the user switches type", () => {
    renderModal();
    const cronKeys = titleKeysOf("cron");
    const onceKeys = titleKeysOf("once");
    fireEvent.change(screen.getByTestId("category-select"), {
      target: { value: "once" },
    });
    expect(screen.getByTestId("category-select")).toHaveValue("once");
    expect(useButtons()).toHaveLength(onceKeys.length);
    for (const key of onceKeys) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    for (const key of cronKeys) {
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
  });

  it("keeps the chosen type across a re-render of the same dialog", () => {
    const { rerender } = render(
      <TemplatePickerModal
        open
        timezone="UTC"
        onCancel={vi.fn()}
        onUseTemplate={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("category-select"), {
      target: { value: "once" },
    });
    rerender(
      <TemplatePickerModal
        open
        timezone="UTC"
        onCancel={vi.fn()}
        onUseTemplate={vi.fn()}
      />,
    );
    expect(screen.getByTestId("category-select")).toHaveValue("once");
  });
});

describe("TemplatePickerModal - card contents", () => {
  it("shows title, description and frequency for every card", () => {
    renderModal();
    for (const template of CRON_TEMPLATES.filter(
      (item) => item.category === "cron",
    )) {
      expect(screen.getByText(template.titleKey)).toBeInTheDocument();
      expect(screen.getByText(template.descriptionKey)).toBeInTheDocument();
      expect(screen.getByText(template.frequencyKey)).toBeInTheDocument();
    }
  });

  it("gives each card exactly one use action", () => {
    renderModal();
    const cronCount = titleKeysOf("cron").length;
    expect(useButtons()).toHaveLength(cronCount);
  });
});

describe("TemplatePickerModal - applying a template", () => {
  it("hands the caller the real recurring form values for the chosen timezone", () => {
    const { props } = renderModal({ timezone: "Europe/Berlin" });
    fireEvent.click(useButtons()[0]);
    expect(props.onUseTemplate).toHaveBeenCalledTimes(1);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    const source = CRON_TEMPLATES.filter((item) => item.category === "cron")[0];
    const { name: _rawName, ...rest } = source.toFormValues("Europe/Berlin");
    // `name` is deliberately excluded here: the picker overwrites it with the
    // translated template title (asserted in its own case below), while every
    // other field must reach the caller exactly as the template produced it.
    expect(payload).toMatchObject(rest);
    expect(payload.scheduleType).toBe("cron");
    expect(payload.schedule).toEqual({
      type: "cron",
      timezone: "Europe/Berlin",
    });
    expect(payload.meta).toEqual({
      template_id: source.id,
      template_source: "builtin",
      show_in_calendar: true,
    });
  });

  it("does not leak the caller's timezone into a scheduled template either", () => {
    const { props } = renderModal({ timezone: "America/New_York" });
    fireEvent.change(screen.getByTestId("category-select"), {
      target: { value: "once" },
    });
    fireEvent.click(useButtons()[0]);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(payload.schedule).toEqual({
      type: "once",
      timezone: "America/New_York",
    });
    expect(payload.scheduleType).toBe("once");
  });

  it("names the new job after the template title instead of leaving it blank", () => {
    const { props } = renderModal();
    fireEvent.click(useButtons()[0]);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    const source = CRON_TEMPLATES.filter((item) => item.category === "cron")[0];
    // The product templates ship name: "" so the picker must overwrite it.
    expect(source.toFormValues("UTC").name).toBe("");
    expect(payload.name).toBe(source.titleKey);
  });

  it("keeps the agent prompt in the request payload and blanks the text field", () => {
    const { props } = renderModal();
    // First recurring template is an agent template.
    const source = CRON_TEMPLATES.filter((item) => item.category === "cron")[0];
    expect(source.toFormValues("UTC").task_type).toBe("agent");
    fireEvent.click(useButtons()[0]);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(payload.task_type).toBe("agent");
    expect(payload.text).toBe("");
    const request = payload.request as { input: string };
    expect(JSON.parse(request.input)[0].role).toBe("user");
    expect(JSON.parse(request.input)[0].content[0].type).toBe("text");
    expect(JSON.parse(request.input)[0].content[0].text).not.toBe("");
  });

  it("carries the reminder wording of a text template through untouched", () => {
    const { props } = renderModal();
    const cronTemplates = CRON_TEMPLATES.filter(
      (item) => item.category === "cron",
    );
    const textIndex = cronTemplates.findIndex(
      (template) => template.toFormValues("UTC").task_type === "text",
    );
    expect(textIndex).toBeGreaterThan(-1);
    const source = cronTemplates[textIndex];
    const originalText = source.toFormValues("UTC").text as string;
    expect(originalText).not.toBe("");
    fireEvent.click(useButtons()[textIndex]);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(payload.task_type).toBe("text");
    expect(payload.text).toBe(originalText);
    expect(payload.request).toBeUndefined();
  });

  it("falls back to the description when a text template ships no wording", async () => {
    // Every built-in text template carries non-empty wording, so this guard is
    // unreachable through the real data. A throwaway module double supplies the
    // one shape the guard exists for; the real templates stay untouched for
    // every other case in this suite (they were imported before the reset).
    vi.resetModules();
    vi.doMock("./templates", async () => {
      const actual = await vi.importActual<typeof import("./templates")>(
        "./templates",
      );
      const bare: CronTemplateDefinition = {
        id: "bare_text_template",
        category: "cron",
        titleKey: "bare.title",
        descriptionKey: "bare.description",
        frequencyKey: "bare.frequency",
        source: "builtin",
        tags: [],
        showInCalendarRecommended: false,
        toFormValues: () => ({ task_type: "text", text: "", name: "" }),
      };
      return { ...actual, CRON_TEMPLATES: [bare] };
    });
    const mod = await import("./TemplatePickerModal");
    const onUseTemplate = vi.fn();
    render(
      <mod.TemplatePickerModal
        open
        timezone="UTC"
        onCancel={vi.fn()}
        onUseTemplate={onUseTemplate}
      />,
    );
    fireEvent.click(screen.getByText("cronJobs.useTemplate"));
    const payload = onUseTemplate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.task_type).toBe("text");
    expect(payload.text).toBe("bare.description");
    expect(payload.name).toBe("bare.title");
    vi.doUnmock("./templates");
    vi.resetModules();
  });

  it("keeps an agent template's text empty even with the description available", () => {
    const { props } = renderModal();
    // The agent branch must NOT take the description fallback: an agent job
    // carries its prompt inside `request`, so `text` has to stay empty.
    fireEvent.click(useButtons()[0]);
    const payload = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(payload.task_type).toBe("agent");
    expect(payload.text).toBe("");
  });

  it("does not close or reset the dialog on its own after applying", () => {
    renderModal();
    fireEvent.click(useButtons()[0]);
    // Visibility is caller-owned: the picker must not flip it by itself.
    expect(screen.getByTestId("template-modal")).toHaveAttribute(
      "data-visible",
      "true",
    );
    expect(screen.getByTestId("category-select")).toHaveValue("cron");
  });

  it("reports each click separately when the user applies two templates", () => {
    const { props } = renderModal();
    fireEvent.click(useButtons()[0]);
    fireEvent.click(useButtons()[1]);
    expect(props.onUseTemplate).toHaveBeenCalledTimes(2);
    const calls = (props.onUseTemplate as ReturnType<typeof vi.fn>).mock.calls;
    const first = calls[0][0] as Record<string, unknown>;
    const second = calls[1][0] as Record<string, unknown>;
    expect((first.meta as Record<string, unknown>).template_id).not.toBe(
      (second.meta as Record<string, unknown>).template_id,
    );
  });
});
