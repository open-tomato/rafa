/** `rafa update board`: a stub until #717; see `./stub.ts`. */
import type { RafaCommand } from '../../core/command/index.js';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'board', summary: 'apply the board\'s newest setup and its migrations', issue: 717 });
export default command;
