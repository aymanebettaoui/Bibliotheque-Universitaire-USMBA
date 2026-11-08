import { randomUUID } from 'node:crypto';
import { test, expect, request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';

type Role = 'STUDENT' | 'LIBRARIAN';
async function apiSession(baseURL: string, role: Role) {
  const origin = new URL(baseURL).origin;
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const preauth = await context.get('/api/auth/me');
  await expect(preauth).toBeOK();
  const config = await preauth.json();
  expect(config.demo, 'Les tests exigent DEMO_MODE=true hors production.').toBe(true);
  const login = await context.post('/api/auth/demo', { headers: { 'X-CSRF-Token': config.csrfToken }, data: { role } });
  await expect(login).toBeOK();
  const identity = await login.json();
  return { context, csrf: identity.csrfToken as string };
}
async function mutate(session: { context: APIRequestContext; csrf: string }, path: string, data: unknown, method = 'POST') {
  return session.context.fetch(`/api${path}`, { method, headers: { 'X-CSRF-Token': session.csrf }, data });
}
async function uiLogin(page: Page, role: Role) {
  await page.goto('/connexion');
  await page.getByTestId(`demo-login-${role}`).click();
  await expect(page).toHaveURL(role === 'STUDENT' ? /\/espace$/ : /\/gestion$/);
}
async function uiLogout(page: Page) {
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
  await expect(page.getByRole('link', { name: /^Se connecter/ })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  const health = await request.get('/api/health');
  await expect(health).toBeOK();
  expect((await health.json()).demo, 'Ne jamais exécuter ces scénarios contre une instance de production.').toBe(true);
});

test('parcours physique complet : étudiant, réservation, remise, emprunt et retour', async ({ page, baseURL }, testInfo) => {
  const staff = await apiSession(baseURL!, 'LIBRARIAN');
  const student = await apiSession(baseURL!, 'STUDENT');
  const title = `E2E — Circulation ${randomUUID()}`;
  let bookId: string | undefined;
  try {
    // Use a uniquely named real database record. Existing seed books and loans
    // are never modified, reset, or deleted by this scenario.
    const created = await mutate(staff, '/staff/books', {
      title, authors: ['Auteur fictif E2E'], categories: ['Validation E2E'], publisher: 'Éditeur fictif',
      year: 2026, description: 'Exemplaire fictif réservé à la validation automatisée du parcours physique.', priceDh: '150.00', coverColor: '#365c62',
    });
    await expect(created).toBeOK();
    bookId = (await created.json()).id;
    const added = await mutate(staff, `/staff/books/${bookId}/copies`, { count: 1 });
    await expect(added).toBeOK();
    const copy = (await added.json()).items[0] as { id: string; barcode: string };

    await test.step('Connexion étudiant et recherche dans le vrai catalogue', async () => {
      await uiLogin(page, 'STUDENT');
      await page.goto('/');
      await page.getByTestId('catalogue-search').fill(title);
      await page.getByTestId('catalogue-search').press('Enter');
      await page.locator(`[data-testid="book-card"][data-book-id="${bookId}"]`).click();
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText('1 exemplaire disponible', { exact: true })).toBeVisible();
    });

    let reservationId = '';
    let studentNumber = '';
    await test.step('Demande et acceptation automatique, distinctes de la remise', async () => {
      const me = await page.request.get('/api/auth/me');
      studentNumber = (await me.json()).user.student.studentNumber;
      await page.getByTestId('request-borrow').click();
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/requests' && response.request().method() === 'POST');
      await page.getByRole('dialog', { name: 'Demander cet ouvrage ?' }).getByRole('button', { name: 'Envoyer ma demande' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      const request = await response.json();
      expect(request.status).toBe('ACCEPTED'); reservationId = request.reservation.id;
      await expect(page).toHaveURL(/\/demandes$/);
      const card = page.locator('.request-card').filter({ hasText: title });
      await expect(card).toContainText('Acceptée');
      await expect(card).toContainText(copy.barcode);
      const loans = await student.context.get('/api/me/loans');
      expect((await loans.json()).items.some((loan: any) => loan.copy.book.id === bookId)).toBe(false);
    });

    let loanId = '';
    await test.step('Contrôle de la carte et de l’exemplaire au guichet', async () => {
      await uiLogout(page); await uiLogin(page, 'LIBRARIAN');
      await page.goto('/gestion/guichet');
      await page.getByTestId(`reservation-row-${reservationId}`).getByTestId('handover-button').click();
      const dialog = page.getByRole('dialog', { name: 'Confirmer la remise physique', exact: true });
      await dialog.getByLabel('Numéro de la carte universitaire présentée').fill(studentNumber);
      await dialog.getByLabel('Code-barres de l’exemplaire remis').fill(copy.barcode);
      const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/staff/reservations/${reservationId}/handover`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Confirmer la remise physique', exact: true }).click();
      const response = await responsePromise; expect(response.status()).toBe(201);
      const loan = await response.json(); expect(loan.status).toBe('ACTIVE'); loanId = loan.id;
      await expect(dialog).not.toBeVisible();
    });

    await test.step('L’étudiant retrouve son emprunt actif et sa date de retour', async () => {
      await uiLogout(page); await uiLogin(page, 'STUDENT');
      await page.goto('/emprunts');
      const row = page.locator('tbody tr').filter({ hasText: title });
      await expect(row).toContainText(copy.barcode); await expect(row).toContainText('En cours');
      // The student UI must never expose the staff handover/return controls.
      await expect(page.getByTestId('return-button')).toHaveCount(0);
    });

    await test.step('Retour normal par le personnel puis disponibilité publique actualisée', async () => {
      await uiLogout(page); await uiLogin(page, 'LIBRARIAN');
      await page.goto('/gestion/guichet');
      await page.getByRole('tab', { name: /Emprunts actifs/ }).click();
      await page.getByTestId(`loan-row-${loanId}`).getByTestId('return-button').click();
      const dialog = page.getByRole('dialog', { name: 'Enregistrer le retour', exact: true });
      await dialog.getByLabel('État physique constaté').selectOption('GOOD');
      await dialog.getByRole('checkbox', { name: 'Je confirme avoir identifié l’exemplaire et contrôlé le constat indiqué.' }).check();
      const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/staff/loans/${loanId}/return`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Clôturer l’emprunt' }).click();
      const response = await responsePromise; expect(response.status()).toBe(200);
      expect((await response.json()).status).toBe('CLOSED');
      await expect(dialog).not.toBeVisible();
      await uiLogout(page);
      await page.goto(`/ouvrages/${bookId}`);
      await expect(page.getByText('1 exemplaire disponible', { exact: true })).toBeVisible();
    });
  } finally {
    // On assertion failure, release only this scenario's own reservation/loan.
    // Keep the book, completed loans, requests and audit records as history.
    const cleanupErrors: string[] = [];
    if (bookId) {
      try {
        const requests = await staff.context.get('/api/staff/requests');
        for (const r of (await requests.json()).items.filter((r: any) => r.book.id === bookId && r.reservation?.status === 'ACTIVE')) {
          const result = await mutate(student, `/requests/${r.id}/cancel`, {});
          if (!result.ok()) cleanupErrors.push(`Annulation ${result.status()}`);
        }
        const loans = await staff.context.get('/api/staff/loans');
        for (const l of (await loans.json()).items.filter((l: any) => l.copy.book.id === bookId && l.status !== 'CLOSED')) {
          const result = await mutate(staff, `/staff/loans/${l.id}/return`, { condition: 'GOOD' });
          if (!result.ok()) cleanupErrors.push(`Retour ${result.status()}`);
        }
        const archived = await mutate(staff, `/staff/books/${bookId}`, { archived: true }, 'PATCH');
        if (!archived.ok()) cleanupErrors.push(`Archivage ${archived.status()}`);
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'Erreur de nettoyage'); }
    }
    await staff.context.dispose(); await student.context.dispose();
    if (cleanupErrors.length) {
      await testInfo.attach('cleanup-errors', { body: cleanupErrors.join('\n'), contentType: 'text/plain' });
      expect(cleanupErrors, 'Les données de ce scénario doivent être libérées puis archivées.').toEqual([]);
    }
  }
});

// These isolated interface tests inject browser error conditions only. They do
// not fabricate a successful capture, OCR result, Google identity or activation.
for (const [name, message] of [
  ['NotAllowedError', 'L’accès à la caméra a été refusé.'],
  ['NotFoundError', 'Aucune caméra n’a été trouvée.'],
] as const) {
  test(`inscription : erreur caméra ${name}, sans fausse capture`, async ({ page }) => {
    await uiLogin(page, 'STUDENT');
    // Present the onboarding UI without changing the verified demo profile in
    // PostgreSQL. Only this test browser's session response is adjusted.
    await page.route('**/api/auth/me', async route => {
      const response = await route.fetch(); const body = await response.json();
      if (body.user?.student) body.user.student.verified = false;
      await route.fulfill({ response, json: body });
    });
    await page.addInitScript(errorName => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => { throw new DOMException('Condition de test', errorName); },
      } });
    }, name);
    await page.goto('/verification');
    await page.getByRole('button', { name: 'Activer la caméra', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Scanner ma carte', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vérifier mes informations' })).toHaveCount(0);
  });
}
