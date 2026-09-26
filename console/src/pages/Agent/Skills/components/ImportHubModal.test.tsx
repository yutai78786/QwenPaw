/**
 * Unit tests for ImportHubModal, the dialog that validates a Skill hub URL and
 * hands it back to the caller for import.
 *
 * Four stubs and one import shape are chosen deliberately:
 *
 * 1. The component and the market list are obtained with a dynamic import
 *    rather than a static one. `./index` re-exports this component
 *    (`export { ImportHubModal } from "./ImportHubModal"`) while the component
 *    itself imports `skillMarkets` from `./index`, so the two modules form a
 *    cycle. Under a static import the component module is evaluated while the
 *    mock namespace for `./index` is still being constructed, and the component
 *    ends up bound to the real market list; a `vi.mock` getter installed on
 *    `./index` is then never called. Loading the component after the static
 *    imports have settled avoids that, which is what the dynamic import below
 *    does.
 *
 * 2. `@agentscope-ai/design` is factory-overridden instead of relying on the
 *    shared test stub. The shared stub renders `Modal` as a pass-through div,
 *    which ignores `open` (children render even when closed) and never renders
 *    the `footer` prop, so the cancel and confirm buttons never reach the DOM.
 *    The local stub respects `open`, renders title, children and footer, and
 *    forwards `Button` props to a real button element including `disabled`.
 *    Forwarding `disabled` faithfully matters: jsdom, like a browser, does not
 *    dispatch click events on a disabled button, so assertions about the
 *    disabled state are made on the attribute rather than on click behaviour.
 *    The stub also renders a `modal-close-request` button standing in for any
 *    close request the dialog can emit (close icon, mask click, escape key),
 *    because the component is expected to ignore such requests while importing.
 *
 * 3. `./index` is mocked with a getter over a mutable holder so the market list
 *    can be swapped per test. The real list has eight entries that all carry at
 *    least one example and a parseable `urlPrefix`, which leaves two paths
 *    unreachable with real data alone: a market without examples, and a market
 *    whose `urlPrefix` throws inside `new URL()`. The original module is spread
 *    back in so every other export keeps working.
 *
 * 4. `react-i18next` echoes the key and serialises interpolation options, so a
 *    test can assert both which key was requested and which values were passed.
 *
 * One test group uses a stateful parent rather than fixed props. `canImport` is
 * `validation.ok && !importing`, and a valid URL can only be typed while the
 * input is enabled, which means `importing` is false at that moment. With fixed
 * props the second operand of that `&&` is therefore never evaluated. Only a
 * parent that flips `importing` to true after the confirm click reaches it.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "./ImportHubModal.module.less";

interface Market {
  key: string;
  name: string;
  homepage: string;
  urlPrefix: string;
  examples: { label: string; url: string }[];
}

const holder = vi.hoisted(() => ({ current: null as unknown[] | null }));

vi.mock("./index", async (importOriginal) => {
  const original = await importOriginal<typeof import("./index")>();
  return {
    ...original,
    get skillMarkets() {
      return holder.current ?? original.skillMarkets;
    },
  };
});

vi.mock("@agentscope-ai/design", async () => {
  const React = await import("react");

  const Modal = (props: {
    className?: string;
    title?: React.ReactNode;
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
      { className: props.className, "data-testid": "modal-root" },
      React.createElement("div", { "data-testid": "modal-title" }, props.title),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "modal-close-request",
          onClick: () => props.onCancel?.(),
        },
        "close",
      ),
      props.children,
      React.createElement(
        "div",
        { "data-testid": "modal-footer" },
        props.footer,
      ),
    );
  };

  const Button = ({
    children,
    onClick,
    loading,
    disabled,
    className,
    type,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    className?: string;
    type?: string;
  }) =>
    React.createElement(
      "button",
      {
        className,
        type,
        disabled: disabled === true,
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
const { skillMarkets } = await import("./index");

type ModalProps = ComponentProps<typeof ImportHubModal>;

const realMarkets = skillMarkets as Market[];

interface Rendered {
  container: HTMLElement;
  unmount: () => void;
  calls: string[];
  input: HTMLInputElement;
}

function renderModal(options?: {
  open?: boolean;
  importing?: boolean;
  hint?: string;
  withCancelImport?: boolean;
}): Rendered {
  const calls: string[] = [];
  const props: ModalProps = {
    open: options?.open ?? true,
    importing: options?.importing ?? false,
    hint: options?.hint,
    onCancel: () => calls.push("cancel"),
    onConfirm: async (url, targetName) => {
      calls.push(`confirm:${url}:${String(targetName)}`);
    },
  };
  if (options?.withCancelImport !== false) {
    props.cancelImport = () => calls.push("cancelImport");
  }
  const view = render(<ImportHubModal {...props} />);
  return {
    container: view.container,
    unmount: view.unmount,
    calls,
    input: view.container.querySelector(
      `.${styles.urlInput}`,
    ) as HTMLInputElement,
  };
}

function cancelButtonOf(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    `.${styles.cancelButton}`,
  ) as HTMLButtonElement;
}

function importButtonOf(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    `.${styles.importButton}`,
  ) as HTMLButtonElement;
}

function closeRequestOf(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[data-testid="modal-close-request"]',
  ) as HTMLButtonElement;
}

function statusTextOf(container: HTMLElement): string {
  const node = container.querySelector(`.${styles.validationStatus}`);
  return node ? node.textContent ?? "" : "<missing>";
}

function statusSpanClassOf(container: HTMLElement): string {
  const node = container.querySelector(`.${styles.validationStatus} > span`);
  return node ? node.className : "<none>";
}

function wrapperClassOf(container: HTMLElement): string {
  const node = container.querySelector(`.${styles.inputWrapper}`);
  return node ? node.className : "<missing>";
}

function rowsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[role="button"]'));
}

function clearButtonOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector(`.${styles.iconButton}`);
}

function currentInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector(`.${styles.urlInput}`) as HTMLInputElement;
}

function typeUrl(container: HTMLElement, value: string): void {
  fireEvent.change(currentInput(container), { target: { value } });
}

function iconLabelOf(container: HTMLElement): string | null {
  const icon = container.querySelector(`.${styles.validationStatus} .anticon`);
  return icon ? icon.getAttribute("aria-label") : null;
}

beforeEach(() => {
  holder.current = null;
});

describe("ImportHubModal closed state", () => {
  it("renders nothing at all when open is false", () => {
    const view = renderModal({ open: false });
    expect(view.container.innerHTML).toBe("");
    expect(view.container.querySelector(`.${styles.urlInput}`)).toBeNull();
    expect(
      view.container.querySelector('[data-testid="modal-footer"]'),
    ).toBeNull();
    view.unmount();
  });

  it("renders no source rows and no buttons when closed", () => {
    const view = renderModal({ open: false });
    expect(rowsOf(view.container)).toHaveLength(0);
    expect(view.container.querySelectorAll("button")).toHaveLength(0);
    view.unmount();
  });

  it("renders content again when reopened", () => {
    const closed = renderModal({ open: false });
    expect(closed.container.innerHTML).toBe("");
    closed.unmount();

    const opened = renderModal({ open: true });
    expect(
      opened.container.querySelector(`.${styles.urlInput}`),
    ).not.toBeNull();
    expect(rowsOf(opened.container)).toHaveLength(realMarkets.length);
    opened.unmount();
  });
});

describe("ImportHubModal dialog chrome", () => {
  it("shows the import title and applies the modal class name", () => {
    const view = renderModal();
    expect(
      view.container.querySelector('[data-testid="modal-title"]'),
    ).toHaveTextContent("skills.importHub");
    expect(
      view.container.querySelector(`.${styles.importHubModal}`),
    ).not.toBeNull();
    view.unmount();
  });

  it("renders the hint paragraph only when a hint is given", () => {
    const withHint = renderModal({ hint: "Pick a hub URL" });
    const hintNode = withHint.container.querySelector(`.${styles.hintText}`);
    expect(hintNode).not.toBeNull();
    expect(hintNode).toHaveTextContent("Pick a hub URL");
    withHint.unmount();

    const withoutHint = renderModal();
    expect(
      withoutHint.container.querySelector(`.${styles.hintText}`),
    ).toBeNull();
    withoutHint.unmount();
  });

  it("keeps the sources section header and list present", () => {
    const view = renderModal();
    expect(
      view.container.querySelector(`.${styles.sourcesSection}`),
    ).not.toBeNull();
    expect(
      view.container.querySelector(`.${styles.sourcesHeader}`),
    ).toHaveTextContent("skills.supportedSources");
    expect(
      view.container.querySelector(`.${styles.sourcesList}`),
    ).not.toBeNull();
    view.unmount();
  });
});

describe("ImportHubModal url input", () => {
  it("labels the input with the placeholder key and text type", () => {
    const view = renderModal();
    expect(view.input).not.toBeNull();
    expect(view.input.getAttribute("aria-label")).toBe("skills.enterSkillUrl");
    expect(view.input.getAttribute("placeholder")).toBe("skills.enterSkillUrl");
    expect(view.input.type).toBe("text");
    view.unmount();
  });

  it("starts empty and stays controlled while typing", () => {
    const view = renderModal();
    expect(view.input.value).toBe("");
    typeUrl(view.container, "https://skills.sh/a");
    expect(currentInput(view.container).value).toBe("https://skills.sh/a");
    view.unmount();
  });

  it("disables the input while an import is running", () => {
    const idle = renderModal({ importing: false });
    expect(idle.input.disabled).toBe(false);
    idle.unmount();

    const busy = renderModal({ importing: true });
    expect(busy.input.disabled).toBe(true);
    busy.unmount();
  });

  it("renders the link icon inside the input wrapper", () => {
    const view = renderModal();
    const icon = view.container.querySelector(`.${styles.urlInputIcon}`);
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-label")).toBe("link");
    view.unmount();
  });
});

describe("ImportHubModal clear button", () => {
  it("is absent while the input is empty", () => {
    const view = renderModal();
    expect(clearButtonOf(view.container)).toBeNull();
    view.unmount();
  });

  it("appears once the input holds any text, including whitespace", () => {
    const view = renderModal();
    typeUrl(view.container, "x");
    expect(clearButtonOf(view.container)).not.toBeNull();

    typeUrl(view.container, "   ");
    expect(clearButtonOf(view.container)).not.toBeNull();
    view.unmount();
  });

  it("carries the clear label on title, aria-label and type", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a");
    const button = clearButtonOf(view.container);
    expect(button?.getAttribute("title")).toBe("common.clear");
    expect(button?.getAttribute("aria-label")).toBe("common.clear");
    expect(button?.getAttribute("type")).toBe("button");
    view.unmount();
  });

  it("empties the input and removes itself when clicked", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a");
    fireEvent.click(clearButtonOf(view.container) as HTMLButtonElement);
    expect(currentInput(view.container).value).toBe("");
    expect(clearButtonOf(view.container)).toBeNull();
    view.unmount();
  });

  it("does not notify the parent when the input is cleared", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a");
    fireEvent.click(clearButtonOf(view.container) as HTMLButtonElement);
    expect(view.calls).toEqual([]);
    view.unmount();
  });

  it("drops the validation message together with the cleared value", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a");
    expect(statusTextOf(view.container)).not.toBe("");
    fireEvent.click(clearButtonOf(view.container) as HTMLButtonElement);
    expect(statusTextOf(view.container)).toBe("");
    expect(wrapperClassOf(view.container)).not.toContain(styles.valid);
    view.unmount();
  });
});

describe("ImportHubModal validation status area", () => {
  it("stays empty for an untouched input", () => {
    const view = renderModal();
    expect(statusTextOf(view.container)).toBe("");
    expect(
      view.container.querySelector(`.${styles.validationStatus} > span`),
    ).toBeNull();
    view.unmount();
  });

  it("stays empty for whitespace-only input because there is no message key", () => {
    const view = renderModal();
    typeUrl(view.container, "    ");
    expect(statusTextOf(view.container)).toBe("");
    expect(
      view.container.querySelector(`.${styles.validationStatus} > span`),
    ).toBeNull();
    view.unmount();
  });

  it("reports an unparseable url with the invalid url key and cross icon", () => {
    const view = renderModal();
    typeUrl(view.container, "not a url");
    expect(statusTextOf(view.container)).toBe("skills.invalidUrl");
    expect(iconLabelOf(view.container)).toBe("close-circle");
    view.unmount();
  });

  it("reports a parseable url from an unsupported host", () => {
    const view = renderModal();
    typeUrl(view.container, "https://example.com/skills/thing");
    expect(statusTextOf(view.container)).toBe("skills.invalidSkillUrlSource");
    expect(iconLabelOf(view.container)).toBe("close-circle");
    view.unmount();
  });

  it("reports a supported host whose path is outside the prefix", () => {
    const view = renderModal();
    typeUrl(view.container, "https://platform.agentscope.io/other");
    expect(statusTextOf(view.container)).toBe("skills.invalidSkillUrlSource");
    view.unmount();
  });

  it("accepts a supported host and path, names the source and shows a check icon", () => {
    const view = renderModal();
    typeUrl(
      view.container,
      "https://platform.agentscope.io/skills/@user/thing",
    );
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"QwenPaw"}',
    );
    expect(iconLabelOf(view.container)).toBe("check-circle");
    expect(statusSpanClassOf(view.container)).toContain(styles.valid);
    view.unmount();
  });

  it("shows a spinner and the loading key when importing with an empty input", () => {
    const view = renderModal({ importing: true });
    expect(statusTextOf(view.container)).toBe("common.loading");
    expect(view.container.querySelector(".ant-spin")).not.toBeNull();
    expect(statusSpanClassOf(view.container)).toContain(styles.validating);
    expect(iconLabelOf(view.container)).toBeNull();
    view.unmount();
  });

  it("names every one of the real supported markets", () => {
    expect(realMarkets.length).toBeGreaterThan(1);
    for (const market of realMarkets) {
      const view = renderModal();
      const example = market.examples[0]?.url ?? `${market.urlPrefix}probe`;
      typeUrl(view.container, example);
      expect(statusTextOf(view.container)).toBe(
        `skills.urlValid:${JSON.stringify({ source: market.name })}`,
      );
      view.unmount();
    }
  });

  it("treats the input host case-insensitively", () => {
    const view = renderModal();
    typeUrl(view.container, "https://SKILLS.SH/a/b");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Skills.sh"}',
    );
    view.unmount();
  });

  it("strips a leading www. from the input host", () => {
    const view = renderModal();
    typeUrl(view.container, "https://www.skills.sh/a/b");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Skills.sh"}',
    );
    view.unmount();
  });

  it("strips a leading www. from the market prefix host as well", () => {
    holder.current = [
      {
        key: "www-market",
        name: "WwwMarket",
        homepage: "https://www-market.test",
        urlPrefix: "https://WWW.www-market.test/skills/",
        examples: [{ label: "e", url: "https://www.www-market.test/skills/e" }],
      },
    ];
    const view = renderModal();
    typeUrl(view.container, "https://www.WWW-MARKET.test/skills/z");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"WwwMarket"}',
    );
    view.unmount();
  });

  it("compares the path case-insensitively", () => {
    const view = renderModal();
    typeUrl(
      view.container,
      "https://platform.agentscope.io/SKILLS/@user/thing",
    );
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"QwenPaw"}',
    );
    view.unmount();
  });

  it("skips a market whose urlPrefix cannot be parsed", () => {
    holder.current = [
      {
        key: "broken",
        name: "Broken",
        homepage: "https://broken.test",
        urlPrefix: "::::not-a-url::::",
        examples: [{ label: "e", url: "https://broken.test/e" }],
      },
      {
        key: "fine",
        name: "Fine",
        homepage: "https://fine.test",
        urlPrefix: "https://fine.test/skills/",
        examples: [{ label: "e", url: "https://fine.test/skills/e" }],
      },
    ];
    const view = renderModal();
    typeUrl(view.container, "https://broken.test/e");
    expect(statusTextOf(view.container)).toBe("skills.invalidSkillUrlSource");

    typeUrl(view.container, "https://fine.test/skills/e");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Fine"}',
    );
    view.unmount();
  });

  it("does not match when the host differs but the path matches", () => {
    holder.current = [
      {
        key: "only",
        name: "Only",
        homepage: "https://only.test",
        urlPrefix: "https://only.test/skills/",
        examples: [{ label: "e", url: "https://only.test/skills/e" }],
      },
    ];
    const view = renderModal();
    typeUrl(view.container, "https://other.test/skills/e");
    expect(statusTextOf(view.container)).toBe("skills.invalidSkillUrlSource");
    view.unmount();
  });
});

describe("ImportHubModal input wrapper state class", () => {
  it("adds the valid class once the url resolves to a known market", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a/b");
    expect(wrapperClassOf(view.container)).toContain(styles.valid);
    expect(wrapperClassOf(view.container)).not.toContain(styles.invalid);
    view.unmount();
  });

  it("adds the invalid class when there is a message key", () => {
    const view = renderModal();
    typeUrl(view.container, "nope");
    expect(wrapperClassOf(view.container)).toContain(styles.invalid);
    expect(wrapperClassOf(view.container)).not.toContain(styles.valid);
    view.unmount();
  });

  it("adds neither class when the input is empty and idle", () => {
    const view = renderModal();
    expect(wrapperClassOf(view.container)).toContain(styles.inputWrapper);
    expect(wrapperClassOf(view.container)).not.toContain(styles.valid);
    expect(wrapperClassOf(view.container)).not.toContain(styles.invalid);
    view.unmount();
  });

  it("adds neither class when the input is empty and importing", () => {
    const view = renderModal({ importing: true });
    expect(wrapperClassOf(view.container)).not.toContain(styles.valid);
    expect(wrapperClassOf(view.container)).not.toContain(styles.invalid);
    view.unmount();
  });

  it("switches from invalid to valid as the url becomes complete", () => {
    const view = renderModal();
    // A supported host whose path is outside the prefix is rejected, so this
    // intermediate state is genuinely invalid. Note that a bare host url such
    // as "https://skills.sh" is accepted: both sides reduce to the pathname
    // "/", so the prefix test passes.
    typeUrl(view.container, "https://platform.agentscope.io/other");
    expect(wrapperClassOf(view.container)).toContain(styles.invalid);
    typeUrl(view.container, "https://platform.agentscope.io/skills/a");
    expect(wrapperClassOf(view.container)).toContain(styles.valid);
    expect(wrapperClassOf(view.container)).not.toContain(styles.invalid);
    view.unmount();
  });

  it("accepts a bare supported host because both pathnames reduce to the root", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Skills.sh"}',
    );
    view.unmount();
  });
});

describe("ImportHubModal footer buttons", () => {
  it("renders a cancel and a confirm button in the footer", () => {
    const view = renderModal();
    const footer = view.container.querySelector('[data-testid="modal-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector(`.${styles.modalFooter}`)).not.toBeNull();
    expect(cancelButtonOf(view.container)).toHaveTextContent("common.cancel");
    expect(importButtonOf(view.container)).toHaveTextContent("common.confirm");
    view.unmount();
  });

  it("marks the confirm button primary and not loading while idle", () => {
    const view = renderModal();
    const button = importButtonOf(view.container);
    expect(button.getAttribute("type")).toBe("primary");
    expect(button.getAttribute("data-loading")).toBe("no");
    view.unmount();
  });

  it("disables the confirm button while the input is empty", () => {
    const view = renderModal();
    expect(importButtonOf(view.container).disabled).toBe(true);
    view.unmount();
  });

  it("disables the confirm button for an invalid url", () => {
    const view = renderModal();
    typeUrl(view.container, "nope");
    expect(importButtonOf(view.container).disabled).toBe(true);
    view.unmount();
  });

  it("enables the confirm button for a valid url while idle", () => {
    const view = renderModal();
    typeUrl(view.container, "https://skills.sh/a/b");
    expect(importButtonOf(view.container).disabled).toBe(false);
    view.unmount();
  });

  it("keeps the confirm button disabled and loading while importing", () => {
    const view = renderModal({ importing: true });
    const button = importButtonOf(view.container);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("data-loading")).toBe("yes");
    view.unmount();
  });

  it("keeps the cancel button enabled while importing", () => {
    const view = renderModal({ importing: true });
    expect(cancelButtonOf(view.container).disabled).toBe(false);
    view.unmount();
  });

  it("labels the cancel button with the cancel import key while importing", () => {
    const view = renderModal({ importing: true, withCancelImport: true });
    expect(cancelButtonOf(view.container)).toHaveTextContent(
      "skills.cancelImport",
    );
    view.unmount();
  });

  it("labels the cancel button with the common key when no cancel handler exists", () => {
    const view = renderModal({ importing: true, withCancelImport: false });
    expect(cancelButtonOf(view.container)).toHaveTextContent("common.cancel");
    view.unmount();
  });

  it("labels the cancel button with the common key while idle even with a handler", () => {
    const view = renderModal({ importing: false, withCancelImport: true });
    expect(cancelButtonOf(view.container)).toHaveTextContent("common.cancel");
    view.unmount();
  });
});

describe("ImportHubModal confirm flow", () => {
  it("hands the trimmed url to onConfirm without a target name", async () => {
    const view = renderModal();
    typeUrl(view.container, "  https://skills.sh/a/b  ");
    await act(async () => {
      fireEvent.click(importButtonOf(view.container));
    });
    expect(view.calls).toEqual(["confirm:https://skills.sh/a/b:undefined"]);
    view.unmount();
  });

  it("keeps the typed value and the valid message after confirming", async () => {
    const view = renderModal();
    typeUrl(view.container, "https://clawhub.ai/x/y");
    await act(async () => {
      fireEvent.click(importButtonOf(view.container));
    });
    expect(currentInput(view.container).value).toBe("https://clawhub.ai/x/y");
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"ClawHub"}',
    );
    view.unmount();
  });

  it("does not notify the parent while the confirm button is disabled", () => {
    const view = renderModal();
    // A disabled button receives no click event in jsdom or in a browser, so
    // the expectation here is about the attribute, not about click handling.
    expect(importButtonOf(view.container).disabled).toBe(true);
    expect(view.calls).toEqual([]);
    view.unmount();
  });
});

describe("ImportHubModal cancel flow", () => {
  it("resets the url and notifies the parent when cancelled while idle", () => {
    const view = renderModal({ importing: false, withCancelImport: false });
    typeUrl(view.container, "https://skills.sh/a/b");
    fireEvent.click(cancelButtonOf(view.container));
    expect(view.calls).toEqual(["cancel"]);
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("resets the url and notifies the parent on a dialog close request", () => {
    const view = renderModal({ importing: false });
    typeUrl(view.container, "https://skills.sh/a/b");
    fireEvent.click(closeRequestOf(view.container));
    expect(view.calls).toEqual(["cancel"]);
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("routes the cancel button to cancelImport while importing", () => {
    const view = renderModal({ importing: true, withCancelImport: true });
    fireEvent.click(cancelButtonOf(view.container));
    expect(view.calls).toEqual(["cancelImport"]);
    view.unmount();
  });

  it("leaves the dialog untouched on cancelImport rather than cancelling", () => {
    const view = renderModal({ importing: true, withCancelImport: true });
    typeUrl(view.container, "");
    fireEvent.click(cancelButtonOf(view.container));
    expect(view.calls).not.toContain("cancel");
    view.unmount();
  });

  it("ignores a cancel button press while importing without a cancel handler", () => {
    const view = renderModal({ importing: true, withCancelImport: false });
    fireEvent.click(cancelButtonOf(view.container));
    expect(view.calls).toEqual([]);
    view.unmount();
  });

  it("ignores a dialog close request while importing", () => {
    const view = renderModal({ importing: true });
    fireEvent.click(closeRequestOf(view.container));
    expect(view.calls).toEqual([]);
    view.unmount();
  });
});

describe("ImportHubModal source list", () => {
  it("renders one row per market with name, homepage link and example", () => {
    const view = renderModal();
    const rows = rowsOf(view.container);
    expect(rows).toHaveLength(realMarkets.length);
    rows.forEach((row, index) => {
      const market = realMarkets[index];
      const anchor = row.querySelector(
        `.${styles.sourceName}`,
      ) as HTMLAnchorElement;
      expect(anchor).toHaveTextContent(market.name);
      expect(anchor.getAttribute("href")).toBe(market.homepage);
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
      expect(row.querySelector(`.${styles.sourceExample}`)).toHaveTextContent(
        market.examples[0].url,
      );
    });
    view.unmount();
  });

  it("marks every row focusable and titled while idle", () => {
    const view = renderModal();
    rowsOf(view.container).forEach((row) => {
      expect(row.getAttribute("tabindex")).toBe("0");
      expect(row.getAttribute("title")).toBe("skills.clickToFill");
    });
    view.unmount();
  });

  it("fills the input with the first example when a row is clicked", () => {
    const view = renderModal();
    fireEvent.click(rowsOf(view.container)[2]);
    expect(currentInput(view.container).value).toBe(
      realMarkets[2].examples[0].url,
    );
    view.unmount();
  });

  it("marks the filled example as valid straight away", () => {
    const view = renderModal();
    fireEvent.click(rowsOf(view.container)[2]);
    expect(statusTextOf(view.container)).toBe(
      `skills.urlValid:${JSON.stringify({ source: realMarkets[2].name })}`,
    );
    view.unmount();
  });

  it("fills the input when Enter is pressed on a row", () => {
    const view = renderModal();
    fireEvent.keyDown(rowsOf(view.container)[1], { key: "Enter" });
    expect(currentInput(view.container).value).toBe(
      realMarkets[1].examples[0].url,
    );
    view.unmount();
  });

  it("ignores keys other than Enter", () => {
    const view = renderModal();
    fireEvent.keyDown(rowsOf(view.container)[1], { key: "a" });
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("overwrites a previous value when another row is picked", () => {
    const view = renderModal();
    const rows = rowsOf(view.container);
    fireEvent.click(rows[0]);
    expect(currentInput(view.container).value).toBe(
      realMarkets[0].examples[0].url,
    );
    fireEvent.keyDown(rows[3], { key: "Enter" });
    expect(currentInput(view.container).value).toBe(
      realMarkets[3].examples[0].url,
    );
    view.unmount();
  });

  it("renders a market without examples as unfocusable and untitled", () => {
    holder.current = [
      {
        key: "no-example",
        name: "NoExample",
        homepage: "https://no-example.test",
        urlPrefix: "https://no-example.test/skills/",
        examples: [],
      },
    ];
    const view = renderModal();
    const row = rowsOf(view.container)[0];
    expect(row.getAttribute("tabindex")).toBe("-1");
    expect(row.getAttribute("title")).toBeNull();
    expect(row.querySelector(`.${styles.sourceExample}`)).toHaveTextContent("");
    view.unmount();
  });

  it("ignores Enter on a row that has no example", () => {
    holder.current = [
      {
        key: "no-example",
        name: "NoExample",
        homepage: "https://no-example.test",
        urlPrefix: "https://no-example.test/skills/",
        examples: [],
      },
    ];
    const view = renderModal();
    fireEvent.keyDown(rowsOf(view.container)[0], { key: "Enter" });
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("ignores a click on a row without examples but honours its neighbour", () => {
    holder.current = [
      {
        key: "no-example",
        name: "NoExample",
        homepage: "https://no-example.test",
        urlPrefix: "https://no-example.test/skills/",
        examples: [],
      },
      {
        key: "with-example",
        name: "WithExample",
        homepage: "https://with-example.test",
        urlPrefix: "https://with-example.test/skills/",
        examples: [{ label: "e", url: "https://with-example.test/skills/e" }],
      },
    ];
    const view = renderModal();
    const rows = rowsOf(view.container);
    expect(rows[0].getAttribute("tabindex")).toBe("-1");
    expect(rows[1].getAttribute("tabindex")).toBe("0");
    fireEvent.click(rows[0]);
    expect(currentInput(view.container).value).toBe("");
    fireEvent.click(rows[1]);
    expect(currentInput(view.container).value).toBe(
      "https://with-example.test/skills/e",
    );
    view.unmount();
  });

  it("does not fill the input when the homepage anchor is clicked", () => {
    const view = renderModal();
    fireEvent.click(
      rowsOf(view.container)[0].querySelector(`.${styles.sourceName}`)!,
    );
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });

  it("adds the disabled class and removes focusability while importing", () => {
    const view = renderModal({ importing: true });
    rowsOf(view.container).forEach((row) => {
      expect(row.className).toContain(styles.disabled);
      expect(row.getAttribute("tabindex")).toBe("-1");
    });
    view.unmount();
  });

  it("omits the disabled class while idle", () => {
    const view = renderModal({ importing: false });
    rowsOf(view.container).forEach((row) => {
      expect(row.className).toContain(styles.sourceRow);
      expect(row.className).not.toContain(styles.disabled);
    });
    view.unmount();
  });

  it("ignores row clicks and Enter keys while importing", () => {
    const view = renderModal({ importing: true });
    const row = rowsOf(view.container)[0];
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(currentInput(view.container).value).toBe("");
    view.unmount();
  });
});

describe("ImportHubModal with a stateful parent", () => {
  function Harness({ withCancelImport }: { withCancelImport: boolean }) {
    const [importing, setImporting] = useState(false);
    const [confirmed, setConfirmed] = useState<string[]>([]);
    const [cancels, setCancels] = useState(0);

    const handleConfirm = useCallback(async (url: string) => {
      setImporting(true);
      setConfirmed((previous) => [...previous, url]);
    }, []);

    const handleCancel = useCallback(() => {
      setCancels((previous) => previous + 1);
      setImporting(false);
    }, []);

    const handleCancelImport = useCallback(() => {
      setCancels((previous) => previous + 100);
      setImporting(false);
    }, []);

    const cancelImport = withCancelImport ? handleCancelImport : undefined;

    return (
      <div>
        <span data-testid="importing-out">{String(importing)}</span>
        <span data-testid="confirmed-out">{JSON.stringify(confirmed)}</span>
        <span data-testid="cancels-out">{String(cancels)}</span>
        <ImportHubModal
          open
          importing={importing}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          cancelImport={cancelImport}
        />
      </div>
    );
  }

  function reading(view: { container: HTMLElement }, key: string): string {
    return (
      view.container.querySelector(`[data-testid="${key}"]`)?.textContent ??
      "<missing>"
    );
  }

  async function startImport(container: HTMLElement): Promise<void> {
    typeUrl(container, "https://skills.sh/a/b");
    await act(async () => {
      fireEvent.click(importButtonOf(container));
    });
  }

  it("disables the confirm button once the parent reports an import in flight", async () => {
    const view = render(<Harness withCancelImport={false} />);
    expect(reading(view, "importing-out")).toBe("false");
    expect(importButtonOf(view.container).disabled).toBe(true);

    await startImport(view.container);

    expect(reading(view, "importing-out")).toBe("true");
    expect(reading(view, "confirmed-out")).toBe(
      JSON.stringify(["https://skills.sh/a/b"]),
    );
    // A valid url is still in the input, so this proves the disabled state
    // comes from the importing flag rather than from the validation result.
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Skills.sh"}',
    );
    expect(importButtonOf(view.container).disabled).toBe(true);
    expect(importButtonOf(view.container).getAttribute("data-loading")).toBe(
      "yes",
    );
    view.unmount();
  });

  it("switches the cancel label once the parent reports an import in flight", async () => {
    const view = render(<Harness withCancelImport />);
    expect(cancelButtonOf(view.container)).toHaveTextContent("common.cancel");

    await startImport(view.container);

    expect(cancelButtonOf(view.container)).toHaveTextContent(
      "skills.cancelImport",
    );
    expect(reading(view, "cancels-out")).toBe("0");
    view.unmount();
  });

  it("keeps the valid message ahead of the spinner while importing", async () => {
    const view = render(<Harness withCancelImport />);
    expect(view.container.querySelector(".ant-spin")).toBeNull();

    await startImport(view.container);

    // The url stays valid, so the valid message keeps priority over the spinner.
    expect(statusTextOf(view.container)).toBe(
      'skills.urlValid:{"source":"Skills.sh"}',
    );
    expect(view.container.querySelector(".ant-spin")).toBeNull();
    view.unmount();
  });

  it("leaves the import running when a dialog close request is ignored", async () => {
    const view = render(<Harness withCancelImport />);
    await startImport(view.container);

    fireEvent.click(closeRequestOf(view.container));

    expect(reading(view, "importing-out")).toBe("true");
    expect(reading(view, "cancels-out")).toBe("0");
    expect(reading(view, "confirmed-out")).toBe(
      JSON.stringify(["https://skills.sh/a/b"]),
    );
    view.unmount();
  });

  it("leaves the import running on a cancel button press without a cancel handler", async () => {
    const view = render(<Harness withCancelImport={false} />);
    await startImport(view.container);

    fireEvent.click(cancelButtonOf(view.container));

    expect(reading(view, "importing-out")).toBe("true");
    expect(reading(view, "cancels-out")).toBe("0");
    view.unmount();
  });

  it("ends the import through cancelImport and re-enables confirming", async () => {
    const view = render(<Harness withCancelImport />);
    await startImport(view.container);

    fireEvent.click(cancelButtonOf(view.container));

    expect(reading(view, "cancels-out")).toBe("100");
    expect(reading(view, "importing-out")).toBe("false");
    expect(importButtonOf(view.container).disabled).toBe(false);
    expect(cancelButtonOf(view.container)).toHaveTextContent("common.cancel");

    await act(async () => {
      fireEvent.click(importButtonOf(view.container));
    });
    expect(reading(view, "confirmed-out")).toBe(
      JSON.stringify(["https://skills.sh/a/b", "https://skills.sh/a/b"]),
    );
    view.unmount();
  });

  it("re-enables the input and the source rows once the import ends", async () => {
    const view = render(<Harness withCancelImport />);
    await startImport(view.container);
    expect(currentInput(view.container).disabled).toBe(true);
    expect(rowsOf(view.container)[0].getAttribute("tabindex")).toBe("-1");

    fireEvent.click(cancelButtonOf(view.container));

    expect(currentInput(view.container).disabled).toBe(false);
    expect(rowsOf(view.container)[0].getAttribute("tabindex")).toBe("0");
    fireEvent.click(rowsOf(view.container)[0]);
    expect(currentInput(view.container).value).toBe(
      realMarkets[0].examples[0].url,
    );
    view.unmount();
  });

  it("has no user-facing way to end an import when the parent supplies no cancel handler", async () => {
    const view = render(<Harness withCancelImport={false} />);
    await startImport(view.container);
    expect(currentInput(view.container).disabled).toBe(true);

    // While importing, handleClose returns early, so neither the cancel button
    // nor a dialog close request can reach onCancel. The parent alone can end
    // the import in that configuration; both user-facing paths stay inert.
    fireEvent.click(closeRequestOf(view.container));
    expect(reading(view, "importing-out")).toBe("true");
    expect(reading(view, "cancels-out")).toBe("0");
    fireEvent.click(cancelButtonOf(view.container));
    expect(reading(view, "importing-out")).toBe("true");
    expect(reading(view, "cancels-out")).toBe("0");
    expect(currentInput(view.container).disabled).toBe(true);
    view.unmount();
  });
});
