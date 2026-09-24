/**
 * MCPClientCard - one entry of the Agent > MCP client list. The card stands
 * for a single MCP server (a local stdio command or a remote HTTP/SSE
 * endpoint), shows its enabled state and its OAuth state, and owns the four
 * entry points hanging off it: the access-policy editor, the raw JSON
 * configuration editor, the enable/disable toggle and the delete
 * confirmation.
 *
 * What this file pins:
 *   1. the derived transport facts: `streamable_http` and `sse` both mean
 *      "Remote" and both add the third action slot (the OAuth button), while
 *      any other transport means "Local", drops that button and uses the
 *      two-slot footer;
 *   2. the OAuth shield matrix in the header, which is three mutually
 *      exclusive arms plus "no OAuth at all": authorized and not yet expired
 *      (ShieldCheck), authorized but expired (ShieldAlert), present but not
 *      authorized (ShieldX), and `oauth_status === null` (no shield at all).
 *      The expiry comparison is `expires_at <= now`, so an expiry exactly
 *      equal to "now" is already the expired arm - that boundary is pinned;
 *   3. the enabled state driving three things at once: the status text, the
 *      `enabledCard` class and the toggle button's icon + label
 *      (eye-invisible/disable vs eye/enable);
 *   4. the description falling back to a single hyphen for an empty string;
 *   5. hover moving the card class between `hover` and `normal`;
 *   6. the JSON editor: clicking the card body opens it read-only with the
 *      client pretty-printed at two-space indent, `edit` swaps the `<pre>` for
 *      a textarea seeded with that same text, `save` strips the `key` field
 *      before calling `onUpdate` (the key is the identity, it must never be
 *      part of the update payload), success closes the dialog and returns it
 *      to read-only, a rejected save keeps it open in edit mode, and invalid
 *      JSON alerts instead of calling `onUpdate` at all;
 *   7. every action button calls `stopPropagation`, so none of them may open
 *      the JSON editor - paired with the positive control that clicking the
 *      card body itself does open it (without that control the negative
 *      assertion would pass even if propagation handling were removed);
 *   8. the delete confirmation: its whole option bag (title, body, ok/cancel
 *      labels and the danger flag on the ok button), that confirming calls
 *      `onDelete(client, null)`, and that cancelling leaves `onDelete`
 *      untouched;
 *   9. the OAuth button's three visual arms (label, icon and inline colour)
 *      and that the OAuth dialog forwards the whole controlled-parameter set
 *      to MCPOAuthSection, seeds `scope` from `oauth_status.scope` (or an
 *      empty string when there is no OAuth status), re-renders when any of the
 *      four setters fires, and calls the optional `onRefresh` from
 *      `onAuthChanged` without throwing when it is absent;
 *  10. the access-policy dialog wiring: `onClose` hides it and `onSave`
 *      forwards to `onUpdatePolicy` under the card's own client key;
 *  11. the read-only `<pre>` switching its palette with the theme.
 *
 * Stubbing facts, all probed rather than assumed:
 *   - the global @agentscope-ai/design stub does NOT export `Card` at all
 *     (its export list is Button/Dropdown/Form/IconButton/Input/InputNumber/
 *     Modal/Spin/Switch/Tabs/Tag/Tooltip), so a bare import would render
 *     nothing; this file overrides the module with importActual and supplies
 *     Card, Button, Tooltip, Modal and Input.TextArea. The overridden Modal
 *     renders the real antd contract this card relies on: `title`, `children`
 *     and a caller-supplied `footer` when one is given, otherwise a default
 *     ok/cancel pair honouring `okButtonProps.danger`; it also renders a close
 *     affordance wired to `onCancel`, because two of the three dialogs pass a
 *     custom footer and their `onCancel` is therefore only reachable through
 *     it (in the real library that is the corner close icon / mask click).
 *   - `@ant-design/icons` and `lucide-react` are deliberately NOT mocked: both
 *     resolve to the real packages here and render real markup
 *     (`.anticon-tool`, `.anticon-eye-invisible`,
 *     `svg.lucide-shield-check`, `svg.lucide-shield-alert`,
 *     `svg.lucide-shield-x`, `svg.lucide-key-round`), so "which icon is on
 *     screen" is a real assertion rather than a tautology about a stub.
 *   - MCPAccessModal and MCPOAuthSection are stubbed with their props
 *     captured: both are covered by their own files, and what this card owns
 *     is only the wiring (open/close state and which callback receives what).
 *   - CSS module class names are asserted through the imported `styles`
 *     object (the same technique as ACPCard.test.tsx), never as literals: the
 *     generated form is `_<name>_<hash>`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { type ComponentProps } from "react";
import styles from "../index.module.less";
import type { MCPAccessPolicy, MCPClientInfo } from "../../../../api/types";

const h = vi.hoisted(() => ({
  isDark: { current: false },
  accessProps: { current: null as Record<string, unknown> | null },
  oauthProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("../../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: h.isDark.current }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
  }),
}));

vi.mock("./MCPAccessModal", () => ({
  MCPAccessModal: (props: Record<string, unknown>) => {
    h.accessProps.current = props;
    return React.createElement("div", {
      "data-testid": "access-modal",
      "data-open": String(props.open),
    });
  },
}));

vi.mock("./MCPOAuthSection", () => ({
  MCPOAuthSection: (props: Record<string, unknown>) => {
    h.oauthProps.current = props;
    return React.createElement("div", {
      "data-testid": "oauth-section",
      "data-scope": String(props.scope),
      "data-client-id": String(props.clientId),
      "data-auth-endpoint": String(props.authEndpoint),
      "data-token-endpoint": String(props.tokenEndpoint),
    });
  },
}));

vi.mock("@agentscope-ai/design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agentscope-ai/design",
  );

  const Card = ({
    children,
    className,
    onClick,
    onMouseEnter,
    onMouseLeave,
    hoverable,
  }: {
    children?: React.ReactNode;
    className?: string;
    onClick?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    hoverable?: boolean;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "design-card",
        className,
        onClick,
        onMouseEnter,
        onMouseLeave,
        "data-hoverable": hoverable ? "true" : undefined,
      },
      children,
    );

  const Button = ({
    children,
    onClick,
    icon,
    className,
    style,
    danger,
    type,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    icon?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    danger?: boolean;
    type?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      "button",
      {
        onClick,
        className,
        style,
        disabled,
        "data-danger": danger ? "true" : undefined,
        "data-btn-type": type,
      },
      icon,
      children,
    );

  const Tooltip = ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: React.ReactNode;
  }) => React.createElement("span", { "data-tooltip-title": title }, children);

  const Input = Object.assign(
    (props: Record<string, unknown>) =>
      React.createElement("input", props as never),
    {
      TextArea: ({
        value,
        onChange,
        style,
      }: {
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
        style?: React.CSSProperties;
      }) =>
        React.createElement("textarea", {
          "data-testid": "json-editor",
          value,
          onChange,
          style,
        }),
    },
  );

  const Modal = ({
    open,
    title,
    children,
    footer,
    onOk,
    onCancel,
    okText,
    cancelText,
    okButtonProps,
    width,
  }: {
    open?: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
    okText?: React.ReactNode;
    cancelText?: React.ReactNode;
    okButtonProps?: { danger?: boolean };
    width?: number;
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "design-modal", "data-modal-width": String(width) },
          React.createElement("div", { "data-testid": "modal-title" }, title),
          React.createElement(
            "button",
            { "data-testid": "modal-close-x", onClick: onCancel },
            "x",
          ),
          React.createElement("div", { "data-testid": "modal-body" }, children),
          footer !== undefined
            ? React.createElement(
                "div",
                { "data-testid": "modal-footer" },
                footer,
              )
            : React.createElement(
                "div",
                { "data-testid": "modal-default-footer" },
                React.createElement(
                  "button",
                  {
                    "data-testid": "modal-ok",
                    onClick: onOk,
                    "data-ok-danger": okButtonProps?.danger
                      ? "true"
                      : undefined,
                  },
                  okText,
                ),
                React.createElement(
                  "button",
                  { "data-testid": "modal-cancel", onClick: onCancel },
                  cancelText,
                ),
              ),
        )
      : null;

  return { ...actual, Card, Button, Tooltip, Input, Modal };
});

import { MCPClientCard } from "./MCPClientCard";

/** Fixed wall clock: the card derives OAuth state from `Date.now() / 1000`. */
const NOW_S = 1_800_000_000;
const FUTURE = NOW_S + 3600;
const PAST = NOW_S - 1;

const EM_DASH = "\u2014";

function makeClient(overrides: Partial<MCPClientInfo> = {}): MCPClientInfo {
  return {
    key: "cursor",
    name: "Cursor",
    description: "Cursor IDE integration",
    enabled: true,
    transport: "streamable_http",
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer t" },
    command: "",
    args: [],
    env: {},
    cwd: "",
    http_timeout: null,
    tools: null,
    oauth_status: {
      authorized: true,
      expires_at: FUTURE,
      scope: "read write",
      client_id: "cid-1",
    },
    access_summary: { default_effect: "ask", overrides_count: 2 },
    ...overrides,
  };
}

/** The component's own prop types: the handlers must match them exactly. */
type CardProps = ComponentProps<typeof MCPClientCard>;

type Handlers = {
  onToggle: ReturnType<typeof vi.fn<CardProps["onToggle"]>>;
  onDelete: ReturnType<typeof vi.fn<CardProps["onDelete"]>>;
  onUpdate: ReturnType<typeof vi.fn<CardProps["onUpdate"]>>;
  onUpdatePolicy: ReturnType<typeof vi.fn<CardProps["onUpdatePolicy"]>>;
  onRefresh?: ReturnType<typeof vi.fn<NonNullable<CardProps["onRefresh"]>>>;
};

function renderCard(
  client: MCPClientInfo = makeClient(),
  handlers: Partial<Handlers> = {},
) {
  const h2: Handlers = {
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onUpdate: vi.fn(async () => true),
    onUpdatePolicy: vi.fn(async () => true),
    ...handlers,
  };
  const utils = render(
    <MCPClientCard client={client} {...h2} onRefresh={h2.onRefresh} />,
  );
  return { ...utils, handlers: h2, client };
}

function card(): HTMLElement {
  return screen.getByTestId("design-card");
}

function cardClasses(): string[] {
  return Array.from(card().classList);
}

/** The single open dialog, or null when every dialog is closed. */
function openModal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="design-modal"]');
}

function modalTitleText(): string {
  return (screen.queryByTestId("modal-title")?.textContent ?? "").trim();
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one button labelled ${label}, found ${found.length}`,
    );
  }
  return found[0] as HTMLButtonElement;
}

function lucide(name: string): Element | null {
  return document.querySelector(`svg.lucide-${name}`);
}

function anticon(name: string): Element | null {
  return document.querySelector(`.anticon-${name}`);
}

function tooltipTitles(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-tooltip-title]"),
  ).map((n) => n.getAttribute("data-tooltip-title") ?? "");
}

beforeEach(() => {
  h.isDark.current = false;
  h.accessProps.current = null;
  h.oauthProps.current = null;
  vi.spyOn(Date, "now").mockReturnValue(NOW_S * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transport derivation and the type badge", () => {
  it("labels a streamable_http client Remote and gives it the three-slot footer", () => {
    renderCard(makeClient({ transport: "streamable_http" }));
    const badge = document.querySelector(`.${styles.typeBadge}`);
    expect(badge?.textContent).toBe("Remote");
    expect(Array.from(badge!.classList)).toContain(styles.remote);
    const row = document.querySelector(`.${styles.cardSecondaryActions}`);
    expect(Array.from(row!.classList)).toContain(
      styles.cardSecondaryActionsThree,
    );
  });

  it("labels an sse client Remote too", () => {
    renderCard(makeClient({ transport: "sse" }));
    expect(document.querySelector(`.${styles.typeBadge}`)?.textContent).toBe(
      "Remote",
    );
    expect(
      Array.from(
        document.querySelector(`.${styles.cardSecondaryActions}`)!.classList,
      ),
    ).toContain(styles.cardSecondaryActionsThree);
  });

  it("labels a stdio client Local and drops the OAuth button", () => {
    renderCard(makeClient({ transport: "stdio" }));
    const badge = document.querySelector(`.${styles.typeBadge}`);
    expect(badge?.textContent).toBe("Local");
    expect(Array.from(badge!.classList)).toContain(styles.local);
    const row = document.querySelector(`.${styles.cardSecondaryActions}`);
    expect(Array.from(row!.classList)).toContain(
      styles.cardSecondaryActionsTwo,
    );
    expect(screen.queryByText("mcp.oauth.authorized")).toBeNull();
    expect(screen.queryByText("mcp.oauth.authorize")).toBeNull();
  });
});

describe("the OAuth shield matrix in the header", () => {
  it("shows ShieldCheck with the authorized tooltip while the token is valid", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: FUTURE,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(lucide("shield-check")).toBeTruthy();
    expect(lucide("shield-alert")).toBeNull();
    expect(lucide("shield-x")).toBeNull();
    expect(tooltipTitles()).toContain("mcp.oauth.authorized");
  });

  it("shows ShieldAlert with the expired tooltip once the token is past due", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: PAST,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(lucide("shield-alert")).toBeTruthy();
    expect(lucide("shield-check")).toBeNull();
    expect(tooltipTitles()).toContain("mcp.oauth.expired");
  });

  it("treats an expiry exactly equal to now as already expired", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: NOW_S,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(lucide("shield-alert")).toBeTruthy();
    expect(lucide("shield-check")).toBeNull();
    expect(tooltipTitles()).toContain("mcp.oauth.expired");
  });

  it("shows ShieldX with the not-authorized tooltip when authorized is false", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: false,
          expires_at: FUTURE,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(lucide("shield-x")).toBeTruthy();
    expect(lucide("shield-check")).toBeNull();
    expect(lucide("shield-alert")).toBeNull();
    expect(tooltipTitles()).toContain("mcp.oauth.notAuthorized");
  });

  it("shows no shield at all when oauth_status is null", () => {
    renderCard(makeClient({ oauth_status: null }));
    expect(lucide("shield-check")).toBeNull();
    expect(lucide("shield-alert")).toBeNull();
    expect(lucide("shield-x")).toBeNull();
    expect(tooltipTitles()).toEqual(["Cursor"]);
  });
});

describe("the enabled state", () => {
  it("reports enabled, adds the enabled class and offers to disable", () => {
    renderCard(makeClient({ enabled: true }));
    expect(document.querySelector(`.${styles.statusText}`)?.textContent).toBe(
      "common.enabled",
    );
    expect(cardClasses()).toContain(styles.enabledCard);
    expect(anticon("eye-invisible")).toBeTruthy();
    expect(anticon("eye")).toBeNull();
    expect(buttonByLabel("common.disable")).toBeTruthy();
  });

  it("reports disabled, omits the enabled class and offers to enable", () => {
    renderCard(makeClient({ enabled: false }));
    expect(document.querySelector(`.${styles.statusText}`)?.textContent).toBe(
      "common.disabled",
    );
    expect(cardClasses()).not.toContain(styles.enabledCard);
    expect(anticon("eye")).toBeTruthy();
    expect(anticon("eye-invisible")).toBeNull();
    expect(buttonByLabel("common.enable")).toBeTruthy();
  });

  it("marks the card hoverable and keeps the base class in both states", () => {
    renderCard(makeClient({ enabled: false }));
    expect(card().getAttribute("data-hoverable")).toBe("true");
    expect(cardClasses()).toContain(styles.mcpCard);
  });
});

describe("the description line", () => {
  it("renders the description when there is one", () => {
    renderCard(makeClient({ description: "Cursor IDE integration" }));
    expect(
      document.querySelector(`.${styles.mcpDescription}`)?.textContent,
    ).toBe("Cursor IDE integration");
  });

  it("falls back to a single hyphen for an empty description", () => {
    renderCard(makeClient({ description: "" }));
    expect(
      document.querySelector(`.${styles.mcpDescription}`)?.textContent,
    ).toBe("-");
  });
});

describe("hover state", () => {
  it("swaps the normal class for the hover class on mouse enter", () => {
    renderCard();
    expect(cardClasses()).toContain(styles.normal);
    act(() => {
      fireEvent.mouseEnter(card());
    });
    expect(cardClasses()).toContain(styles.hover);
    expect(cardClasses()).not.toContain(styles.normal);
  });

  it("swaps back to the normal class on mouse leave", () => {
    renderCard();
    act(() => {
      fireEvent.mouseEnter(card());
      fireEvent.mouseLeave(card());
    });
    expect(cardClasses()).toContain(styles.normal);
    expect(cardClasses()).not.toContain(styles.hover);
  });
});

describe("the JSON configuration dialog", () => {
  function openJsonDialog(
    client: MCPClientInfo = makeClient(),
    handlers: Partial<Handlers> = {},
  ) {
    const ctx = renderCard(client, handlers);
    act(() => {
      fireEvent.click(card());
    });
    return ctx;
  }

  it("opens read-only with the client pretty-printed at two-space indent", () => {
    const client = openJsonDialog().client;
    expect(modalTitleText()).toBe(`${client.name} - Configuration`);
    expect(openModal()?.getAttribute("data-modal-width")).toBe("700");
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toBe(JSON.stringify(client, null, 2));
    expect(screen.queryByTestId("json-editor")).toBeNull();
    expect(screen.queryByText("common.save")).toBeNull();
    expect(buttonByLabel("common.edit")).toBeTruthy();
    expect(
      document.querySelector(`.${styles.maskedFieldHint}`)?.textContent,
    ).toBe("mcp.maskedFieldHint");
  });

  it("closes from the footer cancel button", () => {
    openJsonDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.cancel"));
    });
    expect(openModal()).toBeNull();
  });

  it("closes from the dialog's own cancel affordance", () => {
    openJsonDialog();
    act(() => {
      fireEvent.click(screen.getByTestId("modal-close-x"));
    });
    expect(openModal()).toBeNull();
  });

  it("seeds the textarea with the same text when edit is pressed", () => {
    const client = openJsonDialog().client;
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
    expect(editor.value).toBe(JSON.stringify(client, null, 2));
    expect(document.querySelector("pre")).toBeNull();
    expect(buttonByLabel("common.save")).toBeTruthy();
    expect(screen.queryByText("common.edit")).toBeNull();
  });

  it("tracks edits in the textarea", () => {
    openJsonDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    const editor = screen.getByTestId("json-editor");
    act(() => {
      fireEvent.change(editor, { target: { value: '{"name":"renamed"}' } });
    });
    expect((editor as HTMLTextAreaElement).value).toBe('{"name":"renamed"}');
  });

  it("sends every field except the key and closes on success", async () => {
    const { handlers, client } = openJsonDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    act(() => {
      fireEvent.change(screen.getByTestId("json-editor"), {
        target: { value: JSON.stringify({ ...client, name: "renamed" }) },
      });
    });
    await act(async () => {
      fireEvent.click(buttonByLabel("common.save"));
    });
    await waitFor(() => expect(handlers.onUpdate).toHaveBeenCalledTimes(1));
    const [key, updates] = handlers.onUpdate.mock.calls[0];
    expect(key).toBe("cursor");
    expect(updates).not.toHaveProperty("key");
    expect(updates.name).toBe("renamed");
    expect(updates.transport).toBe("streamable_http");
    await waitFor(() => expect(openModal()).toBeNull());
  });

  it("returns to read-only when the dialog is reopened after a successful save", async () => {
    const { handlers } = openJsonDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    await act(async () => {
      fireEvent.click(buttonByLabel("common.save"));
    });
    await waitFor(() => expect(handlers.onUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openModal()).toBeNull());
    act(() => {
      fireEvent.click(card());
    });
    expect(document.querySelector("pre")).toBeTruthy();
    expect(screen.queryByTestId("json-editor")).toBeNull();
    expect(buttonByLabel("common.edit")).toBeTruthy();
  });

  it("stays open in edit mode when the update is rejected", async () => {
    const { handlers } = openJsonDialog(makeClient(), {
      onUpdate: vi.fn(async () => false),
    });
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    await act(async () => {
      fireEvent.click(buttonByLabel("common.save"));
    });
    await waitFor(() => expect(handlers.onUpdate).toHaveBeenCalledTimes(1));
    expect(openModal()).toBeTruthy();
    expect(screen.getByTestId("json-editor")).toBeTruthy();
    expect(buttonByLabel("common.save")).toBeTruthy();
  });

  it("alerts on invalid JSON and never calls onUpdate", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { handlers } = openJsonDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.edit"));
    });
    act(() => {
      fireEvent.change(screen.getByTestId("json-editor"), {
        target: { value: "{ not json" },
      });
    });
    await act(async () => {
      fireEvent.click(buttonByLabel("common.save"));
    });
    expect(alertSpy).toHaveBeenCalledWith("Invalid JSON format");
    expect(handlers.onUpdate).not.toHaveBeenCalled();
    expect(openModal()).toBeTruthy();
    expect(screen.getByTestId("json-editor")).toBeTruthy();
  });

  it("paints the read-only block with the light palette by default", () => {
    openJsonDialog();
    const pre = document.querySelector("pre") as HTMLElement;
    expect(pre.style.backgroundColor).toBe("rgb(245, 245, 245)");
    expect(pre.style.color).toBe("rgba(0, 0, 0, 0.88)");
  });

  it("paints the read-only block with the theme variables in dark mode", () => {
    h.isDark.current = true;
    openJsonDialog();
    const pre = document.querySelector("pre") as HTMLElement;
    expect(pre.style.backgroundColor).toBe("var(--app-surface)");
    expect(pre.style.color).toBe("var(--app-text)");
  });
});

describe("action buttons must not open the JSON dialog", () => {
  it("opens the access-policy editor from the tools button", () => {
    renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("mcp.tools"));
    });
    expect(h.accessProps.current?.open).toBe(true);
    expect(anticon("tool")).toBeTruthy();
    expect(openModal()).toBeNull();
  });

  it("calls onToggle with the client and the click event", () => {
    const { handlers, client } = renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("common.disable"));
    });
    expect(handlers.onToggle).toHaveBeenCalledTimes(1);
    const [gotClient, gotEvent] = handlers.onToggle.mock.calls[0];
    expect(gotClient).toBe(client);
    expect(gotEvent.type).toBe("click");
    expect(openModal()).toBeNull();
  });

  it("opens the delete confirmation from the danger button", () => {
    renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("common.delete"));
    });
    expect(modalTitleText()).toBe("common.confirm");
    expect(screen.getByText("mcp.deleteConfirm")).toBeTruthy();
    const ok = screen.getByTestId("modal-ok");
    expect(ok.textContent).toBe("common.confirm");
    expect(ok.getAttribute("data-ok-danger")).toBe("true");
    expect(screen.getByTestId("modal-cancel").textContent).toBe(
      "common.cancel",
    );
    expect(buttonByLabel("common.delete").getAttribute("data-danger")).toBe(
      "true",
    );
    expect(openModal()).toBeTruthy();
  });

  it("opens the OAuth dialog from the OAuth button on a remote client", () => {
    renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("mcp.oauth.authorized"));
    });
    expect(screen.getByTestId("oauth-section")).toBeTruthy();
    expect(openModal()?.getAttribute("data-modal-width")).toBe("560");
  });

  it("does open the JSON dialog when the card body itself is clicked", () => {
    renderCard();
    expect(openModal()).toBeNull();
    act(() => {
      fireEvent.click(card());
    });
    expect(openModal()).toBeTruthy();
    expect(modalTitleText()).toBe("Cursor - Configuration");
  });
});

describe("the delete confirmation flow", () => {
  it("calls onDelete with the client and a null event on confirm", () => {
    const { handlers, client } = renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("common.delete"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("modal-ok"));
    });
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledWith(client, null);
    expect(openModal()).toBeNull();
  });

  it("leaves onDelete untouched when the dialog is cancelled", () => {
    const { handlers } = renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("common.delete"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("modal-cancel"));
    });
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(openModal()).toBeNull();
  });

  it("leaves onDelete untouched when the dialog is dismissed", () => {
    const { handlers } = renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("common.delete"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("modal-close-x"));
    });
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(openModal()).toBeNull();
  });
});

describe("the access-policy dialog wiring", () => {
  it("hides itself through onClose", () => {
    renderCard();
    act(() => {
      fireEvent.click(buttonByLabel("mcp.tools"));
    });
    expect(h.accessProps.current?.open).toBe(true);
    act(() => {
      (h.accessProps.current?.onClose as () => void)();
    });
    expect(h.accessProps.current?.open).toBe(false);
  });

  it("forwards onSave to onUpdatePolicy under this card's client key", async () => {
    const { handlers } = renderCard(makeClient({ key: "claude-desktop" }));
    act(() => {
      fireEvent.click(buttonByLabel("mcp.tools"));
    });
    const policy = {
      default_effect: "deny",
      client_overrides: [],
      tool_defaults: [],
      tool_overrides: [],
      unmanaged_rules_count: 0,
    } as MCPAccessPolicy;
    await act(async () => {
      await (h.accessProps.current?.onSave as (p: MCPAccessPolicy) => unknown)(
        policy,
      );
    });
    expect(handlers.onUpdatePolicy).toHaveBeenCalledWith(
      "claude-desktop",
      policy,
    );
  });

  it("always passes the client object it was rendered with", () => {
    const client = makeClient({ key: "k", name: "n" });
    renderCard(client);
    expect(h.accessProps.current?.client).toBe(client);
  });
});

describe("the OAuth button's three visual arms", () => {
  it("reads authorized with a green ShieldCheck while the token is valid", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: FUTURE,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    const btn = buttonByLabel("mcp.oauth.authorized");
    expect(btn.querySelector("svg.lucide-shield-check")).toBeTruthy();
    expect(btn.style.color).toBe("rgb(39, 174, 96)");
    expect(btn.style.borderColor).toBe("rgb(39, 174, 96)");
    expect(btn.style.background).toMatch(/39,\s*174,\s*96/);
  });

  it("reads expired with an orange ShieldAlert once the token is past due", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: PAST,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    const btn = buttonByLabel("mcp.oauth.expired");
    expect(btn.querySelector("svg.lucide-shield-alert")).toBeTruthy();
    expect(btn.style.color).toBe("rgb(230, 126, 34)");
    expect(btn.style.borderColor).toBe("rgb(230, 126, 34)");
    expect(btn.style.background).toMatch(/230,\s*126,\s*34/);
  });

  it("reads authorize with a KeyRound icon and no inline colour when unauthorized", () => {
    renderCard(
      makeClient({
        oauth_status: {
          authorized: false,
          expires_at: FUTURE,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    const btn = buttonByLabel("mcp.oauth.authorize");
    expect(btn.querySelector("svg.lucide-key-round")).toBeTruthy();
    expect(btn.getAttribute("style")).toBeNull();
  });
});

describe("the OAuth management dialog", () => {
  function openOauthDialog(
    client: MCPClientInfo = makeClient(),
    handlers: Partial<Handlers> = {},
  ) {
    const label = client.oauth_status?.authorized
      ? client.oauth_status.expires_at > NOW_S
        ? "mcp.oauth.authorized"
        : "mcp.oauth.expired"
      : "mcp.oauth.authorize";
    const ctx = renderCard(client, handlers);
    act(() => {
      fireEvent.click(buttonByLabel(label));
    });
    return ctx;
  }

  it("titles itself with the client name, an em dash and the manage key", () => {
    openOauthDialog();
    expect(modalTitleText()).toBe(`Cursor ${EM_DASH} mcp.oauth.manage`);
  });

  it("carries the authorized shield in its title", () => {
    openOauthDialog();
    expect(
      screen
        .getByTestId("modal-title")
        .querySelector("svg.lucide-shield-check"),
    ).toBeTruthy();
  });

  it("carries the expired shield in its title", () => {
    openOauthDialog(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: PAST,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(
      screen
        .getByTestId("modal-title")
        .querySelector("svg.lucide-shield-alert"),
    ).toBeTruthy();
  });

  it("carries the unauthorized shield in its title", () => {
    openOauthDialog(
      makeClient({
        oauth_status: {
          authorized: false,
          expires_at: FUTURE,
          scope: "s",
          client_id: "c",
        },
      }),
    );
    expect(
      screen.getByTestId("modal-title").querySelector("svg.lucide-shield-x"),
    ).toBeTruthy();
  });

  it("carries the unauthorized shield in its title when there is no OAuth status", () => {
    openOauthDialog(makeClient({ oauth_status: null }));
    expect(
      screen.getByTestId("modal-title").querySelector("svg.lucide-shield-x"),
    ).toBeTruthy();
  });

  it("forwards the endpoint, the client key and the current status", () => {
    const client = makeClient({ key: "remote-1", url: "https://a/b" });
    openOauthDialog(client);
    expect(h.oauthProps.current?.url).toBe("https://a/b");
    expect(h.oauthProps.current?.clientKey).toBe("remote-1");
    expect(h.oauthProps.current?.oauthEnabled).toBe(true);
    expect(h.oauthProps.current?.currentOAuthStatus).toBe(client.oauth_status);
  });

  it("seeds the scope from the stored OAuth status and leaves the rest blank", () => {
    openOauthDialog(
      makeClient({
        oauth_status: {
          authorized: true,
          expires_at: FUTURE,
          scope: "profile email",
          client_id: "c",
        },
      }),
    );
    expect(screen.getByTestId("oauth-section").getAttribute("data-scope")).toBe(
      "profile email",
    );
    expect(
      screen.getByTestId("oauth-section").getAttribute("data-client-id"),
    ).toBe("");
    expect(
      screen.getByTestId("oauth-section").getAttribute("data-auth-endpoint"),
    ).toBe("");
    expect(
      screen.getByTestId("oauth-section").getAttribute("data-token-endpoint"),
    ).toBe("");
  });

  it("seeds an empty scope when there is no OAuth status", () => {
    openOauthDialog(makeClient({ oauth_status: null }));
    expect(screen.getByTestId("oauth-section").getAttribute("data-scope")).toBe(
      "",
    );
    expect(h.oauthProps.current?.currentOAuthStatus).toBeNull();
  });

  it("re-renders the section when each controlled setter fires", () => {
    openOauthDialog();
    const section = () => screen.getByTestId("oauth-section");
    act(() => {
      (h.oauthProps.current?.onClientIdChange as (v: string) => void)("cid-9");
    });
    expect(section().getAttribute("data-client-id")).toBe("cid-9");
    act(() => {
      (h.oauthProps.current?.onScopeChange as (v: string) => void)("all");
    });
    expect(section().getAttribute("data-scope")).toBe("all");
    act(() => {
      (h.oauthProps.current?.onAuthEndpointChange as (v: string) => void)(
        "https://auth",
      );
    });
    expect(section().getAttribute("data-auth-endpoint")).toBe("https://auth");
    act(() => {
      (h.oauthProps.current?.onTokenEndpointChange as (v: string) => void)(
        "https://token",
      );
    });
    expect(section().getAttribute("data-token-endpoint")).toBe("https://token");
  });

  it("calls the optional onRefresh when the auth state changes", () => {
    const onRefresh = vi.fn(async () => {});
    openOauthDialog(makeClient(), { onRefresh });
    act(() => {
      (h.oauthProps.current?.onAuthChanged as () => void)();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onAuthChanged fires without an onRefresh", () => {
    openOauthDialog(makeClient(), { onRefresh: undefined });
    expect(() =>
      act(() => {
        (h.oauthProps.current?.onAuthChanged as () => void)();
      }),
    ).not.toThrow();
  });

  it("closes from the footer close button", () => {
    openOauthDialog();
    act(() => {
      fireEvent.click(buttonByLabel("common.close"));
    });
    expect(openModal()).toBeNull();
  });

  it("closes from its own cancel affordance", () => {
    openOauthDialog();
    act(() => {
      fireEvent.click(screen.getByTestId("modal-close-x"));
    });
    expect(openModal()).toBeNull();
  });
});
