/** The view config for a rafa repo snapshot: `scripts/snapshot.ts` produces the fields these bindings read. */
import type { SoretesConfig } from '../contract/types.ts';

const count = { kind: 'number', compact: true } as const;

export const RAFA_CONFIG: SoretesConfig = {
  id: 'rafa',
  title: 'rafa repo and effort store',
  entityTypes: {
    package: { name: 'package', icon: '📦', stroke: '#f5c26b', help: 'A workspace package of the monorepo; it contains modules and depends on other packages.', shape: 'd6' },
    module: { name: 'module', icon: '⚙️', stroke: '#d8dee9', help: 'A source folder of a package; its links are the imports between modules.' },
    bucket: { name: 'bucket', icon: '🪣', stroke: '#9ece6a', help: 'A bucket of effort-store rows: plans, bugs or lore. Its links point at the modules the rows name.', shape: 'd4' },
    store: { name: 'store', icon: '🛢️', stroke: '#c3a6ff', help: 'The effort store, the SQLite file the loop writes its task reports into.', shape: 'cylinder' },
    epic: { name: 'epic', icon: '🧭', stroke: '#ffd479', help: 'An epic from the board: its open issues orbit it, and its aura covers the modules its issues touched.', radius: 1.7, shape: 'd10' },
    issue: { name: 'issue', icon: '🎫', stroke: '#b4c7e8', help: 'An open issue of an epic, from the board cache.', radius: 0.62, label: 'none', shape: 'd4' },
    bug: { name: 'bug', icon: '🐞', stroke: '#ff7a7a', help: 'An open bug on the board that belongs to no epic.', radius: 0.62, label: 'none', shape: 'd4' },
    table: { name: 'table', icon: '🧮', stroke: '#c3a6ff', help: "A table of the effort store's SQLite schema.", radius: 0.9, shape: 'd6' },
  },
  edgeKinds: {
    imports: { label: 'imports', color: '#8fa3bf', dash: 0, rest: 10, stiffness: 0.004, calls: true, help: 'Module A imports from module B. Thicker means more import lines.' },
    contains: { label: 'contains', color: '#f5c26b', dash: 0.25, rest: 5, stiffness: 0.03, help: 'A package holds a module, or the store holds a bucket.' },
    depends: { label: 'depends on', color: '#ffffff', dash: 1.2, rest: 12, stiffness: 0.006, calls: true, help: 'A package lists another one in its package.json.' },
    touches: { label: 'plans touch', color: '#9ece6a', dash: 0.6, rest: 14, stiffness: 0.002, help: 'Loop plans whose findings, bugs or changes name a file of the module.' },
    reports: { label: 'bugs name', color: '#ff7a7a', dash: 0.6, rest: 14, stiffness: 0.002, help: 'Out-of-scope bugs the loop filed that name a file of the module.' },
    persists: { label: 'persists to', color: '#c3a6ff', dash: 0, rest: 6, stiffness: 0.03, help: 'The module that writes the effort store.' },
    member: { label: 'epic holds', color: '#ffd479', dash: 0.3, rest: 4, stiffness: 0.02, help: 'An epic and one of its open issues.' },
    scopes: { label: 'epic touches', color: '#f7768e', dash: 0.8, rest: 9, stiffness: 0.004, help: "A module that the epic's issues touched, through their plans or a module label." },
    references: { label: 'references', color: '#c3a6ff', dash: 0, rest: 8, stiffness: 0.01, calls: true, help: "A column holding another table's key (session_id → sessions)." },
    targets: { label: 'issue targets', color: '#7dcfff', dash: 0.4, rest: 8, stiffness: 0.006, help: 'A module an open issue names or its plan touched.' },
  },
  weightedKind: 'imports',
  minWeight: 5,
  pinned: ['pkg:rafa', 'core:effort', 'bucket:plans'],
  groupColors: {
    'pkg:rafa': '#d9503a',
    'pkg:rafa-core': '#4a74e8',
    'pkg:rafa-hub': '#26a69a',
    'pkg:rafa-sync-service': '#3aa0d0',
    'pkg:eslint-config': '#8d6e63',
    'pkg:typescript-config': '#5c6bc0',
    store: '#7e57c2',
  },
  nodeStyle: {
    'bucket:plans': { icon: '🗺️', color: '#3f9a4a' },
    'bucket:bugs': { icon: '🐞', color: '#c43c3c' },
    'bucket:lore': { icon: '💡', color: '#d39a22' },
  },
  size: 'stats.loc',
  widgets: {
    callers: {
      title: 'Callers', icon: '⬆️', value: '@callers', action: { kind: 'highlight', relation: 'callers' },
      description: 'Modules and packages that import this one. Click to fold back and light them up in the graph.',
    },
    callees: {
      title: 'Callees', icon: '⬇️', value: '@callees', action: { kind: 'highlight', relation: 'callees' },
      description: 'Modules this one imports. Click to fold back and light them up in the graph.',
    },
    deps: {
      title: 'Runtime deps', icon: '🔌', value: 'externalDeps', action: { kind: 'radial', items: 'externalDeps' },
      description: 'External packages and runtime modules this one feeds from (bun:sqlite, node:fs…). Click to spread them out.',
    },
    plans: {
      title: 'Plans', icon: '🗺️', value: 'plans', action: { kind: 'radial', items: 'plans', open: { kind: 'plan' } },
      description: 'Loop plans whose findings, bugs or changes name a file here. Click to spread them out; pick one to read its task reports.',
    },
    blockers: { title: 'Blockers', icon: '⛔', value: 'stats.blockers', description: 'Tasks the loop reported as blocked on something in this module.' },
    tests: { title: 'Test files', icon: '🧪', value: 'stats.tests', description: 'Test files beside the sources: the code that exercises this module.' },
    files: { title: 'Files', icon: '📄', value: 'stats.files', description: 'Source files, tests left out.' },
    loc: { title: 'Lines', icon: '📏', value: 'stats.loc', format: count, description: 'Lines of source code, tests left out.' },
    bugs: {
      title: 'Bugs', icon: '🐞', value: 'stats.bugs', action: { kind: 'list', items: 'topBugs', shape: { text: 'what', tag: 'kind', meta: 'plan' } },
      description: 'Out-of-scope bugs the loop filed that name a file here. Click to list the latest in the drawer.',
    },
    changes: { title: 'Changes', icon: '📝', value: 'stats.changes', description: 'Change entries (release-note lines) whose task names a file here.' },
    docs: {
      title: 'Docs', icon: '📚', value: 'docs', action: { kind: 'radial', items: 'docs', open: { kind: 'doc' } },
      description: 'Context pages that name this module. Click to spread them out; pick one to read it in the drawer.',
    },
    lore: {
      title: 'Lore', icon: '💡', value: 'stats.findings', action: { kind: 'list', items: 'topFindings', shape: { text: 'what', tag: 'kind', meta: 'plan' } },
      description: 'Findings the loop recorded here: gotchas, patterns and locations. Click to list the latest.',
    },
    hotfiles: {
      title: 'Hot files', icon: '🔥', value: 'hotFiles', action: { kind: 'list', items: 'hotFiles', shape: { text: 'path', tag: 'count' } },
      description: 'The files of this module the store rows name most often.',
    },
    gotchas: { title: 'Gotchas', icon: '⚠️', value: 'stats.gotchas', description: 'Findings of kind gotcha: traps a task fell into here.' },
    // The bugs bucket's own widgets: where its rows come from (top row) and what they infest (bottom row).
    bugPlans: {
      title: 'Filed by', icon: '🗺️', value: 'bugStats.plansFiling', action: { kind: 'radial', items: 'byPlan', shape: { text: 'plan', tag: 'count' }, open: { kind: 'plan' } },
      description: 'The loop plans that filed these bugs. Click to spread the busiest out; pick one to read its task reports.',
    },
    bugWeek: {
      title: 'This week', icon: '📅', value: 'bugStats.thisWeek', background: { kind: 'sparkline', values: 'weekly' },
      description: 'Bugs filed in the last 7 days; the line behind is bugs per week over the last 8 weeks.',
    },
    bugLast: { title: 'Last filed', icon: '🕑', value: 'bugStats.lastAt', ui: 'label', format: { kind: 'relative-time', style: 'short' }, description: 'When the newest bug was filed.' },
    bugSecurity: { title: 'Security', icon: '🔐', value: 'bugStats.security', description: 'Bugs flagged as security issues; they route to the private advisory channel.' },
    bugBlocked: { title: 'Blocked', icon: '⛔', value: 'bugStats.blocked', description: 'Bugs whose task report ended blocked.' },
    infested: {
      title: 'Infested', icon: '🦠', value: 'bugStats.modulesNamed', action: { kind: 'highlight', ids: 'infestedIds' },
      description: 'Modules at least one bug names. Click to fold back and light them up in the graph.',
    },
    unanchored: {
      title: 'Unanchored', icon: '🌫️', value: 'bugStats.unattributed', format: { kind: 'number', compact: true },
      description: 'Bugs whose text names no source path, so no module can own them yet: fog with no host.',
    },
    lastWeekBugs: { title: 'Last week', icon: '📆', value: 'bugStats.lastWeek', description: 'Bugs filed 7 to 14 days ago, to compare with this week.' },
    bugLatest: {
      title: 'Latest', icon: '🐞', value: 'topBugs', action: { kind: 'list', items: 'topBugs', shape: { text: 'what', tag: 'kind', meta: 'plan' } },
      description: 'The newest bugs. Click to list them in the drawer.',
    },
    bugTotal: { title: 'Bugs', icon: '🐞', value: 'bugStats.total', format: count, description: 'Every out-of-scope bug in the store.' },
    // Epics: what feeds them (top row) and what they reach into (bottom row).
    epicIssues: {
      title: 'Open issues', icon: '🎫', value: 'issueStats.open', action: { kind: 'list', items: 'memberTitles', shape: { text: 'title', tag: 'number' } },
      description: 'Open issues of the epic. Click to list them in the drawer.',
    },
    epicReady: { title: 'Specs ready', icon: '✅', value: 'issueStats.ready', description: 'Open specs marked spec:ready: nothing left to define.' },
    epicBlocked: { title: 'Blocked', icon: '⛔', value: 'issueStats.blocked', description: 'Open specs marked spec:blocked.' },
    epicInDev: { title: 'In development', icon: '🛠️', value: 'issueStats.inDevelopment', description: 'Issues a loop is working on now (rafa:in-development).' },
    epicHigh: { title: 'High priority', icon: '🔺', value: 'issueStats.high', description: 'Open issues labelled priority:high.' },
    epicModules: {
      title: 'Touches', icon: '🧩', value: 'modules', action: { kind: 'highlight', ids: 'modules' },
      description: "Modules the epic's issues touched, through their plans or a module label. Click to light them up.",
    },
    epicBlast: { title: 'Depend on it', icon: '💥', value: 'blast', description: "Modules outside the epic that import the modules it touches: who feels a change." },
    epicModuleBugs: { title: 'Bugs in its code', icon: '🦠', value: 'moduleBugs', format: count, description: 'Bugs the store names in the modules the epic touches.' },
    epicBugs: { title: 'Open bugs', icon: '🐞', value: 'issueStats.bugs', description: 'Open bug issues inside the epic.' },
    epicProgress: { title: 'Done', icon: '📈', value: 'progress', format: { kind: 'percent', ratio: true }, description: 'Closed issues out of all the epic ever held.' },
    epicPlans: { title: 'Plans run', icon: '🔁', value: 'plansRun', description: 'Issues of the epic a loop plan has run for.' },
    // Issues.
    issueKind: { title: 'Type', icon: '🏷️', value: 'kind', ui: 'label', description: 'The issue type: spec, bug, code, chore…' },
    issuePriority: { title: 'Priority', icon: '🔺', value: 'priority', ui: 'label', description: 'The priority label, none when unset.' },
    issueSpec: { title: 'Spec state', icon: '📐', value: 'specState', ui: 'label', format: { kind: 'text', max: 12 }, description: 'ready, needs-work or blocked, for a spec.' },
    issueEpic: { title: 'Epic', icon: '🧭', value: 'group', ui: 'label', format: { kind: 'text', max: 16 }, description: 'The epic this issue belongs to.' },
    issueNumber: { title: 'Issue', icon: '#️⃣', value: 'label', ui: 'label', description: 'The issue number on the board.' },
    issueModules: {
      title: 'Targets', icon: '🧩', value: 'modules', action: { kind: 'highlight', ids: 'modules' },
      description: 'Modules the issue names or its plan touched. Click to light them up.',
    },
    issuePlans: {
      title: 'Plans', icon: '🗺️', value: 'plans', action: { kind: 'radial', items: 'plans', open: { kind: 'plan' } },
      description: 'Loop plans named after this issue. Click to spread them out; pick one to read its task reports.',
    },
    issueReports: { title: 'Task reports', icon: '🧾', value: 'reports', description: "Task reports the issue's plans wrote." },
    issueLabels: {
      title: 'Labels', icon: '🔖', value: 'labels', action: { kind: 'list', items: 'labels' },
      description: 'Every label on the issue. Click to list them.',
    },
    // Tables of the store's schema.
    tableRows: { title: 'Rows', icon: '🧮', value: 'rowCount', format: count, description: 'Rows in the table now.' },
    tableColumns: { title: 'Columns', icon: '🏛️', value: 'columns', action: { kind: 'list', items: 'columns', shape: { text: 'name', tag: 'key', meta: 'type' } }, description: 'Its columns. Click to list them with their keys.' },
    tableRefs: { title: 'References', icon: '🔗', value: 'references', action: { kind: 'highlight', ids: 'references' }, description: 'Tables whose key a column of this one holds.' },
    tableRefBy: { title: 'Referenced by', icon: '↩️', value: '@callers', action: { kind: 'highlight', relation: 'callers' }, description: 'Tables that hold a key of this one.' },
    // Packages (d6): their modules' counters added up.
    holds: { title: 'Holds', icon: '🧩', value: '@children', action: { kind: 'highlight', ids: '@children' }, description: 'Modules in the package. Click to light them up.' },
    pkgBugs: { title: 'Bugs', icon: '🐞', value: 'rollup.bugs', format: count, description: 'Bugs naming any module of the package.' },
    pkgSize: {
      title: 'Size', icon: '📏', value: 'rollup.loc', ui: 'combo', description: 'Its modules, files and lines.',
      parts: [{ title: 'modules', value: 'rollup.modules' }, { title: 'files', value: 'rollup.files' }, { title: 'lines', value: 'rollup.loc', format: count }],
    },
    pkgLore: {
      title: 'Lore', icon: '💡', value: 'rollup.findings', ui: 'combo', description: 'Findings and plans across its modules.',
      parts: [{ title: 'findings', value: 'rollup.findings', format: count }, { title: 'plans', value: 'rollup.plans' }],
    },
    // Buckets (d4): combos of three or four counters per corner.
    bugInflow: {
      title: 'Inflow', icon: '📥', value: 'bugStats.thisWeek', ui: 'combo', description: 'How fast bugs arrive: this week, last week, and the newest.',
      parts: [{ title: 'this week', value: 'bugStats.thisWeek' }, { title: 'last week', value: 'bugStats.lastWeek' }, { title: 'newest', value: 'bugStats.lastAt', format: { kind: 'relative-time', style: 'short' } }],
    },
    bugSeverity: {
      title: 'Severity', icon: '🔐', value: 'bugStats.security', ui: 'combo', description: 'Security bugs, blocked ones, and bugs no module owns yet.',
      parts: [{ title: 'security', value: 'bugStats.security' }, { title: 'blocked', value: 'bugStats.blocked' }, { title: 'unanchored', value: 'bugStats.unattributed', format: count }],
    },
    bugSpread: {
      title: 'Spread', icon: '🦠', value: 'bugStats.modulesNamed', ui: 'combo', action: { kind: 'highlight', ids: 'infestedIds' },
      description: 'How far the bugs reach: modules named, plans that filed them, all bugs. Click to light the modules up.',
      parts: [{ title: 'modules', value: 'bugStats.modulesNamed' }, { title: 'plans', value: 'bugStats.plansFiling' }, { title: 'bugs', value: 'bugStats.total', format: count }],
    },
    bucketLore: {
      title: 'Lore', icon: '💡', value: 'stats.findings', ui: 'combo', description: 'Findings by kind.',
      parts: [{ title: 'findings', value: 'stats.findings', format: count }, { title: 'gotchas', value: 'stats.gotchas' }, { title: 'patterns', value: 'stats.patterns' }],
    },
    // The store (cylinder): rows per table.
    rowsSessions: { title: 'Sessions', icon: '🧵', value: 'storeRows.sessions', format: count, description: 'Claude Code sessions collected.' },
    rowsReports: { title: 'Task reports', icon: '🧾', value: 'storeRows.task_reports', format: count, description: 'Task reports the loop wrote.' },
    rowsFindings: { title: 'Findings', icon: '💡', value: 'storeRows.findings', format: count, description: 'Lore rows.' },
    rowsBugs: { title: 'Bugs', icon: '🐞', value: 'storeRows.out_of_scope_bugs', format: count, description: 'Out-of-scope bug rows.' },
    rowsChanges: { title: 'Changes', icon: '📝', value: 'storeRows.changes', format: count, description: 'Change entries.' },
    rowsCommits: { title: 'Commits', icon: '🔖', value: 'storeRows.commits', format: count, description: 'Commits collected.' },
    rowsBlockers: { title: 'Blockers', icon: '⛔', value: 'storeRows.blockers', description: 'Blocked task reports.' },
    rowsCi: { title: 'CI reads', icon: '🚦', value: 'storeRows.plan_ci', description: 'CI verdicts read per plan.' },
    touched: {
      title: 'Last named', icon: '🕑', value: 'lastTouched', ui: 'label', format: { kind: 'relative-time', style: 'short' },
      description: 'When a store row last named a file of this module.',
    },
  },
  templates: [
    {
      id: 'module',
      appliesTo: ['module'],
      faces: {
        up0: 'callers', up1: 'deps', up2: 'plans', up3: 'blockers', up4: 'tests',
        down0: 'callees', down1: 'bugs', down2: 'changes', down3: 'docs', down4: 'lore',
      },
      details: [
        { value: 'path', format: { kind: 'text', max: 44 } },
        { label: 'files', value: 'stats.files' },
        { label: 'LOC', value: 'stats.loc', format: count },
        { label: 'findings', value: 'stats.findings' },
        { label: 'bugs', value: 'stats.bugs' },
        { label: 'last named', value: 'lastTouched', format: { kind: 'relative-time' } },
      ],
      summary: ['files', 'tests', 'lore', 'bugs', 'plans', 'changes', 'callers', 'callees'],
      lists: [
        { title: 'Hot files', items: 'hotFiles', shape: { text: 'path', tag: 'count' } },
        { title: 'Latest lore', items: 'topFindings', shape: { text: 'what', tag: 'kind' }, limit: 4 },
        { title: 'Docs', items: 'docs', open: { kind: 'doc' } },
        { title: 'Runtime deps', items: 'externalDeps', display: 'chips', limit: 12 },
      ],
    },
    {
      id: 'bugs-bucket',
      appliesTo: ['bucket:bugs'],
      faces: { corner0: 'bugInflow', corner1: 'bugSeverity', corner2: 'bugLatest', center: 'bugSpread' },
      details: [
        { value: 'legend', format: { kind: 'text', max: 44 } },
        { label: 'bugs', value: 'bugStats.total', format: count },
        { label: 'modules named', value: 'bugStats.modulesNamed' },
        { label: 'unanchored', value: 'bugStats.unattributed', format: count },
        { label: 'last filed', value: 'bugStats.lastAt', format: { kind: 'relative-time' } },
      ],
      summary: ['bugTotal', 'bugWeek', 'lastWeekBugs', 'unanchored', 'infested', 'bugPlans', 'bugSecurity', 'bugBlocked'],
      lists: [
        { title: 'Most infested', items: 'infested', shape: { text: 'label', tag: 'count' }, limit: 8 },
        { title: 'Filed most by', items: 'byPlan', shape: { text: 'plan', tag: 'count' }, open: { kind: 'plan' }, limit: 6 },
        { title: 'Latest bugs', items: 'topBugs', shape: { text: 'what', tag: 'kind' }, limit: 4 },
      ],
    },
    {
      id: 'package',
      appliesTo: ['package'],
      faces: { top: 'callers', left: 'holds', right: 'callees', bottom: 'pkgBugs', back: 'pkgSize' },
      details: [
        { value: 'legend' },
        { label: 'modules', value: 'rollup.modules' },
        { label: 'lines', value: 'rollup.loc', format: count },
        { label: 'bugs', value: 'rollup.bugs', format: count },
      ],
      summary: ['holds', 'callers', 'callees', 'pkgBugs', 'pkgLore'],
      lists: [{ title: 'Runtime deps', items: 'externalDeps', display: 'chips', limit: 12 }],
    },
    {
      id: 'bucket',
      appliesTo: ['bucket'],
      faces: { corner0: 'plans', corner1: 'bucketLore', corner2: 'lore', center: 'bugs' },
      details: [{ value: 'legend' }, { label: 'plans', value: 'stats.plans' }, { label: 'findings', value: 'stats.findings', format: count }],
      summary: ['plans', 'lore', 'gotchas', 'bugs'],
      lists: [
        { title: 'Plans', items: 'plans', open: { kind: 'plan' }, limit: 12 },
        { title: 'Latest lore', items: 'topFindings', shape: { text: 'what', tag: 'kind' }, limit: 4 },
      ],
    },
    {
      id: 'store',
      appliesTo: ['store'],
      faces: { c0: 'rowsSessions', c1: 'rowsReports', c2: 'rowsFindings', c3: 'rowsBugs', c4: 'rowsChanges', c5: 'rowsCommits', c6: 'rowsBlockers', c7: 'rowsCi' },
      details: [{ value: 'legend' }],
      summary: ['rowsSessions', 'rowsReports', 'rowsFindings', 'rowsBugs', 'rowsChanges', 'rowsCommits'],
    },
    {
      id: 'epic',
      appliesTo: ['epic'],
      faces: {
        up0: 'epicIssues', up1: 'epicReady', up2: 'epicBlocked', up3: 'epicInDev', up4: 'epicHigh',
        down0: 'epicModules', down1: 'epicBlast', down2: 'epicModuleBugs', down3: 'epicBugs', down4: 'epicProgress',
      },
      details: [
        { value: 'legend', format: { kind: 'text', max: 60 } },
        { label: 'done', value: 'progress', format: { kind: 'percent', ratio: true } },
        { label: 'open', value: 'issueStats.open' },
        { label: 'modules', value: 'modules' },
        { label: 'plans run', value: 'plansRun' },
      ],
      summary: ['epicProgress', 'epicIssues', 'epicReady', 'epicBlocked', 'epicModules', 'epicBlast', 'epicModuleBugs', 'epicBugs'],
      lists: [
        { title: 'Open issues', items: 'memberTitles', shape: { text: 'title', tag: 'number' }, limit: 10 },
        { title: 'Touches', items: 'modules', display: 'chips', limit: 30 },
      ],
    },
    {
      id: 'table',
      appliesTo: ['table'],
      faces: {
        top: 'tableRefBy', left: 'tableRows', right: 'tableRefs', bottom: 'tableColumns', back: 'docs',
      },
      details: [{ value: 'legend' }, { label: 'rows', value: 'rowCount', format: count }, { label: 'columns', value: 'columns' }],
      summary: ['tableRows', 'tableColumns', 'tableRefs', 'tableRefBy'],
      lists: [{ title: 'Columns', items: 'columns', shape: { text: 'name', tag: 'key' }, limit: 30 }],
    },
    {
      id: 'issue',
      appliesTo: ['issue', 'bug'],
      faces: {
        corner0: 'issueKind', corner1: 'issuePriority', corner2: 'issueModules', center: 'issuePlans',
      },
      details: [
        { value: 'title', format: { kind: 'text', max: 60 } },
        { label: '', value: 'kind' },
        { label: 'priority', value: 'priority' },
        { label: 'modules', value: 'modules' },
      ],
      summary: ['issueKind', 'issuePriority', 'issueSpec', 'issueModules', 'issuePlans', 'issueReports'],
      lists: [
        { title: 'Labels', items: 'labels', display: 'chips', limit: 12 },
        { title: 'Plans', items: 'plans', open: { kind: 'plan' } },
        { title: 'Targets', items: 'modules', display: 'chips' },
      ],
    },
    {
      id: 'default',
      appliesTo: '*',
      faces: {
        up0: 'callers', up1: 'plans', up2: 'touched', up3: 'blockers', up4: 'gotchas',
        down0: 'callees', down1: 'bugs', down2: 'changes', down3: 'docs', down4: 'lore',
      },
      details: [
        { value: 'legend', format: { kind: 'text', max: 44 } },
        { label: 'findings', value: 'stats.findings', format: count },
        { label: 'bugs', value: 'stats.bugs', format: count },
        { label: 'plans', value: 'stats.plans' },
      ],
      summary: ['lore', 'bugs', 'plans', 'changes', 'callers', 'callees'],
      lists: [
        { title: 'Plans', items: 'plans', open: { kind: 'plan' }, limit: 12 },
        { title: 'Latest bugs', items: 'topBugs', shape: { text: 'what', tag: 'kind' }, limit: 4 },
        { title: 'Latest lore', items: 'topFindings', shape: { text: 'what', tag: 'kind' }, limit: 4 },
      ],
    },
  ],
  heat: ['bugs', 'lore', 'changes', 'plans', 'loc'],
  lenses: {
    code: {
      title: 'Code', icon: '⚙️',
      description: 'For a developer: packages, modules and the store, linked by imports. Where the code is and what it depends on.',
      types: ['package', 'module', 'bucket', 'store'],
      relations: { member: 'hidden', scopes: 'hidden', targets: 'hidden' },
    },
    qa: {
      title: 'QA', icon: '🦠',
      description: 'For QA: modules under their bug fog. The thicker the fog, the more bugs name the module; the loose mist by the bugs bucket is bugs no module owns yet.',
      types: ['package', 'module', 'bucket'],
      relations: {
        imports: 'force', contains: 'force', depends: 'hidden', touches: 'hidden', reports: 'hidden', persists: 'hidden',
        member: 'hidden', scopes: 'hidden', targets: 'hidden',
      },
      clouds: [
        { look: 'fog', on: ['module'], amount: 'bugLoad', color: '#b8c42a', radius: 2.6 },
        { look: 'fog', on: ['bucket:bugs'], amount: 'bugStats.unattributed', color: '#8f9a74', radius: 7 },
      ],
      heat: 'bugs',
    },
    pm: {
      title: 'PM', icon: '🧭',
      description: 'For a PM: each epic holds its open issues close, and the modules it touches on the shell of its bubble. A module inside two bubbles is where two epics meet in the code.',
      types: ['epic', 'issue', 'module'],
      relations: {
        member: 'line', targets: 'line', scopes: 'hidden',
        imports: 'hidden', contains: 'hidden', depends: 'hidden', touches: 'hidden', reports: 'hidden', persists: 'hidden',
      },
      wells: [
        { on: ['epic'], members: 'members', rest: 3.5, stiffness: 0.06 },
        { on: ['epic'], members: 'modules', rest: 11, stiffness: 0.03, ring: 'sphere', only: ['module'] },
      ],
      clouds: [{ look: 'bubble', on: ['epic'], members: ['members', 'modules'] }],
    },
    arch: {
      title: 'Architecture', icon: '🏛️',
      description: 'For an architect: one box per package with its modules inside, and the imports between them routed at right angles. Flat, face-on, nothing moves.',
      types: ['package', 'module'],
      arrange: { kind: 'plots', contains: 'contains', routed: ['imports'], direction: 'RIGHT' },
      relations: { contains: 'hidden', depends: 'hidden', touches: 'hidden', reports: 'hidden', persists: 'hidden', member: 'hidden', scopes: 'hidden', targets: 'hidden' },
      labels: { module: 'name', package: 'none' },
    },
    schema: {
      title: 'Schema', icon: '🧮',
      description: "The effort store as an ERM: each table a box listing its columns (keys marked), joined where a column holds another table's key.",
      types: ['table'],
      arrange: { kind: 'plots', rows: 'columns', rowShape: { text: 'name', tag: 'key' }, routed: ['references'], direction: 'DOWN' },
      labels: { table: 'none' },
    },
    roadmap: {
      title: 'Roadmap', icon: '📅',
      description: 'Time left to right: a column per week under month boxes, one lane per epic. A bar marks the weeks an epic was worked on, ✓ counts its issues merged that week; open issues with no dated work wait in Planned.',
      types: ['epic', 'issue'],
      arrange: { kind: 'timeline', date: 'activity.last', lane: 'group', laneHeads: ['epic'], cells: 'weeks', span: 'span' },
      relations: { member: 'hidden', targets: 'hidden', scopes: 'hidden' },
      labels: { issue: 'none', epic: 'none' },
    },
    board: {
      title: 'Board', icon: '🗂️',
      description: 'A kanban: open issues and bugs in columns by status, one lane per epic with the epic at its head. Bugs with no epic share the last lane.',
      types: ['epic', 'issue', 'bug'],
      arrange: {
        kind: 'board', column: 'status', lane: 'group', laneHeads: ['epic'],
        columns: [
          { id: 'triage', title: 'Triage' }, { id: 'backlog', title: 'Backlog' }, { id: 'needs-work', title: 'Needs work' },
          { id: 'ready', title: 'Ready' }, { id: 'blocked', title: 'Blocked' }, { id: 'doing', title: 'In development' },
        ],
      },
      relations: { member: 'hidden', targets: 'hidden', scopes: 'hidden' },
      labels: { issue: 'none', bug: 'none', epic: 'none' },
    },
    all: {
      title: 'All', icon: '🌐',
      description: 'Everything at once: every node, every link drawn. Dense on purpose.',
    },
  },
};
