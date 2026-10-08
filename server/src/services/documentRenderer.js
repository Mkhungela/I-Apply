/**
 * PDF rendering for generated application documents.
 *
 * Renders a tailored CV and a cover letter from the generated package. The
 * tailored CV reorders and re-emphasises real CV content for the target advert; it
 * never adds a fact that is not already in the CV.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const log = logger('documents');

const INK = '#111827';
const MUTED = '#4b5563';
const ACCENT = '#1d4ed8';

function safeName(value, fallback = 'document') {
  return (
    String(value || fallback)
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60) || fallback
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function userDocumentDir(userId) {
  return ensureDir(path.join(config.exportDir, `user-${userId}`));
}

function formatDateValue(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function dateRange(item) {
  const start = formatDateValue(item.startDate);
  const end = item.current ? 'Present' : formatDateValue(item.endDate);
  if (!start && !end) return null;
  return [start, end].filter(Boolean).join(' — ');
}

/**
 * @returns {Promise<{path:string, filename:string, bytes:number}>}
 */
export function renderTailoredCv({ userId, job, cv, packageId }) {
  return new Promise((resolve, reject) => {
    try {
      const dir = userDocumentDir(userId);
      const filename = `${safeName(cv.header?.name || 'CV', 'CV')}-${safeName(job.title, 'role')}${packageId ? `-${packageId}` : ''}.pdf`;
      const filePath = path.join(dir, filename);
      const doc = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 46, left: 52, right: 52 }, info: { Title: `${cv.header?.name || 'CV'} — ${job.title}` } });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(cv.header?.name || 'Candidate');
      const contactBits = [cv.header?.email, cv.header?.phone, cv.header?.location, cv.header?.linkedin, cv.header?.portfolio, cv.header?.github].filter(Boolean);
      if (contactBits.length) {
        doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor(MUTED).text(contactBits.join('  •  '));
      }
      doc.moveDown(0.4);
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(10.5).text(`Application: ${job.title}${job.company ? ` — ${job.company}` : ''}`);
      rule(doc);

      if (cv.summary) section(doc, 'Profile', () => doc.font('Helvetica').fontSize(10).fillColor(INK).text(cv.summary, { align: 'justify' }));

      if (cv.coreSkills?.length) {
        section(doc, 'Core Skills', () => {
          doc.font('Helvetica').fontSize(10).fillColor(INK).text(cv.coreSkills.join('  •  '));
          if (cv.tools?.length) doc.moveDown(0.2).fontSize(9.5).fillColor(MUTED).text(`Tools: ${cv.tools.join('  •  ')}`);
        });
      }

      if (cv.experience?.length) {
        section(doc, 'Experience', () => {
          cv.experience.forEach((role, index) => {
            if (index > 0) doc.moveDown(0.5);
            doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(role.title || 'Role');
            const meta = [role.company, role.location, dateRange(role)].filter(Boolean).join('  •  ');
            if (meta) doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(meta);
            const bullets = role.highlights?.length ? role.highlights : role.description ? [role.description] : [];
            if (bullets.length) {
              doc.moveDown(0.2);
              bullets.slice(0, 5).forEach((b) => {
                doc.font('Helvetica').fontSize(9.8).fillColor(INK).text(`•  ${String(b).replace(/^[-•]\s*/, '')}`, { indent: 6, align: 'justify' });
              });
            }
          });
        });
      }

      if (cv.projects?.length) {
        section(doc, 'Selected Projects', () => {
          cv.projects.forEach((p, i) => {
            if (i > 0) doc.moveDown(0.35);
            doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(p.name);
            if (p.description) doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(p.description, { align: 'justify' });
            if (p.url) doc.font('Helvetica').fontSize(8.5).fillColor(ACCENT).text(p.url);
          });
        });
      }

      if (cv.education?.length) {
        section(doc, 'Education', () => {
          cv.education.forEach((e) => {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(e.qualification);
            const meta = [e.institution, e.year].filter(Boolean).join('  •  ');
            if (meta) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(meta);
            doc.moveDown(0.25);
          });
        });
      }

      if (cv.certifications?.length) {
        section(doc, 'Certifications', () => {
          cv.certifications.forEach((c) => {
            doc.font('Helvetica').fontSize(9.8).fillColor(INK).text(`•  ${c.name}${c.year ? ` (${c.year})` : ''}`, { indent: 6 });
          });
        });
      }

      if (cv.languages?.length) {
        section(doc, 'Languages', () => {
          doc.font('Helvetica').fontSize(9.8).fillColor(INK).text(cv.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join('  •  '));
        });
      }

      doc.end();
      stream.on('finish', () => resolve({ path: filePath, filename, bytes: fs.statSync(filePath).size }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * @returns {Promise<{path:string, filename:string, bytes:number}>}
 */
export function renderCoverLetter({ userId, job, coverLetter, name, contact = {}, packageId }) {
  return new Promise((resolve, reject) => {
    try {
      const dir = userDocumentDir(userId);
      const filename = `Cover-letter-${safeName(job.company || 'company')}-${safeName(job.title, 'role')}${packageId ? `-${packageId}` : ''}.pdf`;
      const filePath = path.join(dir, filename);
      const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 60, right: 60 }, info: { Title: `Cover letter — ${job.title}` } });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(name || 'Candidate');
      const bits = [contact.email, contact.phone, contact.location, contact.portfolio, contact.linkedin].filter(Boolean);
      if (bits.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(bits.join('  •  '));
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
      rule(doc);
      if (job.company) {
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${job.company}\n${job.location || ''}`.trim());
        doc.moveDown(0.6);
      }
      if (job.title) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(`Re: ${job.title}`);
        doc.moveDown(0.6);
      }

      const paragraphs = String(coverLetter || '').split(/\n{2,}/);
      for (const p of paragraphs) {
        doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(p.trim(), { align: 'justify', lineGap: 3 });
        doc.moveDown(0.7);
      }

      doc.end();
      stream.on('finish', () => resolve({ path: filePath, filename, bytes: fs.statSync(filePath).size }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Renders a simple application-answers sheet used for assisted handoff. */
export function renderAnswerSheet({ userId, job, answers, name }) {
  return new Promise((resolve, reject) => {
    try {
      const dir = userDocumentDir(userId);
      const filename = `Application-answers-${safeName(job.title, 'role')}.pdf`;
      const filePath = path.join(dir, filename);
      const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 54, right: 54 } });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('Application answers');
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`${job.title}${job.company ? ` — ${job.company}` : ''}${name ? `  •  ${name}` : ''}`);
      rule(doc);
      answers.forEach((a, i) => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`${i + 1}. ${a.question}`);
        doc.font('Helvetica').fontSize(10).fillColor(a.needsUser ? '#b45309' : INK).text(a.answer || '— awaiting your input —', { indent: 10 });
        if (a.note) doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(`Note: ${a.note}`, { indent: 10 });
        doc.moveDown(0.5);
      });
      doc.end();
      stream.on('finish', () => resolve({ path: filePath, filename, bytes: fs.statSync(filePath).size }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function section(doc, title, body) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(title.toUpperCase(), { characterSpacing: 0.6 });
  doc.moveDown(0.25);
  body();
}

function rule(doc) {
  doc.moveDown(0.4);
  const y = doc.y;
  doc.save().strokeColor('#d1d5db').lineWidth(0.8).moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke().restore();
  doc.moveDown(0.6);
}

export function removeFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    log.warn(`could not remove ${filePath}: ${err.message}`);
  }
}
