/**
 * Unit tests for the parts that must never lie, never over-apply and never mis-parse:
 * CV parsing, scam screening, the application policy, truth guarding and generation.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SCAM_ADVERT } from './helpers.js'; // sets DATA_DIR / test env before config loads

const { extractApplyEmail } = await import('../src/services/jobNormalizer.js');
const { rejoinWrappedLinks } = await import('../src/services/cvParser.js');
const { buildProfile, estimateYears } = await import('../src/services/profileBuilder.js');
const { assessJobRisk } = await import('../src/services/scamDetector.js');
const { scoreJob, decidePolicy } = await import('../src/services/matcher.js');
const { validate, claimsAllowed } = await import('../src/services/truthGuard.js');
const { generateApplication } = await import('../src/services/applicationGenerator.js');
const { parseTokenList, selectBoards } = await import('../src/connectors/base.js');

const CV_TEXT = `Lerato Mokoena
Frontend Developer (React) • Pretoria, South Africa
lerato.mokoena@example.com | +27 71 555 0198 | github.com/leratomokoena | linkedin.com/in/lerato
mokoena
PROFESSIONAL SUMMARY
Frontend developer with 6 years of experience building accessible web applications in fintech and retail.
CORE SKILLS
React, TypeScript, JavaScript, HTML, CSS, Accessibility (WCAG), Design Systems, Git, Figma
EXPERIENCE
Senior Frontend Developer — Omega Pay (2021 - Present)
Led the rebuild of the merchant dashboard, cutting page load time by 42%.
Frontend Developer — Kloof Retail (2019 - 2021)
Implemented WCAG 2.1 AA fixes across 40 screens.
EDUCATION
BSc Information Technology — University of Pretoria (2015 - 2018)
LANGUAGES
English (fluent), Sepedi (native)`;

describe('CV parsing', () => {
  test('rejoins links that the PDF text layer wrapped across lines', () => {
    const joined = rejoinWrappedLinks('contact: linkedin.com/in/lerato\nmokoena\nSenior Designer at Acme');
    assert.match(joined, /linkedin\.com\/in\/leratomokoena/);
    // A link that ends a line with a slash is joined too.
    assert.match(rejoinWrappedLinks('github.com/\nleratomokoena'), /github\.com\/leratomokoena/);
    // Ordinary prose is never welded together.
    assert.doesNotMatch(rejoinWrappedLinks('Designed in Figma\nCape Town'), /FigmaCape/);
  });

  test('extracts contact details, titles, skills and languages', () => {
    const { profile } = buildProfile(CV_TEXT, { fileName: 'cv.pdf' });
    assert.equal(profile.fullName, 'Lerato Mokoena');
    assert.equal(profile.email, 'lerato.mokoena@example.com');
    assert.match(profile.phone, /\+27 71 555 0198/);
    assert.equal(profile.linkedinUrl, 'linkedin.com/in/leratomokoena');
    assert.equal(profile.githubUrl, 'github.com/leratomokoena');
    assert.ok(profile.jobTitles.includes('Senior Frontend Developer'));
    assert.ok(profile.skills.some((s) => s.label === 'React'));
    assert.equal(profile.languages.length, 2);
  });

  test('a stated number of years wins over date arithmetic', () => {
    const experience = [{ startDate: new Date('2015-01-01'), endDate: new Date('2026-01-01'), title: 'Dev' }];
    const result = estimateYears(experience, 'Frontend developer with 6 years of experience');
    assert.equal(result.value, 6);
    assert.equal(result.basis, 'stated on CV');
  });

  test('years are derived from dated roles when nothing is stated', () => {
    const experience = [{ startDate: new Date('2019-01-01'), endDate: new Date('2023-01-01'), title: 'Dev' }];
    const result = estimateYears(experience, 'no numbers here');
    assert.ok(result.value >= 3.5 && result.value <= 4.5);
  });
});

describe('application email detection', () => {
  test('never truncates an address', () => {
    assert.equal(extractApplyEmail('email your CV to careers@brightledger.example.'), 'careers@brightledger.example');
  });

  test('prefers hiring mailboxes over unrelated addresses', () => {
    const text = 'Privacy queries: privacy@bigcorp.com. To apply, email hr@bigcorp.com with your CV.';
    assert.equal(extractApplyEmail(text), 'hr@bigcorp.com');
  });

  test('returns null when there is no address', () => {
    assert.equal(extractApplyEmail('Apply through the portal.'), null);
  });
});

describe('scam screening', () => {
  const profile = buildProfile(CV_TEXT, {}).profile;

  test('flags money requests, upfront payment and crypto payroll', () => {
    const risk = assessJobRisk({
      title: 'Work-from-home Data Entry Assistant',
      company: 'Fast Cash Recruiters',
      description: 'Earn R2 500 per day. Pay a registration deposit via bitcoin. Send your bank details and ID number to fastcash.recruiters@gmail.com.',
    });
    assert.equal(risk.level, 'high');
    assert.ok(risk.flags.length >= 2);
  });

  test('does not treat a legitimate crypto company as a scam', () => {
    const risk = assessJobRisk({
      title: 'Senior Product Designer',
      company: 'Luno',
      description:
        'Luno is a crypto exchange. You will design trading experiences in Figma, run research and maintain our design system. Requirements: 5+ years, accessibility, prototyping. Email careers@luno.com.',
    });
    assert.equal(risk.level, 'low');
    assert.equal(risk.flags.length, 0);
  });

  test('high-risk listings can never be prepared for application', () => {
    const job = {
      title: 'Work-from-home Data Entry Assistant — Earn R2 500 per day',
      company: 'Fast Cash Recruiters',
      description: SCAM_ADVERT,
      requirements: [],
    };
    const match = scoreJob({ profile, truthIndex: buildProfile(CV_TEXT, {}).extraction?.truthIndex, job, settings: { minMatchScore: 40, reviewThreshold: 40, autoApplyThreshold: 80, autoApplyEnabled: true } });
    assert.equal(match.decision, 'skip');
    assert.match(match.decisionReason, /safety screening/i);
  });
});

describe('application policy', () => {
  const base = { autoApplyEnabled: true, requireConfirmation: false, autoApplyThreshold: 80, reviewThreshold: 70 };

  test('≥80% with low risk and automation on → auto apply', () => {
    assert.equal(decidePolicy({ score: 92, risk: { level: 'low' }, settings: base }).decision, 'auto_apply');
  });

  test('70–79% → human review', () => {
    assert.equal(decidePolicy({ score: 74, risk: { level: 'low' }, settings: base }).decision, 'review');
  });

  test('below the minimum → skip', () => {
    assert.equal(decidePolicy({ score: 61, risk: { level: 'low' }, settings: base }).decision, 'skip');
  });

  test('confirmation required downgrades auto-apply to review', () => {
    const { decision, decisionReason } = decidePolicy({ score: 95, risk: { level: 'low' }, settings: { ...base, requireConfirmation: true } });
    assert.equal(decision, 'review');
    assert.match(decisionReason, /confirmation is required/i);
  });

  test('medium risk always needs a human', () => {
    const { decision } = decidePolicy({ score: 95, risk: { level: 'medium', flags: [{ label: 'x' }] }, settings: base });
    assert.equal(decision, 'review');
  });

  test('high risk is always skipped regardless of score', () => {
    assert.equal(decidePolicy({ score: 99, risk: { level: 'high', flags: [{ label: 'money request' }] }, settings: base }).decision, 'skip');
  });
});

describe('truth guard', () => {
  const { extraction } = buildProfile(CV_TEXT, {});
  const truthIndex = extraction.truthIndex;

  test('catches an invented employer', () => {
    const result = validate('I currently work at Nedbank as a lead designer.', truthIndex);
    assert.equal(result.ok, false);
    assert.ok(result.violations.length > 0);
  });

  test('allows the employer and role being applied to', () => {
    const result = validate('I am excited about the Senior Product Designer role at Lumen Retail.', truthIndex, {
      allow: ['Lumen Retail', 'Senior Product Designer'],
    });
    assert.equal(result.ok, true);
  });

  test('accepts the candidate’s own history', () => {
    assert.equal(claimsAllowed('I led the rebuild of the merchant dashboard at Omega Pay.', truthIndex), true);
  });
});

describe('application generation', () => {
  const { profile, extraction } = buildProfile(CV_TEXT, {});
  const settings = { autoApplyEnabled: true, requireConfirmation: false, autoApplyThreshold: 80, reviewThreshold: 70, minMatchScore: 60 };

  test('uses only CV-backed facts, and reports what it cannot know', () => {
    const job = {
      title: 'Senior Product Designer',
      company: 'Lumen Retail',
      location: 'Cape Town',
      description: 'Design payments journeys in Figma. Requirements: design systems, accessibility, user research, 5+ years.',
      requirements: ['Design systems', 'Figma', 'Accessibility (WCAG)'],
      // Real adverts carry screening questions; the generator must answer only what it
      // can support and flag the rest for you.
      questions: ['What is your salary expectation?', 'What is your notice period?', 'Are you legally authorised to work in South Africa?'],
    };
    const match = scoreJob({ profile, truthIndex: extraction.truthIndex, job, settings });
    const generated = generateApplication({ profile, truthIndex: extraction.truthIndex, job, match, settings });

    assert.equal(generated.truthGuard.ok, true, JSON.stringify(generated.truthGuard.violations));
    assert.match(generated.coverLetter, /Lumen Retail/);
    assert.doesNotMatch(generated.coverLetter, /Nedbank|Google|Amazon/);
    // Salary and notice period are unknown in this CV, so they must be flagged for the user.
    assert.ok(Array.isArray(generated.needsUserInput));
    assert.ok(generated.answers.length >= 2, 'advert questions should be answered or flagged');
    assert.ok(
      generated.answers.some((a) => a.source === 'missing' || a.needsUser === true),
      'questions the CV cannot answer must be flagged for the user instead of guessed'
    );
    assert.ok(generated.tailoredCv.summary.length > 0);
  });
});

describe('bulk board lists (paste in any format, then verify)', () => {
  test('parses comma-separated, newline-separated, whitespace and JSON arrays', () => {
    assert.deepEqual(parseTokenList('stripe, figma ,  takealotgroup'), ['stripe', 'figma', 'takealotgroup']);
    assert.deepEqual(parseTokenList('stripe\nfigma\ntakealotgroup'), ['stripe', 'figma', 'takealotgroup']);
    assert.deepEqual(parseTokenList('["stripe", "figma"]'), ['stripe', 'figma']);
    // The JSON a user copies from a script often has a trailing comma, brackets and quotes.
    assert.deepEqual(parseTokenList("['stripe', 'figma',]"), ['stripe', 'figma']);
    assert.deepEqual(parseTokenList('["stripe","figma",]'), ['stripe', 'figma']);
    assert.deepEqual(parseTokenList(['Stripe', ' FIGMA ']), ['stripe', 'figma']);
  });

  test('removes duplicates and keeps order, so a re-paste never inflates the list', () => {
    assert.deepEqual(parseTokenList('stripe, STRIPE,\nstripe,figma'), ['stripe', 'figma']);
  });

  test('handles the real South African list the user pasted', () => {
    const pasted = `takealotgroup, takealotcom, offerzen, sociallabsa, stitch-6, luno, float-7, yoco,
peachpayments, tyme, tymebank, betway, multichoice, superbalist, mrprice,
enjin, oldmutual, allangray, coronation, ninetyone, sanlam, momentum`;
    const parsed = parseTokenList(pasted);
    assert.equal(parsed.length, 22);
    assert.ok(parsed.includes('takealotgroup') && parsed.includes('yoco'));
  });

  test('rotation walks the whole list across runs and never repeats within one run', () => {
    const tokens = Array.from({ length: 70 }, (_, i) => `token-${i}`);
    const config = { maxBoardsPerRun: 25 };
    const run1 = selectBoards(tokens, config, 'greenhouse');
    assert.equal(run1.selected.length, 25);
    assert.equal(new Set(run1.selected).size, 25);

    const run2 = selectBoards(tokens, { ...config, boardOffset: run1.nextOffset }, 'greenhouse');
    assert.equal(run2.selected[0], tokens[25], 'the second run resumes where the first stopped');

    // Three runs of 25 cover 75 slots, so every one of the 70 tokens is visited.
    const run3 = selectBoards(tokens, { ...config, boardOffset: run2.nextOffset }, 'greenhouse');
    const covered = new Set([...run1.selected, ...run2.selected, ...run3.selected]);
    assert.equal(covered.size, 70);
  });

  test('a list shorter than the window is fully searched, and the offset wraps to 0', () => {
    const tokens = ['stripe', 'figma'];
    const { selected, nextOffset } = selectBoards(tokens, {}, 'greenhouse');
    assert.deepEqual(selected, tokens);
    assert.equal(nextOffset, 0);
  });
});

describe('search warnings stay readable with long board lists', () => {
  test('44 identical board failures collapse into one line', async () => {
    const { collapseWarnings } = await import('../src/connectors/index.js');
    const boards = Array.from({ length: 44 }, (_, i) => `board-${i}`);
    const raw = boards.map(
      (b) => `Greenhouse job boards: Greenhouse board “${b}”: Outbound network access is disabled in this environment.`
    );
    const collapsed = collapseWarnings(raw);
    assert.equal(collapsed.length, 1, 'one reason should read as one warning');
    assert.match(collapsed[0], /44 item\(s\)/);
    assert.match(collapsed[0], /board-0/);

    // Different reasons must not be merged away.
    const mixed = collapseWarnings([
      'Greenhouse job boards: Greenhouse board “a”: reason one',
      'Greenhouse job boards: Greenhouse board “b”: reason two',
      'Lever job sources: needs configuration (companies).',
    ]);
    assert.equal(mixed.length, 3);
  });
});
