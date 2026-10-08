/**
 * Policy-first "guide" connectors.
 *
 * These are platforms where automated search or automated applying is NOT
 * permitted by their terms, or requires an approved partner integration that we
 * cannot assume you have. AI Job Hunter therefore does not automate them at all.
 *
 * Instead each guide connector:
 *   1. states the platform's rule and the basis for it,
 *   2. lists exactly what credentials / approval would be required to automate,
 *   3. offers the permitted route — paste a job link, and AI Job Hunter runs
 *      matching, tailoring, document generation, tracking and reminders.
 */
import { JobConnector, ConnectorNeedsSetup } from './base.js';

/** @type {Array<object>} */
export const GUIDES = [
  {
    key: 'linkedin',
    name: 'LinkedIn Jobs',
    category: 'social_board',
    description:
      'First-class in AI Job Hunter, but not automated. LinkedIn’s User Agreement prohibits third-party software that scrapes, bots or automates activity on LinkedIn, and Easy Apply is deliberately rate-limited. Use the paste-a-link flow: you browse and save jobs, AI Job Hunter does the match analysis, tailoring, answers and tracking.',
    automationPolicy: {
      automatedSearch: 'prohibited',
      automatedApply: 'prohibited',
      basis:
        'LinkedIn User Agreement §8.2 (Dos and Don’ts) prohibits bots, scrapers, and automating activity on LinkedIn. Easy Apply limits exist to keep applications human-submitted.',
      risk:
        'Automating LinkedIn activity risks account restriction. AI Job Hunter will not attempt it, and has no code path that does.',
    },
    credentials: [
      {
        name: 'linkedin_partner_access',
        label: 'LinkedIn approved partner access',
        required: false,
        help:
          'Automated job search/apply would need an approved LinkedIn partnership (Talent Solutions / Job Posting API under the LinkedIn Partner Programme). Standard developer apps do NOT grant job-search or apply automation. Until you hold such access, use the assisted flow.',
      },
    ],
    permittedRoute:
      'Browse LinkedIn with your saved searches and job alerts, then paste each job URL into AI Job Hunter. Matching, tailored CV, cover letter, answer sheet and tracking all run on it. You can also let AI Job Hunter open the job in a new tab when you click “Apply”.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote:
      'No scraping, no bots, no automated activity on linkedin.com. Human-in-the-loop by design.',
    defaultEnabled: true,
  },
  {
    key: 'indeed',
    name: 'Indeed',
    category: 'job_board',
    description:
      'Indeed forbids automated scraping and automated applications outside their partner programme. Job search is possible through the official Indeed Publisher / Job Sync APIs with an approved API key; applying is possible through “Apply with Indeed” partner integration.',
    automationPolicy: {
      automatedSearch: 'allowed_with_api_key',
      automatedApply: 'not_permitted_without_partner_integration',
      basis: 'Indeed Terms of Service prohibit scraping and automated submission without an approved integration.',
    },
    credentials: [
      { name: 'indeed_publisher_key', label: 'Indeed Publisher API key', required: true, help: 'From indeed.com/publisher — grants job search results via the official API.' },
      { name: 'indeed_apply_partner', label: 'Apply with Indeed partner credentials', required: false, help: 'Only available to approved ATS partners; enables programmatic application submission.' },
    ],
    permittedRoute: 'Add your Publisher API key to enable compliant Indeed search; applications are handed off to Indeed’s own form.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true, apiRequired: true },
    complianceNote: 'No scraping, no form posting. Official API only.',
    defaultEnabled: true,
  },
  {
    key: 'glassdoor',
    name: 'Glassdoor',
    category: 'job_board',
    description:
      'Glassdoor does not offer a public jobs API and prohibits scraping. Job listings often mirror the employer’s own ATS — paste the link and AI Job Hunter will detect the underlying Greenhouse/Lever/Workable/Workday posting and route the application accordingly.',
    automationPolicy: {
      automatedSearch: 'prohibited',
      automatedApply: 'prohibited',
      basis: 'Glassdoor Terms of Use prohibit scraping and automated access; no public jobs API is offered.',
    },
    credentials: [{ name: 'glassdoor_partner_access', label: 'Glassdoor partner/API access', required: false, help: 'Not publicly available; would require a commercial agreement.' }],
    permittedRoute: 'Paste the Glassdoor job link. AI Job Hunter resolves the employer’s own application page and prepares a tailored, truthful application for you to submit there.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote: 'No scraping. Link resolution + assisted application only.',
    defaultEnabled: true,
  },
  {
    key: 'pnet',
    name: 'PNet (South Africa)',
    category: 'za_job_board',
    description:
      'PNet (StepStone / The Network group) does not publish an open API. Compliant access is available through The Network’s partner programme (which powers international job syndication). Until then, paste job links for assisted applications.',
    automationPolicy: {
      automatedSearch: 'not_permitted_without_partner_access',
      automatedApply: 'not_permitted_without_partner_access',
      basis: 'PNet/StepStone provide job data via The Network partner API agreements only; the public site prohibits automated access.',
    },
    credentials: [{ name: 'the_network_api_key', label: 'The Network (StepStone) partner API key', required: true, help: 'Obtained via a commercial agreement with The Network / StepStone — enables compliant syndicated job search.' }],
    permittedRoute: 'Paste PNet job links; or supply a The Network partner key to enable compliant search across their syndication.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true, apiRequired: true },
    complianceNote: 'No scraping. Partner API or assisted flow only.',
    defaultEnabled: true,
  },
  {
    key: 'careers24',
    name: 'Careers24 (South Africa)',
    category: 'za_job_board',
    description:
      'Careers24 (JSE-listed CA Financial Appointments group / Careers24 SA) has no public API and prohibits automated access. Use the assisted flow: paste links and let AI Job Hunter handle matching, tailoring, answers and tracking.',
    automationPolicy: {
      automatedSearch: 'prohibited',
      automatedApply: 'prohibited',
      basis: 'No public API; the site’s terms prohibit scraping/automated access.',
    },
    credentials: [{ name: 'careers24_api', label: 'Careers24 API access', required: false, help: 'Not publicly offered — would require a written agreement with Careers24.' }],
    permittedRoute: 'Paste Careers24 job links into AI Job Hunter for full match analysis, tailoring and tracking.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote: 'Assisted only.',
    defaultEnabled: true,
  },
  {
    key: 'wellfound',
    name: 'Wellfound (AngelList Talent)',
    category: 'startup_board',
    description:
      'Wellfound requires an account and prohibits automated access/scraping. Startup roles are often also posted on the employer’s own ATS, which AI Job Hunter can search if you add that board.',
    automationPolicy: {
      automatedSearch: 'prohibited',
      automatedApply: 'prohibited',
      basis: 'Wellfound Terms of Service prohibit scraping and automated interaction.',
    },
    credentials: [{ name: 'wellfound_api', label: 'Wellfound API access', required: false, help: 'No public API; requires a commercial agreement.' }],
    permittedRoute: 'Paste Wellfound job links; AI Job Hunter prepares the application and tracks it.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote: 'Assisted only.',
    defaultEnabled: true,
  },
  {
    key: 'workday',
    name: 'Workday-hosted careers pages',
    category: 'ats',
    description:
      'Workday has no public apply API and each employer runs its own tenant (e.g. company.wd3.myworkdayjobs.com). Applications must be completed in the employer’s own form.',
    automationPolicy: {
      automatedSearch: 'not_permitted_without_employer_access',
      automatedApply: 'not_permitted_without_employer_access',
      basis: 'Workday integrations are provisioned per employer under contract; there is no public job-board API.',
    },
    credentials: [{ name: 'workday_tenant_credentials', label: 'Workday integration credentials (per employer)', required: false, help: 'Only available if the employer provisions an integration user for you.' }],
    permittedRoute: 'Paste Workday job links. AI Job Hunter prepares your tailored CV, cover letter and answers, then opens the employer’s form for submission.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote: 'Assisted only.',
    defaultEnabled: true,
  },
  {
    key: 'company_careers',
    name: 'Company career pages (generic)',
    category: 'employer',
    description:
      'Any employer careers page. Paste the URL: AI Job Hunter detects whether it is hosted on Greenhouse, Lever, Workable or SmartRecruiters — if you have that board configured, the job is pulled properly and, for Greenhouse, can be submitted automatically.',
    automationPolicy: {
      automatedSearch: 'allowed_via_paste',
      automatedApply: 'depends_on_host',
      basis: 'Reading a page you paste is a single user-initiated fetch. Application automation depends on the ATS hosting the form.',
    },
    credentials: [],
    permittedRoute: 'Paste the job URL. Candidates are auto-routed to the right connector.',
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true, resolvesAts: true },
    complianceNote: 'One user-initiated page fetch per pasted link.',
    defaultEnabled: true,
  },
];

const GUIDE_BY_KEY = new Map(GUIDES.map((g) => [g.key, g]));

export function guideMeta(key) {
  return GUIDE_BY_KEY.get(key) || null;
}

/** Connector classes for guide sources: search is intentionally unavailable. */
export class GuideConnector extends JobConnector {
  static meta = GUIDES[0];

  constructor(ctx) {
    super(ctx);
    const guide = GUIDE_BY_KEY.get(this.constructor.meta.key);
    this.guide = guide;
  }

  static for(guide) {
    return class extends GuideConnector {
      static meta = guide;
    };
  }

  readiness() {
    return { ready: false, missing: (this.meta.credentials || []).filter((c) => c.required).map((c) => c.name), requiresSetup: true, canAutoApply: false, assistedOnly: true };
  }

  async search() {
    throw new ConnectorNeedsSetup(
      `${this.meta.name}: automated search is intentionally not implemented. ${this.meta.automationPolicy.basis} ${
        this.meta.credentials?.find((c) => c.required)?.help || ''
      }`.trim(),
      { required: (this.meta.credentials || []).filter((c) => c.required).map((c) => c.name) }
    );
  }

  async submitApplication(pkg) {
    return {
      status: 'requires_human',
      mode: 'assisted',
      detail: this.guide?.permittedRoute || this.meta.complianceNote,
      handoff: {
        url: pkg.job?.applyUrl || pkg.job?.url || null,
        policy: this.meta.automationPolicy,
        steps: [
          'Open the job link — it opens the platform’s own application form in your browser.',
          'Download the tailored CV and cover letter from this application record.',
          'Use the prepared answers as you fill in the form.',
          'Mark the application “Applied” here so your tracker and stats stay accurate.',
        ],
      },
    };
  }
}

export const guideConnectors = GUIDES.map((guide) => GuideConnector.for(guide));
