/**
 * Whether an out-of-scope bug is a fault of the MACHINE a session ran on
 * rather than a fault of rafa: a system toolchain that cannot do its job,
 * a path into something the machine has installed, or a package manager
 * failing to build something it fetched.
 *
 * A session that hits its own machine's toolchain reports a bug that is
 * true about the machine and false about rafa. Issue #17 on
 * `open-tomato/rafa` is one, filed publicly by this repository's own loop:
 * an Xcode Command Line Tools SDK whose `libSystem` stub is malformed, so
 * `ld` refuses every native build on that machine. No rafa commit can fix
 * it, nobody reading the board can act on it, and the artifact carries the
 * machine's own paths onto a public tracker.
 *
 * This module is the reading alone. It calls nothing, reads no tracker and
 * no store, and answers from the two fields a report gives it — the bug's
 * `what` and its `artifact`, which are all a session is required to
 * write. `./triage.ts` owns what a match then means: a matched bug reaches
 * no tracker at all and is kept as a machine-scoped row instead.
 *
 * ## The two fields, each read whole
 *
 * Both fields are read, because a machine fault is normally split across
 * them: #17 names the SDK and its version in `what` (`Xcode Command Line
 * Tools SDK (MacOSX27.0.sdk)`) and the linker's own line in `artifact`
 * (`ld: tapi error: malformed file`). Either field alone answers less
 * than the pair does.
 *
 * They are read one at a time rather than joined, and the order is shape
 * by shape: {@link SHAPES} is the priority list, and each shape is tried
 * against `what` and then against `artifact`, so a reading reports the
 * first SHAPE that matched and not the first field that did. The second
 * reading a {@link MachineFaultShape} may require
 * ({@link BUILD_FAILURE}) must land in the SAME field as the shape, so a
 * failure word anywhere in a long `what` cannot certify a package
 * manager merely NAMED in the `artifact`. That is the direction the
 * costs are asymmetric in: a rafa bug reporting that `rafa doctor`
 * prints the wrong `brew install` remedy carries both tokens across the
 * pair, and joining the fields would have taken it off the board.
 *
 * ## The three families
 *
 * {@link MachineFaultKind} names them, and {@link SHAPES} holds the
 * patterns of each in that order:
 *
 *   - `toolchain` — a system compiler, linker or OS updater saying it
 *     failed: `ld:` with an error, a `tapi` stub error, `dyld:`, a
 *     `clang`/`gcc` driver error, `xcrun`, `xcode-select`, MSVC's `LNK`
 *     codes, `linker command failed`, `softwareupdate` and the Command
 *     Line Tools by name.
 *   - `sdk-path` — a path that can only be a machine install: a `.sdk`
 *     root, `/Library/Developer/...`, an `Xcode.app`, a system framework
 *     or `/usr/lib` library, a `.tbd` stub, a Homebrew prefix, `/usr/include`
 *     and `C:\Program Files`.
 *   - `package-build` — a package manager failing to BUILD: `gyp ERR!`,
 *     `npm ERR!`, a `make: ***` recipe line, a Python wheel or setuptools
 *     command that failed, a cargo build script, and a manager invocation
 *     (`brew install`, `apt-get install`, `cpanm`, `pip install`,
 *     `node-gyp`, a native extension) that is named beside a failure word.
 *
 * The last group is the only one that needs two readings. A manager's name
 * on its own is not a fault — `rafa doctor` prints `brew install` as a
 * REMEDY, and a bug about that sentence is a rafa bug — so those shapes
 * carry a `needs` pattern and match only when {@link BUILD_FAILURE} is in
 * the same field as the manager.
 *
 * ## What it reads over the 27 filed bodies
 *
 * Measured on 2026-09-20 over the 27 bugs rafa's own runs filed against
 * `open-tomato/rafa` — #6 to #18 and #32 to #46, #40 being a pull request
 * — taking each body's `What` and `Artifact` fences as the two fields.
 * (#6 and #7 were opened by hand and carry prose instead of those fences;
 * they are read through their titles, and neither matches.) The reading is
 * ONE match in 27: #17, which answers FIVE shapes at once — `tapi-stub`,
 * `ld-failure`, `command-line-tools` and `software-update` in the
 * toolchain family, and `sdk-root` in the SDK one, the first of them
 * being what a reading reports. `machine-fault.test.ts` holds all 27
 * pairs and re-measures that count, so a pattern widened later reddens
 * there rather than on the board.
 *
 * The other 26 are real rafa bugs, and a rule that matched one of them
 * would take a real bug OFF the board, which is the direction that costs
 * most. Four near misses shaped the patterns above, each count measured
 * over the same 27 pairs on the same day:
 *
 *   - #10, #14 and #16 report the skill checker misreading fenced code as
 *     command names, and their artifacts read `the command const is in no
 *     directory of the PATH this run was given` and `missing-tool: line 18:
 *     the command _phase ...`. A "a tool is missing from this machine"
 *     rule — the most obvious way to spell a machine fault — matches
 *     exactly those three and loses three checker bugs. Nothing here
 *     reads PATH, a missing command or the word `missing-tool`.
 *   - #11 and #15 report the checker's foreign-path rule, quoting
 *     `/openapi.json` and `/app/api/podcast_service.py`. An "absolute path
 *     outside the checkout" rule matches those two. The `sdk-path` shapes
 *     are therefore anchored on named system roots and on `.sdk`/`.tbd`,
 *     never on a leading slash.
 *   - #43's artifact is `error TS2741: Property 'editBody' is missing in
 *     type`, and #39's is eslint's `Missing code block language`. Both are
 *     a TOOL reporting on rafa's own source, which is the opposite of a
 *     machine fault, so no shape matches a compiler or linter diagnostic
 *     code; the `compiler-driver` shape wants the driver's own
 *     `clang: error` prefix, which a TypeScript or eslint line never has.
 *   - #44 quotes `gh pull requests: gh pr list` — rafa spawning an
 *     external CLI it should not have spawned. Merely NAMING an external
 *     tool matches five of the 27 (#32, #33, #35, #39, #44), so an
 *     external program failing is not the reading either; the toolchain
 *     shapes name system build tools only, and the package-manager ones
 *     want a build verb beside the manager.
 */
import type { ReportBug } from '../report/parse.js';

/** Which family of machine fault a reading matched. */
export type MachineFaultKind = 'package-build' | 'sdk-path' | 'toolchain';

/** What each shape is called in a reading; see the module note. */
export type MachineFaultShapeName =
  | 'command-line-tools'
  | 'compiler-driver'
  | 'developer-dir'
  | 'dyld'
  | 'homebrew-prefix'
  | 'ld-failure'
  | 'linker-command'
  | 'make-recipe'
  | 'msvc-linker'
  | 'native-extension'
  | 'node-gyp'
  | 'npm-error'
  | 'package-manager'
  | 'program-files'
  | 'python-wheel'
  | 'rust-build-script'
  | 'sdk-root'
  | 'setuptools-command'
  | 'software-update'
  | 'system-framework'
  | 'system-headers'
  | 'system-library'
  | 'tapi-stub'
  | 'tbd-stub'
  | 'xcode-app'
  | 'xcode-select'
  | 'xcrun';

/** One pattern read over a bug's two fields. */
interface MachineFaultShape {
  /** What a match of it is called. */
  readonly name: MachineFaultShapeName;
  /** Which family it belongs to. */
  readonly kind: MachineFaultKind;
  /** The pattern, read over one field at a time. */
  readonly pattern: RegExp;
  /**
   * A second reading the matched field must answer, or null when the
   * pattern alone is the fault. Only the package managers carry one.
   */
  readonly needs: RegExp | null;
}

/** What a bug's two fields said about the machine. */
export interface MachineFault {
  readonly kind: MachineFaultKind;
  /** Which shape matched; the first in {@link SHAPES} that did. */
  readonly shape: MachineFaultShapeName;
  /** The matched text, as the bug spelled it. */
  readonly evidence: string;
}

/**
 * A manager named without one of these in the same field is a remedy or
 * a mention, not a fault. See the module note.
 */
export const BUILD_FAILURE = /\b(?:abort(?:ed|s)?|broke|broken|crash(?:ed|es)?|error|errors|fail(?:ed|ing|s|ure|ures)?|unusable)\b/iu;

/**
 * Every shape a bug is read for, in the order a reading takes them:
 * the toolchain saying it failed, then the machine-install paths, then
 * the package-manager builds. Frozen, since a caller that pushed onto it
 * would change which bugs reach the board at all.
 */
export const SHAPES: readonly MachineFaultShape[] = Object.freeze([
  { name: 'tapi-stub', kind: 'toolchain', pattern: /\btapi (?:error|warning)\b/iu, needs: null },
  { name: 'ld-failure', kind: 'toolchain', pattern: /\bld: (?:[\w ]*error|symbol\(s\) not found|(?:framework|library) not found)/iu, needs: null },
  { name: 'linker-command', kind: 'toolchain', pattern: /\blinker command failed\b/iu, needs: null },
  { name: 'msvc-linker', kind: 'toolchain', pattern: /\bLNK\d{4}\b/u, needs: null },
  { name: 'dyld', kind: 'toolchain', pattern: /\bdyld(?:\[\d+\])?: /iu, needs: null },
  { name: 'compiler-driver', kind: 'toolchain', pattern: /\b(?:cc1plus|cc1|clang\+\+|clang|g\+\+|gcc|ld64\.lld): (?:fatal )?error\b/iu, needs: null },
  { name: 'xcrun', kind: 'toolchain', pattern: /\bxcrun: error\b/iu, needs: null },
  { name: 'xcode-select', kind: 'toolchain', pattern: /\bxcode-select(?:: error\b| --install\b)/iu, needs: null },
  { name: 'command-line-tools', kind: 'toolchain', pattern: /\b(?:xcode )?command line tools\b/iu, needs: null },
  { name: 'software-update', kind: 'toolchain', pattern: /\bsoftwareupdate\b/iu, needs: null },
  { name: 'developer-dir', kind: 'sdk-path', pattern: /\/library\/developer\/(?:commandlinetools|xcode)\b/iu, needs: null },
  { name: 'xcode-app', kind: 'sdk-path', pattern: /\/applications\/xcode(?:-[\w.]+)?\.app\b/iu, needs: null },
  { name: 'sdk-root', kind: 'sdk-path', pattern: /\b[a-z][\w.]*\.sdk\b/iu, needs: null },
  { name: 'system-framework', kind: 'sdk-path', pattern: /\/system\/library\/(?:private)?frameworks\b/iu, needs: null },
  { name: 'system-library', kind: 'sdk-path', pattern: /\/usr\/lib(?:64|\/system)?\/lib[\w+.-]*\.(?:a|dylib|so|tbd)\b/iu, needs: null },
  { name: 'tbd-stub', kind: 'sdk-path', pattern: /\blib[\w+.-]*\.tbd\b/iu, needs: null },
  { name: 'homebrew-prefix', kind: 'sdk-path', pattern: /\/(?:opt\/homebrew|usr\/local\/cellar|home\/linuxbrew)\b/iu, needs: null },
  { name: 'system-headers', kind: 'sdk-path', pattern: /\/usr\/(?:include|lib\/gcc)\//iu, needs: null },
  { name: 'program-files', kind: 'sdk-path', pattern: /\b[a-z]:\\program files(?: \(x86\))?\\/iu, needs: null },
  { name: 'npm-error', kind: 'package-build', pattern: /\bnpm err!/iu, needs: null },
  { name: 'python-wheel', kind: 'package-build', pattern: /\bfailed building wheel for\b/iu, needs: null },
  { name: 'setuptools-command', kind: 'package-build', pattern: /\bcommand '[^'\n]+' failed with exit (?:code|status)\b/iu, needs: null },
  { name: 'rust-build-script', kind: 'package-build', pattern: /\bfailed to run custom build command for\b/iu, needs: null },
  { name: 'make-recipe', kind: 'package-build', pattern: /\bmake(?:\[\d+\])?: \*\*\* /u, needs: null },
  { name: 'node-gyp', kind: 'package-build', pattern: /\bgyp err!|\bnode-gyp\b/iu, needs: BUILD_FAILURE },
  { name: 'native-extension', kind: 'package-build', pattern: /\bnative (?:extension|gem extension)s?\b/iu, needs: BUILD_FAILURE },
  { name: 'package-manager', kind: 'package-build', pattern: /\b(?:apk|apt-get|apt|brew|choco|cpanm|cpan|dnf|gem|nix-env|pacman|pip3|pip|port|winget|yum) (?:\w+ )?(?:build|install|rebuild|reinstall|upgrade)\b/iu, needs: BUILD_FAILURE },
]);

/** The fields a reading is taken over, in the order a shape tries them. */
function fieldsOf(bug: Pick<ReportBug, 'artifact' | 'what'>): readonly string[] {
  return [bug.what ?? '', bug.artifact ?? ''].filter((field) => field !== '');
}

/** What `shape` found in `field`, or null when it found nothing there. */
function matchIn(shape: MachineFaultShape, field: string): MachineFault | null {
  const found = shape.pattern.exec(field);
  if (!found) return null;
  if (shape.needs && !shape.needs.test(field)) return null;
  return { kind: shape.kind, shape: shape.name, evidence: found[0] };
}

/** The first shape any field answers, shapes taken in {@link SHAPES} order. */
function firstMatch(fields: readonly string[]): MachineFault | null {
  for (const shape of SHAPES) {
    for (const field of fields) {
      const found = matchIn(shape, field);
      if (found) return found;
    }
  }
  return null;
}

/**
 * What a bug's `what` and `artifact` said about the machine the session
 * ran on, or null when they say nothing about it — which is every bug
 * that is rafa's own. The module note holds the families, the near
 * misses that shaped them and the reading over the 27 filed bodies.
 */
export function readMachineFault(bug: Pick<ReportBug, 'artifact' | 'what'>): MachineFault | null {
  return firstMatch(fieldsOf(bug));
}

/** True when {@link readMachineFault} answers a fault of the machine. */
export function isMachineFault(bug: Pick<ReportBug, 'artifact' | 'what'>): boolean {
  return readMachineFault(bug) !== null;
}

/** One line naming what was read, for the operator to see why nothing was filed. */
export function machineFaultSentence(fault: MachineFault): string {
  return `machine-scoped (${fault.kind}): ${fault.evidence}`;
}
