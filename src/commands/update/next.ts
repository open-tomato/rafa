/** `rafa update next`: a stub until #716; see `./stub.ts`. */
import type { RafaCommand } from '../../core/command/index.js';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'next', summary: 'move this project to the newest minor of its major', issue: 716 });
export default command;
