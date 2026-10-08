// @vitest-environment jsdom
/**
 * ProviderTypeCard - the "Transcription Provider" section of Settings > Voice
 * Transcription. Rendered from one place, checked by grep before this suite was
 * written:
 *   - `pages/Settings/VoiceTranscription/index.tsx:70` (imported through the
 *     `./components` barrel at `:8`), and only while `showProviderSection` holds.
 *
 * Visible contract under test:
 *
 *   1. three backends, in source order: `disabled`, `whisper_api`,
 *      `local_whisper`. These are the wire values the parent saves, so they are
 *      asserted as literals;
 *   2. `providerType` is the ONLY thing driving which radio is checked - the
 *      component is stateless, so the three reachable selections are all pinned;
 *   3. picking another backend hands the parent the RAW STRING, never the event;
 *   4. clicking the backend that is already selected emits nothing;
 *   5. every visible string is an i18n key from the `voiceTranscription`
 *      namespace;
 *   6. the local-whisper banner is gated on TWO independent inputs at once:
 *      `isLocalWhisper` AND `localWhisperStatus` being non-null. Both halves are
 *      pinned separately - and so is the pair that must NOT show a banner,
 *      namely `isLocalWhisper` true while the status has not arrived yet, and a
 *      loaded status while the user is on `whisper_api`. This is the card's own
 *      prop, not a re-read of `providerType`, so a parent that forgets to pass
 *      it down gets caught here;
 *   7. inside the gate the banner is a two-way switch on
 *      `localWhisperStatus.available`: ready -> a success alert with a message
 *      only; not ready -> a warning alert that ALSO carries a description
 *      naming both dependencies;
 *   8. that description is INTERPOLATED: the product calls `t(key, { ffmpeg,
 *      whisper })` where each value is itself a translated word
 *      (`common.enabled` / `common.disabled`) chosen by the matching
 *      `*_installed` flag. All four combinations are asserted, because a card
 *      that reported "ffmpeg disabled" while ffmpeg was in fact installed would
 *      send the user to install something they already have;
 *   9. the option order in the description object is pinned too - `ffmpeg`
 *      before `whisper` - since the product builds the object literal in that
 *      order and the translated sentence reads in that order.
 *
 * Harness notes (measured facts, not guesses):
 *
 * - antd renders for real here (`Card, Radio, Space, Alert` are imported from
 *   `antd`, which `vite.config.ts` does not alias). Probes confirmed the
 *   genuine radio inputs carry `value` / `checked`, `.ant-radio-wrapper` is one
 *   per option, and `.ant-alert-success` / `.ant-alert-warning` carry `type`.
 * - `react-i18next` IS mocked with `t` returning the key verbatim, and
 *   `key:JSON.stringify(opts)` when called with options - that is what makes
 *   the interpolation in point 8 observable at all. Expected strings are built
 *   here with the same `JSON.stringify` shape the product produces.
 * - keys were read back from `src/locales/en.json` (31 keys under
 *   `voiceTranscription`, plus `common.enabled` = "Enabled" and
 *   `common.disabled` = "Disabled"), not typed from memory.
 * - CSS-module class names come from the imported `styles` object.
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

import { ProviderTypeCard } from "./ProviderTypeCard";

const STATUS_READY: LocalWhisperStatus = {
  available: true,
  ffmpeg_installed: true,
  whisper_installed: true,
};

function statusOf(overrides: Partial<LocalWhisperStatus>): LocalWhisperStatus {
  return {
    available: false,
    ffmpeg_installed: false,
    whisper_installed: false,
    ...overrides,
  };
}

/**
 * The exact description string the product asks `t` for, rebuilt here from the
 * same two flags so the expectation cannot drift from the component's own
 * object-literal order (`ffmpeg` first, `whisper` second).
 */
function missingDesc(
  ffmpegInstalled: boolean,
  whisperInstalled: boolean,
): string {
  return `voiceTranscription.localWhisperMissingDesc:${JSON.stringify({
    ffmpeg: ffmpegInstalled ? "common.enabled" : "common.disabled",
    whisper: whisperInstalled ? "common.enabled" : "common.disabled",
  })}`;
}

function renderCard(props: {
  providerType?: string;
  onProviderTypeChange?: (value: string) => void;
  isLocalWhisper?: boolean;
  localWhisperStatus?: LocalWhisperStatus | null;
}) {
  const onProviderTypeChange = props.onProviderTypeChange ?? vi.fn();
  const view = render(
    <ProviderTypeCard
      providerType={props.providerType ?? "disabled"}
      onProviderTypeChange={onProviderTypeChange}
      isLocalWhisper={props.isLocalWhisper ?? false}
      localWhisperStatus={
        props.localWhisperStatus === undefined ? null : props.localWhisperStatus
      }
    />,
  );
  return { ...view, onProviderTypeChange };
}

function radiosOf(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".ant-alert");
}

afterEach(cleanup);

describe("ProviderTypeCard", () => {
  it("renders the three backends in source order", () => {
    const { container } = renderCard({});
    expect(radiosOf(container).map((r) => r.value)).toEqual([
      "disabled",
      "whisper_api",
      "local_whisper",
    ]);
  });

  it("asks for the card title, the description and all three backend labels", () => {
    const { container } = renderCard({});
    const text = container.textContent ?? "";
    expect(text).toContain("voiceTranscription.providerTypeLabel");
    expect(text).toContain("voiceTranscription.providerTypeDescription");
    expect(text).toContain("voiceTranscription.providerTypeDisabled");
    expect(text).toContain("voiceTranscription.providerTypeDisabledDesc");
    expect(text).toContain("voiceTranscription.providerTypeWhisperApi");
    expect(text).toContain("voiceTranscription.providerTypeWhisperApiDesc");
    expect(text).toContain("voiceTranscription.providerTypeLocalWhisper");
    expect(text).toContain("voiceTranscription.providerTypeLocalWhisperDesc");
  });

  it("keeps the title in the heading slot and the description in its own slot", () => {
    const { container } = renderCard({});
    const heading = container.querySelector("h3");
    expect(heading?.textContent).toBe("voiceTranscription.providerTypeLabel");
    expect(heading?.className).toBe(styles.cardTitle);
    expect(container.querySelector("p")?.textContent).toBe(
      "voiceTranscription.providerTypeDescription",
    );
  });

  it("checks the radio named by providerType=disabled", () => {
    const { container } = renderCard({ providerType: "disabled" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("checks the radio named by providerType=whisper_api", () => {
    const { container } = renderCard({ providerType: "whisper_api" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("checks the radio named by providerType=local_whisper", () => {
    const { container } = renderCard({ providerType: "local_whisper" });
    expect(radiosOf(container).map((r) => r.checked)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("emits the raw backend string, not the change event", () => {
    const onProviderTypeChange = vi.fn();
    const { container } = renderCard({
      providerType: "disabled",
      onProviderTypeChange,
    });
    fireEvent.click(radiosOf(container)[1]);
    expect(onProviderTypeChange).toHaveBeenCalledTimes(1);
    expect(onProviderTypeChange.mock.calls[0]).toEqual(["whisper_api"]);
  });

  it("emits local_whisper when the third backend is picked", () => {
    const onProviderTypeChange = vi.fn();
    const { container } = renderCard({
      providerType: "whisper_api",
      onProviderTypeChange,
    });
    fireEvent.click(radiosOf(container)[2]);
    expect(onProviderTypeChange.mock.calls[0]).toEqual(["local_whisper"]);
  });

  it("emits nothing when the already-selected backend is clicked again", () => {
    const onProviderTypeChange = vi.fn();
    const { container } = renderCard({
      providerType: "local_whisper",
      onProviderTypeChange,
    });
    fireEvent.click(radiosOf(container)[2]);
    expect(onProviderTypeChange).not.toHaveBeenCalled();
  });

  it("stacks the three backends vertically, one row each", () => {
    const { container } = renderCard({});
    expect(container.querySelector(".ant-space")?.className).toContain(
      "ant-space-vertical",
    );
    expect(container.querySelectorAll(".ant-radio-wrapper")).toHaveLength(3);
  });

  it("gives every backend a label slot and a description slot", () => {
    const { container } = renderCard({});
    expect(
      Array.from(container.querySelectorAll(`.${styles.optionLabel}`)).map(
        (n) => n.textContent,
      ),
    ).toEqual([
      "voiceTranscription.providerTypeDisabled",
      "voiceTranscription.providerTypeWhisperApi",
      "voiceTranscription.providerTypeLocalWhisper",
    ]);
    expect(
      Array.from(
        container.querySelectorAll(`.${styles.optionDescription}`),
      ).map((n) => n.textContent),
    ).toEqual([
      "voiceTranscription.providerTypeDisabledDesc",
      "voiceTranscription.providerTypeWhisperApiDesc",
      "voiceTranscription.providerTypeLocalWhisperDesc",
    ]);
  });

  it("hides the banner when isLocalWhisper is false even with a loaded status", () => {
    const { container } = renderCard({
      isLocalWhisper: false,
      localWhisperStatus: statusOf({ available: false }),
    });
    expect(alertOf(container)).toBeNull();
  });

  it("hides the banner when isLocalWhisper is true but the status is still null", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: null,
    });
    expect(alertOf(container)).toBeNull();
  });

  it("shows a success alert with no description when local whisper is ready", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: STATUS_READY,
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-success");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.localWhisperReady",
    );
    expect(alert?.querySelector(".ant-alert-description")).toBeNull();
  });

  it("shows a warning alert naming both dependencies when nothing is installed", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: statusOf({}),
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-warning");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.localWhisperMissing",
    );
    expect(alert?.querySelector(".ant-alert-description")?.textContent).toBe(
      missingDesc(false, false),
    );
  });

  it("reports ffmpeg as enabled while whisper is still missing", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: statusOf({ ffmpeg_installed: true }),
    });
    expect(
      alertOf(container)?.querySelector(".ant-alert-description")?.textContent,
    ).toBe(missingDesc(true, false));
  });

  it("reports whisper as enabled while ffmpeg is still missing", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: statusOf({ whisper_installed: true }),
    });
    expect(
      alertOf(container)?.querySelector(".ant-alert-description")?.textContent,
    ).toBe(missingDesc(false, true));
  });

  it("pins the word order in the description: ffmpeg first, whisper second", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: statusOf({ ffmpeg_installed: true }),
    });
    const description =
      alertOf(container)?.querySelector(".ant-alert-description")
        ?.textContent ?? "";
    expect(description.indexOf("ffmpeg")).toBeLessThan(
      description.indexOf("whisper"),
    );
  });

  it("trusts available alone, so both deps installed but unavailable still warns", () => {
    const { container } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: statusOf({
        available: false,
        ffmpeg_installed: true,
        whisper_installed: true,
      }),
    });
    const alert = alertOf(container);
    expect(alert?.className).toContain("ant-alert-warning");
    expect(alert?.querySelector(".ant-alert-message")?.textContent).toBe(
      "voiceTranscription.localWhisperMissing",
    );
    // Both flags are on, so the hint says both are enabled.
    expect(alert?.querySelector(".ant-alert-description")?.textContent).toBe(
      missingDesc(true, true),
    );
  });

  it("moves the banner with isLocalWhisper, holding one shared status object", () => {
    const status = statusOf({});
    const { container, rerender } = renderCard({
      isLocalWhisper: true,
      localWhisperStatus: status,
    });
    expect(alertOf(container)?.className).toContain("ant-alert-warning");
    rerender(
      <ProviderTypeCard
        providerType="whisper_api"
        onProviderTypeChange={vi.fn()}
        isLocalWhisper={false}
        localWhisperStatus={status}
      />,
    );
    expect(alertOf(container)).toBeNull();
  });

  it("wraps itself in the page card class", () => {
    const { container } = renderCard({});
    expect(container.querySelector(".ant-card")?.className).toContain(
      styles.card,
    );
  });
});
