/** `rafa update self`: a stub until #715; see `./stub.ts`. */
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'self', summary: 'update rafa itself, from npm, a pinned version or another source', issue: 715 });
export default command;
