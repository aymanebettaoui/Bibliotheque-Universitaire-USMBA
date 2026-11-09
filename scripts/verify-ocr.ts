/** Optional real-engine smoke test. Uses a synthetic card, never personal data. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import { extractStudentNumber } from '../frontend/src/services/ocr.js';

const cache = path.join(os.tmpdir(), 'unibiblio-ocr-test-cache');
await mkdir(cache, { recursive: true });
const image = await readFile('tests/fixtures/demo-student-card.png');
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
