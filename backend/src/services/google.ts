import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { HttpError } from '../middleware/error.js';
import { safeEqual } from '../middleware/auth.js';

export type GoogleClaims = TokenPayload & { nonce?: string };

/** Called only after cryptographic verification by Google's official client. */
export function validateGoogleClaims(payload: GoogleClaims | undefined, audience: string, nonce: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || !payload.sub || payload.sub.length > 255) throw new HttpError(401, 'GOOGLE_INVALID', 'Identité Google invalide.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new HttpError(401, 'GOOGLE_ISSUER', 'Émetteur Google invalide.');
  if (payload.aud !== audience) throw new HttpError(401, 'GOOGLE_AUDIENCE', 'Ce jeton Google est destiné à une autre application.');
  if (!payload.exp || payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) throw new HttpError(401, 'GOOGLE_EXPIRED', 'Ce jeton Google a expiré ou est invalide.');
  if (!payload.email || payload.email_verified !== true) throw new HttpError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Google doit confirmer votre adresse email.');
  if (!safeEqual(payload.nonce, nonce)) throw new HttpError(401, 'GOOGLE_NONCE', 'La demande de connexion Google a expiré.');
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0] || 'Étudiant' };
}

export const hasUniversityDomain = (email: string) => /^[^@\s]+@usmba\.ac\.ma$/.test(email.toLowerCase());

export async function verifyGoogleCredential(credential: string, nonce: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'La connexion Google nécessite la configuration de GOOGLE_CLIENT_ID.');
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    return validateGoogleClaims(ticket.getPayload() as GoogleClaims | undefined, clientId, nonce);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'GOOGLE_INVALID', 'Le jeton Google est invalide, expiré ou sa signature ne peut pas être vérifiée.');
  }
}
