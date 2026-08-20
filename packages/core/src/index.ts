/**
 * `@molt/core` — the incident state machine and the engine that drives it.
 *
 * `transitions.ts` decides *what state to move to* and is pure. `engine.ts`
 * performs effects and persists them. Everything the engine needs arrives as an
 * injected port, so the entire lifecycle — approval gate, rejection, failed heal,
 * a fix that did not work — is testable with no API key and no credits spent.
 */

export {
  Engine,
  type AdvanceResult,
  type CheckResult,
  type EngineOptions,
  type OnboardRequest,
  type OnboardResult,
} from './engine.js';

export {
  CliScraper,
  CREATE_DESCRIPTION_MAX_CHARS,
  type CliScraperOptions,
} from './cli-scraper.js';

export { SerialQueue } from './queue.js';

export {
  fixedClock,
  systemClock,
  tickingClock,
  type ApproveOutcome,
  type ApproveRequest,
  type Clock,
  type CreateOutcome,
  type CreateRequest,
  type HealOutcome,
  type HealRequest,
  type RunOutcome,
  type RunRequest,
  type ScraperPort,
} from './ports.js';

export {
  needsHuman,
  nextAutomaticTrigger,
  transition,
  type TransitionRequest,
  type TransitionResult,
  type Trigger,
} from './transitions.js';
