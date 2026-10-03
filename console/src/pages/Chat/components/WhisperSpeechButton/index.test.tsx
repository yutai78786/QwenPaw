/**
 * Unit tests for the whisper speech button (voice recording + transcription).
 *
 * What this file pins:
 * - The three visual states (idle mic icon / recording animated bars / spinner)
 *   and the tooltip key that belongs to each one. A wrong key here is invisible
 *   to a render-only test but shows up as the wrong hint for the user.
 * - The MediaRecorder wiring: mime type preference, chunk collection, track
 *   teardown, and the auto-stop timer at the five minute cap.
 * - Every transcription failure arm, including the two distinct file-too-large
 *   messages (the client side size guard and the server side error code), which
 *   differ only in the `limit` fallback.
 * - The imperative ref surface (toggleRecording / isRecording / isLoading) that
 *   the chat page drives from its Ctrl+Shift+M shortcut.
 *
 * Harness notes (all stubs live in this file; no shared stub was edited):
 * - The shared icons stub (src/test/icons-mock.ts) does not export SparkMicLine,
 *   so it is supplied here via importActual spread (same shape: <span data-icon>).
 * - jsdom has neither navigator.mediaDevices nor MediaRecorder, so both are
 *   installed per test from the hoisted fake below.
 * - The design IconButton and the antd Tooltip are replaced with prop-capturing
 *   stubs so `bordered`, `disabled`, `style` and the tooltip title become
 *   observable instead of being swallowed by ...props.
 */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const instances: Array<{
    started: number;
    stopped: number;
    mimeType: string;
    state: string;
    ondataavailable: ((e: { data: Blob }) => void) | null;
    onstop: (() => void | Promise<void>) | null;
  }> = [];
  const supported: string[] = ["audio/webm"];
  class FakeMediaRecorder {
    static isTypeSupported = (type: string) => supported.includes(type);
    started = 0;
    stopped = 0;
    state = "inactive";
    mimeType = "";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void | Promise<void>) | null = null;
    constructor(_stream: unknown, opts?: { mimeType?: string }) {
      this.mimeType = opts?.mimeType ?? "";
      instances.push(this as unknown as (typeof instances)[number]);
    }
    start() {
      this.started += 1;
      this.state = "recording";
    }
    stop() {
      this.stopped += 1;
      this.state = "inactive";
      // The real MediaRecorder fires onstop asynchronously after stop(); the
      // component relies on that ordering, so the fake must reproduce it.
      queueMicrotask(() => {
        void this.onstop?.();
      });
    }
  }
  return {
    instances,
    supported,
    FakeMediaRecorder,
    tracks: [] as Array<{ stop: () => void }>,
    // Typed mocks: an untyped `ReturnType<typeof vi.fn>` is not callable under
    // this tsconfig, so each helper gets its real signature.
    getUserMedia: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    transcribe: vi.fn<(blob: unknown) => Promise<{ text: string }>>(),
    msg: {
      error: vi.fn<(...args: unknown[]) => void>(),
      warning: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
    uploadLimit: null as number | null,
    iconButtonProps: {} as Record<string, unknown>,
    tooltipProps: {} as Record<string, unknown>,
  };
});

vi.mock("@agentscope-ai/icons", async () => {
  const icons = await vi.importActual<Record<string, unknown>>(
    "@agentscope-ai/icons",
  );
  const stub = (name: string) => (props: Record<string, unknown>) => (
    <span data-icon={name} {...props} />
  );
  return { ...icons, SparkMicLine: stub("SparkMicLine") };
});

vi.mock("@agentscope-ai/design", () => ({
  IconButton: (props: Record<string, unknown>) => {
    h.iconButtonProps = props;
    return (
      <button
        type="button"
        data-testid="speech-button"
        data-bordered={String(props.bordered)}
        data-disabled={String(Boolean(props.disabled))}
        disabled={Boolean(props.disabled)}
        style={props.style as React.CSSProperties}
        onClick={props.onClick as () => void}
      >
        {props.icon as React.ReactNode}
      </button>
    );
  },
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("antd");
  return {
    ...actual,
    message: h.msg,
    Tooltip: (props: { title?: unknown; children?: React.ReactNode }) => {
      h.tooltipProps = props as unknown as Record<string, unknown>;
      return (
        <div data-testid="speech-tooltip" data-title={String(props.title)}>
          {props.children}
        </div>
      );
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}::${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en", language: "en", changeLanguage: () => {} },
  }),
}));

vi.mock("@/api/modules/agent", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/api/modules/agent",
  );
  return {
    ...actual,
    agentApi: {
      ...(actual.agentApi as Record<string, unknown>),
      transcribeAudio: (blob: Blob) => h.transcribe(blob),
    },
  };
});

vi.mock("@/stores/uploadLimitStore", () => ({
  useUploadLimitStore: {
    getState: () => ({ uploadMaxSizeMb: h.uploadLimit }),
  },
}));

const loadButton = async () =>
  (await import("@/pages/Chat/components/WhisperSpeechButton")).default;

const makeStream = () => ({
  getTracks: () => h.tracks,
});

const startRecording = async (Whisper: React.ComponentType<never>) => {
  const onTranscription = vi.fn();
  const ref = React.createRef<{
    toggleRecording: () => void;
    isRecording: () => boolean;
    isLoading: () => boolean;
  } | null>();
  const view = render(
    React.createElement(Whisper as never, { onTranscription, ref }),
  );
  await act(async () => {
    fireEvent.click(view.getByTestId("speech-button"));
  });
  return { ...view, onTranscription, ref };
};

const recorder = () => h.instances[h.instances.length - 1];

const emitStop = async (chunks: Blob[] = [new Blob(["hello audio"])]) => {
  await act(async () => {
    chunks.forEach((data) => recorder().ondataavailable?.({ data }));
    await recorder().onstop?.();
  });
};

const makeTranscriptionError = async (code?: string) => {
  const mod = await import("@/api/modules/agent");
  return new mod.TranscriptionError(400, "nope", code as never);
};

describe("WhisperSpeechButton — idle and recording visuals", () => {
  let Whisper: React.ComponentType<never>;

  beforeEach(async () => {
    h.instances.length = 0;
    h.tracks.length = 0;
    h.supported.length = 0;
    h.supported.push("audio/webm");
    h.uploadLimit = null;
    h.getUserMedia.mockReset().mockResolvedValue(makeStream());
    h.transcribe.mockReset().mockResolvedValue({ text: "transcribed" });
    h.msg.error.mockReset();
    h.msg.warning.mockReset();
    h.msg.info.mockReset();
    h.iconButtonProps = {};
    h.tooltipProps = {};
    vi.useRealTimers();
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
      h.FakeMediaRecorder;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: (...a: unknown[]) => h.getUserMedia(...a) },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    Whisper = (await loadButton()) as React.ComponentType<never>;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the mic stub icon, no border and the start-recording hint when idle", () => {
    const { getByTestId } = render(
      React.createElement(Whisper as never, { onTranscription: vi.fn() }),
    );
    expect(getByTestId("speech-button").getAttribute("data-bordered")).toBe(
      "false",
    );
    expect(getByTestId("speech-button").getAttribute("data-disabled")).toBe(
      "false",
    );
    expect(
      getByTestId("speech-button").querySelector('[data-icon="SparkMicLine"]'),
    ).toBeTruthy();
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.startRecording",
    );
    // No accent colour while idle: style.color stays undefined (not "").
    expect(h.iconButtonProps.style).toEqual({ color: undefined });
  });

  it("requests the microphone with audio only and starts the recorder", async () => {
    await startRecording(Whisper);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(h.instances).toHaveLength(1);
    expect(recorder().started).toBe(1);
    expect(recorder().stopped).toBe(0);
    expect(recorder().mimeType).toBe("audio/webm");
  });

  it("falls back to audio/mp4 when webm is not supported", async () => {
    h.supported.length = 0;
    h.supported.push("audio/mp4");
    await startRecording(Whisper);
    expect(recorder().mimeType).toBe("audio/mp4");
  });

  it("swaps to the animated bars svg, the stop hint and the accent colour while recording", async () => {
    const { getByTestId } = await startRecording(Whisper);
    const svg = getByTestId("speech-button").querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.querySelector("title")?.textContent).toBe("Speech Recording");
    // Four animated bars, each with two animate elements (height + y).
    expect(svg?.querySelectorAll("rect")).toHaveLength(4);
    expect(svg?.querySelectorAll("animate")).toHaveLength(8);
    expect(
      getByTestId("speech-button").querySelector('[data-icon="SparkMicLine"]'),
    ).toBeNull();
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.stopRecording",
    );
    expect(h.iconButtonProps.style).toEqual({ color: "#1890ff" });
  });

  it("does not create a second recorder when toggled twice while already recording", async () => {
    const { getByTestId } = await startRecording(Whisper);
    // Second click stops; a third click while stopping is not issued here.
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.instances).toHaveLength(1);
    expect(recorder().stopped).toBe(1);
  });

  it("surfaces a microphone error and stays idle when getUserMedia rejects", async () => {
    h.getUserMedia.mockReset().mockRejectedValue(new Error("denied"));
    const { getByTestId } = render(
      React.createElement(Whisper as never, { onTranscription: vi.fn() }),
    );
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.msg.error).toHaveBeenCalledTimes(1);
    expect(h.msg.error.mock.calls[0][0]).toBe("chat.speech.microphoneError");
    expect(h.instances).toHaveLength(0);
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.startRecording",
    );
  });

  it("is inert while the disabled prop is set", async () => {
    const { getByTestId } = render(
      React.createElement(Whisper as never, {
        onTranscription: vi.fn(),
        disabled: true,
      }),
    );
    expect(getByTestId("speech-button").getAttribute("data-disabled")).toBe(
      "true",
    );
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.instances).toHaveLength(0);
  });
});

describe("WhisperSpeechButton — transcription result handling", () => {
  let Whisper: React.ComponentType<never>;

  beforeEach(async () => {
    h.instances.length = 0;
    h.tracks.length = 0;
    h.supported.length = 0;
    h.supported.push("audio/webm");
    h.uploadLimit = null;
    h.tracks.push({ stop: vi.fn() });
    h.getUserMedia.mockReset().mockResolvedValue(makeStream());
    h.transcribe.mockReset().mockResolvedValue({ text: "transcribed" });
    h.msg.error.mockReset();
    h.msg.warning.mockReset();
    h.msg.info.mockReset();
    h.iconButtonProps = {};
    h.tooltipProps = {};
    vi.useRealTimers();
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
      h.FakeMediaRecorder;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: (...a: unknown[]) => h.getUserMedia(...a) },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    Whisper = (await loadButton()) as React.ComponentType<never>;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hands the transcribed text to onTranscription and stops every track", async () => {
    const { onTranscription } = await startRecording(Whisper);
    await emitStop();
    expect(onTranscription).toHaveBeenCalledWith("transcribed");
    expect(h.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it("posts one blob assembled from the collected chunks, in order", async () => {
    await startRecording(Whisper);
    const first = new Blob(["part-one-"]);
    const second = new Blob(["part-two"]);
    await emitStop([first, second]);
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    const sent = h.transcribe.mock.calls[0][0] as Blob;
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.type).toBe("audio/webm");
    expect(await sent.text()).toBe("part-one-part-two");
  });

  it("ignores zero byte chunks instead of appending empty parts", async () => {
    await startRecording(Whisper);
    await emitStop([new Blob([""]), new Blob(["only-real-audio"])]);
    const sent = h.transcribe.mock.calls[0][0] as Blob;
    expect(await sent.text()).toBe("only-real-audio");
  });

  it("does not call onTranscription when the server returns an empty text", async () => {
    h.transcribe.mockReset().mockResolvedValue({ text: "" });
    const { onTranscription } = await startRecording(Whisper);
    await emitStop();
    expect(onTranscription).not.toHaveBeenCalled();
    expect(h.msg.error).not.toHaveBeenCalled();
  });

  it("reports transcriptionFailed for a generic rejection", async () => {
    h.transcribe.mockReset().mockRejectedValue(new Error("network"));
    const { onTranscription } = await startRecording(Whisper);
    await emitStop();
    expect(onTranscription).not.toHaveBeenCalled();
    expect(h.msg.error).toHaveBeenCalledTimes(1);
    expect(h.msg.error.mock.calls[0][0]).toBe(
      "chat.speech.transcriptionFailed",
    );
  });

  it("reports transcriptionDisabled as a warning for that error code", async () => {
    h.transcribe
      .mockReset()
      .mockRejectedValue(
        await makeTranscriptionError("TRANSCRIPTION_DISABLED"),
      );
    const { onTranscription } = await startRecording(Whisper);
    await emitStop();
    expect(onTranscription).not.toHaveBeenCalled();
    expect(h.msg.warning).toHaveBeenCalledTimes(1);
    expect(h.msg.warning.mock.calls[0][0]).toBe(
      "chat.speech.transcriptionDisabled",
    );
    expect(h.msg.error).not.toHaveBeenCalled();
  });

  it("reports the server side file-too-large arm with a question mark limit when unlimited", async () => {
    h.transcribe
      .mockReset()
      .mockRejectedValue(await makeTranscriptionError("FILE_TOO_LARGE"));
    await startRecording(Whisper);
    await emitStop();
    expect(h.msg.error).toHaveBeenCalledTimes(1);
    const payload = h.msg.error.mock.calls[0][0] as string;
    expect(payload.startsWith("chat.speech.fileTooLarge::")).toBe(true);
    expect(JSON.parse(payload.split("::")[1])).toEqual({
      size: "0.0",
      limit: "?",
    });
  });

  it("reports the server side file-too-large arm with the real limit when one is set", async () => {
    h.uploadLimit = 25;
    h.transcribe
      .mockReset()
      .mockRejectedValue(await makeTranscriptionError("FILE_TOO_LARGE"));
    await startRecording(Whisper);
    await emitStop();
    const payload = h.msg.error.mock.calls[0][0] as string;
    expect(JSON.parse(payload.split("::")[1])).toEqual({
      size: "0.0",
      limit: 25,
    });
  });

  it("falls back to transcriptionFailed for an unknown TranscriptionError code", async () => {
    h.transcribe
      .mockReset()
      .mockRejectedValue(await makeTranscriptionError("UNSUPPORTED_FILE_TYPE"));
    await startRecording(Whisper);
    await emitStop();
    expect(h.msg.error).toHaveBeenCalledTimes(1);
    expect(h.msg.error.mock.calls[0][0]).toBe(
      "chat.speech.transcriptionFailed",
    );
    expect(h.msg.warning).not.toHaveBeenCalled();
  });

  it("tolerates a duplicate onstop and skips the already cleared timer", async () => {
    const { onTranscription } = await startRecording(Whisper);
    await emitStop();
    expect(onTranscription).toHaveBeenCalledWith("transcribed");
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    // Pinned current behaviour: onstop runs the whole pipeline again, because
    // neither chunksRef nor the transcription call is guarded by a "already
    // handled" flag, and the timer ref is already null on this second pass
    // (so the clearTimeout arm is skipped rather than run twice).
    await emitStop();
    expect(h.transcribe).toHaveBeenCalledTimes(2);
    expect(onTranscription).toHaveBeenCalledTimes(2);
    expect(h.tracks[0].stop).toHaveBeenCalledTimes(2);
  });

  it("blocks the request client side when the blob exceeds the upload limit", async () => {
    h.uploadLimit = 1;
    const { onTranscription } = await startRecording(Whisper);
    // 1.5 MiB of payload: above the 1 MB limit, and it rounds to "1.5" in the
    // message, so the assertion below also pins the toFixed(1) formatting.
    await emitStop([new Blob([new Uint8Array(1024 * 1024 + 512 * 1024)])]);
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(onTranscription).not.toHaveBeenCalled();
    expect(h.msg.error).toHaveBeenCalledTimes(1);
    const payload = h.msg.error.mock.calls[0][0] as string;
    expect(payload.startsWith("chat.speech.fileTooLarge::")).toBe(true);
    const options = JSON.parse(payload.split("::")[1]) as {
      size: string;
      limit: number;
    };
    expect(options.size).toBe("1.5");
    expect(options.limit).toBe(1);
  });
});

describe("WhisperSpeechButton — loading state, ref surface and the five minute cap", () => {
  let Whisper: React.ComponentType<never>;
  let deferred: { resolve: (v: { text: string }) => void } | null;

  beforeEach(async () => {
    h.instances.length = 0;
    h.tracks.length = 0;
    h.supported.length = 0;
    h.supported.push("audio/webm");
    h.uploadLimit = null;
    h.tracks.push({ stop: vi.fn() });
    h.getUserMedia = vi.fn().mockResolvedValue(makeStream());
    deferred = null;
    h.transcribe.mockReset().mockImplementation(
      () =>
        new Promise<{ text: string }>((resolve) => {
          deferred = { resolve };
        }),
    );
    h.msg.error.mockReset();
    h.msg.warning.mockReset();
    h.msg.info.mockReset();
    h.iconButtonProps = {};
    h.tooltipProps = {};
    vi.useRealTimers();
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
      h.FakeMediaRecorder;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: (...a: unknown[]) => h.getUserMedia(...a) },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    Whisper = (await loadButton()) as React.ComponentType<never>;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows the spinner, the transcribing hint and disables itself while in flight", async () => {
    const { getByTestId, onTranscription } = await startRecording(Whisper);
    // Stop through the button, which is the user path: stopRecording() clears
    // the recording flag first, then the recorder fires onstop asynchronously.
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    await waitFor(() =>
      expect(getByTestId("speech-button").getAttribute("data-disabled")).toBe(
        "true",
      ),
    );
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.transcribing",
    );
    // The spinner comes from @ant-design/icons (real package, not the stub).
    expect(
      getByTestId("speech-button").querySelector(".anticon-loading"),
    ).toBeTruthy();
    expect(h.iconButtonProps.style).toEqual({ color: "#1890ff" });
    // A click while loading must not start another recorder.
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.instances).toHaveLength(1);
    await act(async () => {
      deferred?.resolve({ text: "late text" });
    });
    await waitFor(() =>
      expect(onTranscription).toHaveBeenCalledWith("late text"),
    );
    expect(getByTestId("speech-button").getAttribute("data-disabled")).toBe(
      "false",
    );
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.startRecording",
    );
  });

  it("exposes the ref surface and reports recording state through it", async () => {
    const { ref, getByTestId } = await startRecording(Whisper);
    expect(ref.current?.isRecording()).toBe(true);
    expect(ref.current?.isLoading()).toBe(false);
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(ref.current?.isRecording()).toBe(false);
    await act(async () => {
      deferred?.resolve({ text: "x" });
    });
    expect(ref.current?.isLoading()).toBe(false);
    expect(ref.current?.isRecording()).toBe(false);
  });

  it("toggles through the ref the same way a click does", async () => {
    const onTranscription = vi.fn();
    const ref = React.createRef<{
      toggleRecording: () => void;
      isRecording: () => boolean;
      isLoading: () => boolean;
    } | null>();
    render(React.createElement(Whisper as never, { onTranscription, ref }));
    expect(ref.current?.isRecording()).toBe(false);
    await act(async () => {
      ref.current?.toggleRecording();
    });
    expect(ref.current?.isRecording()).toBe(true);
    await act(async () => {
      ref.current?.toggleRecording();
    });
    expect(ref.current?.isRecording()).toBe(false);
    expect(recorder().stopped).toBe(1);
  });

  it("auto stops at the five minute cap with the recording-too-long warning", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const onTranscription = vi.fn();
    const { getByTestId } = render(
      React.createElement(Whisper as never, { onTranscription }),
    );
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(recorder().started).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(h.msg.warning).toHaveBeenCalledTimes(1);
    const payload = h.msg.warning.mock.calls[0][0] as string;
    expect(payload.startsWith("chat.speech.recordingTooLong::")).toBe(true);
    expect(JSON.parse(payload.split("::")[1])).toEqual({ limit: 300 });
    expect(recorder().stopped).toBe(1);
    // The cap calls stopRecording(), which clears the recording flag and lets
    // onstop run the request. With the request still in flight the hint moves
    // to transcribing, not back to startRecording.
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.transcribing",
    );
    await act(async () => {
      deferred?.resolve({ text: "capped" });
    });
    expect(getByTestId("speech-tooltip").getAttribute("data-title")).toBe(
      "chat.speech.startRecording",
    );
  });

  it("does not warn when the cap fires after a manual stop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { getByTestId } = render(
      React.createElement(Whisper as never, { onTranscription: vi.fn() }),
    );
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(h.msg.warning).not.toHaveBeenCalled();
    expect(recorder().stopped).toBe(1);
    await act(async () => {
      deferred?.resolve({ text: "manual" });
    });
  });

  it("keeps recording when a second toggle arrives during transcription", async () => {
    const { getByTestId, ref } = await startRecording(Whisper);
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    await waitFor(() =>
      expect(getByTestId("speech-button").getAttribute("data-disabled")).toBe(
        "true",
      ),
    );
    // The rendered button is disabled while loading, so a DOM click is a no-op.
    // Driving the ref is what the chat page does from its Ctrl+Shift+M shortcut,
    // and it must hit the same loading guard without starting a second request.
    await act(async () => {
      ref.current?.toggleRecording();
    });
    expect(h.instances).toHaveLength(1);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred?.resolve({ text: "done" });
    });
  });

  it("starts a second recorder when toggled twice before the microphone resolves", async () => {
    // Pinned current behaviour, not an endorsement: the re-entrancy guard in
    // startRecording only reads internalRecordingRef, which is assigned after
    // the awaited getUserMedia. Two clicks inside that window therefore both
    // pass the guard. Asserting it means a future guard added before the await
    // turns this test red on purpose instead of silently changing behaviour.
    // Both calls must be released: a single `release` closure would only hold
    // the last resolver and the first promise would stay pending forever.
    const releases: Array<(s: unknown) => void> = [];
    h.getUserMedia.mockReset().mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          releases.push(resolve as (s: unknown) => void);
        }),
    );
    const onTranscription = vi.fn();
    const { getByTestId } = render(
      React.createElement(Whisper as never, { onTranscription }),
    );
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    await act(async () => {
      releases.forEach((resolve) => resolve(makeStream()));
    });
    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].started).toBe(1);
    expect(h.instances[1].started).toBe(1);
    // Stopping only reaches the recorder held in the ref, i.e. the second one;
    // the first stays started and never fires onstop. Pinned as current
    // behaviour: a leaked recorder keeps the microphone track open.
    await act(async () => {
      fireEvent.click(getByTestId("speech-button"));
    });
    expect(h.instances[1].stopped).toBe(1);
    expect(h.instances[0].stopped).toBe(0);
    await act(async () => {
      deferred?.resolve({ text: "second" });
    });
    expect(onTranscription).toHaveBeenCalledWith("second");
  });
});
