/** The header: organisation and project as the snapshot names them, its counters, and the dataset switch. */
import { DATASETS } from '../configs/index.ts';
import type { Snapshot } from '../types.ts';

interface HeaderProps {
  readonly snapshot: Snapshot;
  readonly onRefresh: () => void;
  readonly onDataset: (dataset: string) => void;
}

export function Header({ snapshot, onRefresh, onDataset }: HeaderProps) {
  const { project, summary } = snapshot;
  return (
    <header className="header">
      <div className="brand" data-help="S.O.R.E.T.E.S.: Single Origin Related Typified Entities — the working name of this view.">
        <span className="mark">◆</span> S.O.R.E.T.E.S.
      </div>
      <div className="crumbs" data-help={`The organisation and project as the snapshot names them. Scope: ${project.scope}.`}>
        <span>{project.org}</span>
        <span className="sep">/</span>
        <strong>{project.name}</strong>
        {project.version && <span className="version">v{project.version}</span>}
        <span className="scope">{project.scope}</span>
      </div>
      <div className="segmented inline" data-help="Which snapshot and config to draw. Each dataset brings its own entity types, links and dice templates.">
        {DATASETS.map((d) => (
          <button key={d.id} type="button" className={snapshot.dataset === d.id ? 'on' : ''} onClick={() => onDataset(d.id)}>{d.label}</button>
        ))}
      </div>
      <div className="store-rows" data-help="The snapshot's own counters.">
        {Object.entries(summary ?? {}).map(([label, n]) => `${n} ${label}`).join(' · ')}
      </div>
      <button type="button" className="refresh" data-help={`Snapshot built ${snapshot.generatedAt.replace('T', ' ').slice(0, 16)} UTC. Click to rebuild it.`} onClick={onRefresh}>↻</button>
    </header>
  );
}
