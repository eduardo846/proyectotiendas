// Uso: node tests/run-with-emulators.mjs <emuladores> <comando>
// Ejecuta el comando dentro de los emuladores de Firebase. En Windows,
// firebase-tools 13 deja vivo el proceso Java del emulador de Firestore al
// terminar y la siguiente ejecución falla con "port taken"; aquí se cierra.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [only, command] = process.argv.slice(2);
if (!only || !command) {
  console.error("Uso: node tests/run-with-emulators.mjs <emuladores> <comando>");
  process.exit(1);
}
const { port } = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8")).emulators.firestore;

function stopLeftoverEmulator() {
  if (process.platform !== "win32") return;
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
  "firebase", "emulators:exec", "--only", only, "--project", "demo-forno-bello", `"${command}"`,
], { stdio: "inherit", shell: true });
stopLeftoverEmulator();
process.exit(result.status ?? 1);
