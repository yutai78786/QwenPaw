/**
 * Unit tests for OffloadPolicyCard.
 *
 * The card owns three pieces of state (policy / loading / saving) and reaches
 * the backend through toolCallsApi only, so the API module and antd's static
 * message holder are the only two surfaces that need a test double. Everything
 * else (Card / Radio / Space / Typography / Alert / Spin) is the real antd
 * build rendered into jsdom, which is what makes the border assertions below
 * meaningful: they read the inline style the component really produced.
 *
 * One behaviour is pinned as a measured contract rather than an ideal: a click
 * on a radio reaches BOTH the Radio.Group onChange handler and the wrapping
 * Card onClick handler, because the radio lives inside that card and the click
 * bubbles. See "fires the save twice" below.
 */
import { describe, it, vi, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const getOffloadPolicy = vi.fn();
const setOffloadPolicy = vi.fn();
const msgError = vi.fn();

vi.mock("../../../api/modules/toolCalls", () => ({
  toolCallsApi: {
    getOffloadPolicy: (...a: unknown[]) => getOffloadPolicy(...a),
    setOffloadPolicy: (...a: unknown[]) => setOffloadPolicy(...a),
  },
}));

// Partial mock: keep every real antd component, replace only the imperative
// message holder so the failure toast can be observed without a portal hunt.
vi.mock("antd", async (importOriginal) => {
  const real = await importOriginal<typeof import("antd")>();
  return { ...real, message: { error: (...a: unknown[]) => msgError(...a) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: string) => d ?? k,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

import { OffloadPolicyCard } from "./OffloadPolicyCard";

const KEEP_LABEL = "Keep Foreground";
const OFFLOAD_LABEL = "Auto Offload to Background";
const SAVE_FAILED_FALLBACK = "Failed to save policy";
// Colours come from the component's own option literals.
const KEEP_COLOR = "rgb(250, 173, 20)";
const OFFLOAD_COLOR = "rgb(24, 144, 255)";

/** The rendered tree is [outer card, keep-foreground card, offload card]. */
function optionCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-card")).slice(
    1,
  );
}

function borderOf(el: HTMLElement) {
  return { color: el.style.borderColor, width: el.style.borderWidth };
}

function radios(): HTMLInputElement[] {
  return screen.getAllByRole("radio") as HTMLInputElement[];
}

async function settle() {
  await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
}

/** Start a save that stays in flight until the caller releases it. */
function pendingSave(): { release: (v: unknown) => void } {
  let inner: (v: unknown) => void = () => {};
  setOffloadPolicy.mockReturnValue(
    new Promise((r) => {
      inner = r;
    }),
  );
  return { release: (v: unknown) => inner(v) };
}

describe("OffloadPolicyCard - loading state", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it("shows a spinner and no radio options until the policy arrives", async () => {
    let resolveGet: (v: unknown) => void = () => {};
    getOffloadPolicy.mockReturnValue(
      new Promise((r) => {
        resolveGet = r;
      }),
    );
    render(<OffloadPolicyCard />);

    expect(document.querySelector(".ant-spin-spinning")).not.toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    // The alert and the title are outside the loading branch, so they show up
    // immediately - that is what makes this assertion about the branch and not
    // about "nothing rendered yet".
    expect(screen.getByText("Tool Background Execution")).toBeInTheDocument();

    await act(async () => {
      resolveGet({ default_action: "offload" });
    });

    expect(document.querySelector(".ant-spin-spinning")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("renders both options with their labels and descriptions", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    render(<OffloadPolicyCard />);
    await settle();

    expect(screen.getByText(KEEP_LABEL)).toBeInTheDocument();
    expect(screen.getByText(OFFLOAD_LABEL)).toBeInTheDocument();
    expect(
      screen.getByText(/continues running in the foreground/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/automatically moved to background execution/),
    ).toBeInTheDocument();
  });
});

describe("OffloadPolicyCard - initial policy resolution", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it.each([
    ["keep_foreground", [true, false]],
    ["offload", [false, true]],
  ])(
    "selects the option matching default_action=%s",
    async (value, expected) => {
      getOffloadPolicy.mockResolvedValue({ default_action: value });
      render(<OffloadPolicyCard />);
      await settle();
      expect(radios().map((r) => r.checked)).toEqual(expected);
    },
  );

  it.each([
    ["empty string", { default_action: "" }],
    ["missing field", {}],
    ["null field", { default_action: null }],
  ])(
    "falls back to keep-foreground when default_action is %s",
    async (_label, payload) => {
      getOffloadPolicy.mockResolvedValue(payload);
      render(<OffloadPolicyCard />);
      await settle();
      expect(radios().map((r) => r.checked)).toEqual([true, false]);
    },
  );

  it("swallows a rejected fetch without surfacing an error", async () => {
    getOffloadPolicy.mockRejectedValue(new Error("network down"));
    render(<OffloadPolicyCard />);
    await settle();

    // The catch handler is deliberately empty, so the card must reach the
    // settled state with the fallback policy and must not report anything.
    expect(msgError).not.toHaveBeenCalled();
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
    expect(document.querySelector(".ant-spin-spinning")).toBeNull();
  });
});

describe("OffloadPolicyCard - selection styling", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it("marks the selected option with its own colour and a 2px border", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    render(<OffloadPolicyCard />);
    await settle();

    const [keep, offload] = optionCards();
    expect(borderOf(keep)).toEqual({ color: KEEP_COLOR, width: "2px" });
    // The unselected card gets no border colour at all plus a 1px width; this
    // is the falsy side of both ternaries, so it can only pass if the
    // comparison against the current policy really evaluated to false.
    expect(borderOf(offload)).toEqual({ color: "", width: "1px" });
  });

  it("moves the highlight to the other option after a successful switch", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });

    const [keep, offload] = optionCards();
    expect(borderOf(offload)).toEqual({ color: OFFLOAD_COLOR, width: "2px" });
    expect(borderOf(keep)).toEqual({ color: "", width: "1px" });
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
  });
});

describe("OffloadPolicyCard - saving through the card click", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it("persists the clicked value and adopts it locally", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });

    expect(setOffloadPolicy).toHaveBeenCalledTimes(1);
    expect(setOffloadPolicy).toHaveBeenCalledWith("offload");
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
    expect(msgError).not.toHaveBeenCalled();
  });

  it("ignores a second card click while a save is still in flight", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    const { release } = pendingSave();
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });
    expect(setOffloadPolicy).toHaveBeenCalledTimes(1);

    // Still saving: the click handler short-circuits on the saving flag, so no
    // second request may be started.
    await act(async () => {
      fireEvent.click(optionCards()[0]);
    });
    expect(setOffloadPolicy).toHaveBeenCalledTimes(1);
    expect(setOffloadPolicy.mock.calls).toEqual([["offload"]]);

    await act(async () => {
      release({ ok: true });
    });
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
  });

  it("accepts clicks again once the in-flight save has settled", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    const { release } = pendingSave();
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });
    await act(async () => {
      release({ ok: true });
    });

    setOffloadPolicy.mockResolvedValue({ ok: true });
    await act(async () => {
      fireEvent.click(optionCards()[0]);
    });

    // Proves the saving flag was reset in the finally block rather than
    // staying latched after the first save.
    expect(setOffloadPolicy).toHaveBeenCalledTimes(2);
    expect(setOffloadPolicy).toHaveBeenLastCalledWith("keep_foreground");
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
  });

  it("reports the fallback string and keeps the old policy when saving fails", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    setOffloadPolicy.mockRejectedValue(new Error("server said no"));
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });

    expect(msgError).toHaveBeenCalledTimes(1);
    expect(msgError).toHaveBeenCalledWith(SAVE_FAILED_FALLBACK);
    // setPolicy only runs after a successful await, so a failure must leave
    // both the checked state and the highlight on the previous policy.
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
    expect(borderOf(optionCards()[0])).toEqual({
      color: KEEP_COLOR,
      width: "2px",
    });
    expect(borderOf(optionCards()[1])).toEqual({ color: "", width: "1px" });
  });

  it("clears the saving flag after a failure so the user can retry", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    setOffloadPolicy.mockRejectedValueOnce(new Error("transient"));
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });
    expect(msgError).toHaveBeenCalledTimes(1);

    setOffloadPolicy.mockResolvedValue({ ok: true });
    await act(async () => {
      fireEvent.click(optionCards()[1]);
    });

    expect(setOffloadPolicy).toHaveBeenCalledTimes(2);
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
  });
});

describe("OffloadPolicyCard - radio group path", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it("fires the save twice for one radio click because the click also bubbles to the card", async () => {
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    render(<OffloadPolicyCard />);
    await settle();

    await act(async () => {
      fireEvent.click(radios()[1]);
    });

    // Measured contract, not an ideal: the radio sits inside the clickable
    // card, so a single user click drives onChange AND onClick. Both calls
    // carry the same value, which is why the visible outcome is still correct.
    // If the component ever stops the event from bubbling, this expectation is
    // the thing that will fail.
    expect(setOffloadPolicy.mock.calls).toEqual([["offload"], ["offload"]]);
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
    expect(msgError).not.toHaveBeenCalled();
  });
});

describe("OffloadPolicyCard - static copy", () => {
  beforeEach(() => {
    getOffloadPolicy.mockReset();
    setOffloadPolicy.mockReset();
    msgError.mockReset();
    getOffloadPolicy.mockResolvedValue({ default_action: "keep_foreground" });
    setOffloadPolicy.mockResolvedValue({ ok: true });
  });

  it("explains that the setting is global rather than per agent", async () => {
    render(<OffloadPolicyCard />);
    await settle();

    const alert = document.querySelector(".ant-alert");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("ant-alert-info");
    expect(alert?.textContent).toContain(
      "This is a global setting (settings.json), not per-agent.",
    );
    expect(alert?.textContent).toContain(
      "Users can override it from the tool control panel while a tool is running.",
    );
  });

  it("renders exactly two selectable options in a stable order", async () => {
    render(<OffloadPolicyCard />);
    await settle();

    expect(optionCards()).toHaveLength(2);
    expect(radios().map((r) => r.value)).toEqual([
      "keep_foreground",
      "offload",
    ]);
  });
});
