/**
 * The `bun test` preload (`bunfig.toml`): registers happy-dom's window,
 * document and friends as globals, then unmounts what each test rendered.
 * Testing Library is imported after the registration so it sees a DOM.
 * The page reads and writes its URL parameters, so the window has an
 * http URL; on the default `about:blank`, `replaceState` keeps no query.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost:4319/' });

const { cleanup } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
});
