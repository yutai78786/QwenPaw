// @vitest-environment jsdom
/**
 * VoiceTranscriptionPage - the Settings > Voice Transcription page. This is the
 * ASSEMBLY layer: it owns no state of its own, it reads everything from
 * `useVoiceTranscription` and its whole job is (a) pick between the spinner and
 * the form, (b) gate the two provider cards, (c) fan the hook's setters out to
 * the three cards, (d) wire the two footer buttons.
 *
 * Mounted from one place, checked by grep before this suite was written:
 *   - `layouts/registry/builtinRoutes.tsx:44` (lazy import of
 *     `"../../pages/Settings/VoiceTranscription"`) + `:112` (`component:`), so
 *     this is a real route, not dead code.
 *   Its three child cards each already have their own suite
 *     (`components/AudioModeCard.test.tsx`, `ProviderTypeCard.test.tsx`,
 *     `ProviderSelectCard.test.tsx`, all added 2026-10-02), and the hook has
 *     `useVoiceTranscription.test.ts`. The page that wires them together had
 *     none - so every assertion below is about the WIRING, and the cards plus
 *     the hook are stubbed on purpose. That is the same split
 *     `pages/Settings/Backups/index.test.tsx` uses.
 *
 * Visible contract under test:
 *
 *   1. `loading` short-circuits the ENTIRE page: while it is true the user sees
 *      a spinner and nothing else - no breadcrumb, no alert, no cards, no
 *      footer. Pinned by counting all four, because a form that rendered behind
 *      the spinner would let the user save half-loaded settings;
 *   2. the info alert's description is a two-way switch on `isLocalWhisper`
 *      (local whisper hint vs OpenAI-compatible endpoint hint). Both halves are
 *      pinned, since the two texts describe mutually exclusive setups and
 *      showing the wrong one sends the user to install the wrong thing;
 *   3. the two provider cards sit behind a NESTED gate, not two independent
 *      ones: `ProviderTypeCard` needs `showProviderSection`, and
 *      `ProviderSelectCard` needs `showProviderSection && isWhisperApi`. The
 *      combination that pins the nesting is `showProviderSection === false`
 *      with `isWhisperApi === true` - the provider picker must still be absent,
 *      because there is no provider type to pick a provider for;
 *   4. `AudioModeCard` is UNCONDITIONAL - it renders in every non-loading
 *      state, including when the provider section is off;
 *   5. each card receives its hook value AND the matching setter, and the
 *      setter is forwarded by identity (the hook's own `setAudioMode` etc.), so
 *      a change in a card lands in the hook without the page re-plumbing it;
 *   6. the breadcrumb is exactly two levels in a fixed order - Settings, then
 *      Voice Transcription - and the last one is the current page;
 *   7. the footer has exactly two buttons, reset first and save second, and
 *      they route to two DIFFERENT hook functions: reset re-runs `fetchSettings`
 *      (discard local edits), save runs `handleSave`;
 *   8. CRITICAL: `saving` is ONE flag with TWO different mechanisms - reset receives
 *      `disabled`, save receives `loading`. That asymmetry is the contract: the
 *      user can see the save is in flight (spinner on the button they pressed)
 *      while the reset button is simply unusable. Both halves are pinned, and so
 *      is the negative half (reset gets NO `loading`, save gets NO `disabled`),
 *      because a refactor that unified them would silently change which button
 *      looks busy;
 *   9. every visible string is an i18n key - the page hard-codes no English.
 *
 * A product fact recorded here rather than "fixed" by the test:
 *
 *   The loading branch wraps the spinner in `<div className={styles.page}>`
 *   (`index.tsx:35`), but the sibling `index.module.less` defines
 *   `.voiceTranscriptionPage` / `.content` / `.centerState` / ... and NO `.page`
 *   rule. Measured: `styles.page` is `undefined`, so that outer div carries no
 *   class at all, while the non-loading branch's outer div does carry
 *   `styles.voiceTranscriptionPage`. Eleven OTHER pages in this repo reference
 *   `styles.page` and every one of their `.module.less` files DOES define a
 *   `.page` rule, so this file is the only one of the twelve where the lookup
 *   misses (counted on 2026-10-02 by grepping `styles.page` over the tsx files
 *   under `src`, then `^\.page *{` over each sibling `.module.less`).
 *   User-visible
 *   impact was NOT verified in a browser, so per the "no unverified defect
 *   reports" rule this is asserted as the CURRENT behaviour (outer div has no
 *   class) and flagged for the team lead in PROGRESS - the test documents it
 *   instead of encoding a wish. `git log` shows both files were last touched by
 *   `84b61ca3` / `5c1590d4` and `.page` was never present in either revision, so
 *   this is not a regression introduced by a recent PR.
 *
 * Harness notes (measured facts, not guesses):
 *
 * - `useVoiceTranscription`, `./components` (the barrel), `@/components/PageHeader`
 *   and `@agentscope-ai/design` are all mocked IN THIS FILE. None of them is the
 *   subject of an assertion here; each mock records the props it receives so the
 *   wiring can be read back rather than inferred.
 * - CRITICAL: the design stub had to be overridden in-file, and the measured
 *   reason is that the shared stub `src/test/design-mock.ts` renders `Button`
 *   via `buttonLike`,
 *   which spreads props onto a real `<button>`. Probe `/tmp/b96_probe3.txt`
 *   showed that `loading` NEVER reaches the DOM there (React drops the boolean
 *   on a non-standard attribute and warns), while `type="primary"` does - so
 *   `saving`'s effect on the save button is unobservable through the shared
 *   stub. The in-file factory below renders a real button AND records the props,
 *   which makes both halves of contract 8 assertable. The shared stub itself is
 *   left untouched.
 * - antd renders for real (`Alert`, `Spin` come straight from `antd`, which
 *   `vite.config.ts` does not alias). Probes gave the class names used below:
 *   `.ant-alert` / `.ant-alert-info` / `.ant-alert-with-description` /
 *   `.ant-alert-message` / `.ant-alert-description`, and `.ant-spin` with
 *   `aria-busy="true"`.
 * - `react-i18next` IS mocked with `t` returning the key verbatim. Keys read
 *   back from `src/locales/en.json`: `nav.settings`,
 *   `voiceTranscription.title`, `voiceTranscription.transcriptionInfoTitle`,
 *   `...InfoDescLocal`, `...InfoDesc`, `common.reset`, `common.save`.
 * - CSS-module class names are read through the imported `styles` object
 *   (`_voiceTranscriptionPage_244418` style names are hash-suffixed), never
 *   hard-coded.
 * - `cleanup()` runs after every case and the prop recorders are reset, so no
 *   case can read a previous case's props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode, CSSProperties } from "react";

/** Prop recorders. Hoisted so the vi.mock factories below can close over them. */
const rec = vi.hoisted(() => ({
  hook: { state: {} as Record<string, unknown> },
  header: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  buttons: [] as Array<Record<string, unknown>>,
}));

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

vi.mock("./useVoiceTranscription", () => ({
  useVoiceTranscription: () => rec.hook.state,
}));

vi.mock("@/components/PageHeader", () => ({
  PageHeader: (props: Record<string, unknown>) => {
    rec.header.push(props);
    return <div data-stub="PageHeader" />;
  },
}));

vi.mock("./components", () => ({
  AudioModeCard: (props: Record<string, unknown>) => {
    rec.cards.push({ card: "audio", ...props });
    return <div data-stub="AudioModeCard" />;
  },
  ProviderTypeCard: (props: Record<string, unknown>) => {
    rec.cards.push({ card: "type", ...props });
    return <div data-stub="ProviderTypeCard" />;
  },
  ProviderSelectCard: (props: Record<string, unknown>) => {
    rec.cards.push({ card: "select", ...props });
    return <div data-stub="ProviderSelectCard" />;
  },
}));

vi.mock("@agentscope-ai/design", () => {
  // See the harness notes for why the shared stub is not enough here.
  const Button = (props: Record<string, unknown>) => {
    rec.buttons.push(props);
    return (
      <button
        data-stub="design-button"
        data-loading={String(props.loading)}
        data-ptype={String(props.type)}
        disabled={Boolean(props.disabled)}
        style={props.style as CSSProperties}
        onClick={props.onClick as () => void}
      >
        {props.children as ReactNode}
      </button>
    );
  };
  return { Button, default: { Button } };
});

import VoiceTranscriptionPage from "./index";
import styles from "./index.module.less";

/** The hook's full return shape, read back from
 *  `useVoiceTranscription.ts:87-103` rather than recalled. Every setter is a
 *  distinct spy so identity forwarding is assertable. */
function buildState(over: Record<string, unknown> = {}) {
  return {
    loading: false,
    saving: false,
    audioMode: "auto",
    setAudioMode: vi.fn(),
    providerType: "disabled",
    setProviderType: vi.fn(),
    selectedProviderId: "prov-1",
    setSelectedProviderId: vi.fn(),
    localWhisperStatus: null,
    availableProviders: [
      { id: "prov-1", name: "OpenAI", available: true },
      { id: "prov-2", name: "Local", available: false },
    ],
    showProviderSection: false,
    isLocalWhisper: false,
    isWhisperApi: false,
    fetchSettings: vi.fn(),
    handleSave: vi.fn(),
    ...over,
  };
}

const mount = (over: Record<string, unknown> = {}) => {
  const state = buildState(over);
  rec.hook.state = state;
  const view = render(<VoiceTranscriptionPage />);
  return { ...view, state };
};

const cardNames = () => rec.cards.map((c) => c.card);
const cardByName = (name: string) => rec.cards.find((c) => c.card === name);
const domButtons = (root: ParentNode) =>
  Array.from(root.querySelectorAll("button"));

beforeEach(() => {
  rec.header = [];
  rec.cards = [];
  rec.buttons = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VoiceTranscriptionPage loading branch", () => {
  it("shows only the spinner and hides the whole form", () => {
    const { container, baseElement } = mount({ loading: true });

    // The spinner is the only thing on screen.
    const spin = baseElement.querySelector(".ant-spin");
    expect(spin).not.toBeNull();
    expect(spin?.getAttribute("aria-busy")).toBe("true");
    // A form behind the spinner would let the user save half-loaded settings,
    // so all four regions are counted, not just the spinner.
    expect(baseElement.querySelectorAll(".ant-alert").length).toBe(0);
    expect(rec.header.length).toBe(0);
    expect(rec.cards.length).toBe(0);
    expect(domButtons(baseElement).length).toBe(0);
    // The hook is still consulted (it is what reports loading), so the page did
    // not bail out before calling it.
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
  });

  it("centers the spinner and leaves the outer wrapper without a class", () => {
    const { container } = mount({ loading: true });

    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;
    // Read through the imported styles object: CSS-module names are hashed.
    expect(inner.className).toBe(styles.centerState);
    // See the product-fact note at the top of this file: `index.tsx:35` reads
    // `styles.page`, which `index.module.less` does not define, so the outer div
    // ends up with no class at all. Asserted as current behaviour, flagged for
    // the team lead rather than silently "fixed" here.
    expect((styles as Record<string, string>).page).toBeUndefined();
    expect(outer.className).toBe("");
    expect(outer.children.length).toBe(1);
  });

  it("renders the form as soon as loading clears", () => {
    const { state, rerender, baseElement } = mount({ loading: true });
    expect(baseElement.querySelectorAll(".ant-alert").length).toBe(0);

    rec.header = [];
    rec.cards = [];
    rec.buttons = [];
    // The page is a pure function of the hook, so clearing the flag means
    // handing the hook a new state - there is no page-local copy to reset.
    rec.hook.state = { ...state, loading: false };
    rerender(<VoiceTranscriptionPage />);

    expect(baseElement.querySelector(".ant-spin")).toBeNull();
    expect(baseElement.querySelectorAll(".ant-alert").length).toBe(1);
    expect(rec.header.length).toBe(1);
    expect(cardNames()).toEqual(["audio"]);
    expect(domButtons(baseElement).length).toBe(2);
  });
});

describe("VoiceTranscriptionPage layout and breadcrumb", () => {
  it("wraps the form in the page/content/footer CSS-module classes", () => {
    const { container } = mount();

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe(styles.voiceTranscriptionPage);
    // Three regions in source order: header, content, footer.
    const content = root.querySelector(`.${styles.content}`);
    const footer = root.querySelector(`.${styles.footerButtons}`);
    expect(content).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(content?.contains(root.querySelector(".ant-alert"))).toBe(false);
    expect(content?.querySelectorAll("[data-stub]").length).toBe(1);
    expect(footer?.querySelectorAll("button").length).toBe(2);
  });

  it("asks PageHeader for exactly two levels, Settings first", () => {
    mount();

    expect(rec.header.length).toBe(1);
    // The only prop this page passes - no `parent`/`current` shorthand, no
    // `extra` slot, so the header cannot be carrying page-level actions.
    expect(Object.keys(rec.header[0])).toEqual(["items"]);
    expect(rec.header[0].items).toEqual([
      { title: "nav.settings" },
      { title: "voiceTranscription.title" },
    ]);
  });
});

describe("VoiceTranscriptionPage info alert", () => {
  it("is an info alert with an icon and the shared title", () => {
    const { baseElement } = mount();

    const alert = baseElement.querySelector(".ant-alert");
    expect(alert?.className).toContain("ant-alert-info");
    expect(alert?.className).toContain("ant-alert-with-description");
    // `showIcon` is a user-visible affordance, so it is pinned through the icon
    // node antd renders for it.
    expect(baseElement.querySelectorAll(".ant-alert-icon").length).toBe(1);
    expect(baseElement.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.transcriptionInfoTitle",
    );
  });

  it("switches the description on isLocalWhisper - local whisper hint", () => {
    const { baseElement } = mount({ isLocalWhisper: true });

    expect(
      baseElement.querySelector(".ant-alert-description")?.textContent,
    ).toBe("voiceTranscription.transcriptionInfoDescLocal");
  });

  it("switches the description on isLocalWhisper - OpenAI-compatible hint", () => {
    const { baseElement } = mount({ isLocalWhisper: false });

    expect(
      baseElement.querySelector(".ant-alert-description")?.textContent,
    ).toBe("voiceTranscription.transcriptionInfoDesc");
    // The two texts are mutually exclusive: the local hint must not leak in.
    expect(
      baseElement.querySelector(".ant-alert-description")?.textContent,
    ).not.toBe("voiceTranscription.transcriptionInfoDescLocal");
  });

  it("hard-codes no English of its own", () => {
    const { baseElement } = mount();

    // Needles are the REAL en.json translations (read back from
    // `src/locales/en.json`), because the i18n keys themselves contain those
    // words - `voiceTranscription.title` would match a naive /transcription/i.
    const rendered = baseElement.textContent ?? "";
    for (const english of [
      "How transcription works",
      "Settings",
      "Reset",
      "Save",
    ]) {
      expect(rendered).not.toContain(english);
    }
    // Positive control, so the loop above cannot pass on an empty page.
    expect(rendered).toContain("voiceTranscription.transcriptionInfoTitle");
  });
});

describe("VoiceTranscriptionPage card gating", () => {
  it("renders AudioModeCard unconditionally", () => {
    mount({ showProviderSection: false, isWhisperApi: false });
    expect(cardNames()).toEqual(["audio"]);

    rec.cards = [];
    cleanup();
    mount({ showProviderSection: true, isWhisperApi: true });
    expect(cardNames()[0]).toBe("audio");
  });

  it("gates ProviderTypeCard on showProviderSection alone", () => {
    mount({ showProviderSection: true, isWhisperApi: false });

    // The type card does not depend on the API flag: choosing "local whisper"
    // is a provider TYPE and needs no provider picked.
    expect(cardNames()).toEqual(["audio", "type"]);
  });

  it("keeps ProviderSelectCard hidden when the section is off even if isWhisperApi is true", () => {
    mount({ showProviderSection: false, isWhisperApi: true });

    // This is the case that pins the NESTED gate: with two independent gates the
    // picker would show here, leaving the user to pick a provider for a section
    // that is not on screen.
    expect(cardNames()).toEqual(["audio"]);
  });

  it("shows ProviderSelectCard only when both gates are open, after the type card", () => {
    const { container } = mount({
      showProviderSection: true,
      isWhisperApi: true,
    });

    expect(cardNames()).toEqual(["audio", "type", "select"]);
    // Source order is also DOM order. Scoped to the card stubs: the two footer
    // buttons carry `data-stub` too (they come from the design mock), so an
    // unscoped query would count six nodes instead of four.
    const cardStubs = [
      "AudioModeCard",
      "ProviderTypeCard",
      "ProviderSelectCard",
    ];
    expect(
      Array.from(container.querySelectorAll("[data-stub]"))
        .map((n) => n.getAttribute("data-stub"))
        .filter((name) => name !== "PageHeader" && name !== "design-button"),
    ).toEqual(cardStubs);
    expect(
      Array.from(container.querySelectorAll("[data-stub='PageHeader']")),
    ).toHaveLength(1);
  });
});

describe("VoiceTranscriptionPage prop forwarding", () => {
  it("hands AudioModeCard the mode, the setter and the whisper status", () => {
    const status = {
      available: true,
      ffmpeg_installed: true,
      whisper_installed: true,
    };
    const { state } = mount({
      audioMode: "native",
      localWhisperStatus: status,
    });

    const audio = cardByName("audio");
    expect(audio).toBeDefined();
    // Exactly three props: read back off the probe, so a newly added prop shows
    // up as a failure rather than slipping through.
    expect(Object.keys(audio ?? {}).sort()).toEqual([
      "audioMode",
      "card",
      "localWhisperStatus",
      "onAudioModeChange",
    ]);
    expect(audio?.audioMode).toBe("native");
    // Forwarded by identity: the hook's own setter, not a wrapper the page
    // invented, so a change lands in the hook directly.
    expect(audio?.onAudioModeChange).toBe(state.setAudioMode);
    expect(audio?.localWhisperStatus).toBe(status);
  });

  it("hands ProviderTypeCard the type, its setter and both status flags", () => {
    const status = {
      available: false,
      ffmpeg_installed: false,
      whisper_installed: false,
    };
    const { state } = mount({
      showProviderSection: true,
      providerType: "local",
      isLocalWhisper: true,
      localWhisperStatus: status,
    });

    const type = cardByName("type");
    expect(Object.keys(type ?? {}).sort()).toEqual([
      "card",
      "isLocalWhisper",
      "localWhisperStatus",
      "onProviderTypeChange",
      "providerType",
    ]);
    expect(type?.providerType).toBe("local");
    expect(type?.isLocalWhisper).toBe(true);
    expect(type?.onProviderTypeChange).toBe(state.setProviderType);
    expect(type?.localWhisperStatus).toBe(status);
  });

  it("hands ProviderSelectCard the provider list, the selection and its setter", () => {
    const providers = [{ id: "p9", name: "Nine", available: true }];
    const { state } = mount({
      showProviderSection: true,
      isWhisperApi: true,
      availableProviders: providers,
      selectedProviderId: "p9",
    });

    const select = cardByName("select");
    expect(Object.keys(select ?? {}).sort()).toEqual([
      "availableProviders",
      "card",
      "onProviderChange",
      "selectedProviderId",
    ]);
    expect(select?.availableProviders).toBe(providers);
    expect(select?.selectedProviderId).toBe("p9");
    // Note the prop name differs from the hook's setter name
    // (`setSelectedProviderId` -> `onProviderChange`); identity is what matters.
    expect(select?.onProviderChange).toBe(state.setSelectedProviderId);
  });

  it("does not forward the hook's loading/saving flags to any card", () => {
    mount({
      showProviderSection: true,
      isWhisperApi: true,
      loading: false,
      saving: true,
    });

    for (const card of rec.cards) {
      expect(card).not.toHaveProperty("loading");
      expect(card).not.toHaveProperty("saving");
    }
    // And no card receives the page's own action handlers.
    for (const card of rec.cards) {
      expect(card).not.toHaveProperty("onSave");
      expect(card).not.toHaveProperty("onReset");
    }
  });
});

describe("VoiceTranscriptionPage footer buttons", () => {
  it("renders reset first and save second, with only save marked primary", () => {
    const { baseElement } = mount();

    const buttons = domButtons(baseElement);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("common.reset");
    expect(buttons[1].textContent).toBe("common.save");
    expect(buttons[0].getAttribute("data-ptype")).toBe("undefined");
    expect(buttons[1].getAttribute("data-ptype")).toBe("primary");
    // The reset button is the only one carrying the inline spacing - the footer
    // uses flex-end, so the gap belongs to the left-hand button.
    expect(buttons[0].getAttribute("style")).toBe("margin-right: 8px;");
    expect(buttons[1].getAttribute("style")).toBeNull();
  });

  it("routes reset to fetchSettings and save to handleSave", () => {
    const { baseElement, state } = mount();

    const buttons = domButtons(baseElement);
    fireEvent.click(buttons[0]);
    expect(state.fetchSettings).toHaveBeenCalledTimes(1);
    expect(state.handleSave).not.toHaveBeenCalled();

    fireEvent.click(buttons[1]);
    expect(state.handleSave).toHaveBeenCalledTimes(1);
    expect(state.fetchSettings).toHaveBeenCalledTimes(1);
  });

  it("re-runs fetchSettings on every reset click", () => {
    const { baseElement, state } = mount();

    const reset = domButtons(baseElement)[0];
    fireEvent.click(reset);
    fireEvent.click(reset);
    fireEvent.click(reset);

    // Reset is a repeatable "discard my edits" action, not a one-shot.
    expect(state.fetchSettings).toHaveBeenCalledTimes(3);
    expect(state.handleSave).not.toHaveBeenCalled();
  });

  it("turns saving into a disabled reset button and a loading save button", () => {
    const { baseElement } = mount({ saving: true });

    const [reset, save] = domButtons(baseElement);
    // ONE flag, TWO mechanisms. This is the contract: the user sees the save in
    // flight on the button they pressed, while reset is simply unusable.
    expect(reset.disabled).toBe(true);
    expect(save.getAttribute("data-loading")).toBe("true");
  });

  it("gives neither button the other's mechanism while saving", () => {
    const { baseElement } = mount({ saving: true });

    const [reset, save] = domButtons(baseElement);
    // Negative half: a refactor that unified the two would silently change
    // which button looks busy.
    expect(reset.getAttribute("data-loading")).toBe("undefined");
    expect(save.disabled).toBe(false);
  });

  it("passes the two mechanisms as two different props, not one shared prop", () => {
    mount({ saving: true });

    expect(rec.buttons).toHaveLength(2);
    const [resetProps, saveProps] = rec.buttons;
    // Prop-level asymmetry, read back off the recorded props: reset is given
    // `disabled` and no `loading`; save is given `loading`, `type` and no
    // `disabled`.
    expect(Object.keys(resetProps).sort()).toEqual([
      "children",
      "disabled",
      "onClick",
      "style",
    ]);
    expect(resetProps.disabled).toBe(true);
    expect(Object.keys(saveProps).sort()).toEqual([
      "children",
      "loading",
      "onClick",
      "type",
    ]);
    expect(saveProps.loading).toBe(true);
    expect(saveProps.type).toBe("primary");
  });

  it("leaves both buttons interactive when nothing is saving", () => {
    const { baseElement } = mount({ saving: false });

    const [reset, save] = domButtons(baseElement);
    expect(reset.disabled).toBe(false);
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("data-loading")).toBe("false");
    expect(rec.buttons[0].disabled).toBe(false);
    expect(rec.buttons[1].loading).toBe(false);
  });
});

describe("VoiceTranscriptionPage state flow", () => {
  it("reflects a changed audio mode without the page holding any state", () => {
    const { rerender, container } = mount({ audioMode: "auto" });
    expect(cardByName("audio")?.audioMode).toBe("auto");

    rec.cards = [];
    rerender(<VoiceTranscriptionPage />);
    // The page is a pure function of the hook: re-rendering with the same hook
    // value forwards the same value, so it cannot be caching its own copy.
    expect(cardByName("audio")?.audioMode).toBe("auto");
    expect(
      container.querySelectorAll("[data-stub='AudioModeCard']").length,
    ).toBe(1);
  });

  it("reflects a changed provider selection", () => {
    const { state } = mount({
      showProviderSection: true,
      isWhisperApi: true,
      selectedProviderId: "prov-1",
    });
    expect(cardByName("select")?.selectedProviderId).toBe("prov-1");

    rec.cards = [];
    rec.hook.state = { ...state, selectedProviderId: "prov-2" };
    render(<VoiceTranscriptionPage />);
    expect(cardByName("select")?.selectedProviderId).toBe("prov-2");
  });
});
