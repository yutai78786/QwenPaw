// @vitest-environment jsdom
/**
 * ACPCard tests - the ACP agent card's user-visible contract: which icon a
 * builtin agent key resolves to (and the default for unknown keys), the
 * enabled/disabled status text, builtin vs custom tag, the command and args
 * rows including their "not set" fallbacks, and the hover-driven class state.
 *
 * The shared design stub does not export Card, so this suite supplies one that
 * forwards the pointer handlers the component wires up. Icon identity is
 * asserted through stubbed icon components because the real ones render an
 * identical wrapper whose only difference is the svg path.
 *
 * The `iconSpec.imageUrl` arm stays uncovered on purpose: the icon is looked up
 * in BUILTIN_ACP_ICON_MAP with DEFAULT_ACP_ICON as the fallback, every entry of
 * both carries only `icon`, and neither object is exported, so no prop can make
 * `imageUrl` truthy and no passing test can reach the image branch.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stableT: (key: string) => key,
  stableI18n: { language: "en" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.stableT, i18n: h.stableI18n }),
}));

vi.mock("@ant-design/icons", () => {
  const make = (name: string) => () => <span data-icon={name} />;
  return {
    ApiOutlined: make("ApiOutlined"),
    CodeOutlined: make("CodeOutlined"),
    ThunderboltOutlined: make("ThunderboltOutlined"),
    ToolOutlined: make("ToolOutlined"),
  };
});

vi.mock("@agentscope-ai/design", () => {
  const Card = ({
    children,
    onClick,
    onMouseEnter,
    onMouseLeave,
    className,
    bodyStyle,
  }: any) => (
    <div
      data-testid="acp-card"
      className={className}
      style={bodyStyle}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
  return { Card };
});

import { ACPCard } from "./ACPCard";
import type { ACPAgentConfig } from "../../../../api/types";
import styles from "../../../Control/Channels/index.module.less";

function makeConfig(overrides: Partial<ACPAgentConfig> = {}): ACPAgentConfig {
  return {
    enabled: true,
    command: "npx",
    args: ["-y", "@acp/agent"],
    env: {},
    trusted: true,
    tool_parse_mode: "call_title",
    ...overrides,
  };
}

function renderCard(
  props: {
    agentKey?: string;
    config?: Partial<ACPAgentConfig>;
    isBuiltin?: boolean;
  } = {},
) {
  const onClick = vi.fn();
  const utils = render(
    <ACPCard
      agentKey={props.agentKey ?? "custom_agent"}
      config={makeConfig(props.config)}
      isBuiltin={props.isBuiltin ?? false}
      onClick={onClick}
    />,
  );
  return { ...utils, onClick };
}

function iconName(container: HTMLElement): string | null {
  return (
    container.querySelector("[data-icon]")?.getAttribute("data-icon") ?? null
  );
}

function cardClasses(): string[] {
  return (screen.getByTestId("acp-card").className || "")
    .split(/\s+/)
    .filter(Boolean);
}

describe("ACPCard - builtin icon resolution", () => {
  const cases: Array<[string, string]> = [
    ["opencode", "CodeOutlined"],
    ["qwen_code", "ToolOutlined"],
    ["claude_code", "ThunderboltOutlined"],
    ["codex", "ApiOutlined"],
  ];

  it.each(cases)("resolves %s to the %s icon", (agentKey, expected) => {
    const { container } = renderCard({ agentKey });
    expect(iconName(container)).toBe(expected);
  });

  it("falls back to the default icon for an unknown agent key", () => {
    const { container } = renderCard({ agentKey: "something_else" });
    expect(iconName(container)).toBe("ApiOutlined");
  });

  it("falls back to the default icon for an empty agent key", () => {
    const { container } = renderCard({ agentKey: "" });
    expect(iconName(container)).toBe("ApiOutlined");
  });

  it("is case sensitive about builtin keys", () => {
    const { container } = renderCard({ agentKey: "OpenCode" });
    expect(iconName(container)).toBe("ApiOutlined");
  });
});

describe("ACPCard - title and tag", () => {
  it("shows the agent key as the card title", () => {
    renderCard({ agentKey: "claude_code" });
    expect(screen.getByText("claude_code")).toBeInTheDocument();
  });

  it("tags a builtin agent as builtin", () => {
    renderCard({ isBuiltin: true });
    expect(screen.getByText("acp.builtin")).toBeInTheDocument();
    expect(screen.queryByText("acp.custom")).toBeNull();
  });

  it("tags a non-builtin agent as custom", () => {
    renderCard({ isBuiltin: false });
    expect(screen.getByText("acp.custom")).toBeInTheDocument();
    expect(screen.queryByText("acp.builtin")).toBeNull();
  });
});

describe("ACPCard - status text and state classes", () => {
  it("reports an enabled agent as enabled", () => {
    renderCard({ config: { enabled: true } });
    expect(screen.getByText("common.enabled")).toBeInTheDocument();
    expect(screen.queryByText("common.disabled")).toBeNull();
  });

  it("reports a disabled agent as disabled", () => {
    renderCard({ config: { enabled: false } });
    expect(screen.getByText("common.disabled")).toBeInTheDocument();
    expect(screen.queryByText("common.enabled")).toBeNull();
  });

  it("applies the enabled state class while not hovered", () => {
    renderCard({ config: { enabled: true } });
    expect(cardClasses()).toEqual([styles.channelCard, styles.enabled]);
  });

  it("applies the normal state class for a disabled agent", () => {
    renderCard({ config: { enabled: false } });
    expect(cardClasses()).toEqual([styles.channelCard, styles.normal]);
  });

  it("switches to the hover state class on mouse enter", () => {
    renderCard({ config: { enabled: true } });
    fireEvent.mouseEnter(screen.getByTestId("acp-card"));
    expect(cardClasses()).toEqual([styles.channelCard, styles.hover]);
  });

  it("returns to the enabled state class on mouse leave", () => {
    renderCard({ config: { enabled: true } });
    const card = screen.getByTestId("acp-card");
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(cardClasses()).toEqual([styles.channelCard, styles.enabled]);
  });

  it("returns to the normal state class on mouse leave when disabled", () => {
    renderCard({ config: { enabled: false } });
    const card = screen.getByTestId("acp-card");
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(cardClasses()).toEqual([styles.channelCard, styles.normal]);
  });

  it("lets the hover state win over the enabled state", () => {
    renderCard({ config: { enabled: true } });
    fireEvent.mouseEnter(screen.getByTestId("acp-card"));
    expect(cardClasses()).not.toContain(styles.enabled);
  });
});

describe("ACPCard - command and args rows", () => {
  it("shows the configured command", () => {
    const { container } = renderCard({ config: { command: "uvx" } });
    expect(container).toHaveTextContent("acp.command: uvx");
  });

  it("shows the not-set label when the command is empty", () => {
    const { container } = renderCard({ config: { command: "" } });
    expect(container).toHaveTextContent("acp.command: acp.notSet");
  });

  it("joins multiple args with a single space", () => {
    const { container } = renderCard({
      config: { args: ["--model", "gpt-x", "--verbose"] },
    });
    expect(container).toHaveTextContent("acp.args: --model gpt-x --verbose");
  });

  it("shows a single arg unchanged", () => {
    const { container } = renderCard({ config: { args: ["solo"] } });
    expect(container).toHaveTextContent("acp.args: solo");
  });

  it("shows the not-set label when args is empty", () => {
    const { container } = renderCard({ config: { args: [] } });
    expect(container).toHaveTextContent("acp.args: acp.notSet");
  });

  it("keeps an arg that is an empty string as a bare separator", () => {
    const { container } = renderCard({ config: { args: ["a", "", "b"] } });
    // toHaveTextContent normalises whitespace and would collapse the doubled
    // separator that an empty arg produces, so the exact text is compared here.
    const rows = Array.from(
      container.querySelectorAll(`.${styles.cardDescription}`),
    ).map((el) => el.textContent);
    expect(rows).toEqual([
      "acp.command: npx",
      `acp.args: ${["a", "", "b"].join(" ")}`,
    ]);
  });

  it("shows both fallbacks for a fully empty config", () => {
    const { container } = renderCard({ config: { command: "", args: [] } });
    expect(container).toHaveTextContent("acp.notSet");
  });
});

describe("ACPCard - click contract", () => {
  it("calls onClick once when the card is clicked", () => {
    const { onClick } = renderCard();
    fireEvent.click(screen.getByTestId("acp-card"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick on hover alone", () => {
    const { onClick } = renderCard();
    const card = screen.getByTestId("acp-card");
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pads the card body with the fixed 24px style", () => {
    renderCard();
    expect(screen.getByTestId("acp-card").style.padding).toBe("24px");
  });
});
