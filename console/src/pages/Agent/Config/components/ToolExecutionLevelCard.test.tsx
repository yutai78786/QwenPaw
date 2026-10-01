// @vitest-environment jsdom
/**
 * ToolExecutionLevelCard tests - the tool approval mode picker of the Agent
 * Config page, rendered from `pages/Agent/Config/index.tsx:269`
 * (`<ToolExecutionLevelCard ... />`, imported at `:10`).
 *
 * Visible contract under test:
 *
 *   1. the four approval levels are listed in the order the product declares
 *      (STRICT, SMART, AUTO, OFF), each with the label and the description key
 *      it asks for;
 *   2. the card is fully controlled: exactly the level passed in as `value`
 *      carries that level's own colour and the thicker border, and every other
 *      level falls back to a plain 1px border with no colour at all;
 *   3. the four colours are pairwise distinct, so a colour table collapsed onto
 *      one variable cannot pass;
 *   4. clicking a level card reports THAT level verbatim - never an index, never
 *      a widened variant - for all four transitions;
 *   5. the radio input is a second, independent way in: driving it reports the
 *      same level through the group's onChange;
 *   6. there is deliberately no "already selected" short-circuit: picking the
 *      level that is already in force still reports it. This is the opposite of
 *      the sibling MCP client panel, so a spec that only checked "another level
 *      is reported" would miss a guard being added here;
 *   7. `disabled` gates the card click but is optional: omitting it leaves the
 *      picker live, and the flag reaches the radios too.
 *
 * Harness notes (measured facts):
 *
 * - The component imports straight from `antd` (no `@agentscope-ai/design`), so
 *   no design stub is needed and the shared `src/test/design-mock.ts` is
 *   untouched. `lucide-react` is left real, as `MCPClientCard.test.tsx` does.
 * - antd renders one `.ant-card` for the outer container plus one per level
 *   option, so a level card is located through its own radio input
 *   (`input[value="STRICT"]`) and `closest(".ant-card")` rather than by index.
 * - The radios carry no accessible name (probe: all four `aria-label` are
 *   `null`), so they are addressed by value, not by name.
 * - The `react-i18next` stub returns a stable reference (`vi.hoisted`) and `t`
 *   returns the key verbatim, so assertions pin the i18n key the product asks
 *   for rather than a rewordable English sentence. All ten keys were checked to
 *   exist in `src/locales/en.json` under `agentConfig.toolExecutionLevel`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

import {
  ToolExecutionLevelCard,
  type ToolExecutionLevel,
} from "./ToolExecutionLevelCard";

/** The four levels in the order the product lists them. */
const LEVELS: ToolExecutionLevel[] = ["STRICT", "SMART", "AUTO", "OFF"];

/**
 * The colour the product declares per level. Written out instead of read back
 * from the render so that a collapsed colour table (every level pointing at the
 * same variable) fails these assertions instead of passing them.
 */
const COLOUR_OF: Record<ToolExecutionLevel, string> = {
  STRICT: "var(--app-error-text)",
  SMART: "var(--app-warning-text)",
  AUTO: "var(--app-info-text)",
  OFF: "var(--app-success-text)",
};

const LABEL_KEY_OF: Record<ToolExecutionLevel, string> = {
  STRICT: "agentConfig.toolExecutionLevel.strict",
  SMART: "agentConfig.toolExecutionLevel.smart",
  AUTO: "agentConfig.toolExecutionLevel.auto",
  OFF: "agentConfig.toolExecutionLevel.off",
};

const DESC_KEY_OF: Record<ToolExecutionLevel, string> = {
  STRICT: "agentConfig.toolExecutionLevel.strictDesc",
  SMART: "agentConfig.toolExecutionLevel.smartDesc",
  AUTO: "agentConfig.toolExecutionLevel.autoDesc",
  OFF: "agentConfig.toolExecutionLevel.offDesc",
};

afterEach(cleanup);

function radioOf(level: ToolExecutionLevel): HTMLInputElement {
  const radio = document.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${level}"]`,
  );
  if (!radio) throw new Error(`no radio for level ${level}`);
  return radio;
}

/** The clickable option card that wraps a given level's radio. */
function cardOf(level: ToolExecutionLevel): HTMLElement {
  const card = radioOf(level).closest<HTMLElement>(".ant-card");
  if (!card) throw new Error(`no option card for level ${level}`);
  return card;
}

function renderCard(
  value: ToolExecutionLevel,
  extra: { disabled?: boolean } = {},
) {
  const onChange = vi.fn();
  const view = render(
    <ToolExecutionLevelCard value={value} onChange={onChange} {...extra} />,
  );
  return { onChange, ...view };
}

describe("ToolExecutionLevelCard - level list", () => {
  it("lists the four levels in the product's order, once each", () => {
    renderCard("AUTO");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(LEVELS);
  });

  it("labels every level and describes it with the key the product chose", () => {
    renderCard("AUTO");
    for (const level of LEVELS) {
      const card = cardOf(level);
      expect(card).toHaveTextContent(LABEL_KEY_OF[level]);
      expect(card).toHaveTextContent(DESC_KEY_OF[level]);
    }
  });

  it("shows the section title and the info alert above the picker", () => {
    renderCard("AUTO");
    expect(
      screen.getByText("agentConfig.toolExecutionLevel.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("agentConfig.toolExecutionLevel.alertMessage"),
    ).toBeInTheDocument();
    expect(document.querySelector(".ant-alert-info")).not.toBeNull();
  });
});

describe("ToolExecutionLevelCard - controlled highlight", () => {
  it.each(LEVELS)(
    "marks only %s with its own colour and the thicker border",
    (level) => {
      renderCard(level);
      const selected = cardOf(level);
      expect(selected.style.borderColor).toBe(COLOUR_OF[level]);
      expect(selected.style.borderWidth).toBe("2px");

      for (const other of LEVELS) {
        if (other === level) continue;
        const card = cardOf(other);
        // Not selected: no colour at all, and the plain border width.
        expect(card.style.borderColor).toBe("");
        expect(card.style.borderWidth).toBe("1px");
      }
    },
  );

  it("paints the level icon with the same colour as the selected border", () => {
    renderCard("STRICT");
    const icon = cardOf("STRICT").querySelector<HTMLElement>(
      'div[style*="margin-top: 2px"]',
    );
    expect(icon).not.toBeNull();
    expect(icon?.style.color).toBe(COLOUR_OF.STRICT);
  });

  it("keeps the four level colours pairwise distinct", () => {
    const colours = LEVELS.map((level) => COLOUR_OF[level]);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("moves the highlight when the value prop changes, and reverts the old one", () => {
    const { rerender } = renderCard("SMART");
    expect(cardOf("SMART").style.borderWidth).toBe("2px");
    expect(cardOf("OFF").style.borderWidth).toBe("1px");

    rerender(<ToolExecutionLevelCard value="OFF" onChange={vi.fn()} />);

    // The new level takes the colour and the thick border...
    expect(cardOf("OFF").style.borderColor).toBe(COLOUR_OF.OFF);
    expect(cardOf("OFF").style.borderWidth).toBe("2px");
    // ...and the previously selected one must fall back, not stay highlighted.
    expect(cardOf("SMART").style.borderColor).toBe("");
    expect(cardOf("SMART").style.borderWidth).toBe("1px");
  });

  it("checks the radio of the current level and leaves the other three unchecked", () => {
    renderCard("AUTO");
    for (const level of LEVELS) {
      expect(radioOf(level).checked).toBe(level === "AUTO");
    }
  });
});

describe("ToolExecutionLevelCard - reporting a pick", () => {
  it.each(LEVELS)("reports %s verbatim when its card is clicked", (level) => {
    const { onChange } = renderCard("AUTO");
    fireEvent.click(cardOf(level));
    expect(onChange).toHaveBeenCalledTimes(1);
    // Verbatim: the level string itself, not an index and not a widened variant.
    expect(onChange.mock.calls[0]).toEqual([level]);
  });

  it("reports the level through the radio input as well", () => {
    const { onChange } = renderCard("STRICT");
    fireEvent.click(radioOf("OFF"));
    expect(onChange).toHaveBeenCalledWith("OFF");
  });

  it("still reports the level that is already selected (no short-circuit)", () => {
    const { onChange } = renderCard("SMART");
    fireEvent.click(cardOf("SMART"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("SMART");
  });

  it("reports once per click, not once per level rendered", () => {
    const { onChange } = renderCard("AUTO");
    fireEvent.click(cardOf("STRICT"));
    fireEvent.click(cardOf("OFF"));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["STRICT", "OFF"]);
  });
});

describe("ToolExecutionLevelCard - disabled", () => {
  it("is live when the flag is omitted, so the default really is enabled", () => {
    const { onChange } = renderCard("AUTO");
    expect(radioOf("AUTO").disabled).toBe(false);
    fireEvent.click(cardOf("STRICT"));
    expect(onChange).toHaveBeenCalledWith("STRICT");
  });

  it("reports nothing from a card click while disabled", () => {
    const { onChange } = renderCard("AUTO", { disabled: true });
    for (const level of LEVELS) {
      fireEvent.click(cardOf(level));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("passes the flag down to every radio while disabled", () => {
    renderCard("AUTO", { disabled: true });
    for (const level of LEVELS) {
      expect(radioOf(level).disabled).toBe(true);
    }
  });

  it("keeps the highlight on the current level even while disabled", () => {
    renderCard("OFF", { disabled: true });
    expect(cardOf("OFF").style.borderColor).toBe(COLOUR_OF.OFF);
    expect(cardOf("OFF").style.borderWidth).toBe("2px");
  });
});
