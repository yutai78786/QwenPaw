// @vitest-environment jsdom
/**
 * BackupToolbar - the search bar above the backups table. It is a controlled
 * input: the filtering itself happens in `BackupTable` via its `searchQuery`
 * prop, so this component owns no state and its whole contract is "show what
 * the parent handed down, and hand back exactly what the user typed".
 *
 * Rendered from one place, checked by grep before this suite was written
 * (`grep -rn --include=*.ts --include=*.tsx BackupToolbar src | grep -v
 * "\.test\."`): `pages/Settings/Backups/index.tsx:19` (import) + `:102` (JSX),
 * wired as `searchQuery={searchQuery}` / `onSearchChange={setSearchQuery}` with
 * the state declared at `:37`. Nothing else mounts it, so it is not dead code.
 *
 * Visible contract under test:
 *
 *   1. it is fully controlled - the input shows the parent's `searchQuery`
 *      verbatim, including the empty string, and follows it when the parent
 *      changes it. A locally remembered value would desync the bar from the
 *      table below it;
 *   2. typing hands the parent the RAW input value as a single string
 *      argument, not an event object. `onSearchChange` is wired straight to
 *      `setSearchQuery`, so handing it an event would put an event object into
 *      state and the table filter would silently stop matching anything;
 *   3. clearing to an empty string is a first-class case (N=0 of the filter):
 *      it must be reported like any other value, because that is the only way
 *      the table gets its full list back;
 *   4. antd's `allowClear` control reports an empty string too, and it is
 *      hidden while the value is already empty - a user must not be offered a
 *      clear button on an empty field;
 *   5. the placeholder is the backups-specific i18n key, not the generic
 *      settings one (four different `searchPlaceholder` keys exist in
 *      `src/locales/en.json`; the backups one is at `:705`);
 *   6. the search icon is rendered as the input's prefix, so the bar is
 *      recognisable as a filter without a label.
 *
 * Harness notes (measured facts, not guesses):
 *
 * - antd renders for real here (`Input` comes straight from `antd`, which
 *   `vite.config.ts` does not alias), while `SearchOutlined` comes from
 *   `@ant-design/icons`. Probed in this worktree: the icon module resolves to
 *   the real package here (a `.anticon-search` element is present), so the
 *   assertion is written against the rendered prefix rather than against the
 *   shared `src/test/icons-mock.ts` stub.
 * - the value is read off the DOM `input.value`, and the callback payload is
 *   read off `mock.calls[n][0]`. Both were probed: `fireEvent.change` with a
 *   non-empty value reports that value; with an empty value it reports `""`;
 *   clicking `.ant-input-clear-icon` reports `""` while the input keeps showing
 *   the parent's value (correct for a controlled input whose parent does not
 *   change it in this render).
 * - CSS module class names carry a hash (`_toolbar_c5edb9`), so they are never
 *   asserted; only antd's own stable classes and the DOM value are.
 * - `react-i18next` is mocked with `t` returning the key verbatim, so the
 *   placeholder assertion pins the i18n key the product asks for.
 * - `cleanup()` runs after every case.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import BackupToolbar from "./BackupToolbar";

vi.mock("react-i18next", () => {
  // Built once per factory call so `t` keeps a stable identity across renders.
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key;
  return {
    useTranslation: () => ({
      t,
      i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
    }),
  };
});

afterEach(() => cleanup());

// Typed to the component's own prop signature, following the precedent in
// `pages/Agent/Checkpoints/RestoreModal.test.tsx:154`.
type Handlers = {
  onSearchChange: ReturnType<typeof vi.fn<(q: string) => void>>;
};

const setup = (searchQuery = "") => {
  const h: Handlers = { onSearchChange: vi.fn() };
  const view = render(<BackupToolbar searchQuery={searchQuery} {...h} />);
  const input = view.container.querySelector("input") as HTMLInputElement;
  return { ...view, ...h, input };
};

const clearIcon = (root: ParentNode) =>
  root.querySelector<HTMLElement>(".ant-input-clear-icon");

describe("BackupToolbar - controlled value", () => {
  it("shows the parent's query verbatim", () => {
    const { input } = setup("nightly");
    expect(input.value).toBe("nightly");
  });

  it("shows an empty field when the parent has no query", () => {
    const { input } = setup("");
    expect(input.value).toBe("");
  });

  it("follows the parent when the query changes", () => {
    const { input, rerender } = setup("one");
    expect(input.value).toBe("one");
    rerender(<BackupToolbar searchQuery="two" onSearchChange={() => {}} />);
    // A locally cached value would still read "one" here.
    expect(input.value).toBe("two");
  });

  it("accepts a query with spaces and non-ascii characters", () => {
    // Backup names in this product routinely contain them, so the filter input
    // has to round-trip them untouched. The CJK literal is written as a unicode
    // escape on purpose: the runtime value really is those two characters, while
    // the file itself stays pure ASCII (this repo's test-file convention).
    const { input } = setup("nightly snapshot #42");
    expect(input.value).toBe("nightly snapshot #42");
    cleanup();
    const cjk = setup("\u5907\u4efd 2026");
    expect(cjk.input.value).toBe("\u5907\u4efd 2026");
  });

  it("renders a text input with the backups-specific placeholder", () => {
    const { input } = setup();
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("placeholder")).toBe("backup.searchPlaceholder");
    // Guards against picking up the generic settings key by mistake: four
    // different `searchPlaceholder` keys exist in src/locales/en.json.
    expect(input.getAttribute("placeholder")).not.toBe("searchPlaceholder");
  });

  it("renders the search icon as the input prefix", () => {
    const { container } = setup();
    expect(container.querySelector(".ant-input-prefix")).not.toBeNull();
    expect(container.querySelector(".anticon-search")).not.toBeNull();
  });
});

describe("BackupToolbar - what it hands the parent", () => {
  it("reports the raw typed value as a single string argument", () => {
    const { input, onSearchChange } = setup("");
    fireEvent.change(input, { target: { value: "nightly" } });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    // The parent wires this straight into setSearchQuery, so an event object
    // here would end up in state and break the table filter.
    expect(onSearchChange.mock.calls[0]).toEqual(["nightly"]);
    expect(typeof onSearchChange.mock.calls[0][0]).toBe("string");
  });

  it("reports an empty string when the field is cleared by typing", () => {
    const { input, onSearchChange } = setup("abc");
    fireEvent.change(input, { target: { value: "" } });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange.mock.calls[0]).toEqual([""]);
  });

  it("reports every keystroke rather than only the final value", () => {
    // No debounce lives in this component, so each change is its own report and
    // the table below filters as the user types.
    const { input, onSearchChange } = setup("");
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "ni" } });
    fireEvent.change(input, { target: { value: "nig" } });
    expect(onSearchChange).toHaveBeenCalledTimes(3);
    expect(onSearchChange.mock.calls.map((c) => c[0])).toEqual([
      "n",
      "ni",
      "nig",
    ]);
  });

  it("reports an empty string when the clear control is clicked", () => {
    const { container, onSearchChange } = setup("abc");
    const icon = clearIcon(container);
    expect(icon).not.toBeNull();
    fireEvent.click(icon as HTMLElement);
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange.mock.calls[0]).toEqual([""]);
  });

  it("does not re-render the value itself after a clear click", () => {
    // It is controlled: the component may only report, never adopt its own
    // value. With a parent that ignores the report, the field still shows what
    // the parent handed down. Probed, and asserted as the controlled contract.
    const { container } = setup("abc");
    fireEvent.click(clearIcon(container) as HTMLElement);
    expect((container.querySelector("input") as HTMLInputElement).value).toBe(
      "abc",
    );
  });
});

describe("BackupToolbar - clear affordance", () => {
  it("offers the clear control when there is something to clear", () => {
    const { container } = setup("abc");
    const icon = clearIcon(container);
    expect(icon).not.toBeNull();
    expect((icon as HTMLElement).className).not.toContain(
      "ant-input-clear-icon-hidden",
    );
  });

  it("hides the clear control when the field is already empty", () => {
    const { container } = setup("");
    const icon = clearIcon(container);
    expect(icon).not.toBeNull();
    // Probed: antd keeps the element in the DOM but marks it hidden, so the
    // assertion is on the modifier class rather than on presence.
    expect((icon as HTMLElement).className).toContain(
      "ant-input-clear-icon-hidden",
    );
  });
});
