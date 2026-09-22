import type { NotificationParser } from '../parsed-notification';

// No real A-Bank notification has been read yet, so none is recognised: each is answered 422,
// which an automation can report, rather than recorded from a guess at the wording.
export const parseABankNotification: NotificationParser = () => null;
