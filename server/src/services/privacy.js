/**
 * Privacy helpers.
 *
 * The browser only ever receives what it needs to render the profile. Raw CV text,
 * extracted evidence blobs and internal truth indexes stay on the server.
 */
export function sanitizeProfileForClient(profile) {
  if (!profile) return null;
  const { extraction, ...rest } = profile;
  return {
    ...rest,
    extraction: extraction
      ? {
          method: extraction.method,
          parsedAt: extraction.parsedAt,
          confidence: extraction.confidence,
          sectionsDetected: extraction.sectionsDetected,
          yearsBasis: extraction.yearsBasis,
          seniorityBasis: extraction.seniorityBasis,
          warnings: extraction.warnings || [],
          evidence: { name: extraction.evidence?.name, years: extraction.evidence?.years, titles: extraction.evidence?.titles },
          truthIndexSummary: extraction.truthIndex
            ? {
                companies: extraction.truthIndex.companies || [],
                titles: extraction.truthIndex.titles || [],
                skillCount: (extraction.truthIndex.skillIds || []).length,
                education: extraction.truthIndex.education || [],
                certifications: extraction.truthIndex.certifications || [],
                yearsExperience: extraction.truthIndex.yearsExperience,
              }
            : undefined,
        }
      : null,
  };
}

/** Strips oversized/derived fields from a job record before sending it to the client. */
export function sanitizeJobForClient(job) {
  if (!job) return null;
  return { ...job, description: job.description ? String(job.description).slice(0, 6000) : null };
}
