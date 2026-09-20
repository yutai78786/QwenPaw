// @vitest-environment jsdom
/**
 * MessageQueuePanel tests — the queued-message strip rendered by the chat
 * composer: empty-queue suppression, header count with the paused / error run
 * states, pause-resume and the >1-item clear action, per-row edit flow
 * (confirm on Enter and blur, cancel on Escape, blank-text guard), the
 * failed-only retry and skip actions, interrupt-and-send, remove, attachment
 * previews for image vs non-image files, inline error text, drag-to-reorder
 * with its no-op guards, draggable suppression while editing or sending, and
 * embedded mode.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
  isDark: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: h.isDark }),
}));

import MessageQueuePanel from "./MessageQueuePanel";
import type {
  QueueItem,
  QueueRunState,
} from "../../../stores/messageQueueStore";

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    text: "first queued message",
    status: "pending",
    retryCount: 0,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function callbacks() {
  return {
    onRemove: vi.fn(),
    onEdit: vi.fn(),
    onReorder: vi.fn(),
    onInterruptAndSend: vi.fn(),
    onClear: vi.fn(),
    onPauseResume: vi.fn(),
    onRetry: vi.fn(),
    onSkip: vi.fn(),
  };
}

function renderPanel(
  items: QueueItem[],
  runState: QueueRunState = "idle",
  extra: Partial<React.ComponentProps<typeof MessageQueuePanel>> = {},
) {
  // Kept as its own binding so the returned callbacks keep their `vi.fn()`
  // type instead of widening to the plain handler signature via `extra`.
  const props = callbacks();
  const utils = render(
    <MessageQueuePanel
      items={items}
      runState={runState}
      {...props}
      {...extra}
    />,
  );
  return { ...utils, props };
}

/** Locate the icon button that renders a given stubbed icon. */
function buttonByIcon(container: HTMLElement, icon: string) {
  const span = container.querySelector(`span[data-icon="${icon}"]`);
  return span ? span.closest("button") : null;
}

beforeEach(() => {
  h.isDark = false;
});

describe("empty queue", () => {
  it("renders nothing at all when the queue is empty", () => {
    const { container, props } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
    expect(props.onClear).not.toHaveBeenCalled();
  });
});

describe("header", () => {
  it("shows the queue title with the item count", () => {
    renderPanel([makeItem(), makeItem({ id: "q2", text: "second" })]);
    expect(screen.getByText("chat.queue.title (2)")).toBeInTheDocument();
  });

  it("shows the paused marker only for the paused run state", () => {
    const paused = renderPanel([makeItem()], "paused");
    expect(screen.getByText("chat.queue.paused")).toBeInTheDocument();
    expect(
      paused.container.querySelector('span[data-icon="SparkErrorCircleLine"]'),
    ).toBeNull();
    paused.unmount();

    renderPanel([makeItem()], "running");
    expect(screen.queryByText("chat.queue.paused")).toBeNull();
    expect(screen.queryByText("chat.queue.sendFailed")).toBeNull();
  });

  it("shows the send-failed marker only for the error run state", () => {
    const failed = renderPanel([makeItem()], "error");
    expect(screen.getByText("chat.queue.sendFailed")).toBeInTheDocument();
    expect(
      failed.container.querySelector('span[data-icon="SparkErrorCircleLine"]'),
    ).not.toBeNull();
    failed.unmount();

    renderPanel([makeItem()], "idle");
    expect(screen.queryByText("chat.queue.sendFailed")).toBeNull();
  });

  it("offers resume while paused or errored and pause otherwise", () => {
    const paused = renderPanel([makeItem()], "paused");
    expect(buttonByIcon(paused.container, "SparkPlayFill")).not.toBeNull();
    expect(buttonByIcon(paused.container, "SparkPauseLine")).toBeNull();
    paused.unmount();

    const errored = renderPanel([makeItem()], "error");
    expect(buttonByIcon(errored.container, "SparkPlayFill")).not.toBeNull();
    errored.unmount();

    for (const state of ["idle", "running"] as QueueRunState[]) {
      const running = renderPanel([makeItem()], state);
      expect(buttonByIcon(running.container, "SparkPauseLine")).not.toBeNull();
      expect(buttonByIcon(running.container, "SparkPlayFill")).toBeNull();
      running.unmount();
    }
  });

  it("invokes the pause/resume handler from the header button", () => {
    const { container, props } = renderPanel([makeItem()], "paused");
    fireEvent.click(buttonByIcon(container, "SparkPlayFill")!);
    expect(props.onPauseResume).toHaveBeenCalledTimes(1);
  });

  it("omits the clear action for a single item and shows it for two", () => {
    const single = renderPanel([makeItem()]);
    expect(buttonByIcon(single.container, "SparkClearLine")).toBeNull();
    single.unmount();

    const pair = renderPanel([
      makeItem(),
      makeItem({ id: "q2", text: "second" }),
    ]);
    const clear = buttonByIcon(pair.container, "SparkClearLine");
    expect(clear).not.toBeNull();
    fireEvent.click(clear!);
    expect(pair.props.onClear).toHaveBeenCalledTimes(1);
  });

  it("hides the whole header in embedded mode but keeps the rows", () => {
    const { container } = renderPanel(
      [makeItem(), makeItem({ id: "q2", text: "second" })],
      "idle",
      { embedded: true },
    );
    expect(screen.queryByText("chat.queue.title (2)")).toBeNull();
    expect(buttonByIcon(container, "SparkPauseLine")).toBeNull();
    expect(screen.getByText("first queued message")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});

describe("row text", () => {
  it("renders one row per queued item in order", () => {
    renderPanel([
      makeItem({ text: "alpha" }),
      makeItem({ id: "q2", text: "beta" }),
      makeItem({ id: "q3", text: "gamma" }),
    ]);
    expect(
      screen.getAllByText(/alpha|beta|gamma/).map((n) => n.textContent),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("appends the failure reason to the row text", () => {
    renderPanel([
      makeItem({
        text: "boom",
        status: "failed",
        errorMessage: "rate limited",
      }),
    ]);
    expect(screen.getByText("boom")).toHaveTextContent("boom(rate limited)");
  });

  it("omits the parenthesised reason when there is none", () => {
    renderPanel([makeItem({ text: "fine", status: "failed" })]);
    expect(screen.getByText("fine").textContent).toBe("fine");
  });
});

describe("row actions", () => {
  it("removes the row by its id", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "keep", text: "keep me" }),
      makeItem({ id: "drop", text: "drop me" }),
    ]);
    const buttons = container.querySelectorAll(
      'span[data-icon="SparkDeleteLine"]',
    );
    fireEvent.click(buttons[1].closest("button")!);
    expect(props.onRemove).toHaveBeenCalledWith("drop");
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("sends the interrupt-and-send action with the whole item", () => {
    const item = makeItem({ id: "q1", text: "interrupt me" });
    const { container, props } = renderPanel([item]);
    fireEvent.click(buttonByIcon(container, "SparkSendLine")!);
    expect(props.onInterruptAndSend).toHaveBeenCalledWith(item);
  });

  it("shows retry and skip only for failed items", () => {
    const failedRow = renderPanel([
      makeItem({ id: "bad", text: "bad one", status: "failed" }),
    ]);
    expect(
      buttonByIcon(failedRow.container, "SparkRefreshLine"),
    ).not.toBeNull();
    expect(
      buttonByIcon(failedRow.container, "SparkNextSentenceLine"),
    ).not.toBeNull();
    fireEvent.click(buttonByIcon(failedRow.container, "SparkRefreshLine")!);
    expect(failedRow.props.onRetry).toHaveBeenCalledWith("bad");
    fireEvent.click(
      buttonByIcon(failedRow.container, "SparkNextSentenceLine")!,
    );
    expect(failedRow.props.onSkip).toHaveBeenCalledWith("bad");
    failedRow.unmount();

    for (const status of ["pending", "sending", "sent"] as const) {
      const row = renderPanel([makeItem({ text: `row ${status}`, status })]);
      expect(buttonByIcon(row.container, "SparkRefreshLine")).toBeNull();
      expect(buttonByIcon(row.container, "SparkNextSentenceLine")).toBeNull();
      row.unmount();
    }
  });

  it("renders a drag handle on every row", () => {
    const { container } = renderPanel([
      makeItem({ text: "one" }),
      makeItem({ id: "q2", text: "two" }),
    ]);
    expect(
      container.querySelectorAll('span[data-icon="SparkDragDotLine"]'),
    ).toHaveLength(2);
  });
});

describe("edit flow", () => {
  it("prefills the editor with the row text", () => {
    const { container } = renderPanel([
      makeItem({ id: "q1", text: "draft text" }),
    ]);
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("draft text");
    expect(screen.queryByText("draft text")).toBeNull();
  });

  it("commits the trimmed text on Enter", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "q1", text: "old" }),
    ]);
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "  new text  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onEdit).toHaveBeenCalledWith("q1", "new text");
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    // The panel is controlled: it only reports the edit and closes the editor,
    // while the displayed text stays whatever the parent passes back in.
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByText("old")).toBeInTheDocument();
  });

  it("shows the committed text once the parent feeds it back", () => {
    const { container, rerender } = render(
      <MessageQueuePanel
        items={[makeItem({ id: "q1", text: "old" })]}
        runState="idle"
        onRemove={vi.fn()}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onInterruptAndSend={vi.fn()}
        onClear={vi.fn()}
        onPauseResume={vi.fn()}
        onRetry={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "new text" } });
    fireEvent.keyDown(input, { key: "Enter" });

    rerender(
      <MessageQueuePanel
        items={[makeItem({ id: "q1", text: "new text" })]}
        runState="idle"
        onRemove={vi.fn()}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onInterruptAndSend={vi.fn()}
        onClear={vi.fn()}
        onPauseResume={vi.fn()}
        onRetry={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByText("new text")).toBeInTheDocument();
    expect(screen.queryByText("old")).toBeNull();
  });

  it("commits the edit on blur", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "q7", text: "old" }),
    ]);
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "blurred value" } });
    fireEvent.blur(input);
    expect(props.onEdit).toHaveBeenCalledWith("q7", "blurred value");
  });

  it("discards a blank edit without calling the handler", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "q1", text: "keep" }),
    ]);
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onEdit).not.toHaveBeenCalled();
    // Blank input still leaves edit mode, restoring the original text.
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByText("keep")).toBeInTheDocument();
  });

  it("cancels on Escape and keeps the original text", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "q1", text: "original" }),
    ]);
    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByText("original")).toBeInTheDocument();
  });

  it("edits only the row whose edit button was pressed", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const editButtons = container.querySelectorAll(
      'span[data-icon="SparkEditLine"]',
    );
    fireEvent.click(editButtons[1].closest("button")!);
    expect(screen.getByText("row a")).toBeInTheDocument();
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "row b edited" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onEdit).toHaveBeenCalledWith("b", "row b edited");
  });

  it("disables dragging while a row is being edited", () => {
    const { container } = renderPanel([
      makeItem({ id: "q1", text: "edit me" }),
    ]);
    const rowBefore = screen.getByText("edit me").closest("div[draggable]")!;
    expect(rowBefore.getAttribute("draggable")).toBe("true");

    fireEvent.click(buttonByIcon(container, "SparkEditLine")!);
    const input = container.querySelector("input")!;
    const editingRow = input.closest("div[draggable]")!;
    expect(editingRow.getAttribute("draggable")).toBe("false");
  });

  it("disables dragging for a row that is currently sending", () => {
    renderPanel([
      makeItem({ id: "sending", text: "in flight", status: "sending" }),
      makeItem({ id: "waiting", text: "waiting", status: "pending" }),
    ]);
    expect(
      screen
        .getByText("in flight")
        .closest("div[draggable]")!
        .getAttribute("draggable"),
    ).toBe("false");
    expect(
      screen
        .getByText("waiting")
        .closest("div[draggable]")!
        .getAttribute("draggable"),
    ).toBe("true");
  });
});

describe("attachments", () => {
  it("renders an image thumbnail for image attachments", () => {
    renderPanel([
      makeItem({
        text: "with image",
        attachments: [
          { url: "https://x/y.png", name: "y.png", type: "image/png" },
        ],
      }),
    ]);
    const img = screen.getByAltText("y.png") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://x/y.png");
    expect(screen.getByText("y.png")).toBeInTheDocument();
  });

  it("falls back to a generic icon and the file key for unnamed attachments", () => {
    const { container } = renderPanel([
      makeItem({
        text: "with file",
        attachments: [{ url: "https://x/data.csv", type: "text/csv" }],
      }),
    ]);
    expect(
      container.querySelector('span[data-icon="SparkAlertLine"]'),
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chat.queue.file")).toBeInTheDocument();
  });

  it("renders one chip per attachment and none when the list is empty", () => {
    const many = renderPanel([
      makeItem({
        text: "two files",
        attachments: [
          { url: "u1", name: "a.txt", type: "text/plain" },
          { url: "u2", name: "b.png", type: "image/png" },
        ],
      }),
    ]);
    expect(
      many.container.querySelectorAll('span[data-icon="SparkAlertLine"]'),
    ).toHaveLength(1);
    expect(many.container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    many.unmount();

    const empty = renderPanel([
      makeItem({ text: "no files", attachments: [] }),
    ]);
    expect(
      empty.container.querySelector('span[data-icon="SparkAlertLine"]'),
    ).toBeNull();
    expect(empty.container.querySelector("img")).toBeNull();
    expect(screen.queryByText("chat.queue.file")).toBeNull();
  });

  it("treats an attachment without a type as non-image", () => {
    const { container } = renderPanel([
      makeItem({
        text: "untyped",
        attachments: [{ url: "u", name: "mystery" }],
      }),
    ]);
    expect(
      container.querySelector('span[data-icon="SparkAlertLine"]'),
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("drag to reorder", () => {
  it("moves the dragged item onto the drop target and reports the new order", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
      makeItem({ id: "c", text: "row c" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);

    expect(props.onReorder).toHaveBeenCalledTimes(1);
    expect(
      props.onReorder.mock.calls[0][0].map((i: QueueItem) => i.id),
    ).toEqual(["b", "c", "a"]);
  });

  it("reorders upward as well", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
      makeItem({ id: "c", text: "row c" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(
      props.onReorder.mock.calls[0][0].map((i: QueueItem) => i.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("does not report a reorder when dropped on itself", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[0]);
    fireEvent.drop(rows[0]);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("does not report a reorder when nothing was dragged", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragOver(rows[1]);
    fireEvent.drop(rows[1]);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("does not report a reorder when the dragged item left the queue", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[0]);
    // The source row disappears before the drop lands (e.g. it was sent).
    props.onReorder.mockClear();
    fireEvent.dragEnd(rows[0]);
    fireEvent.drop(rows[1]);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("forgets the drag source after dragend", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[0]);
    fireEvent.dragEnd(rows[0]);
    fireEvent.drop(rows[1]);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("leaves a single-item queue untouched by a drag", () => {
    const { container, props } = renderPanel([
      makeItem({ id: "only", text: "sole row" }),
    ]);
    const row = container.querySelector("div[draggable]")!;
    fireEvent.dragStart(row);
    fireEvent.dragOver(row);
    fireEvent.drop(row);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("prevents the default drag-over behaviour so the drop can land", () => {
    const { container } = renderPanel([
      makeItem({ id: "a", text: "row a" }),
      makeItem({ id: "b", text: "row b" }),
    ]);
    const rows = container.querySelectorAll("div[draggable]");
    fireEvent.dragStart(rows[0]);
    const over = fireEvent.dragOver(rows[1]);
    // fireEvent returns false when the handler called preventDefault().
    expect(over).toBe(false);
  });
});

describe("theme branches", () => {
  it("renders the same content in dark mode", () => {
    h.isDark = true;
    renderPanel(
      [
        makeItem({ text: "dark row" }),
        makeItem({ id: "q2", text: "dark row 2" }),
      ],
      "paused",
    );
    expect(screen.getByText("chat.queue.title (2)")).toBeInTheDocument();
    expect(screen.getByText("chat.queue.paused")).toBeInTheDocument();
    expect(screen.getByText("dark row")).toBeInTheDocument();
    expect(screen.getByText("dark row 2")).toBeInTheDocument();
  });

  it("renders embedded mode in dark mode without a header", () => {
    h.isDark = true;
    renderPanel([makeItem({ text: "dark embedded" })], "idle", {
      embedded: true,
    });
    expect(screen.queryByText(/chat\.queue\.title/)).toBeNull();
    expect(screen.getByText("dark embedded")).toBeInTheDocument();
  });
});
