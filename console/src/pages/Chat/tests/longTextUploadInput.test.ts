/**
 * GH#7948 — pasting a long text wipes the whole console input area.
 *
 * The behaviour under test lives in the vendored hook
 * `@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Chat/Input/useLongTextUpload`.
 * QwenPaw only configures it: `OptionsPanel/defaultConfig.ts` supplies
 * `sender.maxLength` and `sender.longTextUpload.enabled`, while
 * `pages/Chat/index.tsx` injects `customRequest` (handleFileUpload) and `prompt`
 * (the `chat.longTextUploadPrompt` i18n string). The vendor package ships no test
 * for this hook, so these cases characterise what users actually observe and fail
 * loudly when a package bump changes it.
 *
 * The fixtures mirror the three real wirings, each verified against the vendored
 * sources:
 *  - `uploadFile` follows `useAttachments` — a Promise that calls
 *    `customRequest({ file, onSuccess, onError, onProgress })` and rejects on `onError`.
 *  - `customRequest` follows the QwenPaw `handleFileUpload` signature.
 *  - `onContentChange` follows `useMentions.handleValueChange`, whose first
 *    statement writes the value back. Skipping that write-back would make the
 *    "input was cleared" assertions pass for the wrong reason.
 *
 * jsdom 29 ships neither `ClipboardEvent` nor `DataTransfer`, so paste events are
 * built with `document.createEvent` plus a `clipboardData` stub. The hook only
 * reads `clipboardData.getData("text")`, `target.value`, `target.selectionStart`,
 * `target.selectionEnd` and calls `preventDefault()` — all present on the native
 * event that React would wrap, so the fixture stays faithful.
 *
 * GH#7948 asks for this behaviour to change. Cases covering the parts under
 * request — converting only the pasted segment, offering a plain-text path,
 * keeping the draft recoverable — are marked "characterisation pin" and describe
 * the current design rather than a desired one, so they fail when a future
 * package implements the request.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../locales/en.json";
import defaultConfig from "../OptionsPanel/defaultConfig";
import useLongTextUpload from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Chat/Input/useLongTextUpload";

type HookParams = Parameters<typeof useLongTextUpload>[0];

// The two values QwenPaw itself contributes to this flow, read from the shipped
// config and locale so the cases follow them if either one changes.
const MAX_LEN = defaultConfig.sender.maxLength;
const PROMPT = en.chat.longTextUploadPrompt;

interface UploadRecord {
  fileName: string;
  fileType: string;
  name: string;
  type: string;
  size: number;
  text: string;
}

interface Host {
  getContent: () => string;
  setContentText: (value: string) => void;
  result: { current: ReturnType<typeof useLongTextUpload> };
  uploads: UploadRecord[];
  clearMentionsCalls: () => number;
  customRequestCalls: () => number;
  onContentChangeCalls: () => string[];
  failUploads: () => void;
}

/** Builds a textarea whose value/caret the vendored `getPastedValue` reads. */
function makeTextarea(value: string, caret: number): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
  document.body.appendChild(textarea);
  return textarea;
}

/** Builds a cancelable paste event carrying `pasted` as clipboard text. */
function makePasteEvent(
  textarea: HTMLTextAreaElement,
  pasted: string,
  modifiers: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
) {
  const event = document.createEvent("Event");
  event.initEvent("paste", true, true);
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      getData: (key: string) =>
        key === "text" || key === "text/plain" ? pasted : "",
    },
  });
  Object.defineProperty(event, "target", {
    configurable: true,
    value: textarea,
  });
  for (const [key, value] of Object.entries(modifiers)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

function padTo(prefix: string, total: number): string {
  return prefix + "x".repeat(Math.max(0, total - prefix.length));
}

/**
 * Renders the vendored hook with the QwenPaw wiring. `initialContent` is the
 * text already sitting in the input area before the user pastes or types.
 */
function createHost(initialContent = ""): Host {
  let content = initialContent;
  const uploads: UploadRecord[] = [];
  const contentChanges: string[] = [];
  let clearMentionsCount = 0;
  let requestCount = 0;
  let shouldFail = false;

  // Mirrors QwenPaw handleFileUpload: reports progress, then success or error.
  const customRequest = (options: {
    file: File;
    onSuccess: (body: { url?: string }) => void;
    onError?: (e: Error) => void;
    onProgress?: (e: { percent?: number }) => void;
  }) => {
    requestCount += 1;
    if (shouldFail) {
      options.onError?.(new Error("mock upload rejected"));
      return;
    }
    options.onProgress?.({ percent: 100 });
    options.onSuccess({ url: "/files/long-text.txt" });
  };

  // Mirrors useAttachments.uploadFile: resolves through customRequest, rejects
  // when the request signals an error.
  const uploadFile = ((
    fileToUpload: File,
    uploadOptions: { customRequest?: typeof customRequest; fileName?: string },
  ) =>
    new Promise((resolve, reject) => {
      const request = uploadOptions?.customRequest;
      if (!request) {
        reject(new Error("Upload request is not available."));
        return;
      }
      const record: UploadRecord = {
        fileName: uploadOptions.fileName ?? "",
        fileType: "",
        name: fileToUpload.name,
        type: fileToUpload.type,
        size: fileToUpload.size,
        text: "",
      };
      uploads.push(record);
      void fileToUpload.text().then((text) => {
        record.text = text;
      });
      request({
        file: fileToUpload,
        onSuccess: () => resolve({ status: "done" }),
        onError: (error: Error) => reject(error),
        onProgress: () => undefined,
      });
    })) as unknown as HookParams["uploadFile"];

  const { result } = renderHook(() =>
    useLongTextUpload({
      options: {
        enabled: defaultConfig.sender.longTextUpload.enabled,
        customRequest,
        // pages/Chat/index.tsx passes the i18n string through a function.
        prompt: () => PROMPT,
      },
      maxLength: MAX_LEN,
      getContent: () => content,
      setContent: (value: string) => {
        content = value;
      },
      clearMentions: () => {
        clearMentionsCount += 1;
      },
      uploadFile,
      // useMentions.handleValueChange writes the value back on its first line.
      onContentChange: (value: string) => {
        contentChanges.push(value);
        content = value;
      },
    } as unknown as HookParams),
  );

  return {
    getContent: () => content,
    setContentText: (value: string) => {
      content = value;
    },
    result,
    uploads,
    clearMentionsCalls: () => clearMentionsCount,
    customRequestCalls: () => requestCount,
    onContentChangeCalls: () => contentChanges,
    failUploads: () => {
      shouldFail = true;
    },
  };
}

/** Drains the fire-and-forget upload promise started by the hook. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function paste(host: Host, pasted: string, caretAtEnd = true) {
  const value = host.getContent();
  const textarea = makeTextarea(value, caretAtEnd ? value.length : 0);
  const event = makePasteEvent(textarea, pasted);
  await act(async () => {
    host.result.current.handlePaste(
      event as unknown as React.ClipboardEvent<HTMLElement>,
    );
  });
  await flush();
  textarea.remove();
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("long-text upload input behaviour (GH#7948)", () => {
  it("is enabled by the shipped QwenPaw defaults", () => {
    const host = createHost();
    // The console offers no UI switch for this: the default config decides.
    expect(defaultConfig.sender.longTextUpload.enabled).toBe(true);
    expect(defaultConfig.sender.maxLength).toBe(MAX_LEN);
    expect(host.result.current.enabled).toBe(true);
  });

  // Characterisation pins: every case in this group records what the current
  // design does on an over-limit paste, which is what GH#7948 asks to change.
  describe("pasting over the limit", () => {
    it("cancels the browser paste instead of inserting the text", async () => {
      const host = createHost(padTo("SECTION_A_user_draft_", MAX_LEN - 100));
      const pasted = padTo("SECTION_B_pasted_", 500);
      const event = await paste(host, pasted);
      expect(event.defaultPrevented).toBe(true);
    });

    it("replaces the whole input area with the prompt, dropping the user's text", async () => {
      const host = createHost(padTo("SECTION_A_user_draft_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_pasted_", 500));

      expect(host.getContent()).toBe(PROMPT);
      expect(host.getContent()).not.toContain("SECTION_A_user_draft_");
      expect(host.getContent()).not.toContain("SECTION_B_pasted_");
      // The user is left with a file chip plus this sentence, as in the issue
      // screenshots: the counter reads the length of the prompt, not the draft.
      expect(host.getContent().length).toBeLessThan(MAX_LEN);
    });

    it("clears the mentions of the replaced input", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_", 500));
      expect(host.clearMentionsCalls()).toBe(1);
    });

    it("uploads the merged input rather than only the pasted segment", async () => {
      const existing = padTo("SECTION_A_user_draft_", MAX_LEN - 100);
      const pasted = padTo("SECTION_B_pasted_", 500);
      const host = createHost(existing);
      await paste(host, pasted);

      expect(host.uploads).toHaveLength(1);
      expect(host.uploads[0].text).toBe(existing + pasted);
      expect(host.uploads[0].text.length).toBe(MAX_LEN - 100 + 500);
      expect(host.uploads[0].text).toContain("SECTION_A_user_draft_");
    });

    it("merges around the caret when the cursor sits mid-text", async () => {
      const head = "HEAD_";
      const tail = "_TAIL";
      const host = createHost(head + tail);
      host.setContentText(head + tail);
      const textarea = makeTextarea(head + tail, head.length);
      const pasted = padTo(
        "MIDDLE_PASTED_",
        MAX_LEN + 1 - head.length - tail.length,
      );

      await act(async () => {
        host.result.current.handlePaste(
          makePasteEvent(
            textarea,
            pasted,
          ) as unknown as React.ClipboardEvent<HTMLElement>,
        );
      });
      await flush();
      textarea.remove();

      // Proves the conversion swallows the surrounding text too, not just what
      // came off the clipboard.
      expect(host.uploads[0].text).toBe(head + pasted + tail);
    });

    it("produces a timestamped plain-text prompt file", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_", 500));

      expect(host.uploads[0].name).toMatch(/^prompt-\d+\.txt$/);
      expect(host.uploads[0].type).toBe("text/plain;charset=utf-8");
      expect(host.uploads[0].size).toBe(host.uploads[0].text.length);
    });

    it("sweeps the previous prompt into the next file when pasting twice", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_", 500));
      expect(host.uploads).toHaveLength(1);

      // Second paste: the input area now holds the injected prompt, so the next
      // file carries that prompt instead of the first draft.
      await paste(host, padTo("SECTION_C_", MAX_LEN + 1 - PROMPT.length));

      expect(host.uploads).toHaveLength(2);
      expect(host.uploads[1].text.startsWith(PROMPT)).toBe(true);
      expect(host.uploads[1].text).toContain("SECTION_C_");
      expect(host.getContent()).toBe(PROMPT);
    });

    it("still converts when the user holds a modifier key (no plain-text escape)", async () => {
      for (const modifiers of [
        { shiftKey: true },
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
      ]) {
        const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
        const textarea = makeTextarea(
          host.getContent(),
          host.getContent().length,
        );
        const event = makePasteEvent(
          textarea,
          padTo("SECTION_B_", 500),
          modifiers,
        );
        await act(async () => {
          host.result.current.handlePaste(
            event as unknown as React.ClipboardEvent<HTMLElement>,
          );
        });
        await flush();
        textarea.remove();

        expect(event.defaultPrevented, JSON.stringify(modifiers)).toBe(true);
        expect(host.uploads, JSON.stringify(modifiers)).toHaveLength(1);
      }
    });
  });

  describe("threshold boundary", () => {
    it("leaves the input untouched when the merged length equals the limit", async () => {
      const existing = padTo("EXISTING_", 5000);
      const pasted = padTo("PASTED_", MAX_LEN - 5000);
      const host = createHost(existing);
      const event = await paste(host, pasted);

      expect(event.defaultPrevented).toBe(false);
      expect(host.uploads).toHaveLength(0);
      expect(host.customRequestCalls()).toBe(0);
      // The browser performs its normal insertion, so nothing is replaced.
      expect(host.getContent()).toBe(existing);
    });

    // Characterisation pin: asserts the merged-length trigger and the resulting
    // full replacement, both of which GH#7948 asks to narrow.
    it("converts once the merged length exceeds the limit by one character", async () => {
      const existing = padTo("EXISTING_", 5000);
      const pasted = padTo("PASTED_", MAX_LEN - 5000 + 1);
      const host = createHost(existing);
      const event = await paste(host, pasted);

      expect(event.defaultPrevented).toBe(true);
      expect(host.uploads).toHaveLength(1);
      expect(host.uploads[0].text.length).toBe(MAX_LEN + 1);
      expect(host.getContent()).toBe(PROMPT);
    });

    it("ignores an ordinary short paste into an empty input", async () => {
      const host = createHost("");
      const event = await paste(host, "hello there");

      expect(event.defaultPrevented).toBe(false);
      expect(host.uploads).toHaveLength(0);
      expect(host.clearMentionsCalls()).toBe(0);
    });

    it("does nothing when the clipboard holds no text", async () => {
      const host = createHost(padTo("EXISTING_", MAX_LEN - 10));
      const textarea = makeTextarea(
        host.getContent(),
        host.getContent().length,
      );
      const event = makePasteEvent(textarea, "");
      await act(async () => {
        host.result.current.handlePaste(
          event as unknown as React.ClipboardEvent<HTMLElement>,
        );
      });
      await flush();
      textarea.remove();

      expect(event.defaultPrevented).toBe(false);
      expect(host.uploads).toHaveLength(0);
    });
  });

  // Characterisation pins: the reporter's second complaint is that there is no
  // escape hatch. These cases pin its absence, so adding one turns them red.
  describe("no way back to plain text", () => {
    it("exposes no undo, revert or plain-text entry point", () => {
      const host = createHost();
      const api = Object.keys(host.result.current);

      // The full surface the vendored hook offers today. `resetPromptState` is
      // the only reset-like entry, and the next case pins that it does not give
      // the draft back.
      const knownSurface = [
        "enabled",
        "handleContentChange",
        "handlePaste",
        "isUploading",
        "resetPromptState",
        "uploading",
      ];
      const added = api.filter((key) => !knownSurface.includes(key));

      expect(
        added,
        `GH#7948: the vendored hook surface gained ${added.join(
          ", ",
        )}, which this file does not characterise yet.`,
      ).toEqual([]);
      expect(api.some((key) => /undo|revert|restore|plain/i.test(key))).toBe(
        false,
      );
    });

    it("does not restore the user's text when resetPromptState is called", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_", 500));
      expect(host.getContent()).toBe(PROMPT);

      await act(async () => {
        host.result.current.resetPromptState();
      });

      // The only reset-like entry point clears internal refs; the draft stays gone.
      expect(host.getContent()).toBe(PROMPT);
      expect(host.getContent()).not.toContain("SECTION_A_");
    });
  });

  describe("typing over the limit", () => {
    // Characterisation pin: the reporter only described pastes, but typing hits
    // the same path, so this is part of the behaviour under review.
    it("converts long typed input the same way a paste is converted", async () => {
      const host = createHost("");
      const typed = padTo("TYPED_BY_USER_", MAX_LEN + 1);

      await act(async () => {
        host.result.current.handleContentChange(typed);
      });
      await flush();

      // Reported in GH#7948 only for pastes, but plain typing hits the same path,
      // so long-form text editing is unavailable either way.
      expect(host.uploads).toHaveLength(1);
      expect(host.uploads[0].text).toBe(typed);
      expect(host.getContent()).toBe(PROMPT);
      expect(host.onContentChangeCalls()).toHaveLength(0);
    });

    it("passes typed input through untouched while under the limit", async () => {
      const host = createHost("");
      const typed = padTo("TYPED_BY_USER_", MAX_LEN);

      await act(async () => {
        host.result.current.handleContentChange(typed);
      });
      await flush();

      expect(host.uploads).toHaveLength(0);
      expect(host.getContent()).toBe(typed);
      expect(host.onContentChangeCalls()).toEqual([typed]);
    });
  });

  describe("upload failure", () => {
    it("gives the user's text back when the upload is rejected", async () => {
      const original = padTo("SECTION_A_user_draft_", MAX_LEN - 100);
      const pasted = padTo("SECTION_B_pasted_", 500);
      const host = createHost(original);
      host.failUploads();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await paste(host, pasted);

      // Pinned for the currently shipped package (1.2.0), which restores the
      // text in its catch branch. Earlier packages left the prompt in place and
      // lost the draft — if a bump reintroduces that, this fails.
      await waitFor(() => expect(host.getContent()).toBe(original + pasted));
      expect(host.getContent()).not.toBe(PROMPT);
      expect(host.uploads).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("leaves the input usable again after a failed upload", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      host.failUploads();
      vi.spyOn(console, "error").mockImplementation(() => {});

      await paste(host, padTo("SECTION_B_", 500));

      await waitFor(() => expect(host.result.current.uploading).toBe(false));
      expect(host.result.current.isUploading()).toBe(false);
    });

    it("reports the upload as settled once it succeeds", async () => {
      const host = createHost(padTo("SECTION_A_", MAX_LEN - 100));
      await paste(host, padTo("SECTION_B_", 500));

      await waitFor(() => expect(host.result.current.uploading).toBe(false));
      expect(host.result.current.isUploading()).toBe(false);
      expect(host.customRequestCalls()).toBe(1);
    });
  });
});
