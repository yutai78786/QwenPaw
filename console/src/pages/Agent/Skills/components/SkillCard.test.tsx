// @vitest-environment jsdom
/**
 * SkillCard tests — file/skill icon resolution for the two lookup layers
 * (skill-key set/switch, then extension switch), the emoji short-circuit in
 * getSkillVisual, and the card's user-visible behaviour: enabled/disabled
 * badge, builtin vs custom tag, preload tag, optional version / last-updated
 * rows, channel label mapping, tag chips vs placeholder, description
 * fallback, footer visibility (hover / batch / mobile) and click routing with
 * event-propagation guards.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// SkillCard calls dayjs(...).fromNow() but does not register the plugin
// itself — the app entry does it globally. Register it here so the
// last-updated row is exercised the same way it is at runtime.
dayjs.extend(relativeTime);

import { SkillCard, getFileIcon, getSkillVisual } from "./SkillCard";
import type { SkillSpec } from "../../../../api/types";

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
    CalendarFilled: make("CalendarFilled"),
    FileTextFilled: make("FileTextFilled"),
    FileZipFilled: make("FileZipFilled"),
    FilePdfFilled: make("FilePdfFilled"),
    FileWordFilled: make("FileWordFilled"),
    FileExcelFilled: make("FileExcelFilled"),
    FilePptFilled: make("FilePptFilled"),
    FileImageFilled: make("FileImageFilled"),
    CodeFilled: make("CodeFilled"),
    EyeOutlined: make("EyeOutlined"),
    EyeInvisibleOutlined: make("EyeInvisibleOutlined"),
  };
});

// The shared design stub does not export Card/Checkbox, so this suite provides
// its own: Card exposes the pointer handlers the component wires up, and
// Checkbox surfaces its checked state for batch-selection assertions.
vi.mock("@agentscope-ai/design", () => {
  const Card = ({ children, onClick, onMouseEnter, onMouseLeave }: any) => (
    <div
      data-testid="skill-card"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
  const Button = ({ children, onClick, disabled, danger }: any) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-danger={danger ? "true" : "false"}
    >
      {children}
    </button>
  );
  const Checkbox = ({ checked, onClick }: any) => (
    <input
      type="checkbox"
      data-testid="select-checkbox"
      checked={!!checked}
      onClick={onClick}
      readOnly
    />
  );
  const Tooltip = ({ children }: any) => <>{children}</>;
  return { Card, Button, Checkbox, Tooltip };
});

/** Render a pure icon element and report which stub icon it produced. */
function iconNameOf(element: React.ReactElement): string | null {
  const { container } = render(element);
  return (
    container.querySelector("span[data-icon]")?.getAttribute("data-icon") ??
    null
  );
}

function makeSkill(overrides: Partial<SkillSpec> = {}): SkillSpec {
  return {
    name: "news",
    description: "Reads the news",
    source: "customized",
    enabled: true,
    channels: ["all"],
    ...overrides,
  };
}

function renderCard(
  skill: SkillSpec,
  props: Partial<React.ComponentProps<typeof SkillCard>> = {},
) {
  return render(
    <SkillCard
      skill={skill}
      onClick={props.onClick ?? (() => {})}
      onToggleEnabled={props.onToggleEnabled ?? (() => {})}
      {...props}
    />,
  );
}

describe("getFileIcon", () => {
  it.each(["news", "file_reader", "browser", "guidance", "dingtalk_channel"])(
    "maps the well-known skill key %s to the text icon",
    (key) => {
      expect(iconNameOf(getFileIcon(key))).toBe("FileTextFilled");
    },
  );

  it("matches skill keys case-insensitively and on the first token only", () => {
    expect(iconNameOf(getFileIcon("  NEWS  daily digest "))).toBe(
      "FileTextFilled",
    );
    expect(iconNameOf(getFileIcon("Browser Automation"))).toBe(
      "FileTextFilled",
    );
  });

  it.each([
    ["docx", "FileWordFilled"],
    ["xlsx", "FileExcelFilled"],
    ["pptx", "FilePptFilled"],
    ["pdf", "FilePdfFilled"],
    ["cron", "CalendarFilled"],
  ])("maps the bare skill key %s to %s", (input, expected) => {
    expect(iconNameOf(getFileIcon(input))).toBe(expected);
  });

  it("falls through to the extension switch when the skill key is compound", () => {
    // normalizeSkillIconKey yields "my.file.docx", which misses the key switch
    // and is then resolved by its extension.
    expect(iconNameOf(getFileIcon("my.file.docx"))).toBe("FileWordFilled");
  });

  it.each([
    ["notes.txt", "FileTextFilled"],
    ["README.md", "FileTextFilled"],
    ["guide.markdown", "FileTextFilled"],
    ["bundle.zip", "FileZipFilled"],
    ["bundle.rar", "FileZipFilled"],
    ["bundle.7z", "FileZipFilled"],
    ["bundle.tar", "FileZipFilled"],
    ["archive.tar.gz", "FileZipFilled"],
    ["report.pdf", "FilePdfFilled"],
    ["letter.doc", "FileWordFilled"],
    ["sheet.xls", "FileExcelFilled"],
    ["deck.ppt", "FilePptFilled"],
    ["photo.JPG", "FileImageFilled"],
    ["photo.jpeg", "FileImageFilled"],
    ["photo.png", "FileImageFilled"],
    ["photo.gif", "FileImageFilled"],
    ["photo.svg", "FileImageFilled"],
    ["photo.webp", "FileImageFilled"],
    ["main.py", "CodeFilled"],
    ["main.js", "CodeFilled"],
    ["main.ts", "CodeFilled"],
    ["view.jsx", "CodeFilled"],
    ["view.tsx", "CodeFilled"],
    ["Main.java", "CodeFilled"],
    ["main.cpp", "CodeFilled"],
    ["main.c", "CodeFilled"],
    ["main.go", "CodeFilled"],
    ["main.rs", "CodeFilled"],
    ["main.rb", "CodeFilled"],
    ["index.php", "CodeFilled"],
  ])("maps extension of %s to %s", (input, expected) => {
    expect(iconNameOf(getFileIcon(input))).toBe(expected);
  });

  it("falls back to the text icon for unknown, empty and extension-less input", () => {
    expect(iconNameOf(getFileIcon("mystery.bin"))).toBe("FileTextFilled");
    expect(iconNameOf(getFileIcon(""))).toBe("FileTextFilled");
    expect(iconNameOf(getFileIcon("LICENSE"))).toBe("FileTextFilled");
  });
});

describe("getSkillVisual", () => {
  it("renders the emoji instead of an icon when one is set", () => {
    const { container } = render(getSkillVisual("news", "🚀"));
    expect(container.textContent).toBe("🚀");
    expect(container.querySelector("span[data-icon]")).toBeNull();
  });

  it("delegates to getFileIcon when emoji is absent or empty", () => {
    expect(iconNameOf(getSkillVisual("report.pdf"))).toBe("FilePdfFilled");
    expect(iconNameOf(getSkillVisual("report.pdf", ""))).toBe("FilePdfFilled");
  });
});

describe("SkillCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    window.innerWidth = 1024;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the enabled badge for an enabled skill", () => {
    renderCard(makeSkill({ enabled: true }));
    expect(screen.getByText("common.enabled")).toBeInTheDocument();
    expect(screen.queryByText("common.disabled")).toBeNull();
  });

  it("shows the disabled badge for a disabled skill", () => {
    renderCard(makeSkill({ enabled: false }));
    expect(screen.getByText("common.disabled")).toBeInTheDocument();
    expect(screen.queryByText("common.enabled")).toBeNull();
  });

  it.each([["builtin"], ["builtin:pack"], ["system"]])(
    "tags source %s as built-in",
    (source) => {
      renderCard(makeSkill({ source }));
      expect(screen.getByText("skills.builtin")).toBeInTheDocument();
      expect(screen.queryByText("skills.custom")).toBeNull();
    },
  );

  it("tags a customized source as custom", () => {
    renderCard(makeSkill({ source: "customized" }));
    expect(screen.getByText("skills.custom")).toBeInTheDocument();
    expect(screen.queryByText("skills.builtin")).toBeNull();
  });

  it("renders the preload tag only when the skill preloads", () => {
    const { rerender } = render(
      <SkillCard
        skill={makeSkill({ preload: true })}
        onClick={() => {}}
        onToggleEnabled={() => {}}
      />,
    );
    expect(screen.getByText("skills.preload")).toBeInTheDocument();
    rerender(
      <SkillCard
        skill={makeSkill({ preload: false })}
        onClick={() => {}}
        onToggleEnabled={() => {}}
      />,
    );
    expect(screen.queryByText("skills.preload")).toBeNull();
  });

  it("omits the version row when version_text is absent", () => {
    renderCard(makeSkill({ version_text: undefined }));
    expect(screen.queryByText("skillPool.version")).toBeNull();
  });

  it("shows the version row when version_text is set", () => {
    renderCard(makeSkill({ version_text: "1.2.3" }));
    expect(screen.getByText("skillPool.version")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
  });

  it("renders a relative last-updated value when the timestamp is present", () => {
    renderCard(makeSkill({ last_updated: "2025-12-31T00:00:00Z" }));
    expect(screen.getByText("skills.lastUpdated")).toBeInTheDocument();
    expect(screen.getByText("a day ago")).toBeInTheDocument();
  });

  it("omits the last-updated row when the timestamp is absent", () => {
    renderCard(makeSkill({ last_updated: undefined }));
    expect(screen.queryByText("skills.lastUpdated")).toBeNull();
  });

  it("labels the wildcard channel set through the all-channels key", () => {
    renderCard(makeSkill({ channels: ["all", "console"] }));
    expect(screen.getByText("skills.allChannels")).toBeInTheDocument();
  });

  it("labels an empty channel list as all channels", () => {
    renderCard(makeSkill({ channels: [] }));
    expect(screen.getByText("skills.allChannels")).toBeInTheDocument();
  });

  it("lists concrete channels verbatim, de-duplicated and comma joined", () => {
    renderCard(makeSkill({ channels: ["console", "dingtalk", "console"] }));
    expect(screen.getByText("console, dingtalk")).toBeInTheDocument();
  });

  it("prefers the supplied channel name mapper over raw keys", () => {
    renderCard(makeSkill({ channels: ["console", "dingtalk"] }), {
      getChannelName: (key: string) => `#${key}#`,
    });
    expect(screen.getByText("#console#, #dingtalk#")).toBeInTheDocument();
  });

  it("renders one chip per tag", () => {
    renderCard(makeSkill({ tags: ["alpha", "beta"] }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders a placeholder when there are no tags", () => {
    renderCard(makeSkill({ tags: [] }));
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("falls back to a placeholder when the description is empty", () => {
    renderCard(makeSkill({ description: "", tags: ["x"] }));
    // The description slot shows "-" while the tag chip shows "x".
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("shows the description text when present", () => {
    renderCard(makeSkill({ description: "Reads the news" }));
    expect(screen.getByText("Reads the news")).toBeInTheDocument();
  });

  it("hides the action footer on a desktop card that is not hovered", () => {
    renderCard(makeSkill());
    expect(screen.queryByText("common.disable")).toBeNull();
    expect(screen.queryByText("common.delete")).toBeNull();
  });

  it("reveals the footer on hover and hides it again on leave", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    renderCard(makeSkill(), { onMouseEnter, onMouseLeave });
    const card = screen.getByTestId("skill-card");

    fireEvent.mouseEnter(card);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(screen.getByText("common.disable")).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("common.disable")).toBeNull();
  });

  it("offers enable instead of disable for a disabled skill", () => {
    renderCard(makeSkill({ enabled: false }), { selected: false });
    expect(screen.getByText("common.enable")).toBeInTheDocument();
    expect(screen.queryByText("common.disable")).toBeNull();
  });

  it("shows the delete action only when a delete handler is supplied", () => {
    const withDelete = renderCard(makeSkill({ enabled: true }), {
      selected: false,
      onDelete: () => {},
    });
    expect(screen.getByText("common.delete")).toBeInTheDocument();
    withDelete.unmount();

    renderCard(makeSkill({ enabled: true }), { selected: false });
    expect(screen.queryByText("common.delete")).toBeNull();
  });

  it("always shows the footer in batch mode and disables both actions", () => {
    renderCard(makeSkill(), { selected: false, onDelete: () => {} });
    expect(screen.getByTestId("select-checkbox")).toBeInTheDocument();
    expect(screen.getByText("common.disable").closest("button")).toBeDisabled();
    expect(screen.getByText("common.delete").closest("button")).toBeDisabled();
  });

  it("marks the checkbox as checked for a selected card in batch mode", () => {
    renderCard(makeSkill(), { selected: true });
    expect(screen.getByTestId("select-checkbox")).toBeChecked();
  });

  it("reveals the footer on a narrow viewport without hovering", () => {
    window.innerWidth = 600;
    renderCard(makeSkill());
    expect(screen.getByText("common.disable")).toBeInTheDocument();
  });

  it("tracks viewport changes across the mobile breakpoint", () => {
    renderCard(makeSkill());
    expect(screen.queryByText("common.disable")).toBeNull();

    window.innerWidth = 500;
    fireEvent(window, new Event("resize"));
    expect(screen.getByText("common.disable")).toBeInTheDocument();

    window.innerWidth = 1200;
    fireEvent(window, new Event("resize"));
    expect(screen.queryByText("common.disable")).toBeNull();
  });

  it("opens the skill when the card is clicked outside batch mode", () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    renderCard(makeSkill(), { onClick, onSelect });
    fireEvent.click(screen.getByTestId("skill-card"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("routes the card click to selection while in batch mode", () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    renderCard(makeSkill(), { onClick, onSelect, selected: false });
    fireEvent.click(screen.getByTestId("skill-card"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("still opens the skill in batch mode when no select handler is given", () => {
    const onClick = vi.fn();
    renderCard(makeSkill(), { onClick, selected: false });
    fireEvent.click(screen.getByTestId("skill-card"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // The footer is revealed by hover here rather than by batch mode: batch mode
  // renders both actions disabled, so their handlers must not fire.
  it("toggles enablement without opening the skill", () => {
    const onClick = vi.fn();
    const onToggleEnabled = vi.fn();
    renderCard(makeSkill(), { onClick, onToggleEnabled });
    fireEvent.mouseEnter(screen.getByTestId("skill-card"));
    fireEvent.click(screen.getByText("common.disable").closest("button")!);
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("deletes without opening the skill", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    renderCard(makeSkill(), { onClick, onDelete });
    fireEvent.mouseEnter(screen.getByTestId("skill-card"));
    fireEvent.click(screen.getByText("common.delete").closest("button")!);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("selects via the checkbox without opening the skill", () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    renderCard(makeSkill(), { onClick, onSelect, selected: false });
    fireEvent.click(screen.getByTestId("select-checkbox"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the skill name and its emoji-free icon", () => {
    const { container } = renderCard(
      makeSkill({ name: "report.pdf", source: "customized" }),
    );
    const card = screen.getByTestId("skill-card");
    expect(within(card).getByText(/report\.pdf/)).toBeInTheDocument();
    expect(
      container.querySelector('span[data-icon="FilePdfFilled"]'),
    ).not.toBeNull();
  });
});
