/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ShellEvasionSection - the grid of the seven shell-evasion checks: how many
 * rows it renders and in which order, the display name with its two sources
 * (the translation, or the key turned into Title Case Words), the description
 * row that only appears when there is something to say, the strict
 * `=== true` reading of each flag (so any other value counts as off), the
 * toggle payload handed up to the parent, the `disabled` prop reaching every
 * switch and blocking the toggle, and the `size="small"` the product asks for.
 *
 * Stub notes, each one measured against the real modules before writing:
 * - The global design stub does export Switch (measured: HAS_DESIGN_Switch=true),
 *   but `@agentscope-ai/design` is still overridden here with a button-based
 *   switch, which is the pattern the sibling tests in this folder already use
 *   (RuleTable.test.tsx) and which keeps the assertion on the callback payload
 *   rather than on jsdom controlled-checkbox behaviour. Overriding is
 *   authorised by src/test/design-mock.ts:4.
 * - No icon library is imported by this component, so none is mocked.
 * - No assertion reads a class name: the CSS module hashes them (measured:
 *   styles.shellEvasionSection is "_shellEvasionSection_cfb928",
 *   styles.shellEvasionItem is "_shellEvasionItem_cfb928", six keys match the
 *   loose case-insensitive substring "evasion", negative control empty).
 * - Translation is a switchable stub: keys listed in `tMissing` answer with the
 *   caller's defaultValue, every other key answers with itself. That is what
 *   makes both arms of `translated || derivedName` and of the conditional
 *   description reachable.
 * - The seven keys and their derived Title Case spellings are written out
 *   explicitly instead of being computed from the component, so the fallback
 *   branch is pinned against an independent expectation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ShellEvasionSection } from "./ShellEvasionSection";

const h = vi.hoisted(() => ({
  tMissing: new Set<string>(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      h.tMissing.has(key) ? opts?.defaultValue ?? "" : key,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("@agentscope-ai/design", () => {
  const Switch = ({ checked, onChange, disabled, size }: any) =>
    React.createElement("button", {
      type: "button",
      role: "switch",
      "data-testid": "check-switch",
      "data-checked": String(Boolean(checked)),
      "data-size": String(size),
      "data-disabled": String(Boolean(disabled)),
      disabled: Boolean(disabled),
      onClick: () => onChange?.(!checked),
    });
  return { Switch };
});

// The product list, in the order the source declares it, paired with the
// Title Case spelling its fallback derives from the key.
const CHECKS: Array<[string, string]> = [
  ["command_substitution", "Command Substitution"],
  ["obfuscated_flags", "Obfuscated Flags"],
  ["backslash_escaped_whitespace", "Backslash Escaped Whitespace"],
  ["backslash_escaped_operators", "Backslash Escaped Operators"],
  ["newlines", "Newlines"],
  ["comment_quote_desync", "Comment Quote Desync"],
  ["quoted_newline", "Quoted Newline"],
];

const KEYS = CHECKS.map(([key]) => key);

const nameKey = (key: string) => `security.shellEvasion.checks.${key}.name`;
const descKey = (key: string) =>
  `security.shellEvasion.checks.${key}.description`;

const allChecksOn = (): Record<string, boolean> =>
  Object.fromEntries(KEYS.map((key) => [key, true]));

const switches = () => screen.queryAllByTestId("check-switch");

describe("ShellEvasionSection - grid shape", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it("renders one switch per declared check, seven in total", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(switches()).toHaveLength(7);
  });

  it("keeps the order the source declares the checks in", () => {
    render(<ShellEvasionSection checks={allChecksOn()} onToggle={vi.fn()} />);
    // With translations present each row shows its own i18n key, which carries
    // the check name, so reading the rows top to bottom pins the order.
    const names = screen
      .getAllByText(/^security\.shellEvasion\.checks\..+\.name$/)
      .map((node) => node.textContent);
    expect(names).toEqual(KEYS.map(nameKey));
  });

  it("renders the same seven rows regardless of which flags are set", () => {
    const { rerender } = render(
      <ShellEvasionSection checks={{}} onToggle={vi.fn()} />,
    );
    expect(switches()).toHaveLength(7);
    rerender(<ShellEvasionSection checks={allChecksOn()} onToggle={vi.fn()} />);
    expect(switches()).toHaveLength(7);
  });

  it("asks the switch for the small size on every row", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    const sizes = switches().map((node) => node.getAttribute("data-size"));
    expect(sizes).toEqual(KEYS.map(() => "small"));
  });
});

describe("ShellEvasionSection - display name", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it("shows the translated name when the catalogue has one", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    for (const key of KEYS) {
      expect(screen.getByText(nameKey(key))).toBeInTheDocument();
    }
  });

  it.each(CHECKS)(
    "falls back to the Title Case spelling of %s when the name is untranslated",
    (key, derived) => {
      h.tMissing.add(nameKey(key));
      render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
      expect(screen.getByText(derived)).toBeInTheDocument();
    },
  );

  it("derives every fallback name at once when no name is translated", () => {
    for (const key of KEYS) h.tMissing.add(nameKey(key));
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    for (const [, derived] of CHECKS) {
      expect(screen.getByText(derived)).toBeInTheDocument();
    }
    // None of the raw i18n name keys survives, so nothing is half translated.
    expect(
      screen.queryByText(/^security\.shellEvasion\.checks\..+\.name$/),
    ).not.toBeInTheDocument();
  });

  it("mixes translated and derived names in one grid", () => {
    h.tMissing.add(nameKey("newlines"));
    h.tMissing.add(nameKey("quoted_newline"));
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(screen.getByText("Newlines")).toBeInTheDocument();
    expect(screen.getByText("Quoted Newline")).toBeInTheDocument();
    expect(
      screen.getByText(nameKey("command_substitution")),
    ).toBeInTheDocument();
  });
});

describe("ShellEvasionSection - description row", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it("renders a description row for every check when they are translated", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    for (const key of KEYS) {
      expect(screen.getByText(descKey(key))).toBeInTheDocument();
    }
  });

  it("renders no description row at all when none is translated", () => {
    for (const key of KEYS) h.tMissing.add(descKey(key));
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(screen.queryByText(/\.description$/)).not.toBeInTheDocument();
    // The seven names are still there, so nothing else disappeared with them.
    expect(switches()).toHaveLength(7);
  });

  it("hides only the rows whose description is missing", () => {
    h.tMissing.add(descKey("newlines"));
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(screen.queryByText(descKey("newlines"))).not.toBeInTheDocument();
    expect(
      screen.getByText(descKey("command_substitution")),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/^security\.shellEvasion\.checks\..+\.description$/),
    ).toHaveLength(6);
  });
});

describe("ShellEvasionSection - flag reading", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it("reports every switch off when no flag is set", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(switches().map((n) => n.getAttribute("data-checked"))).toEqual(
      KEYS.map(() => "false"),
    );
  });

  it("reports every switch on when all seven flags are true", () => {
    render(<ShellEvasionSection checks={allChecksOn()} onToggle={vi.fn()} />);
    expect(switches().map((n) => n.getAttribute("data-checked"))).toEqual(
      KEYS.map(() => "true"),
    );
  });

  it.each([
    ["a single true flag", { newlines: true }, ["newlines"]],
    [
      "two true flags",
      { newlines: true, quoted_newline: true },
      ["newlines", "quoted_newline"],
    ],
  ] as Array<[string, Record<string, boolean>, string[]]>)(
    "turns on only the rows named by %s",
    (_label, checks, expectedOn) => {
      render(<ShellEvasionSection checks={checks} onToggle={vi.fn()} />);
      const on = KEYS.filter(
        (key) =>
          switches()[KEYS.indexOf(key)].getAttribute("data-checked") === "true",
      );
      expect(on).toEqual(expectedOn);
    },
  );

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["null", null],
    ["zero", 0],
    ["one", 1],
    ["the string true", "true"],
    ["an empty string", ""],
  ])("counts a flag of %s as off, because only true is on", (_label, value) => {
    const checks = { newlines: value } as unknown as Record<string, boolean>;
    render(<ShellEvasionSection checks={checks} onToggle={vi.fn()} />);
    const row = switches()[KEYS.indexOf("newlines")];
    expect(row.getAttribute("data-checked")).toBe("false");
  });

  it("follows a flag that changes between renders", () => {
    const { rerender } = render(
      <ShellEvasionSection checks={{}} onToggle={vi.fn()} />,
    );
    expect(switches()[0].getAttribute("data-checked")).toBe("false");
    rerender(<ShellEvasionSection checks={allChecksOn()} onToggle={vi.fn()} />);
    expect(switches()[0].getAttribute("data-checked")).toBe("true");
    rerender(
      <ShellEvasionSection
        checks={{ ...allChecksOn(), obfuscated_flags: false }}
        onToggle={vi.fn()}
      />,
    );
    expect(switches()[1].getAttribute("data-checked")).toBe("false");
    expect(switches()[0].getAttribute("data-checked")).toBe("true");
  });
});

describe("ShellEvasionSection - toggle callback", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it.each(KEYS)("hands the check key %s up with the new value", (key) => {
    const onToggle = vi.fn();
    render(<ShellEvasionSection checks={{}} onToggle={onToggle} />);
    fireEvent.click(switches()[KEYS.indexOf(key)]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(key, true);
  });

  it("reports false when a checked row is turned off", () => {
    const onToggle = vi.fn();
    render(<ShellEvasionSection checks={allChecksOn()} onToggle={onToggle} />);
    fireEvent.click(switches()[KEYS.indexOf("quoted_newline")]);
    expect(onToggle).toHaveBeenCalledWith("quoted_newline", false);
  });

  it("reports one call per click when several rows are toggled", () => {
    const onToggle = vi.fn();
    render(<ShellEvasionSection checks={{}} onToggle={onToggle} />);
    fireEvent.click(switches()[0]);
    fireEvent.click(switches()[2]);
    fireEvent.click(switches()[6]);
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(onToggle.mock.calls).toEqual([
      [KEYS[0], true],
      [KEYS[2], true],
      [KEYS[6], true],
    ]);
  });

  it("does not call back for a row that was never clicked", () => {
    const onToggle = vi.fn();
    render(<ShellEvasionSection checks={{}} onToggle={onToggle} />);
    fireEvent.click(switches()[3]);
    expect(onToggle).not.toHaveBeenCalledWith(KEYS[4], true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("ShellEvasionSection - disabled prop", () => {
  beforeEach(() => {
    h.tMissing.clear();
  });

  it("leaves every switch enabled when the prop is omitted", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} />);
    expect(switches().map((n) => n.getAttribute("data-disabled"))).toEqual(
      KEYS.map(() => "false"),
    );
  });

  it("leaves every switch enabled when the prop is explicitly false", () => {
    render(
      <ShellEvasionSection checks={{}} onToggle={vi.fn()} disabled={false} />,
    );
    expect(switches().map((n) => n.getAttribute("data-disabled"))).toEqual(
      KEYS.map(() => "false"),
    );
  });

  it("disables every switch when the prop is true", () => {
    render(<ShellEvasionSection checks={{}} onToggle={vi.fn()} disabled />);
    expect(switches().map((n) => n.getAttribute("data-disabled"))).toEqual(
      KEYS.map(() => "true"),
    );
    for (const node of switches()) {
      expect(node).toBeDisabled();
    }
  });

  it("blocks the toggle while disabled", () => {
    const onToggle = vi.fn();
    render(<ShellEvasionSection checks={{}} onToggle={onToggle} disabled />);
    fireEvent.click(switches()[0]);
    fireEvent.click(switches()[6]);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still shows the flags while disabled", () => {
    render(
      <ShellEvasionSection
        checks={allChecksOn()}
        onToggle={vi.fn()}
        disabled
      />,
    );
    expect(switches().map((n) => n.getAttribute("data-checked"))).toEqual(
      KEYS.map(() => "true"),
    );
  });

  it("re-enables the toggles when the prop goes back to false", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ShellEvasionSection checks={{}} onToggle={onToggle} disabled />,
    );
    fireEvent.click(switches()[0]);
    expect(onToggle).not.toHaveBeenCalled();
    rerender(
      <ShellEvasionSection checks={{}} onToggle={onToggle} disabled={false} />,
    );
    fireEvent.click(switches()[0]);
    expect(onToggle).toHaveBeenCalledWith(KEYS[0], true);
  });
});
