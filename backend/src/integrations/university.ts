import { HttpError } from '../middleware/error.js';
import { demoEnabled } from '../middleware/auth.js';

export interface UniversityIdentity { studentNumber: string; googleSub: string; email: string; name: string }
export interface UniversityVerification { valid: boolean; provider: 'DEMO' | 'OFFICIAL'; message: string }
export interface UniversityConnector {
  readonly configured: boolean;
  verify(identity: UniversityIdentity): Promise<UniversityVerification>;
}

/** No protocol or institutional credentials were supplied. This fails closed. */
export class UnconfiguredUniversityConnector implements UniversityConnector {
  readonly configured = false;
  async verify(_identity: UniversityIdentity): Promise<UniversityVerification> {
    throw new HttpError(503, 'UNIVERSITY_NOT_CONFIGURED', 'Le connecteur universitaire officiel n’est pas configuré. Aucune identité réelle ne peut être activée sur la seule base d’un scan OCR.');
  }
}

/** Fictional roster; never authenticates a real Google account. */
export const demoRoster: ReadonlyArray<UniversityIdentity> = [
  { studentNumber: 'R202400001', googleSub: 'demo:student', email: 'amina.demo@usmba.ac.ma', name: 'Amina El Fassi' },
  { studentNumber: 'R202400002', googleSub: 'demo:student2', email: 'yassine.demo@usmba.ac.ma', name: 'Yassine Bennani' },
  { studentNumber: 'R202400003', googleSub: 'demo:onboarding', email: 'inscription.demo@usmba.ac.ma', name: 'Samir Exemple' },
];
export class DemoUniversityConnector implements UniversityConnector {
  readonly configured = true;
  async verify(identity: UniversityIdentity): Promise<UniversityVerification> {
    if (!demoEnabled() || !identity.googleSub.startsWith('demo:')) throw new HttpError(503, 'UNIVERSITY_NOT_CONFIGURED', 'La vérification fictive ne peut pas activer un compte Google réel.');
    const valid = demoRoster.some(row => row.studentNumber === identity.studentNumber && row.googleSub === identity.googleSub && row.email === identity.email);
    return { valid, provider: 'DEMO', message: 'Vérification simulée — environnement de démonstration' };
  }
}

export const officialUniversityConnector: UniversityConnector = new UnconfiguredUniversityConnector();
export function connectorForIdentity(identity: UniversityIdentity): UniversityConnector {
  return demoEnabled() && identity.googleSub.startsWith('demo:') ? new DemoUniversityConnector() : officialUniversityConnector;
}
