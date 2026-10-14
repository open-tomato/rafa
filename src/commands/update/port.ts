/** `rafa update port`: a stub until #716; see `./stub.ts`. */
import type { RafaCommand } from '../../core/command/index.js';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'port', summary: 'move this project to a version, as update project does', issue: 716, hidden: true });
export default command;
