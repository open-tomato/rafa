/**
 * The roadmap step of `rafa init --board`: the pinned Roadmap issue and
 * `roadmap.issue` written to the project config. `./setup.ts` runs it
 * from `setUpBoard` and re-exports all of it, so its importers read it
 * there.
 *
 * The issue is opened with {@link roadmapIssueBody} under the
 * `naming.branch` template the caller hands {@link setUpRoadmap}, so its
 * naming paragraph names the branch a claim is made on: the template with
 * the stub, `feat/rafa-<n>-<slug>` by default. The template is read by the
 * command that runs the step; nothing here reads a config for it.
 *
 * ## The roadmap issue, and why the config is read before the search
 *
 * The order is: `roadmap.issue` in the project config, then the open
 * issue titled {@link ROADMAP_TITLE}, then a new issue. The config is
 * read FIRST on purpose. `gh issue list --search` goes through GitHub's
 * search index, which is not updated the moment an issue is created, so
 * a second run minutes after the first can be answered "no issue titled
 * Roadmap" for an issue that exists — and creating a second Roadmap
 * issue is the one failure here that cannot be undone by running the
 * command again. Once `roadmap.issue` names the issue, no later run
 * searches at all, so idempotency rests on a file in the checkout rather
 * than on an index nobody controls.
 *
 * Two open issues titled Roadmap are REFUSED, with `./roadmap.ts`'s own
 * sentence, for the reason it gives: which one holds the order is not
 * this command to guess.
 *
 * ## The roadmap carries {@link ROADMAP_LABEL}
 *
 * A board is an open issue labelled `type:roadmap`, so the Roadmap issue
 * this command opens is opened with `--label type:roadmap`; the labels
 * are made before the issue, so the label is there to be added. An
 * existing issue the title search ADOPTS is read with its labels, and
 * one that lacks the label gets it through
 * `gh issue edit <n> --add-label type:roadmap`. That write is what makes
 * its `issue` part `created` rather than `present`: the issue was not
 * opened by this run, but it was written to, and `boardChanged` (`./setup.ts`)
 * has to say so. An edit that fails leaves the part `present` and comes
 * back as a `BoardSetupReport.problems` sentence, the way a failed
 * pin does: `roadmap.issue` still names the issue, which is what every
 * reader ranks first.
 *
 * An issue `roadmap.issue` already names is not read at all, as before,
 * so it is not labelled either: that path sends nothing to GitHub.
 *
 * The pin is `gh issue pin <n>` (measured present in `gh` 2.100.0 on
 * 2026-09-19). A pin that fails does not make the part refused: the
 * issue exists and `roadmap.issue` names it, which is everything
 * `plan create --next` reads, and pinnedness is what a person sees on
 * the issues page. It comes back as a `BoardSetupReport.problems`
 * sentence instead, the shape `./roadmap.ts` uses for the half of a
 * branch scan that failed.
 *
 * ## Writing one setting into a file of comments
 *
 * `roadmap.issue` is written INTO the config `rafa init` wrote rather
 * than over it, so the commented template an operator reads stays in the
 * file. The edit, the shape it refuses and the parse-back that guards it
 * are `./setup-config.ts`'s; {@link writeRoadmapSetting} is the part
 * that reports what came of them.
 */
import type { SettingReading } from './setup-config.js';
import type { BoardPart } from './setup-parts.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { writeFileSync } from 'node:fs';

import { ID_PREFIX } from '@open-tomato/rafa/board/naming';
import { configFilePath } from '@open-tomato/rafa/core/config';
import {
  branchFromTemplate,
  DEFAULT_BRANCH_TEMPLATE,
  describeValue,
  isMapping,
  messageOf,
} from '@open-tomato/rafa/core/config/sections';

import { GITHUB_LABELS } from '../adapters/tracker/github.js';

import { ROADMAP_SETTING, ROADMAP_TITLE, severalRoadmapsMessage } from './roadmap.js';
import { readRoadmapSetting, roadmapIssueIn, withRoadmapIssue } from './setup-config.js';
import { detailOf, holdsLabel, parseRows, partOf, PREFIX, rowNumber, rowText } from './setup-parts.js';

/** The label that marks an open issue as a board; see the module note. */
export const ROADMAP_LABEL: string = `${GITHUB_LABELS.typePrefix}roadmap`;

/**
 * The body a new Roadmap issue is opened with: the empty list and the
 * naming paragraph, whose branch is the `naming.branch` `template` over
 * the stub, `feat/rafa-<n>-<slug>` under `DEFAULT_BRANCH_TEMPLATE`, the
 * template when left out.
 */
export function roadmapIssueBody(template: string = DEFAULT_BRANCH_TEMPLATE): string {
  const spec = `${ID_PREFIX}-<n>-<slug>`;
  const branch = branchFromTemplate(template, spec);
  return [
    '## Next, in order',
    '',
    '<!-- One issue per line, the one to take next at the top:',
    '`- [ ] #<n> why it is next`. rafa plan create --next walks this list',
    'from the top and takes the first line nobody has finished and nobody',
    'has started, so the order written here is the order the work happens',
    'in. A ticked line is done: rafa pr merge ticks one when the pull',
    'request that closes its issue is merged. -->',
    '',
    '## Naming',
    '',
    'Every piece of work has one issue, and the number of that issue is its',
    `id everywhere else: the spec \`${spec}.md\`, the plan stub \`${spec}\`,`,
    `the branch \`${branch}\` and the pull request title`,
    `\`${ID_PREFIX}-<n>: <what you get>\`.`,
    '',
  ].join('\n');
}

/**
 * The URL `gh issue create` prints, capturing the issue number.
 *
 * `src/adapters/tracker/github.ts` keeps its own copy of this pattern,
 * private, for the same line off the same command. Reading a URL is not
 * the concern either module is about, and the shared alternative is
 * exporting a regular expression from the tracker adapter, which is a
 * copied shape open-tomato owns: a second reader of it would be one more
 * thing a change there has to look at. This copy is the board's own, so
 * it is exported for `./issue-board.ts`, whose `createIssue` reads the
 * same line.
 */
export const CREATED_ISSUE_URL: RegExp = /^https:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+\/issues\/([1-9]\d*)$/u;

/** What a roadmap issue step came to: the parts it made and the issue, when there is one. */
export interface RoadmapStep {
  readonly parts: readonly BoardPart[];
  readonly issue: number | null;
  readonly problems: readonly string[];
}

/** The `Roadmap issue` part, under the name every caller groups it by. */
const ISSUE_PART_NAME = `${ROADMAP_TITLE} issue`;

/**
 * Writes `roadmap.issue: <issue>` into the project config under `root`,
 * having read the text back as that issue first. Answers the `setting`
 * part.
 */
export function writeRoadmapSetting(root: string, issue: number, reading: SettingReading): BoardPart {
  const path = configFilePath(root);
  const name = ROADMAP_SETTING;
  const written = withRoadmapIssue(reading.text, issue);
  if (written === null) {
    const why = `it spells roadmap in a shape this command does not edit, so set ${name} by hand`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }

  let read: number | null;
  try {
    read = roadmapIssueIn(written, path);
  } catch (error) {
    const why = `the file this run would have written does not parse: ${messageOf(error)}`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }
  if (read !== issue) {
    const why = `the file this run would have written reads ${name} as ${describeValue(read)}`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }

  try {
    writeFileSync(path, written, 'utf8');
  } catch (error) {
    return partOf('setting', name, 'refused', `${path} could not be written: ${messageOf(error)}`);
  }
  return partOf('setting', name, 'created', `${path} now names issue #${String(issue)}`);
}

/** Both parts refused for the same reason, when neither can be reached. */
function roadmapRefused(why: string): RoadmapStep {
  return {
    parts: [
      partOf('issue', ISSUE_PART_NAME, 'refused', why),
      partOf('setting', ROADMAP_SETTING, 'refused', why),
    ],
    issue: null,
    problems: [],
  };
}

/** One open issue titled {@link ROADMAP_TITLE}, and whether it already carries {@link ROADMAP_LABEL}. */
interface TitledRoadmap {
  readonly number: number;
  readonly labelled: boolean;
}

/** The label names a row carries at `labels`, checked. */
function rowLabels(row: unknown, command: string, where: string): readonly string[] {
  const value = isMapping(row)
    ? row['labels']
    : null;
  if (!Array.isArray(value)) {
    throw new Error(`${PREFIX}: ${command} answered ${where}.labels as ${describeValue(value)}, expected a list`);
  }
  return (value as readonly unknown[])
    .map((label, index) => rowText(label, 'name', command, `${where}.labels ${String(index)}`));
}

/** Every open issue titled {@link ROADMAP_TITLE}, by an exact fold of the title. */
async function searchRoadmapIssues(gh: GhRunner): Promise<readonly TitledRoadmap[]> {
  const search = `${ROADMAP_TITLE} in:title`;
  const args = ['issue', 'list', '--state', 'open', '--search', search, '--json', 'number,title,labels'];
  const command = `gh issue list --state open --search "${search}" --json number,title,labels`;

  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
  const wanted = ROADMAP_TITLE.toLowerCase();
  return Object.freeze(parseRows(result.stdout, command)
    .map((row, index) => ({
      number: rowNumber(row, 'number', command, `issue ${String(index)}`),
      title: rowText(row, 'title', command, `issue ${String(index)}`),
      labels: rowLabels(row, command, `issue ${String(index)}`),
    }))
    .filter((row) => row.title.trim().toLowerCase() === wanted)
    .map((row) => ({ number: row.number, labelled: holdsLabel(row.labels, ROADMAP_LABEL) })));
}

/**
 * Opens the Roadmap issue, its body naming the claim branch under
 * `template`, and answers its number, or throws naming the command.
 */
async function createRoadmapIssue(gh: GhRunner, template: string): Promise<number> {
  const command = `gh issue create --title ${ROADMAP_TITLE} --label ${ROADMAP_LABEL}`;
  const body = roadmapIssueBody(template);
  const result = await gh(['issue', 'create', '--title', ROADMAP_TITLE, '--label', ROADMAP_LABEL, '--body', body]);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);

  const url = result.stdout.trim().split('\n')
    .at(-1) ?? '';
  const number = CREATED_ISSUE_URL.exec(url)?.[1];
  if (number === undefined) {
    throw new Error(`${PREFIX}: ${command} exited 0 and printed no issue URL, so the issue may exist`
      + ` unrecorded; it wrote ${describeValue(result.stdout)}`);
  }
  return Number.parseInt(number, 10);
}

/** Pins `issue`; a failure is a sentence the caller carries, never a refusal. */
async function pinRoadmapIssue(gh: GhRunner, issue: number): Promise<string | null> {
  const command = `gh issue pin ${String(issue)}`;
  const result = await gh(['issue', 'pin', String(issue)]);
  return result.ok
    ? null
    : `issue #${String(issue)} was opened but not pinned, so it does not show at the top of the issues page: ${detailOf(result, command)}`;
}

/**
 * The `issue` part of an adopted Roadmap issue: `present` when it
 * already carries {@link ROADMAP_LABEL}, else `created` once the label
 * was added, with a problem sentence and `present` when it could not be.
 */
async function adoptRoadmapIssue(gh: GhRunner, found: TitledRoadmap): Promise<{ part: BoardPart; problem: string | null }> {
  const issue = String(found.number);
  const titled = `issue #${issue} is open and titled ${ROADMAP_TITLE}`;
  if (found.labelled) return { part: partOf('issue', ISSUE_PART_NAME, 'present', titled), problem: null };

  const command = `gh issue edit ${issue} --add-label ${ROADMAP_LABEL}`;
  const result = await gh(['issue', 'edit', issue, '--add-label', ROADMAP_LABEL]);
  return result.ok
    ? { part: partOf('issue', ISSUE_PART_NAME, 'created', `${titled}, and now carries ${ROADMAP_LABEL}`), problem: null }
    : {
      part: partOf('issue', ISSUE_PART_NAME, 'present', titled),
      problem: `issue #${issue} was adopted but not labelled ${ROADMAP_LABEL}: ${detailOf(result, command)}`,
    };
}

/**
 * The roadmap issue and the setting that names it: `roadmap.issue` when
 * the project config names one, else the open issue titled
 * {@link ROADMAP_TITLE}, else a new one. See the module note on why the
 * config is read before the search. A new issue's body names the claim
 * branch under `template`, the project's `naming.branch`, which is
 * `DEFAULT_BRANCH_TEMPLATE` when left out.
 */
export async function setUpRoadmap(
  gh: GhRunner,
  root: string,
  template: string = DEFAULT_BRANCH_TEMPLATE,
): Promise<RoadmapStep> {
  const reading = readRoadmapSetting(root);
  if (reading.problem !== null) return roadmapRefused(reading.problem);
  if (reading.issue !== null) {
    return {
      parts: [
        partOf('issue', ISSUE_PART_NAME, 'present', `${ROADMAP_SETTING} names issue #${String(reading.issue)}`),
        partOf('setting', ROADMAP_SETTING, 'present', `it already names issue #${String(reading.issue)}`),
      ],
      issue: reading.issue,
      problems: [],
    };
  }

  let found: readonly TitledRoadmap[];
  try {
    found = await searchRoadmapIssues(gh);
  } catch (error) {
    return roadmapRefused(messageOf(error));
  }
  if (found.length > 1) return roadmapRefused(severalRoadmapsMessage(found.map((row) => row.number)));

  const existing = found[0] ?? null;
  if (existing !== null) {
    const adopted = await adoptRoadmapIssue(gh, existing);
    return {
      parts: [adopted.part, writeRoadmapSetting(root, existing.number, reading)],
      issue: existing.number,
      problems: adopted.problem === null
        ? []
        : [adopted.problem],
    };
  }

  let opened: number;
  try {
    opened = await createRoadmapIssue(gh, template);
  } catch (error) {
    return roadmapRefused(messageOf(error));
  }
  const pin = await pinRoadmapIssue(gh, opened);
  return {
    parts: [
      partOf('issue', ISSUE_PART_NAME, 'created', `issue #${String(opened)} opened with ${ROADMAP_LABEL} and pinned`),
      writeRoadmapSetting(root, opened, reading),
    ],
    issue: opened,
    problems: pin === null
      ? []
      : [pin],
  };
}
