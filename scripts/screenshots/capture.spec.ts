import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const output = 'docs/screenshots';

async function ready(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.loader')).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(250);
}

async function capture(page: Page, name: string) {
  await ready(page);
  await expect(page.locator('.inline-error')).toHaveCount(0);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: 'disabled' });
}

async function login(page: Page, role: 'STUDENT' | 'LIBRARIAN') {
  await page.goto('/connexion', { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`demo-login-${role}`).click();
  await expect(page).toHaveURL(role === 'STUDENT' ? /\/espace$/ : /\/gestion$/);
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
  await expect(page).toHaveURL(/\/connexion$/);
}

test('capturer les interfaces réelles de la démonstration', async ({ page }) => {
  await mkdir(output, { recursive: true });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('catalogue-search')).toBeVisible();
  await expect(page.getByTestId('book-card').first()).toBeVisible();
  await capture(page, 'catalogue');

  await page.goto('/connexion', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Se connecter avec Google', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Étudiant — Démo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bibliothécaire — Démo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tester l’inscription par scan' })).toBeVisible();
  await capture(page, 'connexion');

  await page.getByTestId('demo-login-STUDENT').click();
  await expect(page).toHaveURL(/\/espace$/);
  await capture(page, 'etudiant-dashboard');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('catalogue-search').fill('');
  await capture(page, 'catalogue-recherche');

  await page.goto('/demandes', { waitUntil: 'domcontentloaded' });
  await capture(page, 'reservations');

  await page.goto('/emprunts', { waitUntil: 'domcontentloaded' });
  await capture(page, 'emprunts');

  await logout(page);
  await login(page, 'LIBRARIAN');
  await capture(page, 'bibliothecaire-dashboard');

  await page.goto('/gestion/emprunts', { waitUntil: 'domcontentloaded' });
  await capture(page, 'gestion-emprunts');

  await page.goto('/gestion/sanctions', { waitUntil: 'domcontentloaded' });
  await capture(page, 'sanctions');

  await page.goto('/gestion/parametres', { waitUntil: 'domcontentloaded' });
  await capture(page, 'parametres');

  await logout(page);
  await page.getByTestId('demo-login-ONBOARDING').click();
  await expect(page).toHaveURL(/\/verification$/);
  await page.getByLabel('Importer une photographie de carte').setInputFiles('frontend/public/demo-card.png');
  await expect(page.getByLabel('Numéro étudiant / CNE')).toHaveValue('R202400003', { timeout: 60_000 });
  await capture(page, 'ocr-demo');
});
