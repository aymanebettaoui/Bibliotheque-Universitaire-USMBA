import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const asyncHandler = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.') || 'Données'} : ${issue.message}`).join('; ') } });
    return;
  }
  const issue = error as { code?: string; type?: string; status?: number };
  if (issue?.code === 'P2002' || issue?.code === '23505') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'Cette information est déjà associée à un compte ou un enregistrement.' } });
    return;
  }
  if (issue?.code === 'P2025') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enregistrement introuvable.' } });
    return;
  }
  if (issue?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Le document JSON est invalide.' } });
    return;
  }
  if (issue?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Le document transmis est trop volumineux.' } });
    return;
  }
  console.error('API_ERROR', issue?.code ?? 'UNEXPECTED');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue. Veuillez réessayer.' } });
};
