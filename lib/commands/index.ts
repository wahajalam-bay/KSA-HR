/* Every command module is imported here, which is what registers it. The
   dispatcher imports this file and nothing else, so a command that is not on
   this list cannot be reached — including by a caller that knows its name. */
import './shell';
import './applications';
import './jobs';
import './candidates';
import './interviews';
import './screening';
import './loop';
import './offers';
import './onboarding';
import './team';
import './manpower';
import './settings';
import './tasks';
import './cv';
import './uploads';
import './rows';
