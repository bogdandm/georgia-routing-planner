import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import type {
  UserDataNotice,
  UserDataProblem,
} from '@/application/user/UserDataService';

/** Localized copy for a typed account or synchronization failure. */
export function userDataProblemMessage(problem: UserDataProblem): MessageDescriptor {
  switch (problem) {
    case 'deletion-decision-failed':
      return msg`Unable to apply the deletion decision. Your local data remains available.`;
    case 'session-restore-failed':
      return msg`Unable to restore your account session.`;
    case 'sign-in-failed':
      return msg`Unable to sign in. Check your email and password.`;
    case 'sign-out-failed':
      return msg`Unable to sign out. Try again.`;
    case 'sign-up-failed':
      return msg`Unable to create an account. Try again.`;
    case 'sync-failed':
      return msg`Synchronization could not finish. Your local tracks, folders, and markers remain available.`;
    case 'sync-preference-failed':
      return msg`Unable to update synchronization. Your previous setting is unchanged.`;
    case 'sync-quota-exceeded':
      return msg`Cloud track storage is full. Delete a synchronized track and try again.`;
  }
}

const noticeMessages: Record<UserDataNotice, MessageDescriptor> = {
  'registration-confirmation-sent': msg`Check your email to confirm your account, then sign in.`,
};

/** Localized copy for a typed account notice. */
export function userDataNoticeMessage(notice: UserDataNotice): MessageDescriptor {
  return noticeMessages[notice];
}
