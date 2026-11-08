import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { prisma } from '../config/db.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { asyncRoute } from '../utils/http.js';

// The same location is used from src/ during development and dist/ after build.
export const coverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../var/uploads');
export const coversRouter = Router();
coversRouter.use('/covers', express.static(coverDirectory, {
  dotfiles: 'deny', index: false, maxAge: '1d',
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'"); }
}));
coversRouter.post('/staff/books/:id/cover', requireAuth, requireRoles('LIBRARIAN', 'ADMIN'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }),
  asyncRoute(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Identifiant d’ouvrage invalide.' } });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: { code: 'INVALID_IMAGE', message: 'Sélectionnez une image JPEG, PNG ou WebP de 2 Mo maximum.' } });
    const book = await prisma.book.findUnique({ where: { id: req.params.id } });
    if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ouvrage introuvable.' } });
    let image: Buffer;
    try {
      const input = sharp(req.body, { limitInputPixels: 25000000, animated: false });
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('format');
      // Decode and re-encode: strips EXIF and prevents storing active content or polyglots.
      image = await input.rotate().resize({ width: 800, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'Image illisible, trop grande ou format non autorisé.' } });
    }
    const filename = `${randomUUID()}.webp`;
    const coverUrl = `/api/covers/${filename}`;
    await mkdir(coverDirectory, { recursive: true });
    await writeFile(path.join(coverDirectory, filename), image, { flag: 'wx', mode: 0o600 });
    try {
      await prisma.$transaction(async tx => {
        await tx.book.update({ where: { id: book.id }, data: { coverUrl } });
        await tx.auditLog.create({ data: { userId: req.auth!.user.id, action: 'BOOK_COVER_UPDATED', entity: 'Book', entityId: book.id, details: { coverUrl } } });
      });
    } catch (error) { await unlink(path.join(coverDirectory, filename)).catch(() => {}); throw error; }
    res.json({ coverUrl });
  }));
