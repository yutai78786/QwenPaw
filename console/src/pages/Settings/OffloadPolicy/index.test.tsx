/**
 * Unit tests for the OffloadPolicy page shell.
 *
 * The shell has exactly one job: build the breadcrumb from the two navigation
 * keys and mount the card. PageHeader is stubbed because it owns its own test
 * file, and the card is stubbed because it owns OffloadPolicyCard.test.tsx --
 * this file therefore asserts the wiring only, and deliberately does not
 * re-test either neighbour.
 */
import { describe, it, vi, expect } from "vitest";
import { render } from "@testing-library/react";

const headerProps: Array<Record<string, unknown>> = [];
let cardMounts = 0;

vi.mock("@/components/PageHeader", () => ({
  PageHeader: (props: Record<string, unknown>) => {
    headerProps.push(props);
    return <div data-testid="page-header" />;
  },
}));

vi.mock("./OffloadPolicyCard", () => ({
  OffloadPolicyCard: () => {
    cardMounts += 1;
    return <div data-testid="offload-card" />;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: string) => d ?? k,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

import OffloadPolicyPage from "./index";

describe("OffloadPolicyPage", () => {
  it("mounts the policy card exactly once", () => {
    cardMounts = 0;
    const { getByTestId } = render(<OffloadPolicyPage />);
    expect(getByTestId("offload-card")).toBeInTheDocument();
    expect(cardMounts).toBe(1);
  });

  it("builds the breadcrumb from the settings parent and the offload key", () => {
    headerProps.length = 0;
    render(<OffloadPolicyPage />);

    expect(headerProps).toHaveLength(1);
    // "nav.settings" has no default in the call site, so the stub t() returns
    // the key itself; "nav.offloadPolicy" does carry a fallback string.
    expect(headerProps[0].parent).toBe("nav.settings");
    expect(headerProps[0].current).toBe("Tool Offload");
  });
});
