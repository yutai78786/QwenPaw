// @vitest-environment jsdom
/**
 * QueueItem tests - the market install-queue row's user-visible contract:
 * which action buttons are offered for each install status and target, the
 * status tag it wears, and how the server message is rendered (the timeout
 * sentinel, the failed prefix with its interpolation payload, a plain message,
 * and nothing at all).
 *
 * The shared design stub exports Button, so only react-i18next is doubled.
 * The t stub echoes the key plus a sorted dump of the interpolation options so
 * the tests can assert both the chosen key and the payload handed to it
 * (the real translation is the user-visible string, the key+params pair is the
 * component's side of that contract).
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string, opts?: Record<string, unknown>) => {
    if (!opts) return key;
    const parts = Object.keys(opts)
      .sort()
      .map((k) => `${k}=${String(opts[k])}`);
    return `${key}{${parts.join(",")}}`;
  },
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

import { QueueItem } from "./QueueItem";
import type { InstallQueueItem } from "../useMarketInstall";
import type { MarketResult } from "../../../../api/modules/market";
import styles from "./QueueItem.module.less";

const RESULT: MarketResult = {
  source: "clawhub",
  slug: "demo-skill",
  name: "Demo Skill",
  description: null,
  source_url: "https://example.com/demo",
  version: null,
  author: null,
  icon_url: null,
  stats: null,
};

function makeItem(overrides: Partial<InstallQueueItem> = {}): InstallQueueItem {
  return {
    id: "q-1",
    result: RESULT,
    target: "workspace",
    status: "queued",
    message: "",
    ...overrides,
  };
}

function renderQueue(
  overrides: Partial<InstallQueueItem> = {},
  callbacks: {
    onCancel?: (id: string) => void;
    onRetry?: (id: string) => void;
  } = {},
) {
  const onCancel = callbacks.onCancel ?? vi.fn();
  const onRetry = callbacks.onRetry ?? vi.fn();
  const utils = render(
    <QueueItem
      item={makeItem(overrides)}
      onCancel={onCancel}
      onRetry={onRetry}
    />,
  );
  return { ...utils, onCancel, onRetry };
}

function buttons(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map(
    (b) => b.textContent ?? "",
  );
}

function messageOf(container: HTMLElement): string | null {
  return (
    container.querySelector(`.${styles.queueItemMessage}`)?.textContent ?? null
  );
}

describe("QueueItem - action button matrix", () => {
  it("offers cancel but not retry while queued", () => {
    const { container } = renderQueue({ status: "queued" });
    expect(buttons(container)).toEqual(["common.cancel"]);
  });

  it("offers cancel but not retry while installing to a workspace", () => {
    const { container } = renderQueue({
      status: "installing",
      target: "workspace",
    });
    expect(buttons(container)).toEqual(["common.cancel"]);
  });

  it("offers no cancel while installing into the shared pool", () => {
    // pool + installing is the one non-terminal shape the cancel button hides
    // for, because a pool install cannot be rolled back once it has started.
    const { container } = renderQueue({ status: "installing", target: "pool" });
    expect(buttons(container)).toEqual([]);
  });

  it("offers cancel again for a pool install that is still queued", () => {
    const { container } = renderQueue({ status: "queued", target: "pool" });
    expect(buttons(container)).toEqual(["common.cancel"]);
  });

  it("offers neither button once completed", () => {
    const { container } = renderQueue({ status: "completed" });
    expect(buttons(container)).toEqual([]);
  });

  it("offers retry but not cancel once failed", () => {
    const { container } = renderQueue({ status: "failed" });
    expect(buttons(container)).toEqual(["market.retry"]);
  });

  it("offers retry but not cancel once cancelled", () => {
    const { container } = renderQueue({ status: "cancelled" });
    expect(buttons(container)).toEqual(["market.retry"]);
  });
});

describe("QueueItem - callbacks carry the row id", () => {
  it("calls onCancel with the item id", () => {
    const onCancel = vi.fn();
    const { getByText } = renderQueue({ id: "row-7" }, { onCancel });
    fireEvent.click(getByText("common.cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("row-7");
  });

  it("calls onRetry with the item id", () => {
    const onRetry = vi.fn();
    const { getByText } = renderQueue(
      { id: "row-9", status: "failed" },
      { onRetry },
    );
    fireEvent.click(getByText("market.retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("row-9");
  });
});

describe("QueueItem - status tag and meta", () => {
  it("wears a per-status class alongside the shared tag class", () => {
    const { container } = renderQueue({ status: "installing" });
    const tag = container.querySelector(`.${styles.statusTag}`);
    expect(tag?.classList.contains(styles.statusTag)).toBe(true);
    expect(tag?.classList.contains(styles.installing)).toBe(true);
    expect(tag?.textContent).toBe("market.status.installing");
  });

  it("translates the status through the market.status namespace", () => {
    const { container } = renderQueue({ status: "cancelled" });
    const tag = container.querySelector(`.${styles.statusTag}`);
    expect(tag?.textContent).toBe("market.status.cancelled");
  });

  it("shows the mapped source label in the meta line", () => {
    const { container } = renderQueue();
    const meta = container.querySelector(`.${styles.queueItemMeta}`);
    expect(meta?.textContent).toBe("ClawHub");
  });

  it("falls back to the raw source string when it is not a known provider", () => {
    const { container } = renderQueue({
      result: { ...RESULT, source: "some-new-registry" },
    });
    const meta = container.querySelector(`.${styles.queueItemMeta}`);
    expect(meta?.textContent).toBe("some-new-registry");
  });

  it("shows the skill name as the row heading", () => {
    const { getByText } = renderQueue();
    expect(getByText("Demo Skill").tagName).toBe("STRONG");
  });
});

describe("QueueItem - message rendering", () => {
  it("renders the timeout copy for the __TIMED_OUT__ sentinel", () => {
    const { container } = renderQueue({
      status: "failed",
      message: "__TIMED_OUT__",
    });
    expect(messageOf(container)).toBe("market.queueMsg.timedOut");
  });

  it("renders the failed prefix with the raw message as its payload", () => {
    const { container } = renderQueue({
      status: "failed",
      message: "network down",
    });
    expect(messageOf(container)).toBe(
      "market.queueMsg.failedPrefix{msg=network down}",
    );
  });

  it("renders a non-failed message verbatim", () => {
    const { container } = renderQueue({
      status: "installing",
      message: "42% done",
    });
    expect(messageOf(container)).toBe("42% done");
  });

  it("renders no message block when the message is empty", () => {
    const { container } = renderQueue({ status: "queued", message: "" });
    expect(container.querySelector(`.${styles.queueItemMessage}`)).toBeNull();
  });

  it("prefers the timeout sentinel over the failed prefix", () => {
    // both branches are reachable here; the sentinel check comes first
    const { container } = renderQueue({
      status: "cancelled",
      message: "__TIMED_OUT__",
    });
    expect(messageOf(container)).toBe("market.queueMsg.timedOut");
  });
});
