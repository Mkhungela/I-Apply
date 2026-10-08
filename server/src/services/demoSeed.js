/**
 * Demo workspace.
 *
 * Creates a clearly-labelled sample dataset so you can watch the whole workflow
 * (search → match → policy → generate → track) without waiting for live sources or
 * risking a real application. Every demo row is flagged `is_demo` and the UI marks
 * it; no submission is ever attempted for a demo listing.
 */
import { db } from '../db/index.js';
import { buildProfile } from './profileBuilder.js';
import { ingestJobs, scoreAndStore, loadProfile, loadSettings, truthIndexFor, recordActivity, defaultSettings } from './jobPipeline.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';

const DEMO_CV = `THANDI MOLEFE
UX/UI Designer
Johannesburg, South Africa
thandi.molefe@example.com | +27 82 555 0134
linkedin.com/in/thandimolefe | thandimolefe.design

PROFILE
UX/UI Designer with 6 years of experience designing digital products for financial services
and e-commerce teams. I run end-to-end design: research, information architecture, wireframes,
high-fidelity prototyping in Figma, usability testing and design-system work. I collaborate
closely with engineers and product managers and I care about accessibility, measurable outcomes
and shipping.

CORE SKILLS
UX design, UI design, UX research, user interviews, usability testing, prototyping, wireframing,
information architecture, journey mapping, personas, design systems, accessibility (WCAG 2.1 AA),
responsive design, mobile app design, A/B testing, product analytics, stakeholder management,
design thinking, agile/scrum, mentoring

TOOLS
Figma, FigJam, Figma auto-layout, Miro, Maze, Hotjar, Google Analytics, Jira, Confluence, Storybook,
Photoshop, Illustrator, Principle, Notion, HTML, CSS, Webflow

EXPERIENCE
Senior UX/UI Designer | Lumo Financial | Johannesburg, South Africa | Mar 2022 - Present
• Led the redesign of the onboarding journey, lifting completion by 34% and cutting support tickets by 21%
• Built and maintain a 180-component design system in Figma with tokenised styles, now used by 4 squads
• Ran 40+ moderated usability sessions and 6 rounds of unmoderated testing in Maze, feeding a quarterly research backlog
• Partnered with 3 engineering squads to ship 12 releases, reviewing implementation for accessibility and responsive behaviour
• Introduced weekly journey-mapping sessions that reduced rework on checkout by an estimated 15%

UX Designer | BrightCart E-commerce | Cape Town, South Africa | Jan 2020 - Feb 2022
• Redesigned the mobile checkout flow, increasing conversion by 12% across 220 000 monthly sessions
• Ran discovery research with 25 customers, producing personas and a journey map adopted by the product team
• Worked with analytics to identify drop-off points, reducing cart abandonment by 9%

UI Designer | Nimbus Digital Agency | Pretoria, South Africa | Feb 2019 - Dec 2019
• Designed responsive marketing sites and dashboards for 14 clients across retail and healthcare
• Produced UI kits and handover documentation adopted as the agency standard

EDUCATION
BA Information Design | University of Pretoria | 2018
National Senior Certificate | Pretoria High School | 2014

CERTIFICATIONS
Google UX Design Professional Certificate | 2021
Nielsen Norman Group UX Certification (Interaction Design) | 2023

PROJECTS
Lumo Onboarding Redesign
End-to-end redesign of a 7-step financial onboarding flow: research, IA, prototypes, usability testing and handover. Completion rate up 34%.

BrightCart Mobile Checkout
Three-iteration checkout redesign tested with 18 participants; conversion up 12% and abandonment down 9%.

ACHIEVEMENTS
• Increased onboarding completion by 34% and reduced support tickets by 21%
• Grew design-system adoption to 4 engineering squads and 180 components
• Mentored 2 junior designers to mid-level promotion

LANGUAGES
English (Native), isiZulu (Conversational), Afrikaans (Basic)

NOTICE PERIOD
notice period: 30 days
Expected salary: R55 000 per month
Work authorisation: South African citizen with unrestricted right to work in South Africa
`;

/**
 * Demo listings. Deliberately includes the good/bad/ugly cases:
 * strong matches, a seniority-overshoot, a duplicate posting across two boards,
 * and a scam listing that must be blocked.
 */
const DEMO_JOBS = [
  {
    title: 'UX/UI Designer',
    company: 'Kora Health',
    location: 'Johannesburg, South Africa',
    sourceKey: 'greenhouse',
    externalId: 'demo-gh-1001',
    employmentType: 'full-time',
    workMode: 'hybrid',
    salaryRaw: 'R620 000 - R720 000 per year',
    postedAt: daysAgo(2),
    applicantsCount: 14,
    tags: ['Design', 'HealthTech'],
    description: `Kora Health is hiring a UX/UI Designer to work across our patient and clinician products.

What you will do
• Own end-to-end design for new features: UX research, wireframes, high-fidelity prototypes in Figma
• Plan and run usability testing sessions, and turn findings into prioritised improvements
• Contribute to and extend our design system, keeping components accessible and documented
• Work with engineers and product managers in two-week sprints
• Use analytics and A/B testing to validate design decisions

Requirements
• 4+ years of UX and UI design experience in digital product teams
• Strong Figma skills, including components and auto-layout
• UX research and usability testing experience (moderated and unmoderated)
• Design systems experience
• Accessibility: WCAG 2.1 AA practical knowledge
• Portfolio demonstrating end-to-end product work

Nice to have
• Experience in healthcare or financial services
• Motion design or prototyping in ProtoPie
• Basic HTML/CSS literacy`,
  },
  {
    title: 'Product Designer',
    company: 'Sanlam Digital',
    location: 'Cape Town, South Africa',
    sourceKey: 'lever',
    externalId: 'demo-lv-2002',
    employmentType: 'full-time',
    workMode: 'hybrid',
    salaryRaw: 'Market related',
    postedAt: daysAgo(5),
    applicantsCount: 32,
    tags: ['Product', 'Insurance'],
    description: `We are looking for a Product Designer to join the digital experience team.

You will
• Design end-to-end product experiences from discovery to delivery
• Run user research and translate insight into product direction
• Build prototypes in Figma and validate them with users
• Partner with product managers on roadmap and prioritisation
• Work with our design system team to reuse and improve patterns

Requirements
• 5+ years product design experience
• Strong interaction design and prototyping skills
• UX research: interviews, usability testing, synthesis
• Design systems and component-library experience
• Excellent stakeholder management and presentation skills
• Familiarity with analytics tools and A/B testing

Nice to have
• Financial services or insurance experience
• Accessibility auditing experience`,
  },
  {
    title: 'Senior Product Designer — Team Lead',
    company: 'Vantage Capital Systems',
    location: 'Sandton, South Africa',
    sourceKey: 'greenhouse',
    externalId: 'demo-gh-3003',
    employmentType: 'full-time',
    workMode: 'onsite',
    salaryRaw: 'R1 100 000 - R1 300 000 per year',
    postedAt: daysAgo(1),
    applicantsCount: 61,
    tags: ['Product', 'Enterprise'],
    description: `Senior Product Designer to lead our enterprise design practice.

Requirements
• 8+ years of product design experience
• Must manage a team of 10 designers, including hiring, performance reviews and career development
• Track record leading design at enterprise scale across multiple product lines
• Expert in advanced accessibility and enterprise design systems
• Experience defining design strategy with C-level stakeholders
• Proven track record growing design maturity in an organisation

You will own the design org, run quarterly planning, and represent design at board level.`,
  },
  {
    title: 'Frontend Developer (Design Systems)',
    company: 'Takealot Group',
    location: 'Cape Town, South Africa (Hybrid)',
    sourceKey: 'workable',
    externalId: 'demo-wk-4004',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(6),
    applicantsCount: 27,
    tags: ['Engineering'],
    description: `Join the design systems team to build the component library used by our web teams.

Requirements
• 4+ years front-end development: JavaScript, HTML, CSS
• React and TypeScript experience
• Component library / design system work (Storybook)
• Accessibility knowledge — WCAG, semantic HTML, keyboard navigation
• Experience working closely with designers using Figma
• Git and CI/CD workflow experience
• Testing with Jest or Vitest

Nice to have
• Tailwind CSS
• Web performance optimisation
• Design token tooling`,
  },
  {
    title: 'UI Designer',
    company: 'PayFast',
    location: 'Remote, South Africa',
    sourceKey: 'remotive',
    externalId: 'demo-rm-5005',
    employmentType: 'full-time',
    workMode: 'remote',
    salaryRaw: 'R45 000 - R60 000 per month',
    postedAt: daysAgo(3),
    applicantsCount: 9,
    remoteRestriction: 'South Africa',
    tags: ['Design', 'FinTech'],
    description: `We are a payments company hiring a UI Designer to work remotely from South Africa.

What you'll do
• Design polished, accessible interfaces for our merchant dashboard and mobile app
• Own visual design quality: typography, colour, spacing, component consistency
• Extend our Figma design system and keep it in step with the codebase
• Work with UX researchers to translate findings into interface improvements
• Hand over to engineers with clear specs and review implementation

Requirements
• 3+ years UI or product design experience
• Excellent Figma skills
• Design systems experience
• Responsive design and mobile app design
• Attention to detail and a strong portfolio

Nice to have
• E-commerce or payments experience
• Illustration or motion design`,
  },
  {
    title: 'UX Researcher (Contract)',
    company: 'Discovery Limited',
    location: 'Johannesburg, South Africa',
    sourceKey: 'pnet',
    externalId: 'demo-pn-6006',
    employmentType: 'contract',
    workMode: 'hybrid',
    postedAt: daysAgo(8),
    tags: ['Research'],
    description: `6-month contract for a UX Researcher.

Requirements
• 4+ years UX research experience
• Moderated and unmoderated usability testing
• Qualitative research: interviews, diary studies, contextual inquiry
• Survey design and analysis
• Experience with research tooling (Dovetail, Maze or similar)
• Working with product analytics

You will build the research repository and run a quarterly study programme.`,
  },
  {
    title: 'UX Designer',
    company: 'Nedbank',
    location: 'Johannesburg, South Africa',
    sourceKey: 'careers24',
    externalId: 'demo-c24-7007',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(4),
    applicantsCount: 48,
    tags: ['Design', 'Banking'],
    description: `Nedbank is looking for a UX Designer within the digital channels team.

Requirements
• 3-5 years UX design experience
• User research, journey mapping and information architecture
• Wireframing and prototyping in Figma
• Usability testing
• Collaboration with developers and product owners
• Banking or financial services exposure advantageous`,
  },
  {
    title: 'Senior UX/UI Designer',
    company: 'Yoco',
    location: 'Cape Town, South Africa (Hybrid)',
    sourceKey: 'lever',
    externalId: 'demo-lv-8008',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(2),
    applicantsCount: 21,
    tags: ['Design', 'FinTech'],
    description: `Yoco is hiring a Senior UX/UI Designer to design payments and merchant tools.

Requirements
• 5+ years UX and UI design for digital products
• End-to-end design: research, IA, wireframes, prototypes, polished UI
• Figma expertise and design-system contribution
• Usability testing and synthesis
• Comfort with ambiguity and strong stakeholder communication
• FinTech or payments experience is a plus
• Accessible design (WCAG) awareness`,
  },
  {
    title: 'Lead Product Designer',
    company: 'Standard Bank Group',
    location: 'Johannesburg, South Africa',
    sourceKey: 'manual',
    externalId: 'demo-man-9009',
    url: 'https://www.linkedin.com/jobs/view/lead-product-designer-at-standard-bank-group-3987654321',
    applyUrl: 'https://www.linkedin.com/jobs/view/lead-product-designer-at-standard-bank-group-3987654321',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(1),
    applicantsCount: 83,
    tags: ['LinkedIn'],
    description: `Lead Product Designer for our consumer banking app.

Requirements
• 7+ years product design experience
• Leading a team of 4+ designers: coaching, reviews, hiring input
• Design strategy across multiple squads
• Strong research and prototyping practice
• Expert design systems knowledge
• Stakeholder management with senior executives`,
  },
  {
    title: 'Freelance Web Designer',
    company: 'Studio Kite',
    location: 'Remote (Worldwide)',
    sourceKey: 'remoteok',
    externalId: 'demo-rk-1010',
    employmentType: 'freelance',
    workMode: 'remote',
    postedAt: daysAgo(3),
    tags: ['Freelance', 'Agency'],
    description: `Studio Kite is building a bench of freelance web designers for client projects.

Requirements
• Portfolio of responsive marketing websites
• Figma or Sketch for design, Webflow or similar for build
• Understanding of SEO and web performance basics
• Ability to work async with clients across time zones
• 3+ years experience

Paid per project, typically 2-6 weeks each.`,
  },
  {
    title: 'UX/UI Designer',
    company: 'Kora Health',
    location: 'Johannesburg, South Africa',
    sourceKey: 'import',
    externalId: 'demo-imp-1011',
    tags: ['Duplicate'],
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(2),
    description: `Duplicate of the Kora Health UX/UI Designer advert, syndicated on a different board. Identical requirements: Figma, UX research, prototyping, usability testing, design systems, accessibility.`,
  },
  {
    title: 'Senior Product Designer',
    company: 'Luno',
    location: 'Cape Town / Remote, South Africa',
    sourceKey: 'greenhouse',
    externalId: 'demo-gh-1112',
    employmentType: 'full-time',
    workMode: 'remote',
    postedAt: daysAgo(7),
    applicantsCount: 55,
    tags: ['Crypto', 'Design'],
    description: `Luno is looking for a Senior Product Designer.

Requirements
• 6+ years product design experience in consumer products
• Mobile-first product thinking and prototyping
• UX research and usability testing
• Design systems
• Data-informed design: analytics and experimentation
• Crypto or fintech domain interest

Nice to have
• Design ops or tooling experience
• Accessibility specialism`,
  },
  {
    title: 'UX Designer — Fixed Term 12 Months',
    company: 'Old Mutual',
    location: 'Cape Town, South Africa',
    sourceKey: 'careers24',
    externalId: 'demo-c24-1213',
    employmentType: 'contract',
    workMode: 'hybrid',
    postedAt: daysAgo(9),
    tags: ['Insurance'],
    description: `12-month fixed-term UX Designer role in the digital advisory team.

Requirements
• 3+ years UX design
• Research, journey mapping, wireframing
• Figma prototyping
• Usability testing
• Financial services advantage
• Working in agile squads with Jira and Confluence`,
  },
  {
    title: 'UX/UI Designer (Remote, EU hours)',
    company: 'Helio Labs',
    location: 'Remote, United Kingdom',
    sourceKey: 'arbeitnow',
    externalId: 'demo-an-1314',
    employmentType: 'full-time',
    workMode: 'remote',
    postedAt: daysAgo(4),
    applicantsCount: 37,
    remoteRestriction: 'Europe',
    tags: ['SaaS', 'Remote'],
    description: `Remote-first B2B SaaS company hiring a UX/UI Designer.

Requirements
• 4+ years UX/UI design in SaaS products
• Figma, prototyping, design systems
• UX research and usability testing
• Working with engineers in a distributed team
• Excellent written communication for async work

You must be able to work within European hours. Occasional travel to London.`,
  },
  {
    title: 'Interaction Designer',
    company: 'MultiChoice',
    location: 'Randburg, South Africa',
    sourceKey: 'pnet',
    externalId: 'demo-pn-1415',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(11),
    applicantsCount: 22,
    tags: ['Media'],
    description: `Interaction Designer for streaming product experiences.

Requirements
• 4+ years interaction design
• Motion design and prototyping (After Effects or ProtoPie)
• Design systems and component behaviour specs
• Usability testing
• Collaboration with engineers on implementation detail
• TV or streaming experience is an advantage`,
  },
  {
    title: 'Design Intern (6 months)',
    company: 'Rocket Design Agency',
    location: 'Pretoria, South Africa',
    sourceKey: 'rss',
    externalId: 'demo-rss-1516',
    employmentType: 'internship',
    workMode: 'onsite',
    tags: ['Internship'],
    description: `Graduate/internship programme for junior designers.

Requirements
• Recent graduate in design
• Photoshop and Illustrator basics
• Willingness to learn Figma
• Available 6 months, on-site in Pretoria

Stipend: R7 500 per month.`,
  },
  {
    title: 'Work-from-home Data Entry Assistant — Earn R2 500 per day',
    company: 'FastHire Recruiters',
    location: 'Remote',
    sourceKey: 'indeed',
    externalId: 'demo-scam-1617',
    employmentType: 'part-time',
    workMode: 'remote',
    postedAt: daysAgo(1),
    tags: ['Suspicious'],
    description: `URGENT HIRING! No experience needed, no interview required — start immediately and earn R2 500 per day.

To secure your position, pay a small refundable registration fee of R150 to our bank account and send us a copy of your ID and your banking details.

WhatsApp us now on 081 555 0000 with the word JOBS to claim your position before limited slots close today! Salary is paid in USDT cryptocurrency for convenience.`,
  },
  {
    title: 'Brand & Marketing Designer',
    company: 'Woolworths SA',
    location: 'Cape Town, South Africa',
    sourceKey: 'careers24',
    externalId: 'demo-c24-1718',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(13),
    tags: ['Retail', 'Brand'],
    description: `Brand and marketing designer for campaign work.

Requirements
• 4+ years brand/marketing design
• Adobe Creative Suite (Photoshop, Illustrator, InDesign)
• Email design (Mailchimp or Klaviyo)
• Art direction for photo shoots
• Campaign rollout across print and digital
• Retail experience preferred`,
  },
  {
    title: 'Senior UX Designer — Health Platform',
    company: 'Momentum Health',
    location: 'Centurion, South Africa',
    sourceKey: 'greenhouse',
    externalId: 'demo-gh-1819',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(3),
    applicantsCount: 19,
    tags: ['HealthTech'],
    description: `Senior UX Designer for a digital health platform.

Requirements
• 5+ years UX design
• End-to-end process: research, IA, wireframes, prototyping, usability testing
• Design systems contribution
• Accessibility (WCAG) in practice
• Mentoring junior designers
• Stakeholder management across clinical and technical teams
• Strong communication skills`,
  },
  {
    title: 'Head of Design',
    company: 'Naspers',
    location: 'Cape Town, South Africa',
    sourceKey: 'lever',
    externalId: 'demo-lv-1920',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(6),
    tags: ['Leadership'],
    description: `Head of Design to lead a 25-person design function across 5 product lines.

Requirements
• 12+ years design experience with 5+ years in leadership
• Managing managers and building design ops
• Design strategy at group level
• Budget ownership and vendor management
• Board-level communication
• Track record scaling design teams through rapid growth`,
  },
  {
    title: 'UX/UI Designer — Fintech (Hybrid Bellville)',
    company: 'Capitec Bank',
    location: 'Bellville, Cape Town, South Africa',
    sourceKey: 'careers24',
    externalId: 'demo-c24-2021',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(2),
    applicantsCount: 29,
    tags: ['Banking'],
    description: `UX/UI Designer for Capitec's digital banking team.

Requirements
• 4+ years UX/UI design
• Figma, prototyping, wireframing
• UX research and usability testing
• Design systems
• Mobile app design
• Accessibility awareness
• Working in agile squads`,
  },
  {
    title: 'Design Systems Engineer (Figma + React)',
    company: 'Investec',
    location: 'Sandton, South Africa',
    sourceKey: 'workable',
    externalId: 'demo-wk-2222',
    employmentType: 'full-time',
    workMode: 'hybrid',
    postedAt: daysAgo(4),
    applicantsCount: 18,
    tags: ['Design Ops'],
    description: `Design Systems Engineer to bridge design and front-end engineering.

Requirements
• React and TypeScript
• HTML and CSS
• Design token pipelines and component APIs
• Figma libraries and component documentation
• Accessibility (WCAG)
• Storybook
• Supporting designers in a large organisation`,
  },
  {
    title: 'Junior UI Designer',
    company: 'Mango Marketing',
    location: 'Durban, South Africa',
    sourceKey: 'pnet',
    externalId: 'demo-pn-2323',
    employmentType: 'full-time',
    workMode: 'onsite',
    postedAt: daysAgo(15),
    tags: ['Agency'],
    description: `Junior UI Designer role in a fast-paced agency.

Requirements
• 1-2 years design experience
• Photoshop and Canva
• Working to brand guidelines
• Basic Figma
• Willing to learn quickly on the job`,
  },
  {
    title: 'Remote UX Writer',
    company: 'Trellis Software',
    location: 'Remote, United States',
    sourceKey: 'remotive',
    externalId: 'demo-rm-2424',
    employmentType: 'contract',
    workMode: 'remote',
    postedAt: daysAgo(5),
    applicantsCount: 44,
    remoteRestriction: 'United States',
    tags: ['Content'],
    description: `Remote UX Writer for an enterprise SaaS product.

Requirements
• 4+ years UX writing and content design
• Microcopy, product documentation, content strategy
• Working with designers in Figma
• Content guidelines and terminology management
• Must be authorised to work in the United States`,
  },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/**
 * Seeds the demo workspace for a user: sample CV profile (if they have none),
 * the demo listings, and a full scoring pass.
 */
export async function seedDemoWorkspace(userId) {
  const database = db();
  const existingProfile = loadProfile(userId);

  // 1. Profile: use the user's real CV if they have one; otherwise seed the sample.
  if (!existingProfile) {
    const { profile } = buildProfile(DEMO_CV, { filename: 'demo-cv-thandi-molefe.txt' });
    const columns = [
      profile.fullName, profile.headline, profile.email, profile.phone, profile.location, profile.country, profile.city,
      profile.linkedinUrl, profile.portfolioUrl, profile.githubUrl, profile.summary, profile.yearsExperience, profile.seniority,
      profile.workAuthorization, profile.salaryExpectation, profile.salaryCurrency, profile.noticePeriod,
      JSON.stringify(profile.skills), JSON.stringify(profile.tools), JSON.stringify(profile.jobTitles), JSON.stringify(profile.experience),
      JSON.stringify(profile.education), JSON.stringify(profile.certifications), JSON.stringify(profile.projects),
      JSON.stringify(profile.languages), JSON.stringify(profile.industries), JSON.stringify(profile.achievements), JSON.stringify(profile.extraction || {}),
    ];
    database.run(
      `INSERT INTO profiles (user_id, full_name, headline, email, phone, location, country, city, linkedin_url, portfolio_url, github_url,
        summary, years_experience, seniority, work_authorization, salary_expectation, salary_currency, notice_period, skills, tools, job_titles,
        experience, education, certifications, projects, languages, industries, achievements, extraction)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId,
      ...columns
    );
    database.run(
      `INSERT INTO cvs (user_id, filename, mime, size, storage_path, text_content, parsed, is_active)
       VALUES (?, 'demo-cv-thandi-molefe.txt', 'text/plain', ?, 'demo-seed', ?, ?, 1)`,
      userId,
      Buffer.byteLength(DEMO_CV, 'utf8'),
      DEMO_CV,
      JSON.stringify(profile)
    );
  }

  // 2. Settings tuned to the brief if the user has not configured anything yet.
  const settingsRow = database.get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  const emptySettings = !settingsRow || (safeJson(settingsRow?.roles, []).length === 0 && !settingsRow?.auto_apply_enabled);
  if (emptySettings) {
    const base = { ...defaultSettings(), ...{
      roles: ['UX Designer', 'UI Designer', 'UX/UI Designer', 'Product Designer', 'UI Developer', 'Frontend Developer'],
      locations: ['South Africa', 'Remote', 'International'],
      countries: ['South Africa'],
      workModes: ['remote', 'hybrid', 'onsite'],
      employmentTypes: ['full-time', 'contract', 'freelance'],
      minMatchScore: 70,
      autoApplyThreshold: 80,
      reviewThreshold: 70,
      autoApplyEnabled: false,
      requireConfirmation: true,
      maxApplicationsPerDay: 20,
      maxApplicationsPerWeek: 60,
      durationDays: 7,
      cadence: 'daily',
      runsPerDay: 3,
      preferRecentDays: 14,
      prioritizeLowApplicants: true,
    } };
    const columns = {
      roles: JSON.stringify(base.roles),
      locations: JSON.stringify(base.locations),
      countries: JSON.stringify(base.countries),
      work_modes: JSON.stringify(base.workModes),
      employment_types: JSON.stringify(base.employmentTypes),
      min_match_score: base.minMatchScore,
      auto_apply_threshold: base.autoApplyThreshold,
      review_threshold: base.reviewThreshold,
      auto_apply_enabled: 0,
      max_applications_per_day: base.maxApplicationsPerDay,
      max_applications_per_week: base.maxApplicationsPerWeek,
      max_per_company: base.maxPerCompany,
      duration_days: base.durationDays,
      cadence: base.cadence,
      runs_per_day: base.runsPerDay,
      prefer_recent_days: base.preferRecentDays,
      prioritize_low_applicants: 1,
      reapplication_allowed: 0,
      require_confirmation: 1,
      notify_in_app: 1,
      enabled_connectors: JSON.stringify([]),
    };
    if (settingsRow) {
      database.run(
        `UPDATE user_settings SET ${Object.keys(columns).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE user_id = ?`,
        ...Object.values(columns),
        userId
      );
    } else {
      database.run(
        `INSERT INTO user_settings (user_id, ${Object.keys(columns).join(', ')}) VALUES (?, ${Object.keys(columns).map(() => '?').join(', ')})`,
        userId,
        ...Object.values(columns)
      );
    }
  }

  // 3. Demo jobs + scoring.
  const existingDemo = database.get('SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND is_demo = 1', userId)?.c ?? 0;
  let inserted = [];
  if (!existingDemo) {
    const result = ingestJobs(
      userId,
      DEMO_JOBS.map((job) => ({
        ...job,
        isDemo: true,
        url: job.url || `https://example-jobs.test/demo/${job.sourceKey}/${job.externalId}`,
        applyUrl: job.applyUrl || job.url || `https://example-jobs.test/demo/${job.sourceKey}/${job.externalId}`,
        apply: job.sourceKey === 'greenhouse' ? { mode: 'assisted', provider: 'demo', note: 'Demo listing — no submission is attempted.' } : { mode: 'assisted', provider: 'demo' },
      })),
      { isDemo: true }
    );
    inserted = result.inserted;
  }

  const profile = loadProfile(userId);
  const truthIndex = truthIndexFor(userId);
  const settings = loadSettings(userId);
  const toScore = database.all(
    'SELECT * FROM jobs WHERE user_id = ? AND is_demo = 1 AND id NOT IN (SELECT job_id FROM matches WHERE user_id = ?)',
    userId,
    userId
  );
  const matches = [];
  for (const row of toScore) {
    try {
      const match = scoreAndStore(userId, row, { profile, truthIndex, settings });
      matches.push({ jobId: match.job.id, title: match.job.title, score: match.score, decision: match.decision });
    } catch {
      /* ignore a single bad row */
    }
  }

  recordActivity({
    userId,
    level: 'info',
    scope: 'demo',
    message: `Demo workspace loaded: ${inserted.length || toScore.length} sample jobs scored. Demo rows are labelled and never submitted automatically.`,
  });
  await notify({
    userId,
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Demo workspace ready',
    body: `${matches.length || toScore.length} sample jobs were scored against ${
      existingProfile ? 'your CV' : 'a sample UX/UI designer CV (replace it with your own by uploading yours)'
    }. Press START JOB HUNT to watch the agent search, match, tailor and track. Demo listings never get submitted for real.`,
  });

  return {
    seeded: {
      demoJobs: inserted.length || toScore.length,
      profile: existingProfile ? 'kept your existing profile' : 'created a sample profile',
      scored: matches.length,
    },
    matches: matches.sort((a, b) => b.score - a.score).slice(0, 12),
    note: 'Demo listings are marked “Demo” everywhere and are never submitted to a real employer.',
  };
}

function safeJson(value, fallback = []) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export { DEMO_CV, DEMO_JOBS };

export const DEMO_EMAIL = 'demo@aijobhunter.local';

/**
 * Ensures a ready-to-explore demo account exists (used by the one-click demo login
 * and by AUTO_SEED_DEMO). The account holds only clearly-labelled sample data and
 * cannot be used to submit anything real.
 */
export async function ensureDemoUser({ createIfMissing = true } = {}) {
  const database = db();
  const existing = database.get('SELECT id FROM users WHERE email = ?', DEMO_EMAIL);
  if (existing) return { userId: existing.id, created: false };
  if (!createIfMissing) return { userId: null, created: false };

  const { hashPassword, randomToken } = await import('../lib/crypto.js');
  const password = await hashPassword(`demo-${randomToken(18)}`);
  const info = database.run('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', DEMO_EMAIL, password, 'Demo user');
  const userId = Number(info.lastInsertRowid);
  database.run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
  await seedDemoWorkspace(userId);
  return { userId, created: true };
}
