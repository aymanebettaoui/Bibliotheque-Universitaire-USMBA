/** Extraction conservatrice : même format Massar que le validateur serveur.
 * La lecture OCR n'est jamais une preuve d'identité. */
export function extractStudentNumber(text: string, confidence: number): string | null {
  if (!Number.isFinite(confidence) || confidence < 30) return null;
  const normalized = text.toUpperCase();
  const labelled = normalized.match(/(?:CNE|MASSAR|ETUDIANT|ÉTUDIANT|STUDENT)\s*[:#-]?\s*([A-Z]\s?\d{8,11})(?!\d)/)?.[1]?.replace(/\s/g, '');
  if (labelled && /^[A-Z]\d{8,11}$/.test(labelled)) return labelled;
  return normalized.match(/\b[A-Z]\d{8,11}\b/)?.[0] || null;
}
