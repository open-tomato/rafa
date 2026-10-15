/** `rafa update latest`: a stub until #716; see `./stub.ts`. */
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'latest', summary: 'move this project to the newest version', issue: 716 });
export default command;
