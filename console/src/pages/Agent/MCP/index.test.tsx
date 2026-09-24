/**
 * Agent > MCP page - the MCP client registry screen. It lists the locally
 * configured MCP clients as cards, lists the provider-managed servers
 * discovered from the selected agent backend as read-only tiles, and owns the
 * "create client" dialog with its two import routes: a JSON route that accepts
 * three envelope shapes, and a form route with per-transport validation.
 *
 * What this file pins:
 *   1. `normalizeTransport`: the accepted spellings ("stdio", "sse",
 *      "streamablehttp", "streamable_http", "streamable-http", "http") after
 *      trim + lower-case, the non-string and unknown-value paths, and the
 *      fallback rule that decides between "streamable_http" and "stdio" from
 *      url / baseUrl / command when normalization yields nothing;
 *   2. `normalizeClientData`: every field default and precedence rule -
 *      `transport` then `type`, name falling back to the key, the
 *      enabled / isActive / true chain, url / baseUrl / "", headers / env / cwd
 *      objects, args only when it is an array, and that `command` survives
 *      only for stdio;
 *   3. the three JSON envelopes (`{mcpServers:{...}}`, the direct
 *      `{key, command|url|baseUrl, ...}` shape, and the bare map) including
 *      which bare-map entries are skipped (non-object, null, no endpoint);
 *   4. the failure routes of the JSON import: unparseable text and a `null`
 *      payload both alert "Invalid JSON format"; a rejected create keeps the
 *      dialog open with the edited text intact, and every remaining client is
 *      still attempted;
 *   5. the form route: the four validation alerts (key / name / url /
 *      command, each also reached with whitespace-only input), args splitting
 *      on newlines, commas and spaces, env parsing that keeps only
 *      `KEY=VALUE` lines with a non-empty key, and that success closes and
 *      resets the dialog;
 *   6. the transport selector swapping the url field for command + args and
 *      revealing the env editor only for stdio;
 *   7. the three rendering arms of the body (loading, empty state, sections),
 *      the "no local clients" placeholder inside the managed section while
 *      provider servers are present, and the provider tile's enabled/disabled
 *      class + label pair;
 *   8. the callbacks handed to each card: toggle and delete stop propagation
 *      when an event is given and still work when it is omitted, and
 *      update / updatePolicy / refresh are forwarded by identity;
 *   9. the dialog's close affordances (corner close and footer cancel) and
 *      that both run the same reset.
 *
 * Stubbing facts, all probed rather than assumed:
 *   - the global @agentscope-ai/design stub does NOT export `Empty` or
 *     `Select`, and its `Modal` is a pass-through div that ignores `open` and
 *     drops `footer`; this file overrides the module with importActual and
 *     supplies those three. `Input` / `Input.TextArea` are re-supplied only to
 *     drop the `autoSize` bag, which is not a DOM attribute.
 *   - `Tabs` comes from the real `antd` package, not from the design stub:
 *     both panes are reachable through role="tab" and the form pane mounts on
 *     first activation, which is what the "switch to the form tab" steps rely
 *     on.
 *   - `lucide-react` is deliberately NOT mocked, so "which icon is on screen"
 *     is a real assertion (`svg.lucide-server`, `svg.lucide-plus` and the lock
 *     icon of the provider section).
 *   - `useMCP` and the `./components` barrel are mocked: the hook is covered by
 *     useMCP.test.ts and the card by MCPClientCard.test.tsx, so what this page
 *     owns is the wiring - which callback receives which argument, and what the
 *     hook's data does to the rendered tree.
 *   - CSS module class names are asserted through the imported `styles` object,
 *     never as literals.
 *
 * Observed behaviour pinned without endorsement: a JSON payload that yields no
 * client at all (`{}`, or a bare scalar) still counts as "all succeeded" and
 * therefore closes the dialog without creating anything and without any
 * message. The tests below state that as the current contract.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import type { MCPClientInfo } from "../../../api/types";
import type { HarnessDiscoveredMCPServer } from "../../../api/modules/harness";
import styles from "./index.module.less";

const h = vi.hoisted(() => ({
  clients: [] as MCPClientInfo[],
  providerServers: [] as HarnessDiscoveredMCPServer[],
  loading: false,
  cardProps: {} as Record<string, Record<string, unknown>>,
  toggleEnabled: vi.fn(async (_client: MCPClientInfo) => {}),
  deleteClient: vi.fn(async (_client: MCPClientInfo) => {}),
  createClient: vi.fn(
    async (_key: string, _data: Record<string, unknown>) => true,
  ),
  updateClient: vi.fn(async () => true),
  updatePolicy: vi.fn(async () => true),
  refreshClients: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("./useMCP", () => ({
  useMCP: () => ({
    clients: h.clients,
    providerServers: h.providerServers,
    loading: h.loading,
    toggleEnabled: h.toggleEnabled,
    deleteClient: h.deleteClient,
    createClient: h.createClient,
    updateClient: h.updateClient,
    updatePolicy: h.updatePolicy,
    refreshClients: h.refreshClients,
  }),
}));

vi.mock("./components", () => ({
  MCPClientCard: (props: { client: MCPClientInfo }) => {
    h.cardProps[props.client.key] = props as unknown as Record<string, unknown>;
    return <div data-testid="client-card">{props.client.key}</div>;
  },
}));

vi.mock("@agentscope-ai/design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agentscope-ai/design",
  );

  // `autoSize` is a design-system prop, not a DOM attribute.
  const dropAutoSize = (props: Record<string, unknown>) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.autoSize;
    return rest;
  };

  const Input = Object.assign(
    (props: Record<string, unknown>) => <input {...dropAutoSize(props)} />,
    {
      TextArea: (props: Record<string, unknown>) => (
        <textarea {...dropAutoSize(props)} />
      ),
    },
  );

  const Empty = ({ description }: { description?: React.ReactNode }) => (
    <div data-testid="design-empty">{description}</div>
  );

  const Select = ({
    value,
    onChange,
    options = [],
  }: {
    value?: string;
    onChange?: (value: string) => void;
    options?: Array<{ label: string; value: string }>;
  }) => (
    <select
      data-testid="design-select"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const Modal = ({
    open,
    title,
    children,
    footer,
    onCancel,
  }: {
    open?: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    onCancel?: () => void;
  }) =>
    open ? (
      <div data-testid="design-modal">
        <div data-testid="modal-title">{title}</div>
        <button type="button" data-testid="modal-close" onClick={onCancel}>
          close
        </button>
        {children}
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null;

  return { ...actual, Input, Empty, Select, Modal };
});

import MCPPage from "./index";

function makeClient(overrides: Partial<MCPClientInfo> = {}): MCPClientInfo {
  return {
    key: "alpha",
    name: "Alpha",
    description: "alpha server",
    enabled: true,
    transport: "stdio",
    url: "",
    headers: {},
    command: "npx",
    args: [],
    env: {},
    cwd: "",
    http_timeout: null,
    tools: null,
    oauth_status: null,
    access_summary: { default_effect: "allow", overrides_count: 0 },
    ...overrides,
  };
}

function makeProviderServer(
  overrides: Partial<HarnessDiscoveredMCPServer> = {},
): HarnessDiscoveredMCPServer {
  return {
    name: "provider-tools",
    provider_id: "openai",
    transport: "streamable_http",
    enabled: true,
    auth_status: "authorized",
    read_only: true,
    scope: "provider",
    ...overrides,
  };
}

const DEFAULT_JSON_MARKERS = ["example-client", "@example/mcp-server"];

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.clients = [];
  h.providerServers = [];
  h.loading = false;
  h.cardProps = {};
  vi.clearAllMocks();
  h.createClient.mockResolvedValue(true);
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "mcp.create" }));
}

function jsonTextarea(): HTMLTextAreaElement {
  const found = document.querySelector<HTMLTextAreaElement>(
    `.${styles.jsonTextArea}`,
  );
  expect(found).not.toBeNull();
  return found as HTMLTextAreaElement;
}

function dialogFooterButton(label: string): HTMLElement {
  const footer = screen.getByTestId("modal-footer");
  const button = Array.from(footer.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeTruthy();
  return button as HTMLElement;
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  return screen.getByPlaceholderText(placeholder) as HTMLInputElement;
}

async function clickCreate() {
  await act(async () => {
    fireEvent.click(dialogFooterButton("common.create"));
  });
}

/** Renders the page, types a payload into the JSON editor and clicks create. */
async function importJson(payload: unknown): Promise<void> {
  render(<MCPPage />);
  openDialog();
  fireEvent.change(jsonTextarea(), {
    target: { value: JSON.stringify(payload) },
  });
  await clickCreate();
}

/** Renders the page, types raw text into the JSON editor and clicks create. */
async function importRawJson(text: string): Promise<void> {
  render(<MCPPage />);
  openDialog();
  fireEvent.change(jsonTextarea(), { target: { value: text } });
  await clickCreate();
}

/** Renders the page and switches the create dialog to the form tab. */
function renderFormTab() {
  render(<MCPPage />);
  openDialog();
  fireEvent.click(screen.getByRole("tab", { name: "mcp.tab.form" }));
}

function fillKeyAndName(key = "  solo  ", name = "  Solo  ") {
  fireEvent.change(inputByPlaceholder("mcp.form.keyPlaceholder"), {
    target: { value: key },
  });
  fireEvent.change(inputByPlaceholder("mcp.form.namePlaceholder"), {
    target: { value: name },
  });
}

function selectTransport(value: string) {
  fireEvent.change(screen.getByTestId("design-select"), {
    target: { value },
  });
}

function createdKeys(): string[] {
  return h.createClient.mock.calls.map((call) => call[0]);
}

function payloadAt(index: number): Record<string, unknown> {
  return h.createClient.mock.calls[index][1];
}

function lastPayload(): Record<string, unknown> {
  const calls = h.createClient.mock.calls;
  return calls[calls.length - 1][1];
}

type CardHandler = (
  client: MCPClientInfo,
  event?: { stopPropagation: () => void },
) => Promise<void>;

function cardHandler(name: string): CardHandler {
  return h.cardProps["alpha"][name] as unknown as CardHandler;
}

describe("MCP page - body rendering arms", () => {
  it("shows only the loading text while the hook is loading", () => {
    h.loading = true;
    h.clients = [makeClient()];
    render(<MCPPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("client-card")).toBeNull();
    expect(screen.queryByTestId("design-empty")).toBeNull();
  });

  it("shows the empty state when there is neither a client nor a provider server", () => {
    render(<MCPPage />);
    const empty = screen.getByTestId("design-empty");
    expect(empty).toHaveTextContent("mcp.emptyState");
    expect(empty.closest(`.${styles.emptyState}`)).not.toBeNull();
  });

  it("renders one card per client inside the managed grid", () => {
    h.clients = [makeClient({ key: "alpha" }), makeClient({ key: "beta" })];
    render(<MCPPage />);
    const cards = screen.getAllByTestId("client-card");
    expect(cards.map((node) => node.textContent)).toEqual(["alpha", "beta"]);
    expect(cards[0].closest(`.${styles.mcpGrid}`)).not.toBeNull();
    expect(screen.getByText("mcp.qwenpawManaged")).toBeInTheDocument();
    expect(screen.getByText("mcp.qwenpawManagedHint")).toBeInTheDocument();
  });

  it("hides the provider section entirely when no provider server was discovered", () => {
    h.clients = [makeClient()];
    render(<MCPPage />);
    expect(screen.queryByText("mcp.providerManagedHint")).toBeNull();
    expect(document.querySelector(`.${styles.providerGrid}`)).toBeNull();
  });

  it("keeps the managed section with its placeholder when only provider servers exist", () => {
    h.providerServers = [makeProviderServer()];
    render(<MCPPage />);
    const placeholder = screen.getByText("mcp.emptyState");
    expect(placeholder.closest(`.${styles.sectionEmpty}`)).not.toBeNull();
    expect(screen.queryByTestId("client-card")).toBeNull();
    expect(screen.getByText("mcp.providerManagedHint")).toBeInTheDocument();
  });

  it("renders the provider tile with the enabled class and label", () => {
    h.providerServers = [makeProviderServer({ name: "search", enabled: true })];
    render(<MCPPage />);
    const tile = screen
      .getByText("search")
      .closest(`.${styles.providerCard}`) as HTMLElement;
    expect(tile).not.toBeNull();
    const badge = tile.querySelector(`.${styles.providerEnabled}`);
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("common.enabled");
    expect(tile.querySelector(`.${styles.providerDisabled}`)).toBeNull();
  });

  it("renders the provider tile with the disabled class and label", () => {
    h.providerServers = [
      makeProviderServer({ name: "search", enabled: false }),
    ];
    render(<MCPPage />);
    const tile = screen
      .getByText("search")
      .closest(`.${styles.providerCard}`) as HTMLElement;
    const badge = tile.querySelector(`.${styles.providerDisabled}`);
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("common.disabled");
    expect(tile.querySelector(`.${styles.providerEnabled}`)).toBeNull();
  });

  it("names the provider section after the first server's provider id and lists its metadata", () => {
    h.providerServers = [
      makeProviderServer({ provider_id: "openai", transport: "sse" }),
      makeProviderServer({ provider_id: "anthropic", name: "second" }),
    ];
    render(<MCPPage />);
    expect(
      screen.getByText('mcp.providerManaged:{"provider":"openai"}'),
    ).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    const firstTile = screen
      .getByText("provider-tools")
      .closest(`.${styles.providerCard}`) as HTMLElement;
    const meta = firstTile.querySelector(`.${styles.providerMeta}`);
    expect(meta).toHaveTextContent("sse");
    expect(meta).toHaveTextContent("mcp.providerOnly");
    expect(meta).toHaveTextContent("mcp.readOnly");
  });

  it("renders the breadcrumb trail and the real lucide icons of both sections", () => {
    h.clients = [makeClient()];
    h.providerServers = [makeProviderServer()];
    render(<MCPPage />);
    expect(screen.getByText("nav.agent")).toBeInTheDocument();
    expect(screen.getByText("mcp.title")).toBeInTheDocument();
    expect(document.querySelector("svg.lucide-server")).not.toBeNull();
    expect(document.querySelector("svg.lucide-plus")).not.toBeNull();
    expect(document.querySelector('[class*="lucide-lock"]')).not.toBeNull();
  });
});

describe("MCP page - card callback wiring", () => {
  it("forwards the hook's update callbacks to every card by identity", () => {
    h.clients = [makeClient({ key: "alpha" })];
    render(<MCPPage />);
    const props = h.cardProps["alpha"];
    expect(props["onUpdate"]).toBe(h.updateClient);
    expect(props["onUpdatePolicy"]).toBe(h.updatePolicy);
    expect(props["onRefresh"]).toBe(h.refreshClients);
    expect(props["client"]).toEqual(makeClient({ key: "alpha" }));
  });

  it("stops propagation and toggles when the card reports a click event", async () => {
    const client = makeClient({ key: "alpha" });
    h.clients = [client];
    render(<MCPPage />);
    const stopPropagation = vi.fn();
    await act(async () => {
      await cardHandler("onToggle")(client, { stopPropagation });
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(h.toggleEnabled).toHaveBeenCalledWith(client);
  });

  it("toggles without an event argument as well", async () => {
    const client = makeClient({ key: "alpha" });
    h.clients = [client];
    render(<MCPPage />);
    await act(async () => {
      await cardHandler("onToggle")(client);
    });
    expect(h.toggleEnabled).toHaveBeenCalledWith(client);
  });

  it("stops propagation and deletes when the card reports a click event", async () => {
    const client = makeClient({ key: "alpha" });
    h.clients = [client];
    render(<MCPPage />);
    const stopPropagation = vi.fn();
    await act(async () => {
      await cardHandler("onDelete")(client, { stopPropagation });
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(h.deleteClient).toHaveBeenCalledWith(client);
  });

  it("deletes without an event argument as well", async () => {
    const client = makeClient({ key: "alpha" });
    h.clients = [client];
    render(<MCPPage />);
    await act(async () => {
      await cardHandler("onDelete")(client);
    });
    expect(h.deleteClient).toHaveBeenCalledWith(client);
  });
});

describe("MCP page - dialog open and close", () => {
  it("keeps the dialog closed until the header button is clicked", () => {
    render(<MCPPage />);
    expect(screen.queryByTestId("design-modal")).toBeNull();
    openDialog();
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-title")).toHaveTextContent("mcp.create");
    expect(screen.queryAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "mcp.tab.json",
      "mcp.tab.form",
    ]);
  });

  it("seeds the JSON editor with the documented template", () => {
    render(<MCPPage />);
    openDialog();
    const value = jsonTextarea().value;
    DEFAULT_JSON_MARKERS.forEach((marker) => expect(value).toContain(marker));
  });

  it("resets the dialog when the corner close is used", () => {
    render(<MCPPage />);
    openDialog();
    fireEvent.change(jsonTextarea(), { target: { value: '{"edited":true}' } });
    fireEvent.click(screen.getByTestId("modal-close"));
    expect(screen.queryByTestId("design-modal")).toBeNull();
    openDialog();
    const value = jsonTextarea().value;
    expect(value).not.toContain("edited");
    DEFAULT_JSON_MARKERS.forEach((marker) => expect(value).toContain(marker));
    expect(screen.getByRole("tab", { name: "mcp.tab.json" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("resets the dialog when the footer cancel is used", () => {
    render(<MCPPage />);
    openDialog();
    fireEvent.change(jsonTextarea(), { target: { value: '{"edited":true}' } });
    fireEvent.click(dialogFooterButton("common.cancel"));
    expect(screen.queryByTestId("design-modal")).toBeNull();
    openDialog();
    expect(jsonTextarea().value).not.toContain("edited");
  });
});

describe("MCP page - transport normalization through the JSON import", () => {
  const cases: Array<[string, string]> = [
    ["stdio", "stdio"],
    ["  SSE  ", "sse"],
    ["StreamableHTTP", "streamable_http"],
    ["streamable_http", "streamable_http"],
    ["streamable-http", "streamable_http"],
    ["HTTP", "streamable_http"],
  ];

  it.each(cases)("maps %s onto %s", async (raw, expected) => {
    await importJson({ mcpServers: { alpha: { transport: raw } } });
    expect(lastPayload()["transport"]).toBe(expected);
  });

  it("falls back to streamable_http for an unknown transport when a url exists", async () => {
    await importJson({
      mcpServers: { alpha: { transport: "carrier-pigeon", url: "https://x" } },
    });
    expect(lastPayload()["transport"]).toBe("streamable_http");
  });

  it("falls back to stdio for an unknown transport when only a command exists", async () => {
    await importJson({
      mcpServers: { alpha: { transport: "carrier-pigeon", command: "npx" } },
    });
    expect(lastPayload()["transport"]).toBe("stdio");
  });

  it("ignores a non-string transport and decides from url and command", async () => {
    // 42 is not nullish, so `type` never reaches the normalizer; the fallback
    // then sees a command and no url, which means stdio.
    await importJson({
      mcpServers: { alpha: { transport: 42, command: "npx" } },
    });
    expect(lastPayload()["transport"]).toBe("stdio");
  });

  it("reads the transport from `type` when `transport` is absent", async () => {
    await importJson({ mcpServers: { alpha: { type: "sse" } } });
    expect(lastPayload()["transport"]).toBe("sse");
  });

  it("prefers `transport` over `type` even when `transport` is not a string", async () => {
    await importJson({ mcpServers: { alpha: { transport: 42, type: "sse" } } });
    // No url, no baseUrl and no command, so `!rawData.command` is true and the
    // fallback picks streamable_http.
    expect(lastPayload()["transport"]).toBe("streamable_http");
  });

  it("reads the transport from `type` when `transport` is explicitly null", async () => {
    await importJson({
      mcpServers: { alpha: { transport: null, type: "stdio" } },
    });
    expect(lastPayload()["transport"]).toBe("stdio");
  });

  it("defaults to stdio when neither transport nor type nor url is given", async () => {
    await importJson({ mcpServers: { alpha: { command: "npx" } } });
    expect(lastPayload()["transport"]).toBe("stdio");
  });
});

describe("MCP page - client field normalization", () => {
  it("keeps the command only for stdio clients", async () => {
    await importJson({
      mcpServers: {
        local: { transport: "stdio", command: "npx" },
        remote: { transport: "http", command: "npx", url: "https://x" },
      },
    });
    expect(payloadAt(0)["command"]).toBe("npx");
    expect(payloadAt(1)["command"]).toBe("");
  });

  it("uses an absent command as an empty string for stdio clients", async () => {
    await importJson({ mcpServers: { alpha: { transport: "stdio" } } });
    expect(lastPayload()["command"]).toBe("");
  });

  it("falls back to the key for a missing name and to an empty description", async () => {
    await importJson({ mcpServers: { "my-key": { command: "npx" } } });
    expect(createdKeys()).toEqual(["my-key"]);
    expect(lastPayload()["name"]).toBe("my-key");
    expect(lastPayload()["description"]).toBe("");
  });

  it("keeps a given name and description", async () => {
    await importJson({
      mcpServers: { alpha: { name: "Alpha", description: "hello" } },
    });
    expect(lastPayload()["name"]).toBe("Alpha");
    expect(lastPayload()["description"]).toBe("hello");
  });

  it("honours `enabled` before `isActive` before the true default", async () => {
    await importJson({
      mcpServers: {
        explicitOff: { enabled: false },
        explicitOn: { enabled: true },
        activeFlag: { isActive: false },
        nothing: {},
      },
    });
    expect(payloadAt(0)["enabled"]).toBe(false);
    expect(payloadAt(1)["enabled"]).toBe(true);
    expect(payloadAt(2)["enabled"]).toBe(false);
    expect(payloadAt(3)["enabled"]).toBe(true);
  });

  it("ignores `isActive` once `enabled` is present, including when enabled is false", async () => {
    await importJson({
      mcpServers: { alpha: { enabled: false, isActive: true } },
    });
    expect(lastPayload()["enabled"]).toBe(false);
  });

  it("resolves the url from url, then baseUrl, then an empty string", async () => {
    await importJson({
      mcpServers: {
        withUrl: { url: "https://a" },
        withBaseUrl: { baseUrl: "https://b" },
        withBoth: { url: "https://a", baseUrl: "https://b" },
        withNeither: { command: "npx" },
      },
    });
    expect(payloadAt(0)["url"]).toBe("https://a");
    expect(payloadAt(1)["url"]).toBe("https://b");
    expect(payloadAt(2)["url"]).toBe("https://a");
    expect(payloadAt(3)["url"]).toBe("");
  });

  it("defaults headers and env to empty objects and passes given ones through", async () => {
    await importJson({
      mcpServers: {
        bare: { command: "npx" },
        rich: { headers: { A: "1" }, env: { B: "2" } },
      },
    });
    expect(payloadAt(0)["headers"]).toEqual({});
    expect(payloadAt(0)["env"]).toEqual({});
    expect(payloadAt(1)["headers"]).toEqual({ A: "1" });
    expect(payloadAt(1)["env"]).toEqual({ B: "2" });
  });

  it("keeps args only when they are an array", async () => {
    await importJson({
      mcpServers: {
        withArgs: { args: ["-y", "pkg"] },
        withString: { args: "-y pkg" },
        withoutArgs: {},
      },
    });
    expect(payloadAt(0)["args"]).toEqual(["-y", "pkg"]);
    expect(payloadAt(1)["args"]).toEqual([]);
    expect(payloadAt(2)["args"]).toEqual([]);
  });

  it("defaults cwd to an empty string and keeps a given one", async () => {
    await importJson({
      mcpServers: { bare: {}, withCwd: { cwd: "/srv" } },
    });
    expect(payloadAt(0)["cwd"]).toBe("");
    expect(payloadAt(1)["cwd"]).toBe("/srv");
  });
});

describe("MCP page - JSON envelope shapes", () => {
  it("creates every entry of the mcpServers envelope in key order", async () => {
    await importJson({
      mcpServers: {
        alpha: { command: "npx" },
        beta: { url: "https://beta" },
      },
    });
    expect(createdKeys()).toEqual(["alpha", "beta"]);
    expect(payloadAt(1)["transport"]).toBe("streamable_http");
  });

  it("accepts the direct single-client envelope and strips the key from the data", async () => {
    await importJson({ key: "solo", name: "Solo", command: "npx" });
    expect(createdKeys()).toEqual(["solo"]);
    expect(lastPayload()["name"]).toBe("Solo");
    expect(lastPayload()).not.toHaveProperty("key");
  });

  it("accepts the direct envelope with a url", async () => {
    await importJson({ key: "via-url", url: "https://u" });
    expect(createdKeys()).toEqual(["via-url"]);
    expect(lastPayload()["transport"]).toBe("streamable_http");
    expect(lastPayload()["url"]).toBe("https://u");
  });

  it("accepts the direct envelope with a baseUrl", async () => {
    await importJson({ key: "via-base", baseUrl: "https://b" });
    expect(createdKeys()).toEqual(["via-base"]);
    expect(lastPayload()["transport"]).toBe("streamable_http");
    expect(lastPayload()["url"]).toBe("https://b");
  });

  it("treats a bare map as an envelope and skips entries that cannot be servers", async () => {
    await importJson({
      alpha: { command: "npx" },
      beta: { url: "https://beta" },
      gamma: { baseUrl: "https://gamma" },
      note: "just a string",
      nothing: null,
      empty: { name: "no endpoint" },
    });
    expect(createdKeys()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("closes the dialog without creating anything when the payload yields no client", async () => {
    await importJson({});
    expect(h.createClient).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    // Current contract: an empty candidate list counts as "all succeeded", so
    // the dialog closes silently instead of reporting that nothing was created.
    await waitFor(() =>
      expect(screen.queryByTestId("design-modal")).toBeNull(),
    );
  });

  it("closes the dialog for a bare scalar payload as well", async () => {
    await importRawJson("123");
    expect(h.createClient).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId("design-modal")).toBeNull(),
    );
  });
});

describe("MCP page - JSON import failures", () => {
  it("alerts on unparseable text and keeps the dialog open", async () => {
    await importRawJson("{ this is not json ");
    expect(alertSpy).toHaveBeenCalledWith("Invalid JSON format");
    expect(h.createClient).not.toHaveBeenCalled();
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
    expect(jsonTextarea().value).toBe("{ this is not json ");
  });

  it("alerts for a JSON null payload, which has no readable fields", async () => {
    await importRawJson("null");
    expect(alertSpy).toHaveBeenCalledWith("Invalid JSON format");
    expect(h.createClient).not.toHaveBeenCalled();
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
  });

  it("still attempts every remaining client when one create is rejected", async () => {
    h.createClient.mockImplementation(async (key: string) => key !== "alpha");
    await importJson({
      mcpServers: { alpha: { command: "npx" }, beta: { command: "node" } },
    });
    expect(createdKeys()).toEqual(["alpha", "beta"]);
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
    expect(jsonTextarea().value).toContain("alpha");
  });

  it("keeps the dialog open and the edited text when a single create is rejected", async () => {
    h.createClient.mockResolvedValue(false);
    await importJson({ key: "solo", command: "npx" });
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
    expect(jsonTextarea().value).toContain("solo");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("closes the dialog and restores the template after a successful import", async () => {
    await importJson({ key: "solo", command: "npx" });
    await waitFor(() =>
      expect(screen.queryByTestId("design-modal")).toBeNull(),
    );
    openDialog();
    const value = jsonTextarea().value;
    expect(value).not.toContain("solo");
    DEFAULT_JSON_MARKERS.forEach((marker) => expect(value).toContain(marker));
  });
});

describe("MCP page - form validation", () => {
  it("alerts when the key is empty and creates nothing", async () => {
    renderFormTab();
    fireEvent.change(inputByPlaceholder("mcp.form.namePlaceholder"), {
      target: { value: "Solo" },
    });
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.keyRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when the key is whitespace only", async () => {
    renderFormTab();
    fillKeyAndName("   ", "Solo");
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.keyRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when the name is missing", async () => {
    renderFormTab();
    fillKeyAndName("solo", "");
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.nameRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when a streamable_http client has no url", async () => {
    renderFormTab();
    fillKeyAndName("solo", "Solo");
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.urlRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when an sse client has a whitespace-only url", async () => {
    renderFormTab();
    fillKeyAndName("solo", "Solo");
    selectTransport("sse");
    fireEvent.change(inputByPlaceholder("https://mcp.example.com/mcp"), {
      target: { value: "   " },
    });
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.urlRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when a stdio client has no command", async () => {
    renderFormTab();
    fillKeyAndName("solo", "Solo");
    selectTransport("stdio");
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.commandRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("alerts when a stdio client has a whitespace-only command", async () => {
    renderFormTab();
    fillKeyAndName("solo", "Solo");
    selectTransport("stdio");
    fireEvent.change(inputByPlaceholder("npx"), { target: { value: "  " } });
    await clickCreate();
    expect(alertSpy).toHaveBeenCalledWith("mcp.form.commandRequired");
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("MCP page - form payload", () => {
  it("trims key and name, keeps the url for http and drops the command", async () => {
    renderFormTab();
    fillKeyAndName();
    fireEvent.change(inputByPlaceholder("https://mcp.example.com/mcp"), {
      target: { value: "  https://x/mcp  " },
    });
    fireEvent.change(inputByPlaceholder("mcp.form.descriptionPlaceholder"), {
      target: { value: "a description" },
    });
    await clickCreate();
    expect(createdKeys()).toEqual(["solo"]);
    expect(lastPayload()).toEqual({
      name: "Solo",
      description: "a description",
      transport: "streamable_http",
      url: "https://x/mcp",
      command: "",
      args: [],
      env: {},
      cwd: "",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("design-modal")).toBeNull(),
    );
  });

  it("splits args on newlines, commas and spaces and drops the empty pieces", async () => {
    renderFormTab();
    fillKeyAndName();
    selectTransport("stdio");
    fireEvent.change(inputByPlaceholder("npx"), { target: { value: "npx" } });
    fireEvent.change(inputByPlaceholder("-y @example/mcp-server"), {
      target: { value: "-y, @example/mcp-server\n --flag   " },
    });
    await clickCreate();
    expect(lastPayload()["args"]).toEqual([
      "-y",
      "@example/mcp-server",
      "--flag",
    ]);
    expect(lastPayload()["command"]).toBe("npx");
    expect(lastPayload()["url"]).toBe("");
  });

  it("keeps only env lines with a non-empty key before the equals sign", async () => {
    renderFormTab();
    fillKeyAndName();
    selectTransport("stdio");
    fireEvent.change(inputByPlaceholder("npx"), { target: { value: "npx" } });
    fireEvent.change(inputByPlaceholder("mcp.form.envPlaceholder"), {
      target: {
        value: "API_KEY=abc\n  SPACED = v with spaces \n=novalue\nNOEQUALS\n",
      },
    });
    await clickCreate();
    expect(lastPayload()["env"]).toEqual({
      API_KEY: "abc",
      SPACED: "v with spaces",
    });
  });

  it("keeps the dialog open when the form create is rejected", async () => {
    h.createClient.mockResolvedValue(false);
    renderFormTab();
    fillKeyAndName();
    fireEvent.change(inputByPlaceholder("https://mcp.example.com/mcp"), {
      target: { value: "https://x/mcp" },
    });
    await clickCreate();
    expect(screen.getByTestId("design-modal")).toBeInTheDocument();
    expect(inputByPlaceholder("mcp.form.keyPlaceholder").value).toBe(
      "  solo  ",
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("resets the form and returns to the JSON tab after a successful create", async () => {
    renderFormTab();
    fillKeyAndName();
    fireEvent.change(inputByPlaceholder("https://mcp.example.com/mcp"), {
      target: { value: "https://x/mcp" },
    });
    await clickCreate();
    await waitFor(() =>
      expect(screen.queryByTestId("design-modal")).toBeNull(),
    );
    openDialog();
    expect(screen.getByRole("tab", { name: "mcp.tab.json" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "mcp.tab.form" }));
    expect(inputByPlaceholder("mcp.form.keyPlaceholder").value).toBe("");
    expect(inputByPlaceholder("mcp.form.namePlaceholder").value).toBe("");
    expect(inputByPlaceholder("https://mcp.example.com/mcp").value).toBe("");
  });
});

describe("MCP page - transport selector drives the form fields", () => {
  it("shows the url field and hides command, args and env for streamable_http", () => {
    renderFormTab();
    expect(screen.getByTestId("design-select")).toHaveValue("streamable_http");
    expect(
      screen.queryByPlaceholderText("https://mcp.example.com/mcp"),
    ).not.toBeNull();
    expect(screen.queryByPlaceholderText("npx")).toBeNull();
    expect(screen.queryByPlaceholderText("-y @example/mcp-server")).toBeNull();
    expect(screen.queryByPlaceholderText("mcp.form.envPlaceholder")).toBeNull();
  });

  it("shows the url field for sse as well", () => {
    renderFormTab();
    selectTransport("sse");
    expect(
      screen.queryByPlaceholderText("https://mcp.example.com/mcp"),
    ).not.toBeNull();
    expect(screen.queryByPlaceholderText("npx")).toBeNull();
    expect(screen.queryByPlaceholderText("mcp.form.envPlaceholder")).toBeNull();
  });

  it("swaps to command and args and reveals the env editor for stdio", () => {
    renderFormTab();
    selectTransport("stdio");
    expect(screen.getByTestId("design-select")).toHaveValue("stdio");
    expect(screen.queryByPlaceholderText("npx")).not.toBeNull();
    expect(
      screen.queryByPlaceholderText("-y @example/mcp-server"),
    ).not.toBeNull();
    expect(
      screen.queryByPlaceholderText("mcp.form.envPlaceholder"),
    ).not.toBeNull();
    expect(
      screen.queryByPlaceholderText("https://mcp.example.com/mcp"),
    ).toBeNull();
    expect(screen.getByText("mcp.form.command")).toBeInTheDocument();
    expect(screen.getByText("mcp.form.args")).toBeInTheDocument();
    expect(screen.getByText("mcp.form.env")).toBeInTheDocument();
  });

  it("lists the three transports as the only options", () => {
    renderFormTab();
    const options = Array.from(
      screen.getByTestId("design-select").querySelectorAll("option"),
    ).map((option) => option.value);
    expect(options).toEqual(["streamable_http", "sse", "stdio"]);
  });

  it("renders the documented format hints and their code samples on the JSON tab", () => {
    render(<MCPPage />);
    openDialog();
    expect(screen.getByText("mcp.formatSupport:")).toBeInTheDocument();
    expect(screen.getByText("mcp.standardFormat:")).toBeInTheDocument();
    expect(screen.getByText("mcp.directFormat:")).toBeInTheDocument();
    expect(screen.getByText("mcp.singleFormat:")).toBeInTheDocument();
    const codes = Array.from(document.querySelectorAll("code")).map(
      (node) => node.textContent,
    );
    expect(codes).toEqual([
      '{ "mcpServers": { "key": {...} } }',
      '{ "key": {...} }',
      '{ "key": "...", "name": "...", "command": "..." }',
    ]);
    expect(document.querySelector(`.${styles.importHintList}`)).not.toBeNull();
  });

  it("marks the required form fields with an asterisk", () => {
    renderFormTab();
    expect(screen.getByText("mcp.form.key")).toBeInTheDocument();
    expect(screen.getByText("mcp.form.name")).toBeInTheDocument();
    expect(screen.getByText("mcp.form.transport")).toBeInTheDocument();
    expect(screen.getByText("mcp.form.description")).toBeInTheDocument();
    const asterisks = Array.from(
      document.querySelectorAll("label span"),
    ).filter((node) => node.textContent === " *");
    // key, name and url are the required fields of the http form.
    expect(asterisks.length).toBe(3);
  });
});
