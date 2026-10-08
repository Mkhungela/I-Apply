/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * CV parsing: PDF -> plain text.
 *
 * Uses pdfjs-dist (pure JavaScript, no native build). Text-layer PDFs work;
 * image-only scans are detected and reported clearly instead of failing silently,
 * with the option for the user to paste CV text instead.
 */
import { logger } from '../lib/logger.js';

const log = logger('cv-parser');

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((err) => {
      throw new Error(`PDF engine unavailable: ${err.message}`);
    });
  }
  return pdfjsPromise;
}

export class CvParseError extends Error {
  constructor(message, code = 'cv_parse_failed') {
    super(message);
    this.code = code;
    this.status = 422;
  }
}

/**
 * @param {Buffer|Uint8Array} buffer PDF bytes
 * @returns {Promise<{ text: string, pages: number, characters: number, looksScanned: boolean, warnings: string[] }>}
 */
export async function extractPdfText(buffer) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(buffer);
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new CvParseError(`Could not read this PDF (${err.message}). Try re-saving it or paste your CV as text.`);
  }

  const pages = [];
  let characters = 0;
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(renderPage(content.items));
    characters += pages[pages.length - 1].replace(/\s/g, '').length;
  }
  await doc.destroy?.();

  const text = rejoinWrappedLinks(pages.join('\n\n')).replace(/\u00a0/g, ' ').trim();
  const warnings = [];
  const looksScanned = characters < 120;
  if (looksScanned) {
    warnings.push(
      'This PDF has little or no selectable text — it looks like a scan or an image export. Upload a text-based PDF, or paste your CV text so it can be understood.'
    );
  }
  log.info('pdf parsed', { pages: doc.numPages, characters, looksScanned });
  return { text, pages: doc.numPages, characters, looksScanned, warnings };
}

/** Rebuilds lines from positioned text items so headings and bullets stay intact. */
function renderPage(items) {
  const lines = [];
  let current = { y: null, parts: [] };

  for (const item of items) {
    const str = item.str ?? '';
    const y = Math.round(item.transform?.[5] ?? 0);
    if (current.y === null) current.y = y;
    if (Math.abs(y - current.y) > 2.5) {
      lines.push(joinParts(current.parts));
      current = { y, parts: [] };
    }
    current.parts.push({ str, x: item.transform?.[4] ?? 0, width: item.width ?? 0 });
  }
  if (current.parts.length) lines.push(joinParts(current.parts));

  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

function joinParts(parts) {
  const sorted = [...parts].sort((a, b) => a.x - b.x);
  let out = '';
  let previousEnd = null;
  for (const part of sorted) {
    const gap = previousEnd === null ? 0 : part.x - previousEnd;
    if (out && gap > 1.2) out += ' ';
    out += part.str;
    previousEnd = part.x + (part.width || part.str.length * 4.6);
  }
  return out;
}

/**
 * PDF text layers wrap long URLs and email addresses mid-token ("linkedin.com/in/" +
 * "leratomokoena" on the next line). Left alone, the contact extractor sees a broken
 * link and the profile ends up missing it. This rejoins a line to the next one when
 * the line clearly continues (it ends with "/", "-", "." or "@"), the next token looks
 * like a URL/email fragment, and the join produces something link-shaped.
 */
export function rejoinWrappedLinks(text = '') {
  const lines = String(text).split('\n');
  const out = [];
  const continues = /(?:https?:\/\/|www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?|\b[a-z0-9._%+-]+@[a-z0-9.-]*)[/-]$/i;
  const fragment = /^[A-Za-z0-9._~%+-]{1,48}$/;
  const wordy = /^(and|or|the|to|with|for|of|in|at|on|a|an)$/i;
  // "linkedin.com/in/lerato" + "mokoena": a wrapped link with no trailing slash.
  const midLink = (line) => {
    const lastToken = line.split(/\s+/).pop() || '';
    return /\.[a-z]{2,}\/[^\s]*$/i.test(lastToken) && !/[.,;:!?)\]]$/.test(line);
  };
  const linkTail = (token) => /^[a-z0-9][a-z0-9._~%-]*$/.test(token);

  for (let i = 0; i < lines.length; i += 1) {
    let current = lines[i];
    while (
      i + 1 < lines.length
      && (continues.test(current.trim()) || midLink(current.trim()))
      && fragment.test(lines[i + 1].trim())
      && !wordy.test(lines[i + 1].trim())
      && (continues.test(current.trim()) || linkTail(lines[i + 1].trim()))
    ) {
      current = `${current.trim()}${lines[i + 1].trim()}`;
      i += 1;
    }
    out.push(current);
  }
  return out.join('\n');
}
