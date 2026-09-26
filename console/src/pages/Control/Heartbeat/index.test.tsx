// @vitest-environment jsdom
/**
 * HeartbeatPage tests - the control-plane heartbeat form's user-visible
 * contract.
 *
 * What is covered and why it is covered this way:
 *
 * 1. The shared design stub (src/test/design-mock.ts) exports neither `Card`
 *    nor `Select`, and its `Form.useForm()` returns `[{}]` - an instance with
 *    no `setFieldsValue` and no `getFieldValue`. This page calls
 *    `form.setFieldsValue(...)` after every fetch and drives a
 *    `shouldUpdate` render-prop item, both of which need a real field store.
 *    Measured in this batch: importing the page against the shared stub
 *    yields `STUB_FORM_INST_KEYS=[]` and
 *    `STUB_HAS_SETFIELDSVALUE="undefined"`. This suite therefore supplies a
 *    `vi.mock` factory that maps the six keys the page imports onto the real
 *    antd components. The shared stub is deliberately left untouched: 59
 *    other suites depend on it.
 * 2. The page renders inside antd's `App` context because `useAppMessage`
 *    reads `App.useApp()`. This suite mocks `useAppMessage` itself rather
 *    than relying on the provider, so the success/error toasts are directly
 *    observable and no portal markup is involved.
 * 3. No i18next instance is initialised by src/test/setup.ts (stderr reports
 *    `NO_I18NEXT_INSTANCE`), so `t(key)` returns the key itself. Assertions
 *    therefore compare translation keys, which is also what a user sees
 *    before translations load. This page passes a single argument to `t`, so
 *    unlike suites for components that use `t(key, fallback)` there is no
 *    English fallback string to assert on.
 * 4. Field values are read from the DOM (`.ant-input-number-input`,
 *    `.ant-picker-input input`, `.ant-select-selection-item`,
 *    `[role="switch"]`) rather than from the form instance, because the page
 *    never exposes its form. The switch order is positional and asserted by
 *    the label text next to it, so a reordered stylesheet cannot silently
 *    change which switch a test clicks.
 * 5. The submitted body is asserted by reading the `updateHeartbeatConfig`
 *    call argument. `activeHours: undefined` survives the `in` operator but
 *    disappears from `JSON.stringify`, so the "active hours off" case asserts
 *    the value is `undefined` explicitly instead of relying on a serialised
 *    snapshot that would look identical either way.
 * 6. The interval unit select and the target select are both driven through
 *    their real antd popups. The option labels are the translation keys
 *    (`heartbeat.unitMinutes`, `heartbeat.targetInbox`), so the tests locate
 *    options by those keys instead of by index.
 * 7. Validation is asserted through the rendered `.ant-form-item-explain-error`
 *    nodes plus the fact that `updateHeartbeatConfig` was never called. The
 *    interval-number item is `noStyle`, so its message surfaces on the
 *    wrapping item; both are checked against the same expectation.
 * 8. The `max` rule on `timeoutSeconds` is unreachable through typing: the
 *    `InputNumber` also carries `max={3600}`, which clamps on blur before the
 *    rule sees the value (measured here: typing 3601 then blurring leaves
 *    3600 and renders no error node). The rule is therefore driven with an
 *    over-max value coming from the fetch, because `setFieldsValue` does not
 *    clamp. Both the rule and the clamping behaviour get their own test so a
 *    regression in either one is visible.
 * 9. The fetch is re-run when `selectedAgent` changes (the effect's only
 *    dependency). This suite mocks the agent store and re-renders with a new
 *    agent id, asserting a second `getHeartbeatConfig` call and that the
 *    fields follow the second payload.
 * 10. `TimePickerHHmm` normalises its `value` prop through a two-level
 *     ternary (string / array / anything else) and its `onChange` through a
 *     second one (string / array). The reachable arms are driven with real
 *     payloads: a string, an empty string, a number and a two-element array.
 *     The unexported helper is never rendered directly, because that would
 *     test the helper instead of the page that owns it.
 * 11. Class assertions go through the imported CSS module object rather than
 *     literal hashed names, so a rename in the stylesheet breaks the test at
 *     compile time instead of silently passing.
 * 12. Five branch arms are deliberately left uncovered because no user input
 *     can reach them, each verified rather than assumed:
 *     - the array arm of `typeof str === "string" ? str : str?.[0]`. rc-picker
 *       builds that argument with `return multiple ? values : values[0]`
 *       (lib/PickerInput/SinglePicker.js), and this page never passes
 *       `multiple`, so the callback only ever receives a plain string. The
 *       arm exists to satisfy the `string | string[]` union in the antd prop
 *       type, not to handle a real case.
 *     - the `"6h"` fallback in `onFinish`, plus the `?? false` / `?? "main"` /
 *       `?? 300` fallbacks. All three fields carry `initialValues`, the
 *       interval number and the timeout carry `required` rules that block the
 *       submit before `onFinish` runs, and neither `Select` has `allowClear`
 *       (measured: zero `.ant-select-clear` nodes), so `values` can never hold
 *       a nullish field at this point. Asserting them would require calling
 *       `onFinish` directly, which the page does not export.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/common_setup";
import styles from "./index.module.less";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  err: vi.fn(),
  ok: vi.fn(),
  agent: "alpha",
}));

vi.mock("@agentscope-ai/design", async () => {
  const antd = await vi.importActual<typeof import("antd")>("antd");
  return {
    Button: antd.Button,
    Card: antd.Card,
    Form: antd.Form,
    InputNumber: antd.InputNumber,
    Select: antd.Select,
    Switch: antd.Switch,
  };
});

vi.mock("../../../api", () => ({
  default: {
    getHeartbeatConfig: h.get,
    updateHeartbeatConfig: h.put,
  },
}));

vi.mock("../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({
    message: { error: h.err, success: h.ok },
    modal: {},
    notification: {},
  }),
}));

vi.mock("../../../stores/agentStore", () => ({
  useAgentStore: () => ({ selectedAgent: h.agent }),
}));

import HeartbeatPage from "./index";

/** Full payload: every field present, active hours enabled. */
const CFG_FULL = {
  enabled: true,
  every: "45m",
  target: "last",
  timeoutSeconds: 900,
  activeHours: { start: "07:30", end: "23:15" },
};

const SAVE = "common.save";

function switches(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="switch"]'));
}

function numbers(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(".ant-input-number-input"),
  );
}

function pickers(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(".ant-picker-input input"),
  );
}

function selectedTexts(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".ant-select-selection-item"),
  ).map((el) => el.textContent);
}

function validationErrors(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".ant-form-item-explain-error"),
  ).map((el) => el.textContent);
}

/** Mount the page and wait until the loading branch is gone. */
async function mountLoaded(payload: unknown) {
  h.get.mockResolvedValue(payload as never);
  const view = renderWithProviders(<HeartbeatPage />);
  await waitFor(() =>
    expect(view.container.querySelectorAll(".ant-card").length).toBe(1),
  );
  return view;
}

/** The switch that belongs to the given label text. */
function switchByLabel(container: HTMLElement, labelKey: string) {
  const label = Array.from(container.querySelectorAll("label")).find(
    (el) => el.textContent === labelKey,
  );
  expect(label).toBeTruthy();
  const item = label?.closest(".ant-form-item");
  const found = item?.querySelector<HTMLElement>('[role="switch"]');
  expect(found).toBeTruthy();
  return found as HTMLElement;
}

async function pickSelectOption(
  container: HTMLElement,
  selectorIndex: number,
  optionLabel: string,
) {
  const selector = container.querySelectorAll(".ant-select-selector")[
    selectorIndex
  ] as HTMLElement;
  fireEvent.mouseDown(selector);
  const option = await screen.findByText(optionLabel, {
    selector: ".ant-select-item-option-content",
  });
  fireEvent.click(option);
}

describe("HeartbeatPage loading branch", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("shows the breadcrumb and the loading text while the fetch is pending", async () => {
    let release: (v: unknown) => void = () => {};
    h.get.mockReturnValue(new Promise((r) => (release = r)));
    const { container, unmount } = renderWithProviders(<HeartbeatPage />);

    expect(container.textContent).toContain("common.loading");
    expect(container.textContent).toContain("nav.control");
    expect(container.textContent).toContain("heartbeat.title");
    // The card with the form is not rendered at all while loading.
    expect(container.querySelectorAll(".ant-card").length).toBe(0);
    expect(container.querySelector(`.${styles.heartbeatPage}`)).toBeTruthy();
    expect(container.querySelector(`.${styles.description}`)).toBeTruthy();

    release(CFG_FULL);
    await waitFor(() =>
      expect(container.querySelectorAll(".ant-card").length).toBe(1),
    );
    expect(container.textContent).not.toContain("common.loading");
    unmount();
  });

  it("applies the heartbeat page and content class names once loaded", async () => {
    const { container, unmount } = await mountLoaded(CFG_FULL);
    expect(container.querySelector(`.${styles.heartbeatPage}`)).toBeTruthy();
    expect(container.querySelector(`.${styles.heartbeatContent}`)).toBeTruthy();
    expect(container.querySelector(`.${styles.card}`)).toBeTruthy();
    unmount();
  });
});

describe("HeartbeatPage field mapping", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("maps a full config onto every control", async () => {
    const { container, unmount } = await mountLoaded(CFG_FULL);

    expect(
      switches(container).map((el) => el.getAttribute("aria-checked")),
    ).toEqual(["true", "true"]);
    expect(numbers(container).map((el) => el.value)).toEqual(["45", "900"]);
    expect(pickers(container).map((el) => el.value)).toEqual([
      "07:30",
      "23:15",
    ]);
    expect(selectedTexts(container)).toEqual([
      "heartbeat.unitMinutes",
      "heartbeat.targetLast",
    ]);
    expect(
      Array.from(container.querySelectorAll("label")).map(
        (el) => el.textContent?.replace(/:$/, ""),
      ),
    ).toEqual([
      "heartbeat.enabled",
      "heartbeat.every",
      "heartbeat.timeoutSeconds",
      "heartbeat.target",
      "heartbeat.activeHours",
      "heartbeat.activeStart",
      "heartbeat.activeEnd",
    ]);
    unmount();
  });

  it("falls back to 6h / main / 300 / off when the payload is empty", async () => {
    const { container, unmount } = await mountLoaded({});

    expect(
      switches(container).map((el) => el.getAttribute("aria-checked")),
    ).toEqual(["false", "false"]);
    expect(numbers(container).map((el) => el.value)).toEqual(["6", "300"]);
    expect(selectedTexts(container)).toEqual([
      "heartbeat.unitHours",
      "heartbeat.targetMain",
    ]);
    // No active hours means the whole conditional row is absent.
    expect(pickers(container)).toHaveLength(0);
    unmount();
  });

  it("treats an explicit null activeHours the same as a missing one", async () => {
    const { container, unmount } = await mountLoaded({ activeHours: null });
    expect(pickers(container)).toHaveLength(0);
    expect(
      switchByLabel(container, "heartbeat.activeHours").getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
    unmount();
  });

  it("renders 2h30m as 150 minutes because parseEvery keeps the remainder", async () => {
    const { container, unmount } = await mountLoaded({ every: "2h30m" });
    expect(numbers(container)[0].value).toBe("150");
    expect(selectedTexts(container)[0]).toBe("heartbeat.unitMinutes");
    unmount();
  });

  it("renders an unparseable interval as the 6h default", async () => {
    const { container, unmount } = await mountLoaded({
      every: "not-a-duration",
    });
    expect(numbers(container)[0].value).toBe("6");
    expect(selectedTexts(container)[0]).toBe("heartbeat.unitHours");
    unmount();
  });

  it("re-fetches and re-maps when the selected agent changes", async () => {
    const { container, rerender, unmount } = await mountLoaded(CFG_FULL);
    expect(h.get).toHaveBeenCalledTimes(1);

    h.get.mockResolvedValue({ enabled: false, every: "2h", target: "inbox" });
    h.agent = "beta";
    rerender(<HeartbeatPage />);

    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(numbers(container)[0].value).toBe("2"));
    expect(
      switchByLabel(container, "heartbeat.enabled").getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
    expect(selectedTexts(container)[1]).toBe("heartbeat.targetInbox");
    unmount();
  });
});

describe("HeartbeatPage load failure", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("reports the load error and still renders the form with defaults", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.get.mockRejectedValue(new Error("boom"));
    const { container, unmount } = renderWithProviders(<HeartbeatPage />);

    await waitFor(() => expect(h.err).toHaveBeenCalledTimes(1));
    expect(h.err.mock.calls[0][0]).toBe("heartbeat.loadFailed");
    // The finally branch clears loading, so the card is shown with the
    // Form initialValues rather than staying on the loading branch.
    expect(container.querySelectorAll(".ant-card").length).toBe(1);
    expect(numbers(container).map((el) => el.value)).toEqual(["6", "300"]);
    expect(container.textContent).not.toContain("common.loading");
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to load heartbeat config:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
    unmount();
  });
});

describe("HeartbeatPage active hours row", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("reveals both pickers with the documented defaults when switched on", async () => {
    const { container, unmount } = await mountLoaded({ activeHours: null });
    expect(container.querySelectorAll(".ant-picker").length).toBe(0);

    fireEvent.click(switchByLabel(container, "heartbeat.activeHours"));

    await waitFor(() =>
      expect(container.querySelectorAll(".ant-picker").length).toBe(2),
    );
    expect(pickers(container).map((el) => el.value)).toEqual([
      "08:00",
      "22:00",
    ]);
    expect(container.querySelector(`.${styles.activeHoursRow}`)).toBeTruthy();
    unmount();
  });

  it("hides the pickers again when switched back off", async () => {
    const { container, unmount } = await mountLoaded(CFG_FULL);
    expect(container.querySelectorAll(".ant-picker").length).toBe(2);

    fireEvent.click(switchByLabel(container, "heartbeat.activeHours"));

    await waitFor(() =>
      expect(container.querySelectorAll(".ant-picker").length).toBe(0),
    );
    // The already-loaded times stay in the form even though they are hidden.
    unmount();
  });

  it("keeps the loaded start time when the picker input is emptied", async () => {
    const { container, unmount } = await mountLoaded(CFG_FULL);
    const start = pickers(container)[0];
    fireEvent.change(start, { target: { value: "" } });
    fireEvent.blur(start);
    await waitFor(() => expect(pickers(container)[0].value).toBe(""));

    h.put.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    // Whatever the internal path is, an emptied input can never write an
    // empty time into the stored config. The value is asserted rather than
    // "onChange was not called", because the latter is not observable here.
    expect(h.put.mock.calls[0][0].activeHours).toEqual({
      start: "07:30",
      end: "23:15",
    });
    unmount();
  });

  it("writes a time typed into the picker", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);
    const start = pickers(container)[0];

    fireEvent.mouseDown(start);
    fireEvent.change(start, { target: { value: "10:45" } });
    fireEvent.blur(start);
    await waitFor(() => expect(pickers(container)[0].value).toBe("10:45"));

    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].activeHours).toEqual({
      start: "10:45",
      end: "23:15",
    });
    unmount();
  });

  it("writes a time committed with Enter", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);
    const end = pickers(container)[1];

    fireEvent.mouseDown(end);
    fireEvent.change(end, { target: { value: "20:00" } });
    fireEvent.keyDown(end, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(pickers(container)[1].value).toBe("20:00"));

    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].activeHours).toEqual({
      start: "07:30",
      end: "20:00",
    });
    unmount();
  });

  it("leaves the stored time untouched when the clear icon is used", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);
    const picker = container.querySelectorAll(".ant-picker")[0] as HTMLElement;
    const clear = picker.querySelector(".ant-picker-clear") as HTMLElement;
    expect(clear).toBeTruthy();

    fireEvent.click(clear);
    await waitFor(() => expect(pickers(container)[0].value).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    // Clearing produces an empty string, and the `if (s)` guard drops it, so
    // the previously loaded value is what gets submitted.
    expect(h.put.mock.calls[0][0].activeHours).toEqual({
      start: "07:30",
      end: "23:15",
    });
    unmount();
  });

  it("renders an empty start value as an empty picker instead of a date", async () => {
    const { container, unmount } = await mountLoaded({
      activeHours: { start: "", end: "18:00" },
    });
    // `""` survives the `?? "08:00"` fallback because it is not nullish, so
    // the ternary takes its null branch and no date is parsed.
    expect(pickers(container).map((el) => el.value)).toEqual(["", "18:00"]);
    expect(container.querySelectorAll(".ant-picker").length).toBe(2);
    unmount();
  });

  it("renders a non-string non-array start value as an empty picker", async () => {
    const { container, unmount } = await mountLoaded({
      activeHours: { start: 5, end: "18:00" },
    });
    // Neither the string arm nor the array arm applies, so the helper falls
    // through to null rather than feeding a number to dayjs.
    expect(pickers(container).map((el) => el.value)).toEqual(["", "18:00"]);
    unmount();
  });

  it("renders an array start value by taking its first element", async () => {
    const { container, unmount } = await mountLoaded({
      activeHours: { start: ["09:00", "10:00"], end: "18:00" },
    });
    expect(pickers(container).map((el) => el.value)).toEqual([
      "09:00",
      "18:00",
    ]);
    unmount();
  });
});

describe("HeartbeatPage submit", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("serialises the loaded values and reports success", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);

    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0]).toEqual({
      enabled: true,
      every: "45m",
      target: "last",
      timeoutSeconds: 900,
      activeHours: { start: "07:30", end: "23:15" },
    });
    expect(h.ok.mock.calls[0][0]).toBe("heartbeat.saveSuccess");
    expect(h.err).not.toHaveBeenCalled();
    // The submit button leaves its loading state afterwards.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: SAVE }).className,
      ).not.toContain("ant-btn-loading"),
    );
    expect(container.querySelectorAll(".ant-card").length).toBe(1);
    unmount();
  });

  it("sends the hour unit when the interval is expressed in hours", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded({
      every: "3h",
      activeHours: null,
    });

    fireEvent.change(numbers(container)[0], { target: { value: "12" } });
    await waitFor(() => expect(numbers(container)[0].value).toBe("12"));
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].every).toBe("12h");
    unmount();
  });

  it("sends the minute unit when the unit select is switched to minutes", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded({
      every: "3h",
      activeHours: null,
    });

    await pickSelectOption(container, 0, "heartbeat.unitMinutes");
    await waitFor(() =>
      expect(selectedTexts(container)[0]).toBe("heartbeat.unitMinutes"),
    );
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].every).toBe("3m");
    unmount();
  });

  it("sends the chosen target when the target select changes", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded({ activeHours: null });

    await pickSelectOption(container, 1, "heartbeat.targetInbox");
    await waitFor(() =>
      expect(selectedTexts(container)[1]).toBe("heartbeat.targetInbox"),
    );
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].target).toBe("inbox");
    unmount();
  });

  it("omits activeHours from the body when the switch is off", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);

    fireEvent.click(switchByLabel(container, "heartbeat.activeHours"));
    await waitFor(() =>
      expect(container.querySelectorAll(".ant-picker").length).toBe(0),
    );
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const body = h.put.mock.calls[0][0] as Record<string, unknown>;
    // The key is present but its value is undefined, which is what the
    // component builds. JSON.stringify would hide the difference, so the
    // value is asserted directly.
    expect("activeHours" in body).toBe(true);
    expect(body.activeHours).toBeUndefined();
    expect(body.enabled).toBe(true);
    unmount();
  });

  it("sends enabled false when the enable switch is turned off", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded(CFG_FULL);

    fireEvent.click(switchByLabel(container, "heartbeat.enabled"));
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].enabled).toBe(false);
    unmount();
  });

  it("reports the save error and clears the saving state", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.put.mockRejectedValue(new Error("nope"));
    const { unmount } = await mountLoaded({});

    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.err).toHaveBeenCalledTimes(1));
    expect(h.err.mock.calls[0][0]).toBe("heartbeat.saveFailed");
    expect(h.ok).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to save heartbeat config:",
      expect.any(Error),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: SAVE }).className,
      ).not.toContain("ant-btn-loading"),
    );
    errorSpy.mockRestore();
    unmount();
  });
});

describe("HeartbeatPage validation", () => {
  beforeEach(() => {
    h.get.mockReset();
    h.put.mockReset();
    h.err.mockReset();
    h.ok.mockReset();
    h.agent = "alpha";
  });

  it("blocks the submit and explains when the timeout is cleared", async () => {
    const { container, unmount } = await mountLoaded({});

    fireEvent.change(numbers(container)[1], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() =>
      expect(validationErrors(container)).toEqual([
        "heartbeat.timeoutRequired",
      ]),
    );
    expect(h.put).not.toHaveBeenCalled();
    unmount();
  });

  it("blocks the submit when the backend already returned an over-max timeout", async () => {
    // The max rule is unreachable through typing: InputNumber's own `max`
    // prop clamps the value on blur before the rule ever sees it (measured
    // here - typing 3601 then blurring leaves 3600 and no error node). The
    // rule only fires for a value the fetch wrote in directly, since
    // `setFieldsValue` does not clamp.
    const { container, unmount } = await mountLoaded({
      timeoutSeconds: 3601,
    });

    expect(numbers(container)[1].value).toBe("3601");
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() =>
      expect(validationErrors(container)).toContain("heartbeat.timeoutMax"),
    );
    expect(h.put).not.toHaveBeenCalled();
    unmount();
  });

  it("clamps typed values to the documented bounds before submitting", async () => {
    h.put.mockResolvedValue({});
    const { container, unmount } = await mountLoaded({
      timeoutSeconds: 3600,
    });

    fireEvent.change(numbers(container)[1], { target: { value: "3601" } });
    fireEvent.blur(numbers(container)[1]);
    await waitFor(() => expect(numbers(container)[1].value).toBe("3600"));

    fireEvent.change(numbers(container)[0], { target: { value: "0" } });
    fireEvent.blur(numbers(container)[0]);
    await waitFor(() => expect(numbers(container)[0].value).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0]).toMatchObject({
      timeoutSeconds: 3600,
      every: "1h",
    });
    expect(validationErrors(container)).toHaveLength(0);
    unmount();
  });

  it("blocks the submit when the interval is cleared", async () => {
    const { container, unmount } = await mountLoaded({});

    fireEvent.change(numbers(container)[0], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() =>
      expect(validationErrors(container)).toContain("heartbeat.everyRequired"),
    );
    expect(h.put).not.toHaveBeenCalled();
    unmount();
  });

  it("accepts a corrected timeout and submits", async () => {
    const { container, unmount } = await mountLoaded({});
    h.put.mockResolvedValue({});

    fireEvent.change(numbers(container)[1], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(validationErrors(container)).toHaveLength(1));

    fireEvent.change(numbers(container)[1], { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0].timeoutSeconds).toBe(60);
    await waitFor(() => expect(validationErrors(container)).toHaveLength(0));
    unmount();
  });
});
