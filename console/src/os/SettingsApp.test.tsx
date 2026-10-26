import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsApp from "./SettingsApp";
import { SETTINGS_APP_ID } from "./osRouteMap";
import { useOsRoute } from "./osRouteStore";

const hoisted = vi.hoisted(() => ({ routeSnapshot: vi.fn() }));

vi.mock("../plugins/registry/hooks", () => ({
  useRoutes: () => hoisted.routeSnapshot(),
}));

vi.mock("react-i18next", () => ({
  // Required by src/i18n.ts, pulled in through ChunkErrorBoundary.
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "en" },
  }),
}));

function route(id: string, path: string, label: string) {
  return {
    id,
    path,
    Component: () => <div data-testid="pane">{label} pane</div>,
  };
}

const AGENTS = route("core.agents", "/agents", "Agents");
const MODELS = route("core.models", "/models", "Models");
const DEBUG = route("core.debug", "/debug", "Debug");
/** A registered route that is not one of the settings panes. */
const CHAT = route("core.chat", "/chat/*", "Chat");

function pane(): HTMLElement {
  return screen.getByTestId("pane");
}

describe("SettingsApp", () => {
  beforeEach(() => {
    hoisted.routeSnapshot.mockReset();
    useOsRoute.setState({ targets: {} });
  });

  it("lists only the settings routes that are actually registered", () => {
    hoisted.routeSnapshot.mockReturnValue([AGENTS, MODELS, CHAT]);
    render(<SettingsApp />);

    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    // Not in SETTINGS_ITEMS, so it must never show up in this window.
    expect(screen.queryByText("Chat")).toBeNull();
    // Registered in the manifest but absent from the registry snapshot.
    expect(screen.queryByText("Backups")).toBeNull();
  });

  it("opens on the first available pane and switches panes on selection", () => {
    hoisted.routeSnapshot.mockReturnValue([AGENTS, MODELS, DEBUG]);
    render(<SettingsApp />);

    expect(pane()).toHaveTextContent("Agents pane");

    fireEvent.click(screen.getByText("Debug"));
    expect(pane()).toHaveTextContent("Debug pane");

    fireEvent.click(screen.getByText("Models"));
    expect(pane()).toHaveTextContent("Models pane");
  });

  it("selects the pane named by a pending cross-app deep-link", () => {
    hoisted.routeSnapshot.mockReturnValue([AGENTS, MODELS, DEBUG]);
    useOsRoute.setState({
      targets: { [SETTINGS_APP_ID]: { path: "core.models", nonce: 1 } },
    });
    render(<SettingsApp />);

    expect(pane()).toHaveTextContent("Models pane");
  });

  it("ignores a deep-link that names a pane which is not registered", () => {
    hoisted.routeSnapshot.mockReturnValue([AGENTS, MODELS]);
    useOsRoute.setState({
      targets: { [SETTINGS_APP_ID]: { path: "core.debug", nonce: 1 } },
    });
    render(<SettingsApp />);

    expect(pane()).toHaveTextContent("Agents pane");
  });

  it("shows the empty state when no settings route is registered", () => {
    hoisted.routeSnapshot.mockReturnValue([CHAT]);
    render(<SettingsApp />);

    expect(screen.getByText("No settings available")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });
});
