// Ejecuta las pruebas de reglas en el emulador de Firestore. En Windows,
// firebase-tools 13 deja vivo el proceso Java del emulador al terminar y la
// siguiente ejecución falla con "port taken"; aquí se cierra ese proceso.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { port } = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8")).emulators.firestore;
const isWindows = process.platform === "win32";

function stopLeftoverEmulator() {
  if (!isWindows) return;
  spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      Where-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$_").CommandLine -like '*cloud-firestore-emulator*' } |
      ForEach-Object { Stop-Process -Id $_ -Force }`,
  ], { stdio: "inherit" });
}

stopLeftoverEmulator();
const result = spawnSync("npx", [
  "firebase", "emulators:exec", "--only", "firestore", "--project", "demo-forno-bello",
  '"node --test --test-reporter=spec tests/firestore.rules.test.mjs"',
], { stdio: "inherit", shell: true });
stopLeftoverEmulator();
process.exit(result.status ?? 1);
