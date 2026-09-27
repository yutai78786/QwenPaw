// @vitest-environment jsdom
/**
 * EmptyState tests - the market empty-state placeholder's user-visible
 * contract: it shows the caller-supplied text, a fixed box glyph, and passes
 * any children straight through. The component is a pure function with no
 * hooks and no i18n, so nothing is mocked here.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import styles from "./EmptyState.module.less";

describe("EmptyState", () => {
  it("shows the text the caller passed in", () => {
    const { container } = render(<EmptyState text="market.noResults" />);
    const text = container.querySelector(`.${styles.text}`);
    expect(text?.textContent).toBe("market.noResults");
  });

  it("shows the fixed box glyph", () => {
    const { container } = render(<EmptyState text="anything" />);
    const icon = container.querySelector(`.${styles.icon}`);
    expect(icon?.textContent).toBe("📦");
  });

  it("passes children through after the text", () => {
    const { getByTestId, container } = render(
      <EmptyState text="anything">
        <button data-testid="kid">act</button>
      </EmptyState>,
    );
    expect(getByTestId("kid").textContent).toBe("act");
    // The wrapper holds icon, text and the passed child.
    const wrap = container.querySelector(`.${styles.emptyState}`);
    expect(wrap?.querySelector(`.${styles.text}`)?.textContent).toBe(
      "anything",
    );
  });
});
