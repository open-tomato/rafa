/** The page: header, three columns, footer; loads the snapshot and owns the keyboard. */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import { configFor } from './configs/index.ts';
import { indexSnapshot } from './graph/index.ts';
import { GraphScene } from './scene/GraphScene.tsx';
import { StoreProvider, useStore } from './state.tsx';
import type { Snapshot } from './types.ts';
import { Footer } from './ui/Footer.tsx';
import { Header } from './ui/Header.tsx';
import { LeftNav } from './ui/LeftNav.tsx';
import { RightPanel } from './ui/RightPanel.tsx';
import { makeView, ViewProvider } from './view.tsx';

function useKeyboard(): void {
  const { state, dispatch } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Sliders and checkboxes keep focus after a click; only text fields own the keys.
      const typing = e.target instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(e.target.type);
      if (typing || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === '?' || key === 'h') dispatch({ type: 'drawer', open: !state.drawer.open, tab: 'help' });
      else if (key === 'escape') dispatch({ type: 'escape' });
      else if (key === 'enter' && state.selected) dispatch(state.expanded ? { type: 'collapse' } : { type: 'expand', id: state.selected });
      else if (key === 'l') dispatch({ type: 'toggle-lock' });
      else if (key === 'f') dispatch({ type: 'camera', kind: 'fit' });
      else if (key === '0') dispatch({ type: 'camera', kind: 'reset' });
      else if (key === '+' || key === '=') dispatch({ type: 'camera', kind: 'zoom-in' });
      else if (key === '-') dispatch({ type: 'camera', kind: 'zoom-out' });
      else if (key === 'p' && state.selected) dispatch({ type: 'toggle-pin', id: state.selected });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.drawer.open, state.selected, state.expanded, dispatch]);
}

interface ShellProps {
  readonly snapshot: Snapshot;
  readonly onRefresh: () => void;
  readonly onDataset: (dataset: string) => void;
}

function Shell({ snapshot, onRefresh, onDataset }: ShellProps) {
  const { state, dispatch } = useStore();
  const config = configFor(snapshot.dataset);
  const view = useMemo(() => {
    const callKinds = new Set(Object.entries(config.edgeKinds).filter(([, spec]) => spec.calls).map(([kind]) => kind));
    return makeView(config, indexSnapshot(snapshot, callKinds));
  }, [config, snapshot]);
  useKeyboard();
  // Any element with data-help writes its text to the footer line while pointed at.
  const onOver = (e: MouseEvent): void => {
    const el = (e.target as Element).closest?.('[data-help]');
    const text = el?.getAttribute('data-help');
    if (text && (state.hover?.kind !== 'ui' || state.hover.text !== text)) dispatch({ type: 'hover', hover: { kind: 'ui', text } });
  };
  const onOut = (e: MouseEvent): void => {
    if ((e.target as Element).closest?.('[data-help]') && state.hover?.kind === 'ui') dispatch({ type: 'hover', hover: null });
  };

  return (
    <ViewProvider value={view}>
      <div className="app with-right" onMouseOver={onOver} onMouseOut={onOut}>
        <Header snapshot={snapshot} onRefresh={onRefresh} onDataset={onDataset} />
        <LeftNav />
        <main className="center">
          <GraphScene index={view.index} />
        </main>
        <RightPanel />
        <Footer />
      </div>
    </ViewProvider>
  );
}

const initialDataset = (): string => new URLSearchParams(location.search).get('dataset') ?? 'rafa';

export function App() {
  const [dataset, setDataset] = useState(initialDataset);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (name: string, refresh: boolean) => {
    try {
      const query = new URLSearchParams({ dataset: name });
      if (refresh) query.set('refresh', '1');
      const res = await fetch(`/api/snapshot?${query}`);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setSnapshot((await res.json()) as Snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'snapshot failed');
    }
  }, []);
  useEffect(() => {
    void load(dataset, false);
  }, [load, dataset]);
  const switchDataset = (name: string): void => {
    const url = new URL(location.href);
    url.searchParams.set('dataset', name);
    history.replaceState(null, '', url);
    setDataset(name);
  };

  if (error) return <div className="splash error">Could not load the snapshot: {error}</div>;
  if (!snapshot) return <div className="splash">Rolling the dice…</div>;
  const config = configFor(snapshot.dataset);
  const params = new URLSearchParams(location.search);
  const lensId = params.get('lens') ?? Object.keys(config.lenses ?? {})[0];
  return (
    <StoreProvider
      key={`${snapshot.dataset}:${snapshot.generatedAt}`}
      pinned={config.pinned}
      minWeight={config.minWeight}
      selected={params.get('node')}
      lens={lensId}
      heat={lensId ? config.lenses?.[lensId]?.heat : undefined}
    >
      <Shell snapshot={snapshot} onRefresh={() => void load(dataset, true)} onDataset={switchDataset} />
    </StoreProvider>
  );
}
