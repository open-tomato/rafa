/**
 * The `## Refs` section of a filed bug: the files and exported names its
 * `## Artifact` text points at, each with its target's fingerprint at the
 * time the bug was filed.
 *
 * A bug is filed against the tree as it stood when the session saw it.
 * By the time someone reads the issue, the file its artifact named may
 * have changed or gone, and the issue's text cannot say which. The stamp
 * beside each reference can: a reader who compares it with the target
 * now knows whether the bug was reported against the code in front of
 * them (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * ## What is read
 *
 * The artifact is read with `extractRefs` (`src/refs/extract.ts`), and
 * only the `path` and `symbol` references it answers are kept: those are
 * what an error string or a stack line points at, and the other kinds —
 * an issue, a command, a flag, a key — would need the board or the
 * command roster, which triage neither has nor should ask for a bug. The
 * extractor reads paths and symbols from code spans only, so an artifact
 * names a file for this section when it writes it in backticks, as in
 * `` `src/a.ts` ``; a bare `src/a.ts` in running text names nothing.
 *
 * The artifact read is the REDACTED one, the text `## Artifact` shows,
 * so the section never names what the artifact above it does not.
 *
 * ## The stamps
 *
 * Each reference is read through a {@link RefVerifier}, the verifier of
 * `src/refs/verify.ts`, and stamped with the word `fingerprintText`
 * answers for it: `blob:<sha>` for a committed file, `present` for a
 * directory, a file not yet committed or an exported name, and `absent`
 * for a target the tree does not hold. {@link createArtifactRefsVerifier}
 * makes the one triage reads with by default: git in the repository
 * root, and `ts-symbols` when it is on `PATH`.
 *
 * ## What the section never does
 *
 * It never rejects and never stops a bug being filed. A reference whose
 * reading threw — git missing, the root not a repository — is listed as
 * {@link UNREAD_STAMP}, and the reason is kept OFF the body: a git error
 * carries the machine's own paths, and the issue may be public.
 *
 * With no path and no symbol in the artifact, or no artifact, there is
 * no section: {@link buildRefsSection} answers null and the body goes
 * from `## Artifact` straight to `## Recurrence key`.
 */
import type { DescribeDocument } from '../cli/describe.js';
import type { Ref } from '../refs/extract.js';
import type { LiveReading } from '../refs/stamp.js';
import type { RefVerifier } from '../refs/verify.js';

import { DESCRIBE_BINARY, DESCRIBE_SCHEMA_VERSION } from '../cli/describe.js';
import { createGitRunner } from '../pr/git.js';
import { extractRefs } from '../refs/extract.js';
import { fingerprintText } from '../refs/stamp.js';
import { createRefVerifier, tsSymbolsOutliner } from '../refs/verify.js';

/** The heading the section is written under. */
export const REFS_HEADING = 'Refs';

/** The kinds of reference the section lists; see the module note. */
export const ARTIFACT_REF_KINDS: ReadonlySet<Ref['kind']> = new Set(['path', 'symbol']);

/** What a reference whose reading threw is stamped with in the section. */
export const UNREAD_STAMP = 'unread';

/** The sentence under the heading. */
const REFS_INTRO = 'The paths and symbols the artifact names, each with its target\'s'
  + ' fingerprint when this bug was filed.';

/** One reference the artifact names, and its stamp. */
export interface ArtifactRefStamp {
  readonly kind: Ref['kind'];
  readonly text: string;
  /** The fingerprint in one word, or {@link UNREAD_STAMP} when reading it threw. */
  readonly stamp: string;
}

/** The path and symbol references `artifact` names, in the order it first names them. */
export function artifactRefs(artifact: string): readonly Ref[] {
  return extractRefs(artifact).filter((ref) => ARTIFACT_REF_KINDS.has(ref.kind));
}

/** A live reading in one word; an unreadable one, which no path or symbol answers, as unread. */
function stampWord(live: LiveReading): string {
  return live.kind === 'unreadable'
    ? UNREAD_STAMP
    : fingerprintText(live);
}

/**
 * Each path and symbol `artifact` names, read through `verify` one at a
 * time and stamped. Never rejects: a reading that throws is stamped
 * {@link UNREAD_STAMP}.
 */
export async function stampArtifactRefs(artifact: string, verify: RefVerifier): Promise<readonly ArtifactRefStamp[]> {
  const stamps: ArtifactRefStamp[] = [];
  for (const ref of artifactRefs(artifact)) {
    let stamp: string;
    try {
      stamp = stampWord(await verify({ kind: ref.kind, text: ref.text }));
    } catch {
      // The reason is kept off the body on purpose; see the module note.
      stamp = UNREAD_STAMP;
    }
    stamps.push(Object.freeze({ kind: ref.kind, text: ref.text, stamp }));
  }
  return Object.freeze(stamps);
}

/**
 * The section for `stamps`, heading included, or null when there are
 * none. A path and a symbol are spelled from characters no backtick is
 * among, so each is shown in a plain code span.
 */
export function refsSection(stamps: readonly ArtifactRefStamp[]): string | null {
  if (stamps.length === 0) return null;

  const lines = stamps.map((ref) => `- ${ref.kind} \`${ref.text}\`: \`${ref.stamp}\``);
  return [`## ${REFS_HEADING}`, REFS_INTRO, lines.join('\n')].join('\n\n');
}

/**
 * The `## Refs` section for a bug whose redacted artifact is `artifact`,
 * or null when the artifact is null or names no path and no symbol; see
 * the module note. Never rejects.
 */
export async function buildRefsSection(artifact: string | null, verify: RefVerifier): Promise<string | null> {
  if (artifact === null) return null;
  return refsSection(await stampArtifactRefs(artifact, verify));
}

/** The verifier's roster: empty, since the section reads no command and no flag. */
const EMPTY_ROSTER: DescribeDocument = {
  schemaVersion: DESCRIBE_SCHEMA_VERSION,
  binary: DESCRIBE_BINARY,
  version: '',
  subjects: [],
  commands: [],
};

/** The verifier's issue seam: never asked, since the section reads no issue. */
async function noIssues(): Promise<{ readonly kind: 'failed'; readonly detail: string }> {
  return { kind: 'failed', detail: 'the refs section of a bug reads no issue' };
}

/**
 * The verifier triage stamps an artifact's references with by default:
 * git in `repoRoot`, and `ts-symbols` when `env`'s `PATH` holds it. It
 * is made on the first reference read, so a bug whose artifact names
 * none spawns nothing. It is built for paths and symbols only: its
 * issue seam answers every read as failed and its roster is empty, so
 * any other kind reads as nothing a caller can use.
 */
export function createArtifactRefsVerifier(
  repoRoot: string,
  env?: Readonly<Record<string, string | undefined>>,
): RefVerifier {
  let made: RefVerifier | null = null;
  return async (ref) => {
    made ??= createRefVerifier({
      issues: noIssues,
      git: createGitRunner(repoRoot),
      outline: tsSymbolsOutliner({ cwd: repoRoot, env }),
      roster: EMPTY_ROSTER,
    });
    return made(ref);
  };
}
