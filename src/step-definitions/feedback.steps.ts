import { Then, type DataTable } from '@cucumber/cucumber';
import { expect } from '../support/assertions';
import { outcomeCheck } from '../support/outcome-check';
import type { ParaBankWorld } from '../support/world';

// Messages the bank shows when it refuses or validates a request, on any form.
// After a settled action (see ParaBankWorld.outcomeSettled) the final page is read once.

Then('I should be told {string}', async function (this: ParaBankWorld, message: string) {
  // Exact list: the expected message must be the only one shown.
  await outcomeCheck('message-shown', async () => {
    if (this.outcomeSettled) {
      expect(await this.pages.feedback.shownMessages()).toEqual([message]);
    } else {
      await expect(this.pages.feedback.errors).toHaveText([message]);
    }
  });
});

/** toContainText's rule for a list: each expected text appears, in order, among those shown. */
function containsInOrder(shown: string[], expected: string[]): boolean {
  let next = 0;
  for (const text of shown) {
    if (next < expected.length && text.includes(expected[next] ?? '')) next += 1;
  }
  return next === expected.length;
}

Then(
  'I should be told that each of these details is required:',
  async function (this: ParaBankWorld, messages: DataTable) {
    const expected = messages.raw().map(([text]) => text ?? '');
    await outcomeCheck('required-messages-shown', async () => {
      if (this.outcomeSettled) {
        const shown = await this.pages.feedback.shownMessages();
        expect(
          containsInOrder(shown, expected),
          `messages shown ${JSON.stringify(shown)} include, in order, ${JSON.stringify(expected)}`,
        ).toBe(true);
      } else {
        await expect(this.pages.feedback.errors).toContainText(expected);
      }
    });
  },
);
