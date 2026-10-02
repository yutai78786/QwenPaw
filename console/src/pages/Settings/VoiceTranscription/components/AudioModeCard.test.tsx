// @vitest-environment jsdom
/**
 * AudioModeCard - the "Audio Mode" section of Settings > Voice Transcription.
 * Rendered from one place, checked by grep before this suite was written:
 *   - `pages/Settings/VoiceTranscription/index.tsx:62` (imported through the
 *     `./components` barrel at `:7`)
 *
 * Visible contract under test:
 *
 *   1. the radio pair is fixed and ordered: `auto` first, `native` second. The
 *      values are the wire values the parent saves, so they are asserted as
 *      literals, not as whatever antd happens to render;
 *   2. `audioMode` is the ONLY thing driving which radio is checked - the
 *      component keeps no state of its own, so a parent that refuses the change
 *      leaves the UI on the old mode;
 *   3. picking the other mode hands the parent the RAW STRING (`e.target.value`
 *      is unwrapped inside the component), never the event object;
 *   4. clicking the mode that is already selected emits nothing, so the parent
 *      is not asked to re-save the value it already has;
 *   5. every visible string is an i18n key from the `voiceTranscription`
 *      namespace - the card hard-codes no English;
 *   6. the ffmpeg banner is gated on TWO conditions at once: `audioMode ===
 *      "native"` AND `localWhisperStatus` being non-null. Both halves are
 *      pinned separately, because the status object is fetched once at page
 *      load and stays around after the user switches back to auto mode. A
 *      banner that only checked the status would warn about a missing ffmpeg in
 *      a mode that never uses it;
 *   7. inside that gate the banner is a two-way switch on
 *      `localWhisperStatus.ffmpeg_installed`: installed -> a success alert with
 *      a message only; missing -> a warning alert that ALSO carries a
 *      description (the install hint). The success variant having no description
 *      node is asserted, not just its absence of text;
 *   8. the card wrapper carries the page's own CSS-module class, which is how
 *      the three sibling cards share their spacing.
 *
 * Harness notes (measured facts, not guesses):
 *
 * - antd renders for real here: the component imports `Card, Radio, Space,
 *   Alert` straight from `antd`, and none of them is aliased away by
 *   `vite.config.ts` (only `@agentscope-ai/design`, `@agentscope-ai/icons` and
 *   the two Tauri modules are). Probes confirmed `getAllByRole("radio")`
 *   returns the genuine inputs with their `value` and `checked` state, and that
 *   `.ant-alert-warning` / `.ant-alert-success` carry the `type` prop.
 * - `react-i18next` IS mocked, with `t` returning the key verbatim (and
 *   `key:JSON(opts)` when called with options). That makes every assertion pin
 *   the i18n key the product asks for. Keys were read back from
 *   `src/locales/en.json` (31 keys under `voiceTranscription`), not typed from
 *   memory.
 * - the shared design stub `src/test/design-mock.ts` is NOT involved: this
 *   component never imports `@agentscope-ai/design`, so the stub stays
 *   untouched.
 * - CSS-module class names are read through the imported `styles` object
 *   (`_card_244418` style names are hash-suffixed), never hard-coded.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { LocalWhisperStatus } from "../useVoiceTranscription";
import styles from "../index.module.less";

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

import { AudioModeCard } from "./AudioModeCard";

/** ffmpeg present - the "everything is installed" shape. */
const STATUS_READY: LocalWhisperStatus = {
  available: true,
  ffmpeg_installed: true,
  whisper_installed: true,
};

/** ffmpeg missing - the shape that must produce the install hint. */
const STATUS_NO_FFMPEG: LocalWhisperStatus = {
  available: false,
  ffmpeg_installed: false,
  whisper_installed: true,
};

function renderCard(props: {
  audioMode?: string;
  onAudioModeChange?: (value: string) => void;
  localWhisperStatus?: LocalWhisperStatus | null;
}) {
  const onAudioModeChange = props.onAudioModeChange ?? vi.fn();
  const view = render(
    <AudioModeCard
      audioMode={props.audioMode ?? "auto"}
      onAudioModeChange={onAudioModeChange}
      localWhisperStatus={
        props.localWhisperStatus === undefined ? null : props.localWhisperStatus
      }
    />,
  );
  return { ...view, onAudioModeChange };
}

function radiosOf(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );
}

/** The alert node, or null when the banner is gated off. */
function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".ant-alert");
}

afterEach(cleanup);

describe("AudioModeCard", () => {
  it("renders exactly two modes, auto first and native second", () => {
    const { container } = renderCard({});
    const radios = radiosOf(container);
    expect(radios.map((r) => r.value)).toEqual(["auto", "native"]);
  });

  it("asks for the card title, the description and both mode labels", () => {
    const { container } = renderCard({});
    const text = container.textContent ?? "";
    // Every string on the card is an i18n key: the card hard-codes no English.
    expect(text).toContain("voiceTranscription.audioModeLabel");
    expect(text).toContain("voiceTranscription.audioModeDescription");
    expect(text).toContain("voiceTranscription.modeAuto");
    expect(text).toContain("voiceTranscription.modeAutoDesc");
    expect(text).toContain("voiceTranscription.modeNative");
    expect(text).toContain("voiceTranscription.modeNativeDesc");
  });

  it("keeps the title in the heading slot and the description in its own slot", () => {
    const { container } = renderCard({});
    const heading = container.querySelector("h3");
    expect(heading?.textContent).toBe("voiceTranscription.audioModeLabel");
    expect(heading?.className).toBe(styles.cardTitle);
    const description = container.querySelector("p");
    expect(description?.textContent).toBe(
      "voiceTranscription.audioModeDescription",
    );
    expect(description?.className).toBe(styles.cardDescription);
  });

  it("checks the radio named by audioMode=auto", () => {
    const { container } = renderCard({ audioMode: "auto" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([true, false]);
  });

  it("checks the radio named by audioMode=native", () => {
    const { container } = renderCard({ audioMode: "native" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([false, true]);
  });

  it("moves the check when the parent moves audioMode, holding no state of its own", () => {
    const { container, rerender } = renderCard({ audioMode: "auto" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([true, false]);
    rerender(
      <AudioModeCard
        audioMode="native"
        onAudioModeChange={vi.fn()}
        localWhisperStatus={null}
      />,
    );
    expect(radiosOf(container).map((r) => r.checked)).toEqual([false, true]);
  });

  it("emits the raw mode string, not the change event", () => {
    const onAudioModeChange = vi.fn();
    const { container } = renderCard({ audioMode: "auto", onAudioModeChange });
    fireEvent.click(radiosOf(container)[1]);
    expect(onAudioModeChange).toHaveBeenCalledTimes(1);
    expect(onAudioModeChange.mock.calls[0]).toEqual(["native"]);
  });

  it("emits the other raw string when the user goes back to auto", () => {
    const onAudioModeChange = vi.fn();
    const { container } = renderCard({
      audioMode: "native",
      onAudioModeChange,
    });
    fireEvent.click(radiosOf(container)[0]);
    expect(onAudioModeChange.mock.calls[0]).toEqual(["auto"]);
  });

  it("emits nothing when the already-selected mode is clicked again", () => {
    const onAudioModeChange = vi.fn();
    const { container } = renderCard({ audioMode: "auto", onAudioModeChange });
    fireEvent.click(radiosOf(container)[0]);
    expect(onAudioModeChange).not.toHaveBeenCalled();
  });

  it("stacks the two modes vertically, one per row", () => {
    const { container } = renderCard({});
    const space = container.querySelector(".ant-space");
    expect(space?.className).toContain("ant-space-vertical");
    // Each radio sits in its own wrapper, so the two labels cannot collide.
    expect(container.querySelectorAll(".ant-radio-wrapper")).toHaveLength(2);
  });

  it("gives every mode a label slot and a description slot", () => {
    const { container } = renderCard({});
    const labels = Array.from(
      container.querySelectorAll(`.${styles.optionLabel}`),
    );
    expect(labels.map((n) => n.textContent)).toEqual([
      "voiceTranscription.modeAuto",
      "voiceTranscription.modeNative",
    ]);
    const descriptions = Array.from(
      container.querySelectorAll(`.${styles.optionDescription}`),
    );
    expect(descriptions.map((n) => n.textContent)).toEqual([
      "voiceTranscription.modeAutoDesc",
      "voiceTranscription.modeNativeDesc",
    ]);
  });

  it("hides the ffmpeg banner in auto mode even when the status is loaded", () => {
    const { container } = renderCard({
      audioMode: "auto",
      localWhisperStatus: STATUS_NO_FFMPEG,
    });
    expect(alertOf(container)).toBeNull();
  });

  it("hides the ffmpeg banner in native mode while the status is still null", () => {
    const { container } = renderCard({
      audioMode: "native",
      localWhisperStatus: null,
    });
    expect(alertOf(container)).toBeNull();
  });

  it("shows a success alert with no description when ffmpeg is installed", () => {
    const { container } = renderCard({
      audioMode: "native",
      localWhisperStatus: STATUS_READY,
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-success");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.ffmpegReady",
    );
    // The success variant carries no install hint at all - not an empty node.
    expect(alert?.querySelector(".ant-alert-description")).toBeNull();
  });

  it("shows a warning alert with the install hint when ffmpeg is missing", () => {
    const { container } = renderCard({
      audioMode: "native",
      localWhisperStatus: STATUS_NO_FFMPEG,
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-warning");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.ffmpegMissing",
    );
    expect(alert?.querySelector(".ant-alert-description")?.textContent).toBe(
      "voiceTranscription.ffmpegMissingDesc",
    );
  });

  it("reads only ffmpeg_installed, so a missing whisper alone keeps the success banner", () => {
    const { container } = renderCard({
      audioMode: "native",
      localWhisperStatus: {
        available: false,
        ffmpeg_installed: true,
        whisper_installed: false,
      },
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-success");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.ffmpegReady",
    );
  });

  it("shows an icon on both banner variants", () => {
    const ready = renderCard({
      audioMode: "native",
      localWhisperStatus: STATUS_READY,
    });
    expect(ready.container.querySelectorAll(".ant-alert-icon")).toHaveLength(1);
    const missing = renderCard({
      audioMode: "native",
      localWhisperStatus: STATUS_NO_FFMPEG,
    });
    expect(missing.container.querySelectorAll(".ant-alert-icon")).toHaveLength(
      1,
    );
  });

  it("moves the banner with the mode, using one shared status object", () => {
    const { container, rerender } = renderCard({
      audioMode: "native",
      localWhisperStatus: STATUS_NO_FFMPEG,
    });
    expect(alertOf(container)?.className).toContain("ant-alert-warning");
    rerender(
      <AudioModeCard
        audioMode="auto"
        onAudioModeChange={vi.fn()}
        localWhisperStatus={STATUS_NO_FFMPEG}
      />,
    );
    // Same status object, different mode: the warning must disappear, because
    // auto mode transcribes through a provider and never shells out to ffmpeg.
    expect(alertOf(container)).toBeNull();
  });

  it("wraps itself in the page card class", () => {
    const { container } = renderCard({});
    const card = container.querySelector(".ant-card");
    expect(card?.className).toContain(styles.card);
  });
});
