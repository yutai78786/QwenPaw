/**
 * Unit tests for BackupScopeForm, the full/partial scope section of the
 * create-backup modal.
 *
 * Facts that shaped this suite (each one measured with throwaway probes that
 * were deleted before this file landed):
 *
 * 1. antd renders for real here. The component imports `Checkbox, Radio`
 *    straight from `antd`, so radio/checkbox markup, the checked class and the
 *    indeterminate class are the genuine article and can be asserted directly.
 * 2. `./AgentMultiSelect` is mocked on purpose. Two reasons: (a) it has its own
 *    suite next door, so rendering the real one here would mix two files'
 *    coverage into one run and make it impossible to say which test earned
 *    which line; (b) the mock renders no `.ant-checkbox-wrapper`, which keeps
 *    the checkbox indices below stable: the real component would add a fourth
 *    checkbox-shaped node inside the dropdown.
 * 3. The form is controlled and every handler is a shallow merge
 *    (`onChange({ ...value, ...partial })`), so each case asserts the *whole*
 *    emitted object. That is what catches a merge that silently drops a field.
 * 4. A `vi.fn()` parent never re-renders, so the DOM stays at the initial
 *    `value`. Cases that only read what one click emits use that property (and
 *    say so); every case that depends on something *appearing* (the partial
 *    block, or the agent picker) drives real state through `Harness` and reads
 *    it back from a rendered `<output>` node.
 * 5. Checkbox order in partial mode is fixed by the source: agents, global
 *    config, skill pool, secrets. Measured labels are
 *    `backup.scopeAgents` / `backup.scopeGlobalConfig` /
 *    `backup.scopeSkillPool` / `backup.scopeSecrets`.
 * 6. `indeterminate` is `selectedAgents.length > 0 && selectedAgents.length <
 *    agents.length`, i.e. three reachable states. jsdom does render the
 *    `ant-checkbox-indeterminate` class for it, so all three are asserted.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";

vi.mock("react-i18next", () => {
  // Built once per factory call, so `t` keeps a stable identity.
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key;
  return {
    useTranslation: () => ({
      t,
      i18n: { resolvedLanguage: "en", changeLanguage: vi.fn(), language: "en" },
    }),
  };
});

vi.mock("./AgentMultiSelect", () => ({
  // Test double on purpose (see note 2): no antd Checkbox inside, so the
  // checkbox indices asserted below are exactly the form's own four.
  default: function AgentMultiSelectMock(props: {
    agents: { id: string }[];
    value: string[];
    onChange: (ids: string[]) => void;
  }) {
    return (
      <div data-testid="agent-multi-select">
        <span data-testid="ams-agents">
          {props.agents.map((a) => a.id).join(",")}
        </span>
        <span data-testid="ams-value">{JSON.stringify(props.value)}</span>
        <button
          type="button"
          data-testid="ams-pick"
          onClick={() => props.onChange(["a2"])}
        >
          pick
        </button>
        <button
          type="button"
          data-testid="ams-clear"
          onClick={() => props.onChange([])}
        >
          clear
        </button>
      </div>
    );
  },
}));

import BackupScopeForm from "./BackupScopeForm";
import type { ScopeFormValue } from "./BackupScopeForm";
import type { AgentSummary } from "@/api/types/agents";
import styles from "./BackupScopeForm.module.less";

const MODE_LABEL = "backup.backupMode";
const FULL_LABEL = "backup.fullBackup";
const PARTIAL_LABEL = "backup.partialBackup";
const CB_LABELS = [
  "backup.scopeAgents",
  "backup.scopeGlobalConfig",
  "backup.scopeSkillPool",
  "backup.scopeSecrets",
];

function makeAgent(id: string): AgentSummary {
  return {
    id,
    name: `Name-${id}`,
    description: "",
    workspace_dir: "",
    enabled: true,
    backend: "react",
  };
}

const AGENTS = [makeAgent("a1"), makeAgent("a2"), makeAgent("a3")];

function formValue(overrides: Partial<ScopeFormValue> = {}): ScopeFormValue {
  // Explicit full literal: `defaultCreateScope` is the production default, but
  // each case below states the value it depends on rather than inheriting one.
  return {
    backupMode: "full",
    selectedAgents: [],
    globalConfig: false,
    includeSkillPool: false,
    includeSecrets: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** Stateful parent: needed whenever a case depends on something appearing. */
function Harness({
  initial,
  agents = AGENTS,
}: {
  initial: ScopeFormValue;
  agents?: AgentSummary[];
}) {
  const [value, setValue] = useState<ScopeFormValue>(initial);
  return (
    <>
      <BackupScopeForm value={value} onChange={setValue} agents={agents} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function radios(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ant-radio-wrapper"),
  );
}

function checkboxes(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ant-checkbox-wrapper"),
  );
}

function checkedFlags(): boolean[] {
  return checkboxes().map(
    (c) => c.querySelector(".ant-checkbox-checked") !== null,
  );
}

function indeterminateFlags(): boolean[] {
  return checkboxes().map(
    (c) => c.querySelector(".ant-checkbox-indeterminate") !== null,
  );
}

function clickRadio(index: number): void {
  const input = radios()[index].querySelector("input");
  if (!input) throw new Error(`radio ${index} has no input`);
  fireEvent.click(input);
}

function clickCheckbox(index: number): void {
  const input = checkboxes()[index].querySelector("input");
  if (!input) throw new Error(`checkbox ${index} has no input`);
  fireEvent.click(input);
}

function shownValue(): ScopeFormValue {
  const raw =
    document.querySelector<HTMLElement>('[data-testid="value"]')?.textContent ??
    "null";
  return JSON.parse(raw) as ScopeFormValue;
}

describe("BackupScopeForm mode selector", () => {
  it("renders the mode label and both radio options", () => {
    const { container } = render(
      <BackupScopeForm
        value={formValue()}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(
      container.querySelector(`.${styles.sectionLabel}`)?.textContent,
    ).toBe(MODE_LABEL);
    expect(radios().map((r) => r.textContent)).toEqual([
      `${FULL_LABEL}backup.fullBackupDesc`,
      `${PARTIAL_LABEL}backup.partialBackupDesc`,
    ]);
  });

  it("marks the full radio checked and hides every scope checkbox in full mode", () => {
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "full" })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(
      radios().map((r) => r.querySelector(".ant-radio-checked") !== null),
    ).toEqual([true, false]);
    expect(checkboxes().length).toBe(0);
  });

  it("marks the partial radio checked and shows the four scope checkboxes in partial mode", () => {
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial" })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(
      radios().map((r) => r.querySelector(".ant-radio-checked") !== null),
    ).toEqual([false, true]);
    expect(checkboxes().map((c) => c.textContent)).toEqual(CB_LABELS);
  });

  it("emits the whole value with only backupMode changed when the partial radio is clicked", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "full",
          selectedAgents: ["a1"],
          globalConfig: true,
          includeSkillPool: true,
          includeSecrets: true,
        })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    clickRadio(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      backupMode: "partial",
      selectedAgents: ["a1"],
      globalConfig: true,
      includeSkillPool: true,
      includeSecrets: true,
    });
  });

  it("emits the whole value with only backupMode changed when the full radio is clicked back", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", globalConfig: true })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    clickRadio(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      backupMode: "full",
      selectedAgents: [],
      globalConfig: true,
      includeSkillPool: false,
      includeSecrets: false,
    });
  });

  it("switches the visible section when the mode radio is clicked through real state", () => {
    render(<Harness initial={formValue({ backupMode: "full" })} />);
    expect(checkboxes().length).toBe(0);
    expect(shownValue().backupMode).toBe("full");

    clickRadio(1);
    expect(shownValue().backupMode).toBe("partial");
    expect(checkboxes().map((c) => c.textContent)).toEqual(CB_LABELS);

    clickRadio(0);
    expect(shownValue().backupMode).toBe("full");
    expect(checkboxes().length).toBe(0);
  });
});

describe("BackupScopeForm scope checkboxes", () => {
  it("reflects each boolean field in its own checkbox", () => {
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a1"],
          globalConfig: true,
          includeSkillPool: false,
          includeSecrets: true,
        })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(checkedFlags()).toEqual([true, true, false, true]);
  });

  it("shows the secrets hint next to the secrets checkbox", () => {
    const { container } = render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial" })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(container.querySelector(`.${styles.secretsHint}`)?.textContent).toBe(
      "backup.scopeSecretsHint",
    );
  });

  it.each([
    [1, "globalConfig"],
    [2, "includeSkillPool"],
    [3, "includeSecrets"],
  ])(
    "toggles checkbox #%s into the %s field and leaves the others alone",
    (index, field) => {
      const onChange = vi.fn();
      render(
        <BackupScopeForm
          value={formValue({ backupMode: "partial" })}
          onChange={onChange}
          agents={AGENTS}
        />,
      );
      clickCheckbox(index as number);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toEqual({
        backupMode: "partial",
        selectedAgents: [],
        globalConfig: false,
        includeSkillPool: false,
        includeSecrets: false,
        [field as string]: true,
      });
    },
  );

  it("clears a boolean field when its checkbox is clicked while already checked", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", includeSecrets: true })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    clickCheckbox(3);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].includeSecrets).toBe(false);
  });

  it("keeps unrelated fields intact across several clicks when the parent does not re-render", () => {
    // Note 4: with a vi.fn() parent the DOM never moves, so the four clicks all
    // read the same initial value and each emitted object differs in one field.
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          globalConfig: true,
          includeSkillPool: true,
          includeSecrets: true,
        })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    clickCheckbox(1);
    clickCheckbox(2);
    clickCheckbox(3);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls.map((c) => c[0].globalConfig)).toEqual([
      false,
      true,
      true,
    ]);
    expect(onChange.mock.calls.map((c) => c[0].includeSkillPool)).toEqual([
      true,
      false,
      true,
    ]);
    expect(onChange.mock.calls.map((c) => c[0].includeSecrets)).toEqual([
      true,
      true,
      false,
    ]);
    // Nothing outside the clicked field ever changed.
    onChange.mock.calls.forEach((c) => {
      expect(c[0].backupMode).toBe("partial");
      expect(c[0].selectedAgents).toEqual([]);
    });
  });
});

describe("BackupScopeForm agents checkbox", () => {
  it("selects every agent id when the agents checkbox is checked", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", selectedAgents: [] })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    clickCheckbox(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].selectedAgents).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
  });

  it("clears the agent list when the agents checkbox is unchecked", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a1", "a2"],
        })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    expect(checkedFlags()[0]).toBe(true);
    clickCheckbox(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].selectedAgents).toEqual([]);
  });

  it("emits an empty agent list when checked while there are no agents to add", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", selectedAgents: [] })}
        onChange={onChange}
        agents={[]}
      />,
    );
    clickCheckbox(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].selectedAgents).toEqual([]);
  });

  it("marks the agents checkbox checked but not indeterminate once every agent is selected", () => {
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a1", "a2", "a3"],
        })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(checkedFlags()[0]).toBe(true);
    expect(indeterminateFlags()[0]).toBe(false);
  });

  it("marks the agents checkbox indeterminate on a partial agent selection", () => {
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a1"],
        })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(checkedFlags()[0]).toBe(true);
    expect(indeterminateFlags()[0]).toBe(true);
  });

  it("leaves the agents checkbox neither checked nor indeterminate when nothing is selected", () => {
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", selectedAgents: [] })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(checkedFlags()[0]).toBe(false);
    expect(indeterminateFlags()[0]).toBe(false);
  });

  it("leaves the agents checkbox untouched when the agent list itself is empty", () => {
    // `selectedAgents.length < agents.length` is false here (0 < 0), so the
    // length guard is what keeps an empty agent list out of the indeterminate
    // state.
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", selectedAgents: [] })}
        onChange={vi.fn()}
        agents={[]}
      />,
    );
    expect(checkedFlags()[0]).toBe(false);
    expect(indeterminateFlags()[0]).toBe(false);
  });
});

describe("BackupScopeForm agent picker wiring", () => {
  it("does not render the picker while no agent is selected", () => {
    render(
      <BackupScopeForm
        value={formValue({ backupMode: "partial", selectedAgents: [] })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).toBeNull();
  });

  it("renders the picker once an agent is selected and forwards both props", () => {
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a2"],
        })}
        onChange={vi.fn()}
        agents={AGENTS}
      />,
    );
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="ams-agents"]')?.textContent,
    ).toBe("a1,a2,a3");
    expect(
      document.querySelector('[data-testid="ams-value"]')?.textContent,
    ).toBe('["a2"]');
  });

  it("writes the picker selection back into selectedAgents", () => {
    const onChange = vi.fn();
    render(
      <BackupScopeForm
        value={formValue({
          backupMode: "partial",
          selectedAgents: ["a1"],
          includeSecrets: true,
        })}
        onChange={onChange}
        agents={AGENTS}
      />,
    );
    fireEvent.click(
      document.querySelector<HTMLElement>('[data-testid="ams-pick"]')!,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      backupMode: "partial",
      selectedAgents: ["a2"],
      globalConfig: false,
      includeSkillPool: false,
      includeSecrets: true,
    });
  });

  it("hides the picker again when the picker clears the selection through real state", () => {
    render(
      <Harness
        initial={formValue({
          backupMode: "partial",
          selectedAgents: ["a1"],
        })}
      />,
    );
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).not.toBeNull();

    fireEvent.click(
      document.querySelector<HTMLElement>('[data-testid="ams-clear"]')!,
    );
    expect(shownValue().selectedAgents).toEqual([]);
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).toBeNull();
    expect(checkedFlags()[0]).toBe(false);
    expect(indeterminateFlags()[0]).toBe(false);
  });

  it("grows the selection through the picker and shows the indeterminate state", () => {
    render(
      <Harness
        initial={formValue({
          backupMode: "partial",
          selectedAgents: ["a1"],
        })}
      />,
    );
    fireEvent.click(
      document.querySelector<HTMLElement>('[data-testid="ams-pick"]')!,
    );
    expect(shownValue().selectedAgents).toEqual(["a2"]);
    expect(checkedFlags()[0]).toBe(true);
    expect(indeterminateFlags()[0]).toBe(true);
  });

  it("drives the whole partial flow through real state: radio, agents checkbox, picker", () => {
    render(<Harness initial={formValue({ backupMode: "full" })} />);
    expect(checkboxes().length).toBe(0);

    clickRadio(1);
    expect(checkboxes().length).toBe(4);
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).toBeNull();

    clickCheckbox(0);
    expect(shownValue().selectedAgents).toEqual(["a1", "a2", "a3"]);
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).not.toBeNull();
    expect(checkedFlags()[0]).toBe(true);
    expect(indeterminateFlags()[0]).toBe(false);

    clickCheckbox(0);
    expect(shownValue().selectedAgents).toEqual([]);
    expect(
      document.querySelector('[data-testid="agent-multi-select"]'),
    ).toBeNull();
  });
});
