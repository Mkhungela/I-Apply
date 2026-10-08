import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { ApiError, asyncHandler, parse } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { extractPdfText, CvParseError } from '../services/cvParser.js';
import { buildProfile } from '../services/profileBuilder.js';
import { loadProfile } from '../services/jobPipeline.js';
import { sanitizeProfileForClient } from '../services/privacy.js';
import { notify, NOTIFICATION_TYPES } from '../services/notifications.js';
import { log } from '../lib/logger.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'application/x-pdf', 'text/plain', 'text/markdown'].includes(file.mimetype) || /\.(pdf|txt|md)$/i.test(file.originalname);
    cb(ok ? null : ApiError.badRequest('Only PDF (or plain text) CVs are supported.'), ok);
  },
});

/** Uploads a CV, extracts text, builds the structured profile, stores everything. */
router.post(
  '/cv',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    let text = '';
    let filename = 'cv.txt';
    let warnings = [];
    let mime = req.file?.mimetype || 'text/plain';
    let bytes;

    if (req.file) {
      filename = req.file.originalname;
      bytes = req.file.buffer;
      if (/pdf$/i.test(req.file.mimetype) || /\.pdf$/i.test(filename)) {
        try {
          const extracted = await extractPdfText(req.file.buffer);
          text = extracted.text;
          warnings = extracted.warnings;
          if (extracted.looksScanned && !(req.body.text || '').trim()) {
            throw new CvParseError(
              'This PDF has no selectable text (it looks like a scan or an image export). Upload a text-based PDF, or paste your CV text instead.',
              'scanned_pdf'
            );
          }
        } catch (err) {
          if (err instanceof CvParseError) throw err;
          throw new CvParseError(err.message);
        }
      } else {
        text = req.file.buffer.toString('utf8');
      }
    } else if (typeof req.body.text === 'string' && req.body.text.trim()) {
      text = req.body.text;
      filename = 'pasted-cv.txt';
      warnings = ['Profile built from pasted text.'];
    } else {
      throw ApiError.badRequest('Attach a PDF (field name “file”) or paste your CV text in the “text” field.');
    }

    if (warnings.some((w) => /scan|image/i.test(w)) && text.replace(/\s/g, '').length < 200) {
      throw new CvParseError('Not enough text could be read from that PDF. Try a text-based PDF or paste your CV text.', 'no_text');
    }

    const { profile, extraction } = buildProfile(text, { filename });

    // Store the file for auditability, and the extracted text + structured profile.
    const dir = path.join(config.uploadDir, `user-${userId}`);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, `${Date.now()}-${filename.replace(/[^\w.-]/g, '_')}`);
    if (bytes) fs.writeFileSync(storedPath, bytes);
    const sha = bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;

    const database = db();
    database.transaction(() => {
      database.run('UPDATE cvs SET is_active = 0 WHERE user_id = ?', userId);
      database.run(
        `INSERT INTO cvs (user_id, filename, mime, size, storage_path, sha256, text_content, parsed, is_active)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        userId,
        filename,
        mime,
        bytes?.length ?? Buffer.byteLength(text, 'utf8'),
        storedPath,
        sha,
        text.slice(0, 200_000),
        JSON.stringify(profile)
      );
      upsertProfile(userId, profile);
    });

    await notify({
      userId,
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'CV understood',
      body: `Extracted ${profile.skills.length} skills, ${profile.experience.length} role(s), ${profile.education.length} qualification(s)${
        profile.yearsExperience ? `, ~${profile.yearsExperience} years of experience` : ''
      }. Review the profile and correct anything that looks off.`,
    });

    res.status(201).json({ profile: sanitizeProfileForClient(profile), extraction, warnings });
  })
);

function upsertProfile(userId, profile) {
  const database = db();
  const existing = database.get('SELECT id FROM profiles WHERE user_id = ?', userId);
  const columns = [
    profile.fullName, profile.headline, profile.email, profile.phone, profile.location, profile.country, profile.city,
    profile.linkedinUrl, profile.portfolioUrl, profile.githubUrl, profile.summary, profile.yearsExperience, profile.seniority,
    profile.workAuthorization, profile.salaryExpectation, profile.salaryCurrency, profile.noticePeriod,
    JSON.stringify(profile.skills), JSON.stringify(profile.tools), JSON.stringify(profile.jobTitles),
    JSON.stringify(profile.experience), JSON.stringify(profile.education), JSON.stringify(profile.certifications),
    JSON.stringify(profile.projects), JSON.stringify(profile.languages), JSON.stringify(profile.industries),
    JSON.stringify(profile.achievements), JSON.stringify(profile.extraction || {}),
  ];
  if (existing) {
    database.run(
      `UPDATE profiles SET full_name=?, headline=?, email=?, phone=?, location=?, country=?, city=?, linkedin_url=?, portfolio_url=?,
       github_url=?, summary=?, years_experience=?, seniority=?, work_authorization=?, salary_expectation=?, salary_currency=?,
       notice_period=?, skills=?, tools=?, job_titles=?, experience=?, education=?, certifications=?, projects=?, languages=?,
       industries=?, achievements=?, extraction=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?`,
      ...columns,
      userId
    );
  } else {
    database.run(
      `INSERT INTO profiles (user_id, full_name, headline, email, phone, location, country, city, linkedin_url, portfolio_url,
       github_url, summary, years_experience, seniority, work_authorization, salary_expectation, salary_currency, notice_period,
       skills, tools, job_titles, experience, education, certifications, projects, languages, industries, achievements, extraction)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId,
      ...columns
    );
  }
}

router.get(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = loadProfile(req.user.id);
    if (!profile) return res.json({ profile: null, cv: null });
    const cv = db().get('SELECT id, filename, size, created_at, is_active FROM cvs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', req.user.id);
    res.json({ profile: sanitizeProfileForClient(profile), cv: cv || null });
  })
);

/** Manual corrections to the extracted profile — the CV is the source of truth for claims. */
const profilePatch = z.object({
  fullName: z.string().max(120).nullish(),
  headline: z.string().max(160).nullish(),
  email: z.string().max(180).nullish(),
  phone: z.string().max(60).nullish(),
  location: z.string().max(160).nullish(),
  country: z.string().max(80).nullish(),
  city: z.string().max(80).nullish(),
  linkedinUrl: z.string().max(300).nullish(),
  portfolioUrl: z.string().max(300).nullish(),
  githubUrl: z.string().max(300).nullish(),
  summary: z.string().max(4000).nullish(),
  yearsExperience: z.number().min(0).max(60).nullish(),
  workAuthorization: z.string().max(200).nullish(),
  salaryExpectation: z.string().max(120).nullish(),
  salaryCurrency: z.string().max(12).nullish(),
  noticePeriod: z.string().max(120).nullish(),
  skills: z.array(z.string().max(80)).max(120).optional(),
  jobTitles: z.array(z.string().max(120)).max(50).optional(),
});

router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = parse(profilePatch, req.body);
    const userId = req.user.id;
    const database = db();
    const existing = database.get('SELECT * FROM profiles WHERE user_id = ?', userId);
    if (!existing) throw ApiError.notFound('No profile yet — upload a CV first.');

    const map = {
      fullName: 'full_name', headline: 'headline', email: 'email', phone: 'phone', location: 'location', country: 'country',
      city: 'city', linkedinUrl: 'linkedin_url', portfolioUrl: 'portfolio_url', githubUrl: 'github_url', summary: 'summary',
      yearsExperience: 'years_experience', workAuthorization: 'work_authorization', salaryExpectation: 'salary_expectation',
      salaryCurrency: 'salary_currency', noticePeriod: 'notice_period',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(patch[key]);
    }
    if (patch.skills) {
      const current = safeJson(existing.skills, []);
      const known = new Map(current.map((s) => [String(s.label || s).toLowerCase(), s]));
      const merged = patch.skills.map((s) => known.get(s.toLowerCase()) || { id: s, label: s, category: 'manual', hits: 1 });
      sets.push('skills = ?');
      values.push(JSON.stringify(merged));
    }
    if (patch.jobTitles) {
      sets.push('job_titles = ?');
      values.push(JSON.stringify(patch.jobTitles));
    }
    if (!sets.length) return res.json({ profile: sanitizeProfileForClient(loadProfile(userId)) });

    database.transaction(() => {
      database.run(`UPDATE profiles SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?`, ...values, userId);
      // Keep the truth index in step with manual edits.
      const updated = database.get('SELECT * FROM profiles WHERE user_id = ?', userId);
      const extraction = safeJson(updated.extraction, {});
      extraction.truthIndex = {
        ...(extraction.truthIndex || {}),
        name: updated.full_name,
        yearsExperience: updated.years_experience,
        skillIds: safeJson(updated.skills, []).map((s) => s.id || s),
        skillLabels: safeJson(updated.skills, []).map((s) => s.label || s),
        titles: safeJson(updated.job_titles, []),
        workAuthorization: updated.work_authorization,
      };
      database.run('UPDATE profiles SET extraction = ? WHERE user_id = ?', JSON.stringify(extraction), userId);
    });

    res.json({ profile: sanitizeProfileForClient(loadProfile(userId)) });
  })
);

/** Re-runs extraction from the stored CV text (useful after a parser improvement). */
router.post(
  '/profile/reparse',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cv = db().get('SELECT * FROM cvs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', req.user.id);
    if (!cv?.text_content) throw ApiError.badRequest('No stored CV text to re-parse — upload your CV again.');
    const { profile, extraction } = buildProfile(cv.text_content, { filename: cv.filename });
    db().transaction(() => upsertProfile(req.user.id, profile));
    log.info('profile re-parsed', { userId: req.user.id });
    res.json({ profile: sanitizeProfileForClient(profile), extraction });
  })
);

export default router;

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
