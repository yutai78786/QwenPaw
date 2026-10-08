// @vitest-environment jsdom
/**
 * HeaderActions tests - the action bar of the Skills page, rendered from
 * `pages/Agent/Skills/index.tsx:144` (`<HeaderActions ... />`, imported at
 * `:10`).
 *
 * Visible contract under test:
 *
 *   1. the bar has two mutually exclusive shapes, switched solely by the
 *      `batchModeEnabled` flag: a normal bar (refresh / sync-to-pool / batch
 *      operation / add-skill dropdown) and a batch bar (count / select-all /
 *      clear / sync selected / enable / disable / delete / exit);
 *   2. the hidden file input is always mounted, accepts only `.zip`, stays out
 *      of layout, is handed to the caller through `fileInputRef`, and forwards
 *      its change event untouched;
 *   3. `loading` drives BOTH the refresh button's disabled state and its icon's
 *      spin flag, and neither while idle;
 *   4. the two buttons that share the `skills.uploadToPool` label do completely
 *      different things - the normal one opens the pool dialog, the batch one
 *      performs the transfer - so asserting only the label would let a swap
 *      through;
 *   5. the batch transfer has an empty-selection guard: with nothing selected it
 *      reports nothing at all (it must not even clear), and with a selection it
 *      clears FIRST and then hands over the names as an array snapshot;
 *   6. the selection count reaches the label through the i18n `count` option and
 *      is also printed inline on the delete button;
 *   7. all six add-skill entry points are wired to the right callback, including
 *      the two whose names cross over (`onOpenDownloadPool` feeds `onFromPool`,
 *      `onUploadClick` feeds `onUploadZip`, `onImportHub` feeds `onFromUrl`).
 *
 * Harness notes (measured facts):
 *
 * - `AddSkillDropdown` is replaced with a recorder that hands the props it
 *   receives back to the test. That is the only way to assert the six-callback
 *   mapping in (7): the shared design stub renders `Dropdown` as a pass-through
 *   div, so the menu never opens and the wiring would be unobservable. It has no
 *   suite of its own, so nothing is being skipped by stubbing it here.
 *   `src/test/design-mock.ts` is untouched.
 * - The refresh button is icon-only: probe shows `textContent` empty,
 *   `aria-label` null and `title` null (the hint lives on the Tooltip wrapper
 *   div), so it is located by its `anticon-reload` icon rather than by name.
 * - `loading` is observable as the extra `anticon-spin` class on that same icon.
 * - `t` returns the key verbatim and records its options, so assertions pin the
 *   i18n key the product asks for plus the interpolation argument it passes.
 *   Keys checked present in `src/locales/en.json`: `skills.selectedCount`,
 *   `selectAll`, `clearSelection`, `uploadToPoolHint`, `uploadToPool`,
 *   `batchEnable`, `batchDisable`, `exitBatch`, `refreshHint`,
 *   `batchOperation`, `common.delete`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // Records EVERY call, not just the last one: the count label is translated
  // before the seven button labels, so a "last call" recorder would always
  // report one of those instead.
  stableT: (key: string, options?: Record<string, unknown>) => {
    h.tCalls.push([key, options ?? null]);
    return key;
  },
  stableI18n: { language: "en" },
  tCalls: [] as Array<[string, Record<string, unknown> | null]>,
  // Props the stubbed AddSkillDropdown received, handed back to the test.
  dropdownProps: null as Record<string, unknown> | null,
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

vi.mock("./AddSkillDropdown", () => ({
  AddSkillDropdown: (props: Record<string, unknown>) => {
    h.dropdownProps = props;
    return <button type="button">stub-add-skill-dropdown</button>;
  },
}));

import { HeaderActions } from "./HeaderActions";

/** Every prop the component declares, with a fresh spy for each callback. */
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    batchModeEnabled: false,
    selectedSkills: new Set<string>(),
    loading: false,
    uploading: false,
    fileInputRef: createRef<HTMLInputElement>(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onUploadToPool: vi.fn(),
    onBatchEnable: vi.fn(),
    onBatchDisable: vi.fn(),
    onBatchDelete: vi.fn(),
    onToggleBatchMode: vi.fn(),
    onHardRefresh: vi.fn(),
    onOpenDownloadPool: vi.fn(),
    onOpenUploadPool: vi.fn(),
    onUploadClick: vi.fn(),
    onImportHub: vi.fn(),
    onCreate: vi.fn(),
    onBrowseMarket: vi.fn(),
    onFileChange: vi.fn(),
    ...overrides,
  };
}

type Props = ReturnType<typeof makeProps>;

afterEach(cleanup);

beforeEach(() => {
  h.dropdownProps = null;
  h.tCalls = [];
});

function buttonByLabel(label: string): HTMLButtonElement {
  const found = screen
    .queryAllByRole("button")
    .filter((b) => (b.textContent ?? "").trim().startsWith(label));
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one button for ${label}, got ${found.length}`,
    );
  }
  return found[0] as HTMLButtonElement;
}

/** The icon-only refresh button, located by its icon (probe: no accessible name). */
function refreshButton(): HTMLButtonElement {
  const icon = document.querySelector(".anticon-reload");
  const button = icon?.closest("button");
  if (!button) throw new Error("no refresh button found");
  return button as HTMLButtonElement;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input found");
  return input;
}

describe("HeaderActions - the two bar shapes are mutually exclusive", () => {
  it("renders the four normal-bar actions and none of the batch ones", () => {
    render(<HeaderActions {...makeProps()} />);
    expect(buttonByLabel("skills.uploadToPool")).toBeInTheDocument();
    expect(buttonByLabel("skills.batchOperation")).toBeInTheDocument();
    expect(screen.getByText("stub-add-skill-dropdown")).toBeInTheDocument();
    expect(refreshButton()).toBeInTheDocument();

    for (const batchOnly of [
      "skills.selectAll",
      "skills.clearSelection",
      "skills.batchEnable",
      "skills.batchDisable",
      "skills.exitBatch",
    ]) {
      expect(screen.queryByText(batchOnly)).toBeNull();
    }
    expect(screen.queryByText(/^common\.delete/)).toBeNull();
  });

  it("renders the eight batch-bar actions and none of the normal ones", () => {
    render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["alpha", "beta"]),
        })}
      />,
    );
    for (const label of [
      "skills.selectAll",
      "skills.clearSelection",
      "skills.uploadToPool",
      "skills.batchEnable",
      "skills.batchDisable",
      "skills.exitBatch",
    ]) {
      expect(buttonByLabel(label)).toBeInTheDocument();
    }
    expect(buttonByLabel("common.delete (2)")).toBeInTheDocument();

    // The normal bar is gone entirely: no refresh icon, no dropdown stub.
    expect(document.querySelector(".anticon-reload")).toBeNull();
    expect(screen.queryByText("stub-add-skill-dropdown")).toBeNull();
    expect(screen.queryByText("skills.batchOperation")).toBeNull();
  });

  it("lists the batch actions in the order the product declares", () => {
    render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["a", "b", "c"]),
        })}
      />,
    );
    expect(
      screen.queryAllByRole("button").map((b) => (b.textContent ?? "").trim()),
    ).toEqual([
      "skills.selectAll",
      "skills.clearSelection",
      "skills.uploadToPool",
      "skills.batchEnable",
      "skills.batchDisable",
      "common.delete (3)",
      "skills.exitBatch",
    ]);
  });
});

describe("HeaderActions - hidden file input", () => {
  it("is always mounted, zip-only and kept out of layout in both modes", () => {
    const { rerender } = render(<HeaderActions {...makeProps()} />);
    expect(fileInput().accept).toBe(".zip");
    expect(fileInput().style.display).toBe("none");

    rerender(<HeaderActions {...makeProps({ batchModeEnabled: true })} />);
    expect(fileInput().accept).toBe(".zip");
    expect(fileInput().style.display).toBe("none");
  });

  it("hands the very same element to the caller through fileInputRef", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    expect(props.fileInputRef.current).not.toBeNull();
    expect(props.fileInputRef.current).toBe(fileInput());
  });

  it("forwards the change event untouched", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(props.onFileChange).toHaveBeenCalledTimes(1);
    const arg = props.onFileChange.mock.calls[0][0] as Event;
    expect(arg.target).toBe(fileInput());
  });
});

describe("HeaderActions - loading drives the refresh button", () => {
  it("keeps refresh clickable and unspun while idle", () => {
    render(<HeaderActions {...makeProps({ loading: false })} />);
    expect(refreshButton().disabled).toBe(false);
    expect(refreshButton().querySelector(".anticon-spin")).toBeNull();
  });

  it("disables refresh and spins its icon while loading", () => {
    render(<HeaderActions {...makeProps({ loading: true })} />);
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().querySelector(".anticon-spin")).not.toBeNull();
  });

  it("reports the hard refresh on click", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    fireEvent.click(refreshButton());
    expect(props.onHardRefresh).toHaveBeenCalledTimes(1);
  });

  it("puts both tooltips on the two left-hand buttons only", () => {
    const { container } = render(<HeaderActions {...makeProps()} />);
    expect(
      Array.from(container.querySelectorAll("div[title]")).map((d) =>
        d.getAttribute("title"),
      ),
    ).toEqual(["skills.refreshHint", "skills.uploadToPoolHint"]);
  });
});

describe("HeaderActions - the two same-labelled buttons differ", () => {
  it("opens the pool dialog from the normal bar", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.uploadToPool"));
    expect(props.onOpenUploadPool).toHaveBeenCalledTimes(1);
    // It must not perform a transfer: nothing is selected in this mode anyway.
    expect(props.onUploadToPool).not.toHaveBeenCalled();
    expect(props.onClearSelection).not.toHaveBeenCalled();
  });

  it("marks that button as the primary transfer action in both modes", () => {
    const { container, rerender } = render(<HeaderActions {...makeProps()} />);
    expect(buttonByLabel("skills.uploadToPool").className).toMatch(
      /primaryTransferButton/,
    );
    rerender(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["x"]),
        })}
      />,
    );
    expect(buttonByLabel("skills.uploadToPool").className).toMatch(
      /primaryTransferButton/,
    );
    expect(container.querySelector(".anticon-swap")).not.toBeNull();
  });

  it("enters and leaves batch mode through the same callback", () => {
    const props = makeProps();
    const { rerender } = render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.batchOperation"));
    rerender(<HeaderActions {...props} batchModeEnabled={true} />);
    fireEvent.click(buttonByLabel("skills.exitBatch"));
    expect(props.onToggleBatchMode).toHaveBeenCalledTimes(2);
  });
});

describe("HeaderActions - batch selection wiring", () => {
  it("reports select-all, clear, enable, disable and delete on their own buttons", () => {
    const props = makeProps({
      batchModeEnabled: true,
      selectedSkills: new Set(["a"]),
    });
    render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.selectAll"));
    fireEvent.click(buttonByLabel("skills.clearSelection"));
    fireEvent.click(buttonByLabel("skills.batchEnable"));
    fireEvent.click(buttonByLabel("skills.batchDisable"));
    fireEvent.click(buttonByLabel("common.delete (1)"));
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
    expect(props.onBatchEnable).toHaveBeenCalledTimes(1);
    expect(props.onBatchDisable).toHaveBeenCalledTimes(1);
    expect(props.onBatchDelete).toHaveBeenCalledTimes(1);
  });

  it("passes the selection size to the i18n count option", () => {
    render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["a", "b", "c", "d"]),
        })}
      />,
    );
    // The count label is rendered...
    expect(screen.getByText("skills.selectedCount")).toBeInTheDocument();
    // ...and that key, and only that key, was interpolated with the size.
    expect(optionsForKey("skills.selectedCount")).toEqual({ count: 4 });
    const withOptions = h.tCalls.filter(([, o]) => o !== null).map(([k]) => k);
    expect(withOptions).toEqual(["skills.selectedCount"]);
  });

  it("passes a zero count through rather than hiding the label", () => {
    render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set<string>(),
        })}
      />,
    );
    expect(optionsForKey("skills.selectedCount")).toEqual({ count: 0 });
  });

  it("tracks the count option when the selection changes", () => {
    const { rerender } = render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["a"]),
        })}
      />,
    );
    expect(optionsForKey("skills.selectedCount")).toEqual({ count: 1 });
    h.tCalls = [];
    rerender(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["a", "b", "c"]),
        })}
      />,
    );
    expect(optionsForKey("skills.selectedCount")).toEqual({ count: 3 });
  });

  it("prints the size inline on the delete button, tracking the selection", () => {
    const { rerender } = render(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set<string>(),
        })}
      />,
    );
    expect(buttonByLabel("common.delete (0)").textContent).toBe(
      "common.delete (0)",
    );
    rerender(
      <HeaderActions
        {...makeProps({
          batchModeEnabled: true,
          selectedSkills: new Set(["a", "b"]),
        })}
      />,
    );
    expect(buttonByLabel("common.delete (2)").textContent).toBe(
      "common.delete (2)",
    );
  });
});

describe("HeaderActions - the batch transfer guard", () => {
  it("reports nothing at all when the selection is empty, and does not clear", () => {
    const props: Props = makeProps({
      batchModeEnabled: true,
      selectedSkills: new Set<string>(),
    });
    render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.uploadToPool"));
    expect(props.onUploadToPool).not.toHaveBeenCalled();
    // The guard returns before the clear too, so the selection is left alone.
    expect(props.onClearSelection).not.toHaveBeenCalled();
  });

  it("clears first, then hands over the names as an array snapshot", () => {
    const props = makeProps({
      batchModeEnabled: true,
      selectedSkills: new Set(["zeta", "alpha"]),
    });
    render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.uploadToPool"));

    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
    expect(props.onUploadToPool).toHaveBeenCalledTimes(1);
    const names = props.onUploadToPool.mock.calls[0][0] as string[];
    // An array copy, not the Set itself, so later selection changes cannot
    // retro-edit what was handed over.
    expect(Array.isArray(names)).toBe(true);
    expect(names).toEqual(["zeta", "alpha"]);
    expect(props.selectedSkills.has("zeta")).toBe(true);

    // Order: clear is invoked before the transfer.
    expect(props.onClearSelection.mock.invocationCallOrder[0]).toBeLessThan(
      props.onUploadToPool.mock.invocationCallOrder[0],
    );
  });

  it("hands over a single-element array for a single selection", () => {
    const props = makeProps({
      batchModeEnabled: true,
      selectedSkills: new Set(["only"]),
    });
    render(<HeaderActions {...props} />);
    fireEvent.click(buttonByLabel("skills.uploadToPool"));
    expect(props.onUploadToPool).toHaveBeenCalledWith(["only"]);
  });
});

describe("HeaderActions - add-skill dropdown wiring", () => {
  it("maps all six entry points, including the two that cross over", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    const received = h.dropdownProps as Record<string, unknown> | null;
    expect(received).not.toBeNull();
    // Same function identity per prop: a swap would show up as a mismatch here.
    expect(received?.onCreate).toBe(props.onCreate);
    expect(received?.onFromPool).toBe(props.onOpenDownloadPool);
    expect(received?.onUploadZip).toBe(props.onUploadClick);
    expect(received?.onFromUrl).toBe(props.onImportHub);
    expect(received?.onBrowseMarket).toBe(props.onBrowseMarket);
  });

  it("does not collapse the crossed-over callbacks onto each other", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    const received = h.dropdownProps as Record<string, unknown>;
    const handed = [
      received.onCreate,
      received.onFromPool,
      received.onUploadZip,
      received.onFromUrl,
      received.onBrowseMarket,
    ];
    expect(new Set(handed).size).toBe(handed.length);
  });

  it("forwards the uploading flag to the dropdown", () => {
    const { rerender } = render(
      <HeaderActions {...makeProps({ uploading: false })} />,
    );
    expect((h.dropdownProps as Record<string, unknown>).uploading).toBe(false);
    rerender(<HeaderActions {...makeProps({ uploading: true })} />);
    expect((h.dropdownProps as Record<string, unknown>).uploading).toBe(true);
  });

  it("invokes the caller's callback when the dropdown reports an entry point", () => {
    const props = makeProps();
    render(<HeaderActions {...props} />);
    const received = h.dropdownProps as Record<string, unknown>;
    (received.onFromUrl as () => void)();
    (received.onUploadZip as () => void)();
    expect(props.onImportHub).toHaveBeenCalledTimes(1);
    expect(props.onUploadClick).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
