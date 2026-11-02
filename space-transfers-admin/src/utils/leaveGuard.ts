/**
 * A page with unsaved work registers a question here, and anything that moves
 * the console to another page asks it first. Closing the tab is covered
 * separately by `beforeunload`.
 */
let question: string | null = null;

export const setLeaveGuard = (message: string | null) => {
  question = message;
};

/** True when it is fine to leave the current page. */
export const confirmLeave = (): boolean => !question || window.confirm(question);
