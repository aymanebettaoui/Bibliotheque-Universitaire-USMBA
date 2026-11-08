/** Optional real-engine smoke test. Uses a synthetic card, never personal data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { extractStudentNumber } from '../frontend/src/services/ocr.js';

const cache = path.join(os.tmpdir(), 'unibiblio-ocr-test-cache');
await mkdir(cache, { recursive: true });
const fictionalCard = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="800"><rect width="1400" height="800" rx="28" fill="#ffffff"/><rect width="1400" height="190" fill="#183642"/><g font-family="DejaVu Sans, sans-serif"><text x="80" y="82" font-size="42" fill="white">BIBLIOTHEQUE - DEMONSTRATION</text><text x="80" y="145" font-size="32" fill="#d7e8e7">CARTE SYNTHETIQUE - AUCUNE VALEUR OFFICIELLE</text><text x="90" y="315" font-size="52" fill="#111111">SAMIR EXEMPLE</text><text x="90" y="465" font-size="80" fill="#111111">CNE: R202400003</text><text x="90" y="575" font-size="36" fill="#111111">inscription.demo@usmba.ac.ma</text><text x="90" y="700" font-size="34" fill="#555555">FICTIF - IMAGE DE TEST OCR UNIQUEMENT</text></g></svg>`);
const image = await sharp(fictionalCard).png().toBuffer();
await mkdir('tests/fixtures', { recursive: true });
await writeFile('tests/fixtures/demo-student-card.png', image);
const worker = await createWorker('eng', 1, { cachePath: cache });
try {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(image);
  const studentNumber = extractStudentNumber(data.text, data.confidence);
  if (!studentNumber) console.error(JSON.stringify({ fixture: 'synthetic-card', recognizedText: data.text, confidence: data.confidence }));
  assert.equal(studentNumber, 'R202400003', 'Le moteur doit réellement lire le numéro de la carte synthétique.');
  assert.equal(extractStudentNumber('CARTE FLOUE SANS NUMERO', 92), null);
  assert.equal(extractStudentNumber('CNE: R202400001', 12), null, 'Une lecture à faible confiance ne doit pas être présentée comme fiable.');
  console.log(JSON.stringify({ result: 'PASS', engine: 'Tesseract.js', fixture: 'synthetic-card', studentNumber, confidence: data.confidence }));
} finally { await worker.terminate(); }
