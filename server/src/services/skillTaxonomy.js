/**
 * Canonical skill / role taxonomy.
 *
 * Purpose: give the matcher a deterministic, explainable vocabulary so the same
 * free-text CV and job advert always normalise to the same skill ids. This is the
 * "local engine": it works with no API keys. When an LLM provider is configured
 * (see services/llm.js) it *enhances* results but is never required.
 *
 * Each entry: { id, label, category, aliases[] }
 * Categories: design, research, frontend, backend, data, product, a11y, method, tool, soft, cloud
 */

const s = (id, label, category, aliases) => ({ id, label, category, aliases: aliases.map((a) => a.toLowerCase()) });

export const SKILLS = [
  // --- UX / research -------------------------------------------------------
  s('ux-design', 'UX Design', 'design', ['ux design', 'user experience design', 'user experience', 'ux']),
  s('ui-design', 'UI Design', 'design', ['ui design', 'user interface design', 'ui', 'visual design', 'user interface']),
  s('ux-ui', 'UX/UI Design', 'design', ['ux/ui', 'ui/ux', 'ux ui', 'product interface design']),
  s('product-design', 'Product Design', 'design', ['product design', 'product designer']),
  s('interaction-design', 'Interaction Design', 'design', ['interaction design', 'ixd', 'micro-interaction']),
  s('visual-design', 'Visual Design', 'design', ['visual design', 'graphic design', 'brand design']),
  s('design-systems', 'Design Systems', 'design', ['design system', 'design systems', 'component library', 'pattern library', 'atomic design', 'storybook']),
  s('wireframing', 'Wireframing', 'design', ['wireframe', 'wireframing', 'low fidelity', 'lo-fi', 'sketching', 'paper prototype']),
  s('prototyping', 'Prototyping', 'design', ['prototype', 'prototyping', 'interactive prototype', 'hi-fi prototype']),
  s('ux-research', 'UX Research', 'research', ['ux research', 'user research', 'design research', 'user interviews', 'discovery research', 'contextual inquiry']),
  s('usability-testing', 'Usability Testing', 'research', ['usability testing', 'usability test', 'usability study', 'moderated testing', 'unmoderated testing', 'user testing']),
  s('surveys', 'Surveys & Questionnaires', 'research', ['survey design', 'questionnaire', 'surveys']),
  s('analytics', 'Product Analytics', 'research', ['analytics', 'google analytics', 'mixpanel', 'amplitude', 'heap', 'product analytics', 'data-informed']),
  s('ab-testing', 'A/B Testing', 'research', ['a/b test', 'ab testing', 'split testing', 'experimentation', 'multivariate']),
  s('journey-mapping', 'Journey Mapping', 'research', ['journey map', 'customer journey', 'service blueprint', 'experience map', 'user flow', 'task flow']),
  s('personas', 'Personas & Segmentation', 'research', ['persona', 'personas', 'user segmentation']),
  s('information-architecture', 'Information Architecture', 'design', ['information architecture', 'ia ', 'card sorting', 'sitemap', 'taxonomy']),
  s('accessibility', 'Accessibility (WCAG)', 'a11y', ['accessibility', 'wcag', 'a11y', 'screen reader', 'inclusive design', 'ada compliance', 'section 508']),
  s('design-thinking', 'Design Thinking', 'method', ['design thinking', 'double diamond', 'human centred design', 'human-centered design', 'ux process']),
  s('service-design', 'Service Design', 'method', ['service design', 'service blueprinting']),
  s('content-design', 'Content & UX Writing', 'design', ['ux writing', 'content design', 'copywriting', 'microcopy', 'content strategy']),
  s('mobile-design', 'Mobile App Design', 'design', ['mobile design', 'ios design', 'android design', 'mobile app', 'responsive mobile']),
  s('responsive-design', 'Responsive Design', 'frontend', ['responsive design', 'responsive web', 'mobile-first', 'mobile first']),
  s('motion-design', 'Motion & Animation', 'design', ['motion design', 'animation', 'lottie', 'micro-animations', 'after effects']),
  s('3d-design', '3D & Spatial', 'design', ['3d design', 'blender', 'spatial design', 'augmented reality design']),

  // --- Design tools --------------------------------------------------------
  s('figma', 'Figma', 'tool', ['figma', 'figjam', 'figma prototyping']),
  s('sketch', 'Sketch', 'tool', ['sketch app', 'sketch']),
  s('adobe-xd', 'Adobe XD', 'tool', ['adobe xd', 'xd']),
  s('photoshop', 'Adobe Photoshop', 'tool', ['photoshop', 'adobe photoshop', 'psd']),
  s('illustrator', 'Adobe Illustrator', 'tool', ['illustrator', 'adobe illustrator']),
  s('indesign', 'Adobe InDesign', 'tool', ['indesign']),
  s('after-effects', 'After Effects', 'tool', ['after effects', 'aftereffects', 'adobe ae']),
  s('framer', 'Framer', 'tool', ['framer']),
  s('invision', 'InVision', 'tool', ['invision']),
  s('miro', 'Miro / Mural', 'tool', ['miro', 'mural', 'figjam board']),
  s('dovetail', 'Research Tooling', 'tool', ['dovetail', 'usertesting.com', 'maze', 'optimal workshop', 'lookback', 'hotjar', 'fullstory']),
  s('canva', 'Canva', 'tool', ['canva']),
  s('zeplin', 'Zeplin', 'tool', ['zeplin']),

  // --- Frontend ------------------------------------------------------------
  s('html', 'HTML', 'frontend', ['html', 'html5', 'semantic html']),
  s('css', 'CSS', 'frontend', ['css', 'css3', 'scss', 'sass', 'less', 'styled components', 'css modules']),
  s('javascript', 'JavaScript', 'frontend', ['javascript', 'js', 'es6', 'ecmascript', 'vanilla js']),
  s('typescript', 'TypeScript', 'frontend', ['typescript', 'ts ']),
  s('react', 'React', 'frontend', ['react', 'react.js', 'reactjs', 'next.js', 'nextjs']),
  s('vue', 'Vue', 'frontend', ['vue', 'vue.js', 'vuejs', 'nuxt']),
  s('angular', 'Angular', 'frontend', ['angular', 'angularjs']),
  s('svelte', 'Svelte', 'frontend', ['svelte', 'sveltekit']),
  s('tailwind', 'Tailwind CSS', 'frontend', ['tailwind', 'tailwindcss']),
  s('bootstrap', 'Bootstrap', 'frontend', ['bootstrap']),
  s('component-libraries', 'Component Libraries', 'frontend', ['material ui', 'mui', 'chakra', 'ant design', 'shadcn', 'component library']),
  s('web-performance', 'Web Performance', 'frontend', ['web performance', 'lighthouse', 'core web vitals', 'performance optimisation', 'performance optimization']),
  s('seo', 'SEO Fundamentals', 'frontend', ['seo', 'search engine optimisation', 'search engine optimization']),
  s('cms', 'CMS Platforms', 'frontend', ['wordpress', 'webflow', 'contentful', 'sanity', 'strapi', 'drupal', 'shopify', 'headless cms', 'sitecore']),
  s('ecommerce', 'E-commerce', 'product', ['e-commerce', 'ecommerce', 'online store', 'checkout', 'magento', 'woocommerce']),
  s('email-design', 'Email Design', 'design', ['email design', 'html email', 'mailchimp', 'klaviyo', 'campaign monitor']),
  s('testing-frontend', 'Frontend Testing', 'frontend', ['jest', 'vitest', 'cypress', 'playwright', 'testing library', 'unit test']),
  s('git', 'Git & Version Control', 'tool', ['git', 'github', 'gitlab', 'bitbucket', 'version control']),
  s('storybook', 'Storybook', 'tool', ['storybook']),

  // --- Product / delivery --------------------------------------------------
  s('product-strategy', 'Product Strategy', 'product', ['product strategy', 'product vision', 'roadmap', 'product roadmap']),
  s('requirements', 'Requirements & Specs', 'product', ['requirements gathering', 'functional specification', 'user stories', 'prd', 'product requirements']),
  s('agile', 'Agile / Scrum', 'method', ['agile', 'scrum', 'kanban', 'sprint', 'safe']),
  s('stakeholder-mgmt', 'Stakeholder Management', 'soft', ['stakeholder management', 'stakeholder engagement', 'cross-functional', 'cross functional']),
  s('workshops', 'Workshops & Facilitation', 'method', ['workshop', 'facilitation', 'design sprint', 'co-creation']),
  s('mentoring', 'Mentoring & Coaching', 'soft', ['mentoring', 'mentorship', 'coaching', 'line management', 'team lead', 'lead a team', 'manage a team']),
  s('project-management', 'Project Management', 'method', ['project management', 'jira', 'asana', 'trello', 'clickup', 'notion', 'monday.com', 'confluence']),
  s('presentation', 'Presentation & Storytelling', 'soft', ['presentation', 'storytelling', 'pitch', 'public speaking']),
  s('commercial-awareness', 'Commercial Awareness', 'soft', ['commercial', 'business case', 'roi', 'revenue impact', 'conversion rate']),
  s('documentation', 'Documentation', 'soft', ['documentation', 'knowledge base', 'guidelines', 'writing guidelines']),

  // --- Backend / data (kept small: helps adjacent frontend roles) ----------
  s('node', 'Node.js', 'backend', ['node.js', 'nodejs', 'node ']),
  s('python', 'Python', 'backend', ['python']),
  s('php', 'PHP', 'backend', ['php', 'laravel']),
  s('java', 'Java', 'backend', ['java ', 'spring boot']),
  s('dotnet', 'C#/.NET', 'backend', ['c#', '.net', 'asp.net']),
  s('databases', 'Databases', 'backend', ['sql', 'mysql', 'postgres', 'postgresql', 'mongodb', 'sqlite', 'database design']),
  s('api-integration', 'API Integration', 'backend', ['rest api', 'graphql', 'api integration', 'restful', 'webhooks']),
  s('cloud', 'Cloud Platforms', 'cloud', ['aws', 'azure', 'google cloud', 'gcp', 'cloud platform']),
  s('devops', 'DevOps & CI', 'cloud', ['docker', 'kubernetes', 'ci/cd', 'github actions', 'jenkins', 'terraform']),
  s('ai-tools', 'AI & Automation Tools', 'tool', ['ai tooling', 'chatgpt', 'midjourney', 'generative ai', 'prompt engineering', 'ai-assisted']),
  s('security-awareness', 'Security Awareness', 'cloud', ['owasp', 'security best practice', 'penetration', 'gdpr', 'popia']),
];

export const SKILL_BY_ID = new Map(SKILLS.map((x) => [x.id, x]));

/** Alias -> skill id lookup (longest alias wins so "ui/ux" beats "ux"). */
const ALIAS_INDEX = (() => {
  const map = new Map();
  for (const skill of SKILLS) {
    for (const alias of skill.aliases) {
      const key = alias.trim();
      if (!key) continue;
      const existing = map.get(key);
      if (!existing || key.length > existing.alias.length) map.set(key, { id: skill.id, alias: key });
    }
  }
  return map;
})();

export const ALIASES = ALIAS_INDEX;

/**
 * Desired-role catalogue offered in the UI. `core` skills drive role-fit scoring;
 * `supporting` add weight; `tools` are expected tooling for the role.
 */
export const ROLE_CATALOGUE = [
  {
    id: 'ux-designer',
    label: 'UX Designer',
    group: 'Design',
    core: ['ux-design', 'ux-research', 'wireframing', 'usability-testing', 'information-architecture', 'journey-mapping'],
    supporting: ['prototyping', 'personas', 'design-thinking', 'accessibility', 'figma', 'documentation'],
    tools: ['figma', 'miro', 'dovetail', 'sketch', 'adobe-xd'],
    titles: ['ux designer', 'user experience designer', 'ux specialist', 'ux consultant'],
  },
  {
    id: 'ui-designer',
    label: 'UI Designer',
    group: 'Design',
    core: ['ui-design', 'visual-design', 'figma', 'design-systems', 'responsive-design'],
    supporting: ['prototyping', 'motion-design', 'accessibility', 'html', 'css', 'component-libraries'],
    tools: ['figma', 'sketch', 'adobe-xd', 'photoshop', 'illustrator'],
    titles: ['ui designer', 'user interface designer', 'visual designer', 'digital designer'],
  },
  {
    id: 'ux-ui-designer',
    label: 'UX/UI Designer',
    group: 'Design',
    core: ['ux-design', 'ui-design', 'figma', 'prototyping', 'ux-research', 'usability-testing'],
    supporting: ['design-systems', 'wireframing', 'responsive-design', 'accessibility', 'html', 'css'],
    tools: ['figma', 'sketch', 'adobe-xd', 'miro'],
    titles: ['ux/ui designer', 'ui/ux designer', 'ux ui designer', 'product designer (ux/ui)'],
  },
  {
    id: 'product-designer',
    label: 'Product Designer',
    group: 'Design',
    core: ['product-design', 'ux-design', 'ui-design', 'prototyping', 'design-systems'],
    supporting: ['ux-research', 'analytics', 'ab-testing', 'product-strategy', 'stakeholder-mgmt', 'figma'],
    tools: ['figma', 'miro', 'dovetail', 'storybook'],
    titles: ['product designer', 'senior product designer', 'digital product designer'],
  },
  {
    id: 'ui-developer',
    label: 'UI Developer',
    group: 'Engineering',
    core: ['html', 'css', 'javascript', 'responsive-design', 'component-libraries'],
    supporting: ['react', 'typescript', 'accessibility', 'design-systems', 'git', 'web-performance'],
    tools: ['git', 'storybook', 'figma'],
    titles: ['ui developer', 'front-end developer', 'frontend developer', 'front end developer', 'ui engineer'],
  },
  {
    id: 'frontend-developer',
    label: 'Frontend Developer',
    group: 'Engineering',
    core: ['javascript', 'html', 'css', 'react', 'api-integration'],
    supporting: ['typescript', 'git', 'testing-frontend', 'web-performance', 'accessibility', 'tailwind', 'vue'],
    tools: ['git', 'storybook'],
    titles: ['frontend developer', 'front-end developer', 'front end developer', 'javascript developer', 'react developer'],
  },
  {
    id: 'front-end-developer',
    label: 'Front-End Developer',
    group: 'Engineering',
    core: ['javascript', 'html', 'css', 'typescript', 'react'],
    supporting: ['git', 'api-integration', 'testing-frontend', 'web-performance', 'accessibility'],
    tools: ['git', 'storybook'],
    titles: ['front-end developer', 'front end developer', 'frontend engineer', 'web developer'],
  },
  {
    id: 'web-designer',
    label: 'Web Designer',
    group: 'Design',
    core: ['ui-design', 'responsive-design', 'html', 'css', 'cms'],
    supporting: ['visual-design', 'seo', 'ecommerce', 'figma', 'photoshop'],
    tools: ['figma', 'photoshop', 'illustrator', 'canva'],
    titles: ['web designer', 'website designer', 'digital web designer'],
  },
  {
    id: 'interaction-designer',
    label: 'Interaction Designer',
    group: 'Design',
    core: ['interaction-design', 'prototyping', 'motion-design', 'ui-design'],
    supporting: ['ux-research', 'usability-testing', 'frontend', 'javascript', 'css'],
    tools: ['figma', 'framer', 'after-effects'],
    titles: ['interaction designer', 'ixd designer', 'motion designer'],
  },
  {
    id: 'digital-product-designer',
    label: 'Digital Product Designer',
    group: 'Design',
    core: ['product-design', 'ux-design', 'ui-design', 'prototyping', 'design-systems', 'figma'],
    supporting: ['ux-research', 'analytics', 'agile', 'stakeholder-mgmt'],
    tools: ['figma', 'miro', 'dovetail'],
    titles: ['digital product designer', 'digital designer', 'senior digital designer'],
  },
];

export const ROLES_BY_LABEL = new Map(ROLE_CATALOGUE.map((r) => [r.label.toLowerCase(), r]));

/** Finds the role definition whose title keywords best match a free-text title. */
export function findRoleByTitle(title = '') {
  const t = normaliseText(title);
  let best = null;
  for (const role of ROLE_CATALOGUE) {
    for (const candidate of role.titles) {
      if (t.includes(candidate)) {
        const score = candidate.length;
        if (!best || score > best.score) best = { role, score };
      }
    }
  }
  return best?.role ?? null;
}

/** Resolves any user-supplied role string to a known role id (or null). */
export function resolveRole(input = '') {
  const direct = ROLE_CATALOGUE.find((r) => r.id === input || r.label.toLowerCase() === String(input).toLowerCase());
  if (direct) return direct;
  return findRoleByTitle(input);
}

export const SENIORITY_LEVELS = [
  { id: 'intern', label: 'Intern / Graduate', rank: 1, patterns: ['intern', 'graduate', 'trainee', 'student'] },
  { id: 'junior', label: 'Junior', rank: 2, patterns: ['junior', 'entry level', 'entry-level', 'jr '] },
  { id: 'mid', label: 'Mid-level', rank: 3, patterns: ['mid level', 'mid-level', 'intermediate', 'midweight'] },
  { id: 'senior', label: 'Senior', rank: 4, patterns: ['senior', 'snr', 'sr '] },
  { id: 'lead', label: 'Lead / Staff', rank: 5, patterns: ['lead', 'staff', 'principal', 'head of', 'manager'] },
  { id: 'director', label: 'Director / Executive', rank: 6, patterns: ['director', 'vp ', 'vice president', 'chief', 'cto', 'cpo', 'ceo'] },
];

export function detectSeniority(text = '') {
  const t = normaliseText(text);
  let found = null;
  for (const level of SENIORITY_LEVELS) {
    for (const p of level.patterns) {
      if (t.includes(p)) {
        if (!found || level.rank > found.rank) found = level;
      }
    }
  }
  return found;
}

/** Lower-cases, strips punctuation noise and collapses whitespace for matching. */
export function normaliseText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9+#./&' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds every taxonomy skill present in a blob of text.
 * Returns [{ id, label, category, hits, evidence }]
 */
export function extractSkills(text = '', { limit = 60 } = {}) {
  const haystack = ` ${normaliseText(text)} `;
  const found = new Map();
  for (const [alias, { id }] of ALIAS_INDEX) {
    if (alias.length < 2) continue;
    const idx = haystack.indexOf(` ${alias}`) !== -1 ? true : haystack.includes(alias);
    if (!idx) continue;
    const re = aliasBoundaryRegex(alias);
    const m = re.exec(haystack);
    if (!m) continue;
    const entry = found.get(id) ?? { id, label: SKILL_BY_ID.get(id)?.label ?? id, category: SKILL_BY_ID.get(id)?.category, hits: 0, evidence: [] };
    entry.hits += 1;
    if (entry.evidence.length < 2) entry.evidence.push(trimEvidence(haystack, m.index, alias.length));
    found.set(id, entry);
  }
  return [...found.values()].sort((a, b) => b.hits - a.hits).slice(0, limit);
}

function aliasBoundaryRegex(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needsTrailingSpace = /[a-z0-9]$/.test(alias) ? '\\b' : '';
  return new RegExp(`(^|[^a-z0-9])${escaped}${needsTrailingSpace}`, '');
}

function trimEvidence(haystack, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(haystack.length, index + length + 40);
  return haystack.slice(start, end).trim();
}

export const ALL_SKILL_LABELS = SKILLS.map((x) => x.label);
