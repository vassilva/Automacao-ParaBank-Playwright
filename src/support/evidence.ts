import { setDefinitionFunctionWrapper } from '@cucumber/cucumber';
import { redactError } from './redaction';
import { ParaBankWorld } from './world';

/**
 * Every step and hook runs through this wrapper, so an error is sanitized before Cucumber turns it
 * into report content (JSON, HTML, JUnit, and through the Playwright adapter, Playwright's
 * reports). Assertions are unchanged: only the description of a failure is redacted.
 * Cucumber keeps the original function's arity, so data tables and parameters are unaffected.
 */
setDefinitionFunctionWrapper(function (fn: (...args: unknown[]) => unknown) {
  return async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      // BeforeAll/AfterAll have no World: pattern-based redaction still applies.
      throw redactError(error, this instanceof ParaBankWorld ? this.sensitiveValues() : []);
    }
  };
});
