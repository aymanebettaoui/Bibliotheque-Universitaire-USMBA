// Test discovery must load the config without starting a server. Reject an
// explicitly disabled isolated server unless an existing test server was chosen.
export default function verifyE2eMode() {
  if (process.env.E2E_START_SERVERS === 'false' && process.env.E2E_USE_EXISTING_TEST_SERVER !== 'true') {
    throw new Error('Utilisez E2E_START_SERVERS=true pour lancer la base de tests isolée, ou E2E_USE_EXISTING_TEST_SERVER=true pour une instance de TEST locale déjà démarrée.');
  }
}
