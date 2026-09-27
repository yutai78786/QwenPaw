import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The viewer only consumes `t` for two strings that both ship an English
// fallback, so the mock hands the fallback back. That keeps the assertions on
// what a user actually reads instead of on translation keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { LogViewer } from "./LogViewer";

// antd renders a real Spin/Typography here, so nothing else is mocked: the
// assertions below read the DOM the component actually produced.

function renderViewer(lines: string[], query: string, loading = false) {
  return render(<LogViewer lines={lines} query={query} loading={loading} />);
}

/** Every <mark> the viewer produced, in document order. */
function markTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("mark")).map(
    (m) => m.textContent ?? "",
  );
}

/**
 * Text of each rendered log row, in document order.
 *
 * Rows are the divs the viewer maps over `lines`; the empty-state placeholder
 * is a Typography span instead, so it is deliberately not counted as a row.
 */
function rowTexts(container: HTMLElement): string[] {
  const viewer = container.querySelector("div[class*='logViewer']");
  if (!viewer) throw new Error("log viewer container not rendered");
  return Array.from(viewer.children)
    .filter((row) => row.tagName === "DIV")
    .map((row) => row.textContent ?? "");
}

afterEach(cleanup);

describe("LogViewer row rendering", () => {
  it("renders one row per line and keeps their order", () => {
    const { container } = renderViewer(["first", "second", "third"], "");
    expect(rowTexts(container)).toEqual(["first", "second", "third"]);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("renders an empty line as an empty row instead of dropping it", () => {
    const { container } = renderViewer(["a", "", "b"], "");
    expect(rowTexts(container)).toEqual(["a", "", "b"]);
  });

  it("shows the placeholder when there are no lines at all", () => {
    const { container } = renderViewer([], "anything");
    expect(container.textContent).toContain(
      "Backend log output will appear here.",
    );
    expect(rowTexts(container)).toEqual([]);
  });

  it("keeps showing every line while loading", () => {
    const { container } = renderViewer(["still here"], "", true);
    expect(rowTexts(container)).toEqual(["still here"]);
  });
});

describe("LogViewer loading state", () => {
  it("spins and shows the loading tip while loading", () => {
    const { container } = renderViewer(["a"], "", true);
    const spin = container.querySelector(".ant-spin-spinning");
    expect(spin).not.toBeNull();
    expect(spin?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".ant-spin-text")?.textContent).toBe(
      "Loading",
    );
  });

  it("shows no spinner and no tip when not loading", () => {
    const { container } = renderViewer(["a"], "", false);
    expect(container.querySelector(".ant-spin-spinning")).toBeNull();
    expect(container.querySelector(".ant-spin-text")).toBeNull();
    expect(container.querySelector("[aria-busy]")).toBeNull();
  });
});

describe("LogViewer query highlighting", () => {
  it("wraps a single match in a <mark> and keeps the surrounding text", () => {
    const { container } = renderViewer(["alpha"], "alp");
    expect(markTexts(container)).toEqual(["alp"]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("leaves the line untouched when nothing matches", () => {
    const { container } = renderViewer(["alpha"], "zzz");
    expect(markTexts(container)).toEqual([]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("treats an empty query as no highlighting", () => {
    const { container } = renderViewer(["alpha"], "");
    expect(markTexts(container)).toEqual([]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("treats a whitespace-only query as no highlighting", () => {
    const { container } = renderViewer(["alpha"], "   ");
    expect(markTexts(container)).toEqual([]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("matches case-insensitively but keeps the original casing on screen", () => {
    const { container } = renderViewer(["AbC abc ABC"], "abc");
    expect(markTexts(container)).toEqual(["AbC", "abc", "ABC"]);
    expect(rowTexts(container)).toEqual(["AbC abc ABC"]);
  });

  it("highlights every occurrence on a line, not just the first", () => {
    const { container } = renderViewer(["err warn err err"], "err");
    expect(markTexts(container)).toEqual(["err", "err", "err"]);
  });

  it("highlights a match at the very start of a line with no leading text", () => {
    const { container } = renderViewer(["alpha"], "alp");
    const row = rowTexts(container)[0];
    expect(row).toBe("alpha");
    expect(container.querySelector("mark")?.previousSibling).toBeNull();
  });

  it("highlights a match at the very end of a line with no trailing text", () => {
    const { container } = renderViewer(["alpha"], "pha");
    expect(markTexts(container)).toEqual(["pha"]);
    expect(container.querySelector("mark")?.nextSibling).toBeNull();
  });

  it("highlights a query that spans the whole line", () => {
    const { container } = renderViewer(["alpha"], "alpha");
    expect(markTexts(container)).toEqual(["alpha"]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("does not let adjacent matches overlap", () => {
    const { container } = renderViewer(["aaaa"], "aa");
    expect(markTexts(container)).toEqual(["aa", "aa"]);
    expect(rowTexts(container)).toEqual(["aaaa"]);
  });

  it("highlights only the lines that contain the query", () => {
    const lines = ["plain text", "hit here", "another line"];
    const { container } = renderViewer(lines, "hit");

    expect(markTexts(container)).toEqual(["hit"]);
    expect(rowTexts(container)).toEqual(lines);

    // Assert per row, not just in total: a mark leaking into a neighbouring
    // row would still pass a global count check.
    const viewer = container.querySelector("div[class*='logViewer']");
    const rows = Array.from(viewer?.children ?? []).filter(
      (row) => row.tagName === "DIV",
    );
    expect(rows.map((row) => row.querySelectorAll("mark").length)).toEqual([
      0, 1, 0,
    ]);
  });

  it("finds an ASCII query inside a non-ASCII line", () => {
    const { container } = renderViewer(["日志 error 行"], "error");
    expect(markTexts(container)).toEqual(["error"]);
    expect(rowTexts(container)).toEqual(["日志 error 行"]);
  });

  it("trims surrounding whitespace from the query before matching", () => {
    const { container } = renderViewer(["alpha"], "  alp  ");
    expect(markTexts(container)).toEqual(["alp"]);
    expect(rowTexts(container)).toEqual(["alpha"]);
  });

  it("never renders an empty mark element", () => {
    const { container } = renderViewer(["a.b and ab"], ".");
    const marks = Array.from(container.querySelectorAll("mark"));
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.textContent ?? "").not.toBe("");
    }
  });
});

describe("LogViewer query escaping", () => {
  // Every one of these is a regex metacharacter. If the query reached `new
  // RegExp` unescaped, "." would match any character, "(" would throw, and so
  // on. The expectation is always the same: the query is matched literally.
  const META_QUERIES: Array<[string, string, string[]]> = [
    ["a.b ab", ".", ["."]],
    ["a*b ab", "*", ["*"]],
    ["a+b ab", "+", ["+"]],
    ["a?b ab", "?", ["?"]],
    ["^a a", "^", ["^"]],
    ["a$ a", "$", ["$"]],
    ["(x) x", "(x)", ["(x)"]],
    ["[a] a", "[a]", ["[a]"]],
    ["a{2} a2", "{2}", ["{2}"]],
    ["a|b ab", "|", ["|"]],
    ["a\\b ab", "\\", ["\\"]],
  ];

  it("matches every regex metacharacter literally instead of as a pattern", () => {
    const observed = META_QUERIES.map(([line, query]) => {
      const { container, unmount } = renderViewer([line], query);
      const result = {
        query,
        marks: markTexts(container),
        rows: rowTexts(container),
      };
      unmount();
      return result;
    });

    expect(observed).toEqual(
      META_QUERIES.map(([line, query, marks]) => ({
        query,
        marks,
        rows: [line],
      })),
    );
  });

  it("does not let a dot in the query match unrelated characters", () => {
    const { container } = renderViewer(["abcdef"], ".");
    expect(markTexts(container)).toEqual([]);
    expect(rowTexts(container)).toEqual(["abcdef"]);
  });

  it("survives a query that is not a valid regular expression", () => {
    const observed = ["[", "((((", "a{", "*"].map((query) => {
      const { container, unmount } = renderViewer(["abc"], query);
      const result = { query, marks: markTexts(container) };
      unmount();
      return result;
    });

    expect(observed).toEqual([
      { query: "[", marks: [] },
      { query: "((((", marks: [] },
      { query: "a{", marks: [] },
      { query: "*", marks: [] },
    ]);
  });

  it("still matches a literal substring that looks like a broken pattern", () => {
    const { container } = renderViewer(["value of [ is odd"], "[");
    expect(markTexts(container)).toEqual(["["]);
    expect(rowTexts(container)).toEqual(["value of [ is odd"]);
  });
});
