import { defineConfig, devices } from "@playwright/test";

// Ejecutar con: npm run test:e2e (arranca los emuladores de Firestore y Auth).
// La app se conecta a los emuladores con un proyecto demo; nunca al proyecto real.
const port = 5174;

export default defineConfig({
  testDir: "./e2e",
  // Todas las pruebas comparten el mismo emulador, que se reinicia antes de cada una.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "es-CO",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "movil", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Compilación de producción en una carpeta aparte, para no pisar dist/.
    command: `npx vite build --outDir .e2e-dist --emptyOutDir && npx vite preview --outDir .e2e-dist --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      VITE_FIREBASE_EMULATORS: "true",
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-forno-bello.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-forno-bello",
      VITE_FIREBASE_STORAGE_BUCKET: "demo-forno-bello.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
      VITE_FIREBASE_APP_ID: "1:000000000000:web:demo",
    },
  },
});
