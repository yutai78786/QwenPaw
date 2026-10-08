// @vitest-environment jsdom
/**
 * columns.test.tsx — session table column contract.
 *
 * createColumns() is a factory returning antd column definitions, so cells are
 * exercised by calling their render/sorter functions directly (the same approach
 * as pages/Control/CronJobs/components/columns.test.tsx). Nothing here mounts a
 * Table; each case stays focused on one cell's user visible output.
 *
 * Environment facts driving the mocks (all probed in this repo, not assumed):
 *  - createColumns() calls useTranslation() at the top of its body. The real
 *    react-i18next hook throws "Cannot read properties of null (reading
 *    'useContext')" outside a render pass, so the package is stubbed with a
 *    recording t() that returns the caller-supplied fallback (or the key).
 *    Recording matters: it pins WHICH i18n key each label asks for, so a
 *    renamed key shows up as a failure instead of silently rendering a raw key.
 *  - The global design stub renders Tag as a pass-through div, which keeps the
 *    `color` prop but produces no antd class names. Colour is therefore read
 *    off the returned element's props; asserting DOM classes would pin the stub
 *    rather than the product.
 *  - The same stub renders Button as a real <button> that forwards onClick, so
 *    action cells can be mounted and clicked to prove handler wiring.
 *  - The CSS module has no `actionColumn` key (verified by grep on
 *    pages/Control/Sessions/index.module.less and by reading the imported
 *    object at runtime), so the action wrapper renders without a class. Tests
 *    assert on the wrapper's contents, not on its className.
 *
 * formatTime() goes through Date#toLocaleString("zh-CN", …), whose exact text
 * depends on host locale/ICU. Following constants.test.ts, every assertion
 * about formatted time compares two calls made in the SAME process, which keeps
 * the cases locale independent while still pinning the normalisation contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ColumnsType } from "antd/es/table";
import type { Session } from "./constants";
import { formatTime } from "./constants";
import { CHANNEL_COLORS } from "../../../../constants/channel";

// ---- Hoisted mocks ---------------------------------------------------------
const tSpy = vi.hoisted(() =>
  vi.fn((key: string, fallback?: string) => fallback ?? key),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tSpy }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { createColumns } from "./columns";

// ---- Helpers ---------------------------------------------------------------
type Col = ColumnsType<Session>[number];

/** Structural view of a column, so render/sorter can be called with real types. */
interface ColShape {
  key?: React.Key;
  title?: unknown;
  width?: number;
  dataIndex?: unknown;
  fixed?: string;
  defaultSortOrder?: string;
  render?: (value: never, record: Session, index: number) => React.ReactNode;
  sorter?: (a: Session, b: Session) => number;
}

const asCol = (c: Col): ColShape => c as unknown as ColShape;

const colBy = (cols: ColumnsType<Session>, key: string): ColShape => {
  const found = cols.find((c) => String(asCol(c).key) === key);
  expect(found, `column "${key}" must exist`).toBeTruthy();
  return asCol(found!);
};

const handlers = () => ({
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onView: vi.fn(),
  onArchiveToggle: vi.fn(),
});

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: "chat-uuid-1",
    session_id: "discord:user-42",
    user_id: "user-42",
    channel: "discord",
    name: "Daily sync",
    created_at: "2026-09-01T08:30:00Z",
    updated_at: "2026-09-02T09:00:00Z",
    ...over,
  }) as Session;

/** Call a cell's render function and return the produced element. */
const renderCell = (
  col: ColShape,
  value: unknown,
  record: Session,
): React.ReactElement => {
  const node = col.render?.(value as never, record, 0);
  expect(node).toBeTruthy();
  return node as React.ReactElement;
};

beforeEach(() => {
  tSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Column set shape
// ---------------------------------------------------------------------------
describe("createColumns — active tab column set", () => {
  it("returns the eight documented columns in order", () => {
    const cols = createColumns(handlers());

    expect(cols.map((c) => String(asCol(c).key))).toEqual([
      "id",
      "name",
      "session_id",
      "user_id",
      "channel",
      "created_at",
      "updated_at",
      "action",
    ]);
  });

  it("does not add an archived_at column", () => {
    const cols = createColumns(handlers());

    expect(cols.map((c) => String(asCol(c).key))).not.toContain("archived_at");
  });

  it("keeps the widths each column was designed with", () => {
    const cols = createColumns(handlers());
    const widths = cols.map((c) => asCol(c).width);

    expect(widths).toEqual([250, 200, 180, 150, 120, 180, 180, 200]);
  });

  it("binds every data column to its backend field name", () => {
    const cols = createColumns(handlers());

    expect(colBy(cols, "id").dataIndex).toBe("id");
    expect(colBy(cols, "name").dataIndex).toBe("name");
    expect(colBy(cols, "session_id").dataIndex).toBe("session_id");
    expect(colBy(cols, "user_id").dataIndex).toBe("user_id");
    expect(colBy(cols, "channel").dataIndex).toBe("channel");
    expect(colBy(cols, "created_at").dataIndex).toBe("created_at");
    expect(colBy(cols, "updated_at").dataIndex).toBe("updated_at");
  });

  it("leaves the four plain text columns without a custom render", () => {
    const cols = createColumns(handlers());

    for (const key of ["id", "name", "session_id", "user_id"]) {
      expect(
        colBy(cols, key).render,
        `${key} must stay a plain text cell`,
      ).toBe(undefined);
    }
  });

  it("sorts updated_at descending by default on the active tab", () => {
    const cols = createColumns(handlers());

    expect(colBy(cols, "updated_at").defaultSortOrder).toBe("descend");
  });

  it("does not pre-sort created_at", () => {
    const cols = createColumns(handlers());

    expect(colBy(cols, "created_at").defaultSortOrder).toBeUndefined();
  });

  it("pins the action column to the right edge", () => {
    const cols = createColumns(handlers());

    expect(colBy(cols, "action").fixed).toBe("right");
  });

  it("asks for the shared common.* labels", () => {
    const cols = createColumns(handlers());
    render(colBy(cols, "action").render!(undefined as never, session(), 0));

    const keys = tSpy.mock.calls.map((c) => c[0]);
    expect(keys).toContain("common.edit");
    expect(keys).toContain("common.view");
    expect(keys).toContain("common.delete");
    expect(keys).toContain("sessions.archive.action");
  });
});

describe("createColumns — archived tab column set", () => {
  it("inserts archived_at just before the action column", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    expect(cols.map((c) => String(asCol(c).key))).toEqual([
      "id",
      "name",
      "session_id",
      "user_id",
      "channel",
      "created_at",
      "updated_at",
      "archived_at",
      "action",
    ]);
  });

  it("titles archived_at through i18n with an inline fallback", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    expect(colBy(cols, "archived_at").title).toBe("ArchivedAt");
    expect(
      tSpy.mock.calls.some(
        (c) => c[0] === "sessions.archivedAtColumn" && c[1] === "ArchivedAt",
      ),
    ).toBe(true);
  });

  it("switches the default sort to archived_at descending", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    expect(colBy(cols, "archived_at").defaultSortOrder).toBe("descend");
    expect(colBy(cols, "updated_at").defaultSortOrder).toBeUndefined();
  });

  it("narrows the action column because it holds fewer buttons", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    expect(colBy(cols, "action").width).toBe(160);
  });

  it("treats a falsy isArchivedTab the same as an absent one", () => {
    const withFalse = createColumns({ ...handlers(), isArchivedTab: false });

    expect(withFalse.map((c) => String(asCol(c).key))).not.toContain(
      "archived_at",
    );
    expect(colBy(withFalse, "action").width).toBe(200);
    expect(colBy(withFalse, "updated_at").defaultSortOrder).toBe("descend");
  });

  it("formats the archived_at cell like every other timestamp cell", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });
    const ts = "2026-09-03T10:00:00Z";

    const el = renderCell(colBy(cols, "archived_at"), ts, session());

    expect(el).toBe(formatTime(ts));
  });
});

// ---------------------------------------------------------------------------
// channel cell
// ---------------------------------------------------------------------------
describe("channel cell — colour mapping", () => {
  it.each([
    ["discord", CHANNEL_COLORS.discord],
    ["console", CHANNEL_COLORS.console],
    ["dingtalk", CHANNEL_COLORS.dingtalk],
    ["telegram", CHANNEL_COLORS.telegram],
  ])("maps the known channel %s to its palette colour", (channel, colour) => {
    const cols = createColumns(handlers());

    const el = renderCell(
      colBy(cols, "channel"),
      channel,
      session({ channel }),
    );

    expect((el.props as { color?: string }).color).toBe(colour);
  });

  it("falls back to the neutral colour for a channel the palette never saw", () => {
    const cols = createColumns(handlers());

    const el = renderCell(
      colBy(cols, "channel"),
      "brand-new-channel",
      session({ channel: "brand-new-channel" }),
    );

    expect((el.props as { color?: string }).color).toBe("default");
  });

  it("falls back to the neutral colour when channel is an empty string", () => {
    const cols = createColumns(handlers());

    const el = renderCell(colBy(cols, "channel"), "", session({ channel: "" }));

    expect((el.props as { color?: string }).color).toBe("default");
  });

  it("shows the raw channel name as the tag label", () => {
    const cols = createColumns(handlers());

    const el = renderCell(colBy(cols, "channel"), "feishu", session());
    const { container } = render(el);

    expect(container.textContent).toBe("feishu");
  });

  it("keeps showing an unmapped channel name instead of hiding it", () => {
    const cols = createColumns(handlers());

    const el = renderCell(
      colBy(cols, "channel"),
      "unknown-x",
      session({ channel: "unknown-x" }),
    );
    const { container } = render(el);

    expect(container.textContent).toBe("unknown-x");
  });
});

// ---------------------------------------------------------------------------
// timestamp cells
// ---------------------------------------------------------------------------
describe("timestamp cells — created_at / updated_at", () => {
  it("renders an ISO string through the shared formatter", () => {
    const cols = createColumns(handlers());
    const ts = "2026-09-01T08:30:00Z";

    expect(renderCell(colBy(cols, "created_at"), ts, session())).toBe(
      formatTime(ts),
    );
  });

  it("renders a numeric epoch through the shared formatter", () => {
    const cols = createColumns(handlers());

    expect(
      renderCell(colBy(cols, "updated_at"), 1700000000000, session()),
    ).toBe(formatTime(1700000000000));
  });

  it("renders N/A when the backend never set the timestamp", () => {
    const cols = createColumns(handlers());

    expect(renderCell(colBy(cols, "created_at"), null, session())).toBe("N/A");
  });

  it("does not confuse the epoch 0 with a missing timestamp", () => {
    const cols = createColumns(handlers());

    const out = renderCell(colBy(cols, "created_at"), 0, session());

    expect(out).not.toBe("N/A");
    expect(out).toBe(formatTime(0));
  });
});

describe("timestamp sorters — UTC normalisation contract", () => {
  const sortCreated = (a: Session, b: Session): number => {
    const cols = createColumns(handlers());
    return colBy(cols, "created_at").sorter!(a, b);
  };

  it("orders an earlier created_at before a later one", () => {
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T00:00:00Z" }),
        session({ created_at: "2026-09-02T00:00:00Z" }),
      ),
    ).toBeLessThan(0);
  });

  it("orders a later created_at after an earlier one", () => {
    expect(
      sortCreated(
        session({ created_at: "2026-09-02T00:00:00Z" }),
        session({ created_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBeGreaterThan(0);
  });

  it("returns exactly one day in milliseconds for a one day gap", () => {
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T00:00:00Z" }),
        session({ created_at: "2026-09-02T00:00:00Z" }),
      ),
    ).toBe(-86_400_000);
  });

  it("reports equality for identical timestamps", () => {
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T00:00:00Z" }),
        session({ created_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBe(0);
  });

  it("treats a naive timestamp as UTC, matching the same instant with a Z", () => {
    // This is the regression the helper exists for: a value produced by
    // datetime.utcnow() has no suffix, and a browser would read it as local
    // time. Both forms must land on the same instant.
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T00:00:00" }),
        session({ created_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBe(0);
  });

  it("compares an explicit offset against UTC correctly", () => {
    // 08:00+02:00 == 06:00Z, so it sorts before 07:00Z.
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T08:00:00+02:00" }),
        session({ created_at: "2026-09-01T07:00:00Z" }),
      ),
    ).toBeLessThan(0);
  });

  it("compares a compact offset without a colon correctly", () => {
    // 0800+0200 == 06:00Z.
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T08:00:00+0200" }),
        session({ created_at: "2026-09-01T06:00:00Z" }),
      ),
    ).toBe(0);
  });

  it("compares a negative offset correctly", () => {
    // 20:00-05:00 == 01:00Z the next day, so it sorts after 23:00Z.
    expect(
      sortCreated(
        session({ created_at: "2026-09-01T20:00:00-05:00" }),
        session({ created_at: "2026-09-01T23:00:00Z" }),
      ),
    ).toBeGreaterThan(0);
  });

  it("sorts a null timestamp first, as the epoch zero", () => {
    const ts = "2026-09-01T00:00:00Z";

    expect(
      sortCreated(session({ created_at: null }), session({ created_at: ts })),
    ).toBe(0 - new Date(ts).getTime());
  });

  it("sorts a missing (undefined) timestamp first as well", () => {
    const ts = "2026-09-01T00:00:00Z";
    const bare = { id: "x" } as Session;

    expect(sortCreated(bare, session({ created_at: ts }))).toBe(
      0 - new Date(ts).getTime(),
    );
  });

  it("reports equality when both timestamps are absent", () => {
    expect(
      sortCreated(session({ created_at: null }), session({ created_at: null })),
    ).toBe(0);
  });

  it("sorts updated_at with the same normalisation rules", () => {
    const cols = createColumns(handlers());
    const sorter = colBy(cols, "updated_at").sorter!;

    expect(
      sorter(
        session({ updated_at: "2026-09-01T00:00:00" }),
        session({ updated_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBe(0);
    expect(
      sorter(
        session({ updated_at: "2026-09-05T00:00:00Z" }),
        session({ updated_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBeGreaterThan(0);
  });

  it("sorts archived_at with the same normalisation rules", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });
    const sorter = colBy(cols, "archived_at").sorter!;

    expect(
      sorter(
        session({ archived_at: "2026-09-01T00:00:00" }),
        session({ archived_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBe(0);
    expect(
      sorter(
        session({ archived_at: null }),
        session({ archived_at: "2026-09-01T00:00:00Z" }),
      ),
    ).toBeLessThan(0);
  });

  it("every sortable column exposes a comparator function", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    for (const key of ["created_at", "updated_at", "archived_at"]) {
      expect(typeof colBy(cols, key).sorter, `${key} must be sortable`).toBe(
        "function",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// action cell — active tab
// ---------------------------------------------------------------------------
describe("action cell — active tab", () => {
  const mountAction = (over: Partial<Session> = {}) => {
    const h = handlers();
    const cols = createColumns(h);
    const record = session(over);
    const utils = render(
      colBy(cols, "action").render!(undefined as never, record, 0),
    );
    return { h, record, ...utils };
  };

  it("offers edit, view, archive and delete", () => {
    mountAction();

    expect(screen.getByText("common.edit")).toBeInTheDocument();
    expect(screen.getByText("common.view")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("common.delete")).toBeInTheDocument();
  });

  it("offers exactly four buttons", () => {
    const { container } = mountAction();

    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("never offers unarchive on the active tab", () => {
    mountAction();

    expect(screen.queryByText("Unarchive")).toBeNull();
  });

  it("reports the whole record when edit is clicked", () => {
    const { h, record } = mountAction();

    fireEvent.click(screen.getByText("common.edit"));

    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onEdit).toHaveBeenCalledWith(record);
  });

  it("reports the whole record when view is clicked", () => {
    const { h, record } = mountAction();

    fireEvent.click(screen.getByText("common.view"));

    expect(h.onView).toHaveBeenCalledTimes(1);
    expect(h.onView).toHaveBeenCalledWith(record);
  });

  it("reports the whole record when archive is clicked", () => {
    const { h, record } = mountAction();

    fireEvent.click(screen.getByText("Archive"));

    expect(h.onArchiveToggle).toHaveBeenCalledTimes(1);
    expect(h.onArchiveToggle).toHaveBeenCalledWith(record);
  });

  it("reports only the id when delete is clicked", () => {
    const { h, record } = mountAction();

    fireEvent.click(screen.getByText("common.delete"));

    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledWith(record.id);
    expect(h.onDelete).not.toHaveBeenCalledWith(record);
  });

  it("keeps the other handlers untouched when one button is clicked", () => {
    const { h } = mountAction();

    fireEvent.click(screen.getByText("common.view"));

    expect(h.onEdit).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(h.onArchiveToggle).not.toHaveBeenCalled();
  });

  it("passes a session id containing a slash through unchanged", () => {
    const { h, record } = mountAction({ session_id: "discord:user/42" });

    fireEvent.click(screen.getByText("common.delete"));

    expect(h.onDelete).toHaveBeenCalledWith(record.id);
    expect(record.session_id).toBe("discord:user/42");
  });

  it("handles a session whose name holds CJK and emoji characters", () => {
    const { h, record } = mountAction({ name: "会话 🚀 daily" });

    fireEvent.click(screen.getByText("common.edit"));

    expect(h.onEdit).toHaveBeenCalledWith(record);
    expect(record.name).toBe("会话 🚀 daily");
  });

  it("keeps the view button visually distinct with an inline colour", () => {
    const { container } = mountAction();
    const view = screen.getByText("common.view");

    expect(view.style.color).toBe("rgb(82, 196, 26)");
    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("passes the row record through unchanged whatever index antd supplies", () => {
    const h = handlers();
    const cols = createColumns(h);
    const record = session();

    render(colBy(cols, "action").render!(undefined as never, record, 7));
    fireEvent.click(screen.getByText("common.delete"));

    expect(h.onDelete).toHaveBeenCalledWith(record.id);
  });
});

// ---------------------------------------------------------------------------
// action cell — archived tab
// ---------------------------------------------------------------------------
describe("action cell — archived tab", () => {
  const mountArchived = (over: Partial<Session> = {}) => {
    const h = handlers();
    const cols = createColumns({ ...h, isArchivedTab: true });
    const record = session(over);
    const utils = render(
      colBy(cols, "action").render!(undefined as never, record, 0),
    );
    return { h, record, ...utils };
  };

  it("offers only unarchive and delete", () => {
    mountArchived();

    expect(screen.getByText("Unarchive")).toBeInTheDocument();
    expect(screen.getByText("common.delete")).toBeInTheDocument();
    expect(screen.queryByText("common.edit")).toBeNull();
    expect(screen.queryByText("common.view")).toBeNull();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("offers exactly two buttons", () => {
    const { container } = mountArchived();

    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("restores the session through the same toggle handler", () => {
    const { h, record } = mountArchived();

    fireEvent.click(screen.getByText("Unarchive"));

    expect(h.onArchiveToggle).toHaveBeenCalledTimes(1);
    expect(h.onArchiveToggle).toHaveBeenCalledWith(record);
  });

  it("still deletes by id on the archived tab", () => {
    const { h, record } = mountArchived();

    fireEvent.click(screen.getByText("common.delete"));

    expect(h.onDelete).toHaveBeenCalledWith(record.id);
  });

  it("asks for the unarchive label through i18n with its fallback", () => {
    mountArchived();

    expect(
      tSpy.mock.calls.some(
        (c) => c[0] === "sessions.archive.unaction" && c[1] === "Unarchive",
      ),
    ).toBe(true);
  });

  it("keeps working for a session that was archived without a timestamp", () => {
    const { h, record } = mountArchived({ archived_at: null });

    fireEvent.click(screen.getByText("Unarchive"));

    expect(h.onArchiveToggle).toHaveBeenCalledWith(record);
  });
});

// ---------------------------------------------------------------------------
// factory purity
// ---------------------------------------------------------------------------
describe("createColumns — factory behaviour", () => {
  it("returns a fresh array per call so callers cannot leak mutations", () => {
    const first = createColumns(handlers());
    const second = createColumns(handlers());

    expect(first).not.toBe(second);
    first.pop();
    expect(second).toHaveLength(8);
  });

  it("does not mutate the handlers object it was given", () => {
    const h = handlers();
    const snapshot = { ...h };

    createColumns(h);

    expect(h).toEqual(snapshot);
  });

  it("keeps every column keyed, so antd can track them", () => {
    const cols = createColumns({ ...handlers(), isArchivedTab: true });

    for (const c of cols) {
      expect(asCol(c).key).toBeTruthy();
    }
  });
});
