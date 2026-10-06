/**
 * Runs the four gates of `rafa issue edit` in their order over one
 * fixture per refusal, then over the passing rows.
 *
 * The order is the contract: the first refusal ends the run, so each
 * refusal fixture also carries a fault that a LATER gate would refuse
 * (a leak, a closed issue, a claim), and the ordering cases pin which
 * gate answers when several would. Every refusal sits beside a control
 * differing only in the part that gate reads, so a gate refusing
 * everything and a gate refusing nothing both fail here.
 *
 * The gh seam is a stand-in answering `api user` and the collaborators
 * path; no case spawns a process or reaches GitHub.
 */
import type { EditKind, EditStateReading } from './issue-edit-state.js';
import type { BoardItem, TrustReading } from './trust.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, test } from 'bun:test';

import { CLAIMED_LABEL } from '../claims/stale.js';
import { CommandExit } from '../cli/command.js';

import { appendedBody, renderUpdateBlock, replacedBody } from './issue-edit-body.js';
import { editStateRefusalMessage, readEditState } from './issue-edit-state.js';
import { addedTextSource, editedBodySource, requireEditText } from './issue-edit-text.js';
import { SPEC_LABEL } from './issue.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { branchName } from './naming.js';
import { BOARD_REFUSAL_EXIT } from './plan-spec.js';
import { READINESS_REFUSAL_EXIT, SPEC_READY_LABEL } from './readiness.js';
import {
  createGhEditorLogin,
  editorRefusalMessage,
  ghBoardTrust,
  readBoardTrust,
  readEditorTrust,
  TRUST_REFUSAL_EXIT,
  trustRefusalMessage,
} from './trust.js';

const REPO = 'open-tomato/rafa';
const ISSUE = 12;
const TITLE = 'Sync design for devices';
const DAY = new Date(2026, 9, 6, 12, 0);
const REASON = 'sync design';
const OPEN_ITEM: BoardItem = { kind: 'issue', number: ISSUE, repo: REPO };

const COMPLETE = [
  '## What you get\n\nAn edit command.\n',
  '## Starting position\n\nNo way to change a body.\n',
  '## Design\n\nFour gates in order.\n',
  '## What can go wrong\n\nA leak reaches the board.\n',
  '## Tasks the plan must carry\n\n- add the gate\n',
  '## Definition of done\n\n- a leak is refused\n',
].join('\n');
const INCOMPLETE = COMPLETE.replace('Four gates in order.\n', '');
const CLEAN_TEXT = 'One workflow moves or seeds an environment.';
const HOME_PATH_TEXT = 'The copy sits under /Users/jdoe/projects/app/.rafa/specs.';

/** The gate that refused an edit, with the exit and sentence the command would end with. */
type Gate = 'editor' | 'author' | 'text' | 'state';

interface Refusal {
  readonly gate: Gate;
  readonly exitCode: number;
  readonly message: string;
}

/** What the four gates answered over one edit: a refusal, or the state gate's passing reading. */
type GateOutcome =
  | { readonly pass: true; readonly state: EditStateReading }
  | { readonly pass: false; readonly refusal: Refusal };

/** Everything the four gates are handed for one edit. */
interface Scenario {
  /** What `gh api user` answers for the editor. */
  readonly editorUser: GhResult;
  /** The collaborators lookups, by login; any other login is a 404. */
  readonly permissions: Readonly<Record<string, GhResult>>;
  /** The login that wrote the issue. */
  readonly author: string;
  readonly trustedAuthors: readonly string[];
  readonly open: boolean;
  readonly labels: readonly string[];
  readonly kind: EditKind;
  readonly whileInDevelopment: boolean;
  readonly before: string;
  readonly added: string;
  readonly after: string;
}

/** A `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** What the collaborators endpoint answers for one permission. */
function permissionOf(permission: string): GhResult {
  return wrote(JSON.stringify({ permission, role_name: permission, user: {} }));
}

/** What `gh api user` answers for `login`. */
function userOf(login: string): GhResult {
  return wrote(JSON.stringify({ login, id: 1, type: 'User' }));
}

/** A stand-in `gh` answering `api user` and the collaborators path; any other command rejects. */
function standInGh(user: GhResult, permissions: Readonly<Record<string, GhResult>>): GhRunner {
  return (args) => {
    const [verb, path] = args;
    if (verb === 'api' && path === 'user') return Promise.resolve(user);
    const login = /^repos\/\{owner\}\/\{repo\}\/collaborators\/([^/]+)\/permission$/.exec(path ?? '')?.[1];
    if (verb === 'api' && login !== undefined) {
      return Promise.resolve(permissions[login] ?? failed('gh: Not Found (HTTP 404)'));
    }
    return Promise.reject(new Error(`stand-in gh: no route for ${args.join(' ')}`));
  };
}

/** The gate 4 input the command builds: the issue as read, the title, no saved copies. */
function stateInputOf(scenario: Scenario) {
  return {
    issue: ISSUE,
    title: TITLE,
    open: scenario.open,
    labels: scenario.labels,
    savedCopies: [],
    kind: scenario.kind,
    whileInDevelopment: scenario.whileInDevelopment,
  };
}

/** Runs gates 1 to 4 in order, stopping at the first refusal. */
async function runGates(scenario: Scenario): Promise<GateOutcome> {
  const gh = standInGh(scenario.editorUser, scenario.permissions);
  const trust = ghBoardTrust({ gh, trustedAuthors: scenario.trustedAuthors, repo: REPO });

  const editor = await readEditorTrust(trust, createGhEditorLogin({ gh }));
  if (!editor.trusted) {
    return refused('editor', TRUST_REFUSAL_EXIT, editorRefusalMessage(OPEN_ITEM, editor));
  }

  const author: TrustReading = await readBoardTrust(trust, scenario.author);
  if (!author.trusted) {
    return refused('author', TRUST_REFUSAL_EXIT, trustRefusalMessage(OPEN_ITEM, author));
  }

  try {
    requireEditText({
      issue: ISSUE,
      labels: scenario.labels,
      before: scenario.before,
      added: scenario.added,
      after: scenario.after,
    });
  } catch (error) {
    if (error instanceof CommandExit) return refused('text', error.exitCode, error.message);
    throw error;
  }

  const stateInput = stateInputOf(scenario);
  const state = readEditState(stateInput);
  if (!state.pass) {
    return refused('state', BOARD_REFUSAL_EXIT, editStateRefusalMessage(stateInput, state));
  }
  return { pass: true, state };
}

/** A refused outcome for `gate`. */
function refused(gate: Gate, exitCode: number, message: string): GateOutcome {
  return { pass: false, refusal: { gate, exitCode, message } };
}

/** The refusal `outcome` carries, failing the test when the gates passed. */
function refusalOf(outcome: GateOutcome): Refusal {
  if (outcome.pass) throw new Error('expected a refusal, and the gates passed');
  return outcome.refusal;
}

/** A complete, trusted, open spec edited by an append of `added`. */
function appendOver(added: string, over: Partial<Scenario> = {}): Scenario {
  return {
    editorUser: userOf('octocat'),
    permissions: { octocat: permissionOf('write') },
    author: 'octocat',
    trustedAuthors: [],
    open: true,
    labels: [SPEC_LABEL],
    kind: 'append',
    whileInDevelopment: false,
    before: COMPLETE,
    added,
    after: appendedBody(COMPLETE, renderUpdateBlock(DAY, REASON, added)),
    ...over,
  };
}

/** A complete, trusted, open spec edited by a replace whose new body is `body`. */
function replaceWith(body: string, over: Partial<Scenario> = {}): Scenario {
  return {
    ...appendOver(body),
    kind: 'replace',
    added: body,
    after: replacedBody(body),
    ...over,
  };
}

describe('the four gates, refusals in order', () => {
  test('refuses an untrusted editor at gate 1, naming the login and exiting 2', async () => {
    const refusal = refusalOf(await runGates(appendOver(CLEAN_TEXT, {
      permissions: { octocat: permissionOf('read') },
    })));

    expect(refusal.gate).toBe('editor');
    expect(refusal.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refusal.message).toContain('octocat');
  });

  test('refuses when the editor lookup fails at gate 1, as ownership-unknown and never as trusted', async () => {
    const refusal = refusalOf(await runGates(appendOver(CLEAN_TEXT, {
      editorUser: failed('gh auth login required'),
    })));

    expect(refusal.gate).toBe('editor');
    expect(refusal.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refusal.message).toContain('could not be read');
    expect(refusal.message).toContain('gh auth login required');
  });

  test('refuses an untrusted author at gate 2, naming the author and exiting 2', async () => {
    const refusal = refusalOf(await runGates(appendOver(CLEAN_TEXT, {
      author: 'stranger',
      permissions: { octocat: permissionOf('write'), stranger: permissionOf('read') },
    })));

    expect(refusal.gate).toBe('author');
    expect(refusal.exitCode).toBe(TRUST_REFUSAL_EXIT);
    expect(refusal.message).toContain('stranger');
  });

  test('refuses leaking added text at gate 3, naming the added text and exiting 2', async () => {
    const refusal = refusalOf(await runGates(appendOver(HOME_PATH_TEXT)));

    expect(refusal.gate).toBe('text');
    expect(refusal.exitCode).toBe(LEAK_REFUSAL_EXIT);
    expect(refusal.message).toContain(addedTextSource(ISSUE));
  });

  test('refuses a ready spec whose new body fails its template at gate 3, exiting 2', async () => {
    const refusal = refusalOf(await runGates(replaceWith(INCOMPLETE, {
      labels: [SPEC_LABEL, SPEC_READY_LABEL],
    })));

    expect(refusal.gate).toBe('text');
    expect(refusal.exitCode).toBe(READINESS_REFUSAL_EXIT);
    expect(refusal.message).toContain(editedBodySource(ISSUE));
  });

  test('refuses an edit to a closed issue at gate 4, exiting 2', async () => {
    const refusal = refusalOf(await runGates(appendOver(CLEAN_TEXT, { open: false })));

    expect(refusal.gate).toBe('state');
    expect(refusal.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refusal.message).toContain('the issue is closed');
  });

  test('refuses a replace of an in-development issue at gate 4, naming the loop branch', async () => {
    const refusal = refusalOf(await runGates(replaceWith(COMPLETE, {
      labels: [SPEC_LABEL, CLAIMED_LABEL],
    })));

    expect(refusal.gate).toBe('state');
    expect(refusal.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refusal.message).toContain(branchName(ISSUE, TITLE));
  });

  test('refuses a replace on spec:ready at gate 4, pointing at an append', async () => {
    const refusal = refusalOf(await runGates(replaceWith(COMPLETE, {
      labels: [SPEC_LABEL, SPEC_READY_LABEL],
    })));

    expect(refusal.gate).toBe('state');
    expect(refusal.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(refusal.message).toContain(SPEC_READY_LABEL);
    expect(refusal.message).toContain('--append-file=');
  });
});

describe('the four gates, which gate answers when several would refuse', () => {
  test('the editor refusal ends the run before a leak, a closed issue and an untrusted author are weighed', async () => {
    const refusal = refusalOf(await runGates(appendOver(HOME_PATH_TEXT, {
      editorUser: failed('gh auth login required'),
      author: 'stranger',
      open: false,
    })));

    expect(refusal.gate).toBe('editor');
  });

  test('the author refusal ends the run before a leak and a closed issue are weighed', async () => {
    const refusal = refusalOf(await runGates(appendOver(HOME_PATH_TEXT, {
      author: 'stranger',
      open: false,
    })));

    expect(refusal.gate).toBe('author');
  });

  test('the text refusal ends the run before a closed issue is weighed', async () => {
    const refusal = refusalOf(await runGates(appendOver(HOME_PATH_TEXT, { open: false })));

    expect(refusal.gate).toBe('text');
  });
});

describe('the four gates, passing rows', () => {
  test('lets an append to a plain spec through with no stale copy and no branch', async () => {
    const outcome = await runGates(appendOver(CLEAN_TEXT));

    expect(outcome).toEqual({ pass: true, state: { pass: true, staleCopy: false, branch: null } });
  });

  test('lets a replace of a plain spec through', async () => {
    const outcome = await runGates(replaceWith(COMPLETE));

    expect(outcome).toEqual({ pass: true, state: { pass: true, staleCopy: false, branch: null } });
  });

  test('lets an append to a spec:ready issue through', async () => {
    const outcome = await runGates(appendOver(CLEAN_TEXT, { labels: [SPEC_LABEL, SPEC_READY_LABEL] }));

    expect(outcome.pass).toBe(true);
  });

  test('lets an amendment to an in-development issue through under --while-in-development, naming the branch', async () => {
    const outcome = await runGates(appendOver(CLEAN_TEXT, {
      labels: [SPEC_LABEL, CLAIMED_LABEL],
      whileInDevelopment: true,
    }));

    expect(outcome).toEqual({
      pass: true,
      state: { pass: true, staleCopy: true, branch: branchName(ISSUE, TITLE) },
    });
  });
});
