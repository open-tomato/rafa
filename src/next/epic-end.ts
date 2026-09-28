/**
 * The end of an epic: the lines `rafa next` ends with when the walk ran
 * dry inside an epic, the next steps that are no row of the state table.
 *
 * A dry epic is one whose every line is done or taken though the epic is
 * not done (`src/board/epic-walk.ts`), carried out of the walk as
 * {@link NextRoadmapReading.dryEpic} (`./sources.ts`). Row 13,
 * `nothing-left`, then reads a roadmap with no line left and proposes a
 * new spec issue; what the person actually does next is close the epic,
 * so `rafa next` ends with up to three lines after its own:
 *
 * ```text
 * 👉 epic #80 Epic title has run dry: close it through its gate — rafa epic close 80
 * 🗺 list the board's epics with their state and progress — rafa roadmap
 * 🏷 0.8.0 is in CHANGELOG.md with no tag: tag the release — rafa release tag
 * ```
 *
 * The first two are always there; the third only where
 * {@link readEpicEndRelease} finds a version the changelog calls
 * released that no tag names, the reading `rafa release status` makes
 * through `readUntagged` and `readTags` (`src/commands/release/status.ts`).
 * The release commands are named, never run: `rafa epic close` is the
 * gate that checks the acceptance criteria and `release tag` a write of
 * its own, and each is the person's to type.
 *
 * ## Read only when an epic ran dry
 *
 * {@link watchDryEpic} wraps one answer's board so the reading its walk
 * makes is remembered without being made twice: the command reads the
 * listing once, as every command here does. The wrap reads nothing of
 * its own, so a turn whose rows never walked the roadmap — off the base
 * branch, say — remembers no epic and prints no line.
 * {@link readEpicEndRelease} runs `git tag --list` and reads the
 * changelog, and the caller asks it only once a dry epic was found, so
 * a project with no `type:epic` issue sends not one command more and
 * prints byte-identical output.
 *
 * ## When the release reading fails
 *
 * A tag listing that failed is a problem, NOT an empty list: read as
 * empty, every version the changelog names would be offered for
 * tagging. So a failed reading of either file answers no versions and
 * the sentence of what failed, which the caller writes as a warning,
 * and the release line is left out rather than guessed.
 */
import type { DryEpic, NextBoard, NextRoadmapReading, NextSources } from './readings.js';
import type { GitRunner } from '../pr/index.js';

import { readTags, readUntagged } from '../commands/release/status.js';

/** The mark the closing gate's line opens with: the next step, as the proposal line marks it. */
const CLOSE_MARK = '👉';

/** The mark the line naming the board's epics opens with. */
const ROADMAP_MARK = '🗺';

/** The mark the release line opens with. */
const RELEASE_MARK = '🏷';

/** The command that lists the board's epics. */
export const EPIC_END_ROADMAP_COMMAND = 'rafa roadmap';

/** The command that tags the untagged release. */
export const EPIC_END_RELEASE_COMMAND = 'rafa release tag';

/** The closing gate's command line for `epic`. */
export function epicCloseCommand(epic: DryEpic): string {
  return `rafa epic close ${String(epic.number)}`;
}

/** What the release reading answered: the untagged versions, or why none could be read. */
export interface EpicEndRelease {
  /** The path as `release.changelog` spells it. */
  readonly changelog: string;
  /** The released versions no tag names, newest first; empty when the reading failed. */
  readonly versions: readonly string[];
  /** Why the reading failed, or null when it was made. */
  readonly problem: string | null;
}

/**
 * The versions the changelog at `changelog` under `root` calls released
 * that no release tag of the repository `git` runs in names. A reading
 * that failed answers none and says why; see the module note.
 */
export function readEpicEndRelease(git: GitRunner, root: string, changelog: string): EpicEndRelease {
  const tags = readTags(git);
  if (tags.problem !== null) return { changelog, versions: [], problem: tags.problem };

  const untagged = readUntagged(root, changelog, tags.tags);
  return untagged.problem === null
    ? { changelog, versions: untagged.versions, problem: null }
    : { changelog, versions: [], problem: untagged.problem };
}

/** The versions as a sentence names them, with the verb that agrees. */
function namedVersions(versions: readonly string[]): string {
  if (versions.length === 1) return `${versions[0] ?? ''} is`;
  const head = versions.slice(0, -1).join(', ');
  return `${head} and ${versions[versions.length - 1] ?? ''} are`;
}

/**
 * The lines `rafa next` ends with for `epic`: the closing gate, the
 * board's epics, and the release line when `release` names a version to
 * tag. `release` is null where it was not read.
 */
export function epicEndLines(epic: DryEpic, release: EpicEndRelease | null): readonly string[] {
  const lines = [
    `${CLOSE_MARK} epic #${String(epic.number)} ${epic.title} has run dry: close it through its gate`
      + ` — ${epicCloseCommand(epic)}`,
    `${ROADMAP_MARK} list the board's epics with their state and progress — ${EPIC_END_ROADMAP_COMMAND}`,
  ];
  if (release === null || release.versions.length === 0) return Object.freeze(lines);

  return Object.freeze([
    ...lines,
    `${RELEASE_MARK} ${namedVersions(release.versions)} in ${release.changelog} with no tag: tag the release`
      + ` — ${EPIC_END_RELEASE_COMMAND}`,
  ]);
}

/** The dry epic the last watched walk answered, and the watch itself. */
export interface DryEpicWatch {
  /** `sources` with its board's walk remembered; the last watched answer resets what was remembered. */
  readonly watch: (sources: NextSources) => NextSources;
  /** The dry epic of the last watched answer's walk, or null when it walked none dry or walked nothing. */
  readonly last: () => DryEpic | null;
}

/** A watch over the answers a chain reads; see the module note. */
export function watchDryEpic(): DryEpicWatch {
  let last: DryEpic | null = null;
  return {
    watch: (sources: NextSources): NextSources => {
      last = null;
      const { board } = sources;
      const watched: NextBoard = {
        ...board,
        next: async (): Promise<NextRoadmapReading> => {
          const reading = await board.next();
          last = reading.dryEpic ?? null;
          return reading;
        },
      };
      return { ...sources, board: watched };
    },
    last: () => last,
  };
}
