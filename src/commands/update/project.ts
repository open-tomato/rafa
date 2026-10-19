/** `rafa update project`: a stub until #716; see `./stub.ts`. */
import type { RafaCommand } from '@open-tomato/rafa/core/command';

import { createUpdateStub } from './stub.js';

const command: RafaCommand = createUpdateStub({ action: 'project', summary: 'move this project to a version, with its migrations', issue: 716 });
export default command;
