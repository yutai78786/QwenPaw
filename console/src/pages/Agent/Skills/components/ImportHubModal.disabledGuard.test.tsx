/**
 * Defensive-guard tests for ImportHubModal.
 *
 * `handleConfirm` starts with `if (importing || !validation.ok) return;`, and
 * `handleClose` with `if (importing) return;`. Both guards test the same
 * conditions that already drive `disabled={!canImport}` on the import button,
 * so through a faithful Button stub a browser or jsdom never delivers the click
 * and the guards cannot be observed. They exist as a second line of defence in
 * case the disabled state and the guard ever disagree.
 *
 * This file therefore uses a Button stub that reports the disabled flag as a
 * data attribute but does NOT emulate the browser rule that suppresses click
 * handling on disabled buttons. That lets a click reach the handler so the
 * guard itself can be asserted. The main suite
 * (`ImportHubModal.test.tsx`) keeps the faithful stub, which is why the two
 * files are separate rather than one.
 *
 * `Modal` is stubbed for the same reason as in the main suite: the shared test
 * stub renders a pass-through div that ignores `open` and never renders the
 * `footer` prop, so the footer buttons would not exist.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "./ImportHubModal.module.less";

vi.mock("@agentscope-ai/design", async () => {
  const React = await import("react");

  const Modal = (props: {
    open?: boolean;
    onCancel?: () => void;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    if (!props.open) {
      return null;
    }
    return React.createElement(
      "div",
      { "data-testid": "modal-root" },
      React.createElement(
        "span",
        {
          role: "button",
          "data-testid": "modal-close-request",
          onClick: () => props.onCancel?.(),
        },
        "close",
      ),
      props.children,
      React.createElement(
        "span",
        { "data-testid": "modal-footer" },
        props.footer,
      ),
    );
  };

  // Deliberately not a real <button>: a real one would be given `disabled`, and
  // jsdom then suppresses the click, which is exactly what this file needs to
  // see past. The flag is still reported so tests can assert it.
  const Button = ({
    children,
    onClick,
    loading,
    disabled,
    className,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    className?: string;
  }) =>
    React.createElement(
      "span",
      {
        className,
        role: "button",
        "data-disabled": disabled === true ? "yes" : "no",
        "data-loading": loading === true ? "yes" : "no",
        onClick,
      },
      children,
    );

  return {
    Modal: Object.assign(Modal, {
      confirm: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    }),
    Button,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const { ImportHubModal } = await import("./ImportHubModal");

function importButtonOf(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${styles.importButton}`) as HTMLElement;
}

function cancelButtonOf(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${styles.cancelButton}`) as HTMLElement;
}

function closeRequestOf(container: HTMLElement): HTMLElement {
  return container.querySelector(
    '[data-testid="modal-close-request"]',
  ) as HTMLElement;
}

function currentInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector(`.${styles.urlInput}`) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ImportHubModal confirm guard", () => {
  it("drops the click when the url cannot be parsed", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    const button = importButtonOf(view.container);
    expect(button.getAttribute("data-disabled")).toBe("yes");
    fireEvent.change(currentInput(view.container), {
      target: { value: "not a url" },
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("drops the click when the url comes from an unsupported host", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    const button = importButtonOf(view.container);
    fireEvent.change(currentInput(view.container), {
      target: { value: "https://example.com/skills/thing" },
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("drops the click when the input is empty", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    const button = importButtonOf(view.container);
    expect(button.getAttribute("data-disabled")).toBe("yes");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("drops the click when the input holds only whitespace", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    fireEvent.change(currentInput(view.container), {
      target: { value: "   " },
    });

    await act(async () => {
      fireEvent.click(importButtonOf(view.container));
    });

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("drops the click while an import is already running", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    const button = importButtonOf(view.container);
    expect(button.getAttribute("data-disabled")).toBe("yes");
    expect(button.getAttribute("data-loading")).toBe("yes");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("still hands the trimmed url over when the click is legitimate", async () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async (url) => {
          calls.push(`confirm:${url}`);
        }}
      />,
    );
    fireEvent.change(currentInput(view.container), {
      target: { value: "  https://skills.sh/a/b  " },
    });
    const button = importButtonOf(view.container);
    expect(button.getAttribute("data-disabled")).toBe("no");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(calls).toEqual(["confirm:https://skills.sh/a/b"]);
    view.unmount();
  });
});

describe("ImportHubModal close guard", () => {
  it("drops a dialog close request while an import is running", () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing
        onCancel={() => calls.push("cancel")}
        onConfirm={async () => {}}
      />,
    );

    fireEvent.click(closeRequestOf(view.container));

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("drops a cancel button press while an import is running and no cancel handler exists", () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing
        onCancel={() => calls.push("cancel")}
        onConfirm={async () => {}}
      />,
    );

    fireEvent.click(cancelButtonOf(view.container));

    expect(calls).toEqual([]);
    view.unmount();
  });

  it("does not clear the input when the close request is dropped", () => {
    const view = render(
      <ImportHubModal
        open
        importing
        onCancel={() => {}}
        onConfirm={async () => {}}
      />,
    );
    fireEvent.click(closeRequestOf(view.container));
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("resets the url and notifies the parent when the close request is honoured", () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async () => {}}
      />,
    );
    fireEvent.change(currentInput(view.container), {
      target: { value: "https://skills.sh/a/b" },
    });

    fireEvent.click(closeRequestOf(view.container));

    expect(calls).toEqual(["cancel"]);
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("resets the url and notifies the parent when cancelled while idle", () => {
    const calls: string[] = [];
    const view = render(
      <ImportHubModal
        open
        importing={false}
        onCancel={() => calls.push("cancel")}
        onConfirm={async () => {}}
      />,
    );
    fireEvent.change(currentInput(view.container), {
      target: { value: "https://skills.sh/a/b" },
    });

    fireEvent.click(cancelButtonOf(view.container));

    expect(calls).toEqual(["cancel"]);
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });
});
