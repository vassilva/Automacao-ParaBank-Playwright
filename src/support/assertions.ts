import { expect as baseExpect } from '@playwright/test';
import { config } from './config';

/** Playwright's web-first assertions, with a timeout suited to the shared public server. */
export const expect = baseExpect.configure({ timeout: config.timeouts.assertion });
