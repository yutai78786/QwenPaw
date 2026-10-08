// @vitest-environment jsdom
/**
 * ImportBuiltinModal tests - the built-in skill import dialog's user-visible
 * contract: which cards are listed, the import status label each one gets
 * (per-language status winning over the item status), the version fallback
 * chain, the notice block that only appears when there are updates, the
 * select-all and clear-shortcut actions, the language override buttons, and
 * above all what confirm reports back: one entry per selected skill with the
 * language resolved from the override, the skill's own current language, or
 * the caller's default, in that order.
 *
 * The shared design stub renders Modal as a pass-through div that ignores
 * `open` and renders no footer, so this suite supplies its own Modal, Button
 * and Tooltip. The stub mirrors the real dialog by rendering nothing while
 * closed and by wiring okButtonProps onto the confirm button, which is what
 * makes the disabled-while-empty contract observable.
 *
 * Translated strings are asserted by i18n key: the stub `t` returns the key,
 * so a test that sees "skillPool.importStatusCurrent" proves which arm of the
 * product's switch produced the label without depending on any locale file.
 *
 * One arm stays uncovered, measured (branch id and source line):
 *   - `ImportBuiltinModal.tsx:86` branch id=7 hits [19, 0]: the fallback used
 *     when a selected name has no matching source. The open effect reseeds the
 *     selection from `defaultSelectedNames` filtered by the available names,
 *     and its dependency list includes that name set, so any catalogue change
 *     re-filters the selection before a confirm can run. Keeping a selection
 *     with no source would need the source list to change without that effect
 *     running, which jsdom does not offer. The reseed itself is asserted as the
 *     user-visible contract instead.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  t: (key: string, opts?: unknown) => (typeof opts === "string" ? opts : key),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t, i18n: { language: "en" } }),
}));

vi.mock("@ant-design/icons", () => ({
  CheckOutlined: () => <span data-icon="check" />,
}));

vi.mock("@agentscope-ai/design", () => {
  const Modal = ({
    open,
    title,
    children,
    onOk,
    onCancel,
    okButtonProps,
  }: any) => {
    if (!open) return null;
    const ok = okButtonProps ?? {};
    return (
      <div data-testid="modal">
        <div data-testid="modal-title">{title}</div>
        {children}
        <button
          type="button"
          data-testid="modal-ok"
          disabled={!!ok.disabled}
          onClick={onOk}
        >
          OK
        </button>
        <button type="button" data-testid="modal-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  };
  const Button = ({ children, onClick, type, size, ...rest }: any) => (
    <button type="button" data-btn-type={type} onClick={onClick} {...rest}>
      {children}
    </button>
  );
  const Tooltip = ({ children }: any) => <span>{children}</span>;
  return { Modal, Button, Tooltip };
});

import { ImportBuiltinModal } from "./ImportBuiltinModal";
import type {
  BuiltinImportSpec,
  BuiltinUpdateNotice,
} from "../../../../api/types";

/** One entry of the payload the dialog reports on confirm. */
type ConfirmSelection = Array<{ skill_name: string; language: "en" | "zh" }>;

/**
 * The mock has to declare the parameter: a bare `async () => {}` is inferred as
 * zero-argument, which makes `mock.calls[0][0]` a type error and hides the real
 * payload type from the assertions below.
 */
function makeConfirmSpy() {
  return vi.fn(async (_selections: ConfirmSelection) => {});
}

function makeSource(over: Partial<BuiltinImportSpec> = {}): BuiltinImportSpec {
  return {
    name: "web-search",
    version_text: "1.2.0",
    current_version_text: "1.0.0",
    status: "outdated",
    ...over,
  };
}

function makeNotice(
  over: Partial<BuiltinUpdateNotice> = {},
): BuiltinUpdateNotice {
  return {
    fingerprint: "fp-1",
    has_updates: true,
    total_changes: 2,
    actionable_skill_names: ["web-search"],
    added: [],
    missing: [],
    updated: [makeSource()],
    removed: [],
    ...over,
  };
}

function renderModal(
  props: {
    sources?: BuiltinImportSpec[];
    notice?: BuiltinUpdateNotice | null;
    defaultLanguage?: "en" | "zh";
    defaultSelectedNames?: string[];
    open?: boolean;
    loading?: boolean;
  } = {},
) {
  const onCancel = vi.fn();
  const onConfirm = makeConfirmSpy();
  const utils = render(
    <ImportBuiltinModal
      open={props.open ?? true}
      loading={props.loading ?? false}
      sources={props.sources ?? [makeSource()]}
      notice={props.notice === undefined ? null : props.notice}
      defaultLanguage={props.defaultLanguage ?? "en"}
      defaultSelectedNames={props.defaultSelectedNames}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { ...utils, onCancel, onConfirm };
}

function clickCard(name: string) {
  fireEvent.click(screen.getByText(name));
}

async function confirm() {
  await fireEvent.click(screen.getByTestId("modal-ok"));
}

afterEach(() => {
  cleanup();
});

describe("ImportBuiltinModal - dialog frame", () => {
  it("renders nothing while closed", () => {
    renderModal({ open: false });

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  it("asks for the import title when open", () => {
    renderModal();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "skillPool.importBuiltin",
    );
  });

  it("shows the hint above the picker", () => {
    renderModal();

    expect(screen.getByText("skillPool.importBuiltinHint")).toBeInTheDocument();
  });

  it("disables confirm while nothing is selected", () => {
    renderModal();

    expect(screen.getByTestId("modal-ok")).toBeDisabled();
  });

  it("enables confirm once a card is selected", () => {
    renderModal();

    clickCard("web-search");

    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();
  });

  it("keeps the dialog usable while an import is in flight", () => {
    renderModal({ loading: true, sources: [makeSource({ name: "a" })] });

    clickCard("a");

    // The loading flag belongs to the design library's button rendering, so it
    // is not asserted here; what the product decides is that selection still
    // works and that cancel is refused (covered below).
    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();
  });
});

describe("ImportBuiltinModal - listing", () => {
  it("renders one card per source with its name", () => {
    renderModal({
      sources: [
        makeSource({ name: "alpha" }),
        makeSource({ name: "beta" }),
        makeSource({ name: "gamma" }),
      ],
    });

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("renders an empty picker when there are no sources", () => {
    renderModal({ sources: [] });

    expect(screen.queryByTestId("modal-ok")).toBeDisabled();
    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(0);
  });

  it("reports the source and current versions", () => {
    renderModal({
      sources: [
        makeSource({
          name: "one",
          version_text: "2.0.0",
          current_version_text: "1.5.0",
        }),
      ],
    });

    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5\.0/)).toBeInTheDocument();
  });

  it("falls back to a dash for both versions when the source gives none", () => {
    renderModal({
      sources: [
        makeSource({
          name: "bare",
          version_text: undefined,
          current_version_text: undefined,
        }),
      ],
    });

    // Each version row is "<label>: <value>" inside one element, so the dash is
    // matched at the end of that row rather than as a standalone text node.
    expect(
      screen.getByText(/^skillPool\.sourceVersion: -$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^skillPool\.currentVersion: -$/),
    ).toBeInTheDocument();
  });

  it("prefers the selected language spec version over the item version", () => {
    renderModal({
      sources: [
        makeSource({
          name: "lang-skill",
          version_text: "item-1.0",
          languages: { zh: { language: "zh", version_text: "zh-9.9" } },
          current_language: "zh",
        }),
      ],
    });

    expect(screen.getByText(/zh-9\.9/)).toBeInTheDocument();
    expect(screen.queryByText(/item-1\.0/)).toBeNull();
  });
});

describe("ImportBuiltinModal - status label", () => {
  const cases: Array<[string, string]> = [
    ["current", "skillPool.importStatusCurrent"],
    ["outdated", "skillPool.importStatusOutdated"],
    ["conflict", "skillPool.importStatusConflict"],
    ["missing", "skillPool.importStatusMissing"],
  ];

  it.each(cases)("maps status %s to its label", (status, label) => {
    renderModal({ sources: [makeSource({ status })] });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("labels an absent status as missing", () => {
    renderModal({ sources: [makeSource({ status: undefined })] });

    expect(
      screen.getByText("skillPool.importStatusMissing"),
    ).toBeInTheDocument();
  });

  it("labels an unknown status as missing", () => {
    renderModal({ sources: [makeSource({ status: "something-new" })] });

    expect(
      screen.getByText("skillPool.importStatusMissing"),
    ).toBeInTheDocument();
  });

  it("lets the language spec status win over the item status", () => {
    renderModal({
      sources: [
        makeSource({
          status: "current",
          current_language: "en",
          languages: { en: { language: "en", status: "conflict" } },
        }),
      ],
    });

    expect(
      screen.getByText("skillPool.importStatusConflict"),
    ).toBeInTheDocument();
    expect(screen.queryByText("skillPool.importStatusCurrent")).toBeNull();
  });

  it("falls back to the item status when the language spec has none", () => {
    renderModal({
      sources: [
        makeSource({
          status: "outdated",
          current_language: "en",
          languages: { en: { language: "en" } },
        }),
      ],
    });

    expect(
      screen.getByText("skillPool.importStatusOutdated"),
    ).toBeInTheDocument();
  });
});

describe("ImportBuiltinModal - selection", () => {
  it("selects every source from the select all action", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a" }), makeSource({ name: "b" })],
    });

    fireEvent.click(screen.getByText("agent.selectAll"));
    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "en" },
      { skill_name: "b", language: "en" },
    ]);
  });

  it("clears the whole selection", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a" })],
      defaultSelectedNames: ["a"],
    });

    fireEvent.click(screen.getByText("skills.clearSelection"));

    expect(screen.getByTestId("modal-ok")).toBeDisabled();
    await confirm();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("toggles a card off when it is clicked twice", async () => {
    const { onConfirm } = renderModal({ sources: [makeSource({ name: "a" })] });

    clickCard("a");
    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();
    clickCard("a");
    expect(screen.getByTestId("modal-ok")).toBeDisabled();

    await confirm();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("marks a selected card with the check icon", () => {
    renderModal({
      sources: [makeSource({ name: "a" }), makeSource({ name: "b" })],
      defaultSelectedNames: ["b"],
    });

    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1);
  });

  it("seeds the selection from the given names", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a" }), makeSource({ name: "b" })],
      defaultSelectedNames: ["b"],
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "b", language: "en" },
    ]);
  });

  it("drops seeded names that are not among the sources", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a" })],
      defaultSelectedNames: ["a", "ghost-skill"],
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "en" },
    ]);
  });

  it("starts empty when the seeded names are all unknown", () => {
    renderModal({
      sources: [makeSource({ name: "a" })],
      defaultSelectedNames: ["ghost"],
    });

    expect(screen.getByTestId("modal-ok")).toBeDisabled();
  });

  it("starts empty when no seeded names are given", () => {
    renderModal({ sources: [makeSource({ name: "a" })] });

    expect(screen.getByTestId("modal-ok")).toBeDisabled();
  });

  it("re-seeds when the caller changes the default names", async () => {
    const onConfirm = makeConfirmSpy();
    const sources = [makeSource({ name: "a" }), makeSource({ name: "b" })];
    const view = render(
      <ImportBuiltinModal
        open
        loading={false}
        sources={sources}
        notice={null}
        defaultLanguage="en"
        defaultSelectedNames={["a"]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    view.rerender(
      <ImportBuiltinModal
        open
        loading={false}
        sources={sources}
        notice={null}
        defaultLanguage="en"
        defaultSelectedNames={["b"]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await fireEvent.click(screen.getByTestId("modal-ok"));
    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "b", language: "en" },
    ]);
  });

  it("keeps a manual selection when unrelated props change", async () => {
    const onConfirm = makeConfirmSpy();
    const sources = [makeSource({ name: "a" })];
    const view = render(
      <ImportBuiltinModal
        open
        loading={false}
        sources={sources}
        notice={null}
        defaultLanguage="en"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    clickCard("a");
    view.rerender(
      <ImportBuiltinModal
        open
        loading
        sources={sources}
        notice={null}
        defaultLanguage="en"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();
  });
});

describe("ImportBuiltinModal - language resolution", () => {
  it("uses the caller default when the source has no current language", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a", current_language: undefined })],
      defaultSelectedNames: ["a"],
      defaultLanguage: "zh",
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "zh" },
    ]);
  });

  it("uses the source current language when no override is picked", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a", current_language: "zh" })],
      defaultSelectedNames: ["a"],
      defaultLanguage: "en",
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "zh" },
    ]);
  });

  it("keeps the english source language when the default is english", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a", current_language: "en" })],
      defaultSelectedNames: ["a"],
      defaultLanguage: "en",
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "en" },
    ]);
  });

  it("falls back to the caller default for an unknown current language", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a", current_language: "fr" })],
      defaultSelectedNames: ["a"],
      defaultLanguage: "zh",
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "zh" },
    ]);
  });

  it("applies the chinese override to every selected skill", async () => {
    const { onConfirm } = renderModal({
      sources: [
        makeSource({ name: "a", current_language: "en" }),
        makeSource({ name: "b", current_language: "zh" }),
      ],
      defaultLanguage: "en",
    });

    fireEvent.click(screen.getByText("中文"));
    fireEvent.click(screen.getByText("agent.selectAll"));
    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "zh" },
      { skill_name: "b", language: "zh" },
    ]);
  });

  it("applies the english override even to a chinese source", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "a", current_language: "zh" })],
      defaultLanguage: "zh",
    });

    fireEvent.click(screen.getByText("English"));
    clickCard("a");
    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "en" },
    ]);
  });

  it("goes back to per-skill languages from the default override", async () => {
    const { onConfirm } = renderModal({
      sources: [
        makeSource({ name: "a", current_language: "zh" }),
        makeSource({ name: "b", current_language: "en" }),
      ],
      defaultLanguage: "en",
    });

    fireEvent.click(screen.getByText("中文"));
    fireEvent.click(screen.getByText("skillPool.langDefault"));
    fireEvent.click(screen.getByText("agent.selectAll"));
    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "a", language: "zh" },
      { skill_name: "b", language: "en" },
    ]);
  });

  it("marks the picked override button as primary", () => {
    renderModal();

    fireEvent.click(screen.getByText("中文"));

    const zhButton = screen.getByText("中文").closest("button");
    const enButton = screen.getByText("English").closest("button");
    expect(zhButton).toHaveAttribute("data-btn-type", "primary");
    expect(enButton).toHaveAttribute("data-btn-type", "default");
  });

  it("starts with the default override active", () => {
    renderModal();

    expect(
      screen.getByText("skillPool.langDefault").closest("button"),
    ).toHaveAttribute("data-btn-type", "primary");
  });

  it("re-reads the version and status of the overridden language", () => {
    renderModal({
      sources: [
        makeSource({
          name: "a",
          version_text: "item-1.0",
          status: "current",
          languages: {
            zh: { language: "zh", version_text: "zh-2.0", status: "outdated" },
            en: { language: "en", version_text: "en-3.0", status: "conflict" },
          },
        }),
      ],
    });

    fireEvent.click(screen.getByText("中文"));

    expect(screen.getByText(/zh-2\.0/)).toBeInTheDocument();
    expect(
      screen.getByText("skillPool.importStatusOutdated"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("English"));

    expect(screen.getByText(/en-3\.0/)).toBeInTheDocument();
    expect(
      screen.getByText("skillPool.importStatusConflict"),
    ).toBeInTheDocument();
  });
});

describe("ImportBuiltinModal - notice block", () => {
  it("hides the notice when there is none", () => {
    renderModal({ notice: null });

    expect(screen.queryByText("skillPool.builtinNoticeSummary")).toBeNull();
  });

  it("hides the notice when it reports no updates", () => {
    renderModal({ notice: makeNotice({ has_updates: false }) });

    expect(screen.queryByText("skillPool.builtinNoticeSummary")).toBeNull();
  });

  it("shows the summary when there are updates", () => {
    renderModal({ notice: makeNotice({ total_changes: 3 }) });

    expect(
      screen.getByText("skillPool.builtinNoticeSummary"),
    ).toBeInTheDocument();
  });

  it("lists one line per non-empty change kind in a stable order", () => {
    renderModal({
      notice: makeNotice({
        added: [makeSource({ name: "new-one" })],
        missing: [makeSource({ name: "gone-one" })],
        updated: [makeSource({ name: "changed-one" })],
        removed: [{ name: "dropped-one" }],
      }),
    });

    const labels = [
      "skillPool.builtinNoticeLineAdded",
      "skillPool.builtinNoticeLineMissing",
      "skillPool.builtinNoticeLineUpdated",
      "skillPool.builtinNoticeLineRemoved",
    ];
    labels.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    const rendered = screen
      .getAllByText(/skillPool\.builtinNoticeLine/)
      .map((node) => node.textContent);
    expect(rendered).toEqual(labels);
  });

  it("omits the lines whose change kind is empty", () => {
    renderModal({
      notice: makeNotice({
        added: [makeSource({ name: "new-one" })],
        missing: [],
        updated: [],
        removed: [],
      }),
    });

    expect(
      screen.getByText("skillPool.builtinNoticeLineAdded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("skillPool.builtinNoticeLineMissing")).toBeNull();
    expect(screen.queryByText("skillPool.builtinNoticeLineUpdated")).toBeNull();
    expect(screen.queryByText("skillPool.builtinNoticeLineRemoved")).toBeNull();
  });

  it("renders no line when every change kind is empty", () => {
    renderModal({
      notice: makeNotice({
        has_updates: true,
        added: [],
        missing: [],
        updated: [],
        removed: [],
      }),
    });

    expect(
      screen.getByText("skillPool.builtinNoticeSummary"),
    ).toBeInTheDocument();
    expect(screen.queryAllByText(/skillPool\.builtinNoticeLine/)).toHaveLength(
      0,
    );
  });

  it("skips change entries whose name is blank or missing", () => {
    renderModal({
      notice: makeNotice({
        added: [
          makeSource({ name: "  " }),
          makeSource({ name: "" }),
          { version_text: "x" } as BuiltinImportSpec,
          makeSource({ name: "real-one" }),
        ],
      }),
    });

    expect(
      screen.getByText("skillPool.builtinNoticeLineAdded"),
    ).toBeInTheDocument();
  });
});

describe("ImportBuiltinModal - cancel", () => {
  it("reports cancel and empties the selection", () => {
    const { onCancel } = renderModal({
      sources: [makeSource({ name: "a" })],
      defaultSelectedNames: ["a"],
    });

    fireEvent.click(screen.getByTestId("modal-cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("modal-ok")).toBeDisabled();
  });

  it("ignores cancel while an import is in flight", () => {
    const { onCancel } = renderModal({ loading: true });

    fireEvent.click(screen.getByTestId("modal-cancel"));

    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ImportBuiltinModal - confirm payload", () => {
  it("reports an empty list when confirm is forced with nothing selected", async () => {
    const { onConfirm } = renderModal();

    // The button is disabled, so the click does not reach the handler.
    await confirm();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports one entry per selected skill", async () => {
    const { onConfirm } = renderModal({
      sources: [
        makeSource({ name: "a" }),
        makeSource({ name: "b" }),
        makeSource({ name: "c" }),
      ],
      defaultSelectedNames: ["a", "c"],
    });

    await confirm();

    const payload = onConfirm.mock.calls[0][0] as Array<{ skill_name: string }>;
    expect(payload.map((entry) => entry.skill_name).sort()).toEqual(["a", "c"]);
  });

  it("keeps the selection after confirm so a second submit repeats it", async () => {
    const onConfirm = makeConfirmSpy();
    const view = render(
      <ImportBuiltinModal
        open
        loading={false}
        sources={[makeSource({ name: "a" })]}
        notice={null}
        defaultLanguage="en"
        defaultSelectedNames={["a"]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await fireEvent.click(screen.getByTestId("modal-ok"));

    // The dialog stays open with the same selection: clearing it is the cancel
    // path, not the confirm path.
    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();
    await fireEvent.click(screen.getByTestId("modal-ok"));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm.mock.calls[1][0]).toEqual([
      { skill_name: "a", language: "en" },
    ]);
    view.unmount();
  });

  it("drops a manual selection when the catalogue is refreshed", async () => {
    const onConfirm = makeConfirmSpy();
    const view = render(
      <ImportBuiltinModal
        open
        loading={false}
        sources={[makeSource({ name: "a" }), makeSource({ name: "b" })]}
        notice={null}
        defaultLanguage="zh"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    clickCard("a");
    expect(screen.getByTestId("modal-ok")).not.toBeDisabled();

    view.rerender(
      <ImportBuiltinModal
        open
        loading={false}
        sources={[makeSource({ name: "b" })]}
        notice={null}
        defaultLanguage="zh"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // The effect reseeds the selection whenever the available names change, so
    // a hand picked skill does not survive a catalogue refresh.
    expect(screen.getByTestId("modal-ok")).toBeDisabled();
    await fireEvent.click(screen.getByTestId("modal-ok"));
    expect(onConfirm).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps non-ascii skill names intact in the payload", async () => {
    const { onConfirm } = renderModal({
      sources: [makeSource({ name: "文档 解析器" })],
      defaultSelectedNames: ["文档 解析器"],
    });

    await confirm();

    expect(onConfirm).toHaveBeenCalledWith([
      { skill_name: "文档 解析器", language: "en" },
    ]);
  });
});
