// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginType } from "@/api/modules/plugin";

// The shared icons stub (src/test/icons-mock.ts) does not export SparkWifiLine,
// which the "channel" arm of the type map renders. Without a local stub that
// arm resolves to an undefined element type and React throws while rendering.
vi.mock("@agentscope-ai/icons", () => ({
  SparkWifiLine: (props: Record<string, unknown>) => (
    <span data-icon="SparkWifiLine" {...props} />
  ),
}));

const t = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import { PluginTypeTag } from "./PluginTypeTag";

// Every plugin type the product declares, with the label and the antd color
// token each one is expected to render. antd maps the `color` prop onto an
// `ant-tag-<color>` class, so the class token is how the color is observable.
const TYPE_ROWS: Array<{
  type: PluginType;
  label: string;
  color: string;
}> = [
  { type: "tool", label: "Tool", color: "blue" },
  { type: "provider", label: "Provider", color: "purple" },
  { type: "hook", label: "Hook", color: "orange" },
  { type: "command", label: "Command", color: "cyan" },
  { type: "frontend", label: "Frontend", color: "green" },
  { type: "app", label: "App", color: "geekblue" },
  { type: "memory", label: "Memory", color: "purple" },
  { type: "general", label: "General", color: "default" },
];

function tagOf(container: HTMLElement) {
  const tag = container.querySelector(".ant-tag");
  if (!tag) throw new Error("expected an antd Tag to be rendered");
  return tag as HTMLElement;
}

describe("PluginTypeTag", () => {
  beforeEach(() => {
    t.mockReset();
    // Echo the key (plus any default value) so assertions can tell the
    // translated arm from the literal-label arm.
    t.mockImplementation((key: string, fallback?: unknown) =>
      fallback === undefined ? key : `${key}::${String(fallback)}`,
    );
  });

  it.each(TYPE_ROWS)(
    "renders the $label label for the $type type",
    ({ type, label }) => {
      const { container } = render(<PluginTypeTag type={type} />);
      const tag = tagOf(container);
      // Only the memory arm goes through i18n; every other type renders the
      // literal label from the type map.
      const expected =
        type === "memory" ? `pluginManager.typeMemory::${label}` : label;
      expect(tag.textContent).toBe(expected);
    },
  );

  it.each(TYPE_ROWS)(
    "colors the $type tag with the $color token",
    ({ type, color }) => {
      const { container } = render(<PluginTypeTag type={type} />);
      expect(tagOf(container).className).toContain(`ant-tag-${color}`);
    },
  );

  it("passes the literal label to i18n as the fallback for the memory type", () => {
    render(<PluginTypeTag type="memory" />);
    expect(t).toHaveBeenCalledWith("pluginManager.typeMemory", "Memory");
  });

  it.each(TYPE_ROWS.filter((row) => row.type !== "memory"))(
    "does not translate the $type label",
    ({ type }) => {
      render(<PluginTypeTag type={type} />);
      expect(t).not.toHaveBeenCalled();
    },
  );

  it("renders the channel icon through the icons package", () => {
    const { container } = render(<PluginTypeTag type="channel" />);
    expect(
      container.querySelector('[data-icon="SparkWifiLine"]'),
    ).not.toBeNull();
  });

  it.each(TYPE_ROWS.filter((row) => row.type !== "channel"))(
    "renders a lucide icon for the $type type",
    ({ type }) => {
      const { container } = render(<PluginTypeTag type={type} />);
      expect(tagOf(container).querySelector("svg")).not.toBeNull();
    },
  );

  it("falls back to the general config when the type is unknown", () => {
    const { container } = render(
      <PluginTypeTag type={"not-a-type" as unknown as PluginType} />,
    );
    const tag = tagOf(container);
    expect(tag.textContent).toBe("General");
    expect(tag.className).toContain("ant-tag-default");
    expect(t).not.toHaveBeenCalled();
  });

  it("renders an unknown memory-like type without translating it", () => {
    const { container } = render(
      <PluginTypeTag type={"MEMORY" as unknown as PluginType} />,
    );
    expect(tagOf(container).textContent).toBe("General");
    expect(t).not.toHaveBeenCalled();
  });
});
