/**
 * Curated default job boards.
 *
 * Developed by Lulamile Mkhungela.
 *
 * Every token below answered its platform's own public read API when this list was
 * assembled, so a fresh install reaches real, live boards on its first hunt instead of
 * searching nothing. They are ordinary public employer boards — nothing here scrapes a
 * platform that forbids it, and nothing needs credentials.
 *
 * These are *defaults*, not fixtures: the Job sources panel can add to them, and the
 * "verify saved list" button re-checks each one and prunes whatever has gone dead.
 *
 * The keys match the connectors' own configuration fields:
 *   greenhouse → boardTokens  (boards.greenhouse.io/<token>)
 *   lever      → companies    (jobs.lever.co/<company>)
 *   workable   → subdomains   (<subdomain>.workable.com)
 */
export const DEFAULT_BOARD_LISTS = {
  greenhouse: [
    'figma',
    'stripe',
    'vercel',
    'robinhood',
    'toast',
    'bitwarden',
    'bruntworkwear',
    'xendit',
    'capco',
    'airbnb',
    'dropbox',
    'reddit',
    'coinbase',
    'tripadvisor',
    'forbes',
    'remote',
    'takealotgroup',
    'takealotcom',
    'offerzen',
    'sociallabsa',
    'luno',
  ],
  lever: ['moo', 'getwingapp', 'jobgether', 'smarsh'],
  workable: ['remote-recruitment', 'sparkschools', 'valr', 'purple-group'],
};

/** The connector key each list belongs to, in the config field those connectors read. */
export const DEFAULT_BOARD_FIELDS = {
  greenhouse: 'boardTokens',
  lever: 'companies',
  workable: 'subdomains',
};

export function defaultConfigFor(key) {
  const field = DEFAULT_BOARD_FIELDS[key];
  const list = DEFAULT_BOARD_LISTS[key];
  if (!field || !list?.length) return null;
  return { [field]: [...list], boardOffset: 0 };
}
