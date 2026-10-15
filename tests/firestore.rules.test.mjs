// Pruebas de seguridad de firestore.rules. Ejecutar con: npm run test:rules
// (arranca el emulador de Firestore; no toca el proyecto real).
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { deleteApp, initializeApp } from "firebase/app";
import {
  addDoc, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs,
  getFirestore, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where,
} from "firebase/firestore";

setLogLevel("silent");
const MAX_ORDER_LINES = 15;
const projectId = "demo-forno-bello";
const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
const emulatorUrl = `http://${emulatorHost}:${emulatorPort}/emulator/v1/projects/${projectId}`;
const clients = new Map();

// Cada identidad usa su propia app; el emulador acepta tokens sin firmar y
// "owner" omite las reglas para preparar datos.
function firestoreAs(key, mockUserToken) {
  if (!clients.has(key)) {
    const app = initializeApp({ projectId, apiKey: "demo-key" }, key);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, emulatorHost, Number(emulatorPort), mockUserToken ? { mockUserToken } : {});
    clients.set(key, { app, db });
  }
  return clients.get(key).db;
}

async function assertSucceeds(operation) {
  return operation;
}

async function assertFails(operation) {
  try {
    await operation;
  } catch (error) {
    if (error.code === "permission-denied") return error;
    throw error;
  }
  throw new Error("Se esperaba PERMISSION_DENIED, pero las reglas permitieron la operación.");
}

async function emulatorRequest(path, init) {
  const response = await fetch(`${emulatorUrl}${path}`, init);
  if (!response.ok) throw new Error(`Emulador: ${response.status} ${await response.text()}`);
}

const env = {
  clearFirestore: () => emulatorRequest("/databases/(default)/documents", { method: "DELETE" }),
  withSecurityRulesDisabled: (callback) => callback({ firestore: () => firestoreAs("owner", "owner") }),
  unauthenticatedContext: () => ({ firestore: () => firestoreAs("anon") }),
  authenticatedContext: (uid, claims) => ({
    firestore: () => firestoreAs(`uid:${uid}:${JSON.stringify(claims)}`, { sub: uid, user_id: uid, ...claims }),
  }),
};

const line = (overrides = {}) => ({ productoId: "1", tamano: "Mediana", cantidad: 1, ...overrides });
const lines = (count) => Array.from({ length: count }, (_, index) => line({ productoId: String(index + 1) }));
const validOrder = (overrides = {}) => ({
  cliente: { nombre: "Ana", telefono: "300 123 4567" },
  items: [line({ cantidad: 2 })],
  metodoPago: "Nequi",
  estado: "pendiente_revision",
  preciosVerificados: false,
  creadoEn: serverTimestamp(),
  ...overrides,
});
const statusChange = (estado, extra = {}) => ({ estado, estadoActualizadoEn: serverTimestamp(), ...extra });

const anon = () => env.unauthenticatedContext().firestore();
const authed = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const createOrder = (db, order) => addDoc(collection(db, "pedidos"), order);

before(() => emulatorRequest(":securityRules", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rules: { files: [{ name: "firestore.rules", content: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }] },
  }),
}));
after(() => Promise.all([...clients.values()].map(({ app }) => deleteApp(app))));

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.now();
    const profile = (rol, activo = true) => ({
      email: `${rol}@forno.test`, nombre: rol, rol, activo, creadoEn: now, creadoPor: "seed", actualizadoEn: now,
    });
    await Promise.all([
      setDoc(doc(db, "configuracion/tienda"), { nombre: "Forno Bello", whatsapp: "573001112233", tamanos: ["Personal", "Mediana", "Familiar"] }),
      setDoc(doc(db, "configuracion/interna"), { secreto: true }),
      setDoc(doc(db, "productos/1"), { nombre: "Margarita", precio: 32000, activo: true }),
      setDoc(doc(db, "productos/2"), { nombre: "Retirada", precio: 1, activo: false }),
      setDoc(doc(db, "categorias/clasicas"), { nombre: "Clásicas", activa: true, orden: 1 }),
      setDoc(doc(db, "usuarios/admin1"), profile("admin")),
      setDoc(doc(db, "usuarios/admin2"), profile("admin")),
      setDoc(doc(db, "usuarios/seller1"), profile("seller")),
      setDoc(doc(db, "usuarios/sellerOff"), profile("seller", false)),
      setDoc(doc(db, "usuarios/legacyOff"), profile("admin", false)),
      setDoc(doc(db, "pedidos/abierto"), { ...validOrder(), creadoEn: now }),
      setDoc(doc(db, "pedidos/entregado"), { ...validOrder(), estado: "entregado", creadoEn: now }),
    ]);
  });
});

describe("Anónimo: catálogo y configuración", () => {
  test("lee configuracion/tienda", () => assertSucceeds(getDoc(doc(anon(), "configuracion/tienda"))));
  test("no lee otros documentos de configuracion", () => assertFails(getDoc(doc(anon(), "configuracion/interna"))));
  test("lee un producto activo", () => assertSucceeds(getDoc(doc(anon(), "productos/1"))));
  test("no lee un producto inactivo", () => assertFails(getDoc(doc(anon(), "productos/2"))));
  test("no lista productos sin filtrar por activo", () => assertFails(getDocs(collection(anon(), "productos"))));
  test("lista productos activos", () => assertSucceeds(getDocs(query(collection(anon(), "productos"), where("activo", "==", true)))));
  test("no modifica precios", () => assertFails(updateDoc(doc(anon(), "productos/1"), { precio: 1 })));
  test("no cambia el WhatsApp de la tienda", () => assertFails(updateDoc(doc(anon(), "configuracion/tienda"), { whatsapp: "1" })));
});

describe("Anónimo: solicitudes de pedido", () => {
  test("crea una solicitud válida", () => assertSucceeds(createOrder(anon(), validOrder())));
  test(`acepta ${MAX_ORDER_LINES} líneas (límite de la tienda)`, () =>
    assertSucceeds(createOrder(anon(), validOrder({ items: lines(MAX_ORDER_LINES) }))));
  test(`rechaza ${MAX_ORDER_LINES + 1} líneas`, () =>
    assertFails(createOrder(anon(), validOrder({ items: lines(MAX_ORDER_LINES + 1) }))));
  test("acepta notas y teléfono internacional con la cantidad máxima de líneas", () =>
    assertSucceeds(createOrder(anon(), validOrder({
      cliente: { nombre: "Cliente con nombre largo", telefono: "+57 (300) 123-4567" },
      notas: "x".repeat(1000),
      items: lines(MAX_ORDER_LINES).map((item) => ({ ...item, cantidad: 50, tamano: "Familiar" })),
    }))));
  test("rechaza un pedido vacío", () => assertFails(createOrder(anon(), validOrder({ items: [] }))));

  test("no lee pedidos", () => assertFails(getDoc(doc(anon(), "pedidos/abierto"))));
  test("no lista pedidos", () => assertFails(getDocs(collection(anon(), "pedidos"))));
  test("no actualiza pedidos", () => assertFails(updateDoc(doc(anon(), "pedidos/abierto"), statusChange("cancelado"))));
  test("no borra pedidos", () => assertFails(deleteDoc(doc(anon(), "pedidos/abierto"))));

  test("no inyecta el total", () => assertFails(createOrder(anon(), validOrder({ total: 1 }))));
  test("no marca precios verificados", () => assertFails(createOrder(anon(), validOrder({ preciosVerificados: true }))));
  test("no crea un pedido ya confirmado", () => assertFails(createOrder(anon(), validOrder({ estado: "confirmado" }))));
  test("no usa un método de pago desconocido", () => assertFails(createOrder(anon(), validOrder({ metodoPago: "Bitcoin" }))));
  test("no acepta un teléfono con script", () =>
    assertFails(createOrder(anon(), validOrder({ cliente: { nombre: "A", telefono: "javascript:alert(1)" } }))));
  test("no acepta notas de más de 1000 caracteres", () => assertFails(createOrder(anon(), validOrder({ notas: "x".repeat(1001) }))));
  test("no acepta fecha futura", () =>
    assertFails(createOrder(anon(), validOrder({ creadoEn: Timestamp.fromMillis(Date.now() + 864e5) }))));
  test("no acepta fecha retroactiva (saltar la cola FIFO)", () =>
    assertFails(createOrder(anon(), validOrder({ creadoEn: Timestamp.fromDate(new Date("2000-01-01")) }))));

  for (const [name, item] of [
    ["precio inyectado", line({ precioUnitario: 1 })],
    ["nombre inyectado que vería el personal", line({ nombre: "Pizza gratis" })],
    ["sin tamaño", { productoId: "1", cantidad: 1 }],
    ["tamaño vacío", line({ tamano: "" })],
    ["tamaño de más de 40 caracteres", line({ tamano: "x".repeat(41) })],
    ["tamaño con separador |", line({ tamano: "Mediana|50" })],
    ["productoId numérico", line({ productoId: 1 })],
    ["productoId con caracteres no permitidos", line({ productoId: "../usuarios" })],
    ["cantidad 0", line({ cantidad: 0 })],
    ["cantidad 51", line({ cantidad: 51 })],
    ["cantidad decimal", line({ cantidad: 1.5 })],
    ["cantidad como texto", line({ cantidad: "5" })],
  ]) {
    test(`rechaza línea con ${name}`, () => assertFails(createOrder(anon(), validOrder({ items: [line(), item] }))));
  }

  // Riesgos conocidos aún abiertos: deberían rechazarse y hoy se aceptan.
  test("no acepta productos inexistentes", { todo: "validar productoId contra productos/ en las reglas" }, () =>
    assertFails(createOrder(anon(), validOrder({ items: [line({ productoId: "NO_EXISTE" })] }))));
  test("no acepta productos inactivos", { todo: "validar productoId contra productos/ en las reglas" }, () =>
    assertFails(createOrder(anon(), validOrder({ items: [line({ productoId: "2" })] }))));
  test("no acepta tamaños fuera de la configuración", { todo: "validar tamano contra configuracion/tienda" }, () =>
    assertFails(createOrder(anon(), validOrder({ items: [line({ tamano: "Gigante" })] }))));
  test("limita solicitudes masivas", { todo: "activar App Check con aplicación obligatoria en Firestore" }, async () => {
    const db = anon();
    await assertFails(Promise.all(Array.from({ length: 50 }, () => createOrder(db, validOrder()))));
  });
});

describe("Usuario autenticado sin perfil de personal", () => {
  const intruder = () => authed("intruso");
  test("no se crea un perfil de administrador", () => assertFails(setDoc(doc(intruder(), "usuarios/intruso"), {
    email: "i@forno.test", nombre: "I", rol: "admin", activo: true,
    creadoEn: serverTimestamp(), creadoPor: "intruso", actualizadoEn: serverTimestamp(),
  })));
  test("no lee pedidos", () => assertFails(getDocs(collection(intruder(), "pedidos"))));
  test("no lista al personal", () => assertFails(getDocs(collection(intruder(), "usuarios"))));
  test("no lee perfiles ajenos", () => assertFails(getDoc(doc(intruder(), "usuarios/admin1"))));
  test("no escribe productos", () => assertFails(setDoc(doc(intruder(), "productos/x"), { activo: true })));
  test("un claim de rol inventado no da acceso", () => assertFails(getDocs(collection(authed("x", { role: "owner" }), "pedidos"))));
});

describe("Vendedor", () => {
  const seller = () => authed("seller1");
  test("lee pedidos", () => assertSucceeds(getDocs(collection(seller(), "pedidos"))));
  test("cambia el estado", () => assertSucceeds(updateDoc(doc(seller(), "pedidos/abierto"), statusChange("confirmado"))));
  test("cierra un pedido", () => assertSucceeds(updateDoc(doc(seller(), "pedidos/abierto"), statusChange("cerrado"))));
  test("no reabre un pedido entregado", () => assertFails(updateDoc(doc(seller(), "pedidos/entregado"), statusChange("confirmado"))));
  test("no cambia datos del cliente", () =>
    assertFails(updateDoc(doc(seller(), "pedidos/abierto"), statusChange("confirmado", { "cliente.telefono": "3111111111" }))));
  test("no marca precios verificados", () =>
    assertFails(updateDoc(doc(seller(), "pedidos/abierto"), statusChange("confirmado", { preciosVerificados: true }))));
  test("no usa un estado inventado", () => assertFails(updateDoc(doc(seller(), "pedidos/abierto"), statusChange("pagado"))));
  test("no falsifica la fecha del cambio", () => assertFails(updateDoc(doc(seller(), "pedidos/abierto"), {
    estado: "confirmado", estadoActualizadoEn: Timestamp.fromDate(new Date("2000-01-01")),
  })));
  test("no borra pedidos", () => assertFails(deleteDoc(doc(seller(), "pedidos/abierto"))));
  test("no edita productos", () => assertFails(updateDoc(doc(seller(), "productos/1"), { precio: 1 })));
  test("no edita la configuración", () => assertFails(updateDoc(doc(seller(), "configuracion/tienda"), { whatsapp: "1" })));
  test("no se asciende a administrador", () =>
    assertFails(updateDoc(doc(seller(), "usuarios/seller1"), { rol: "admin", actualizadoEn: serverTimestamp() })));
  test("no lista al personal", () => assertFails(getDocs(collection(seller(), "usuarios"))));
  test("lee su propio perfil", () => assertSucceeds(getDoc(doc(seller(), "usuarios/seller1"))));
});

describe("Revocación de acceso", () => {
  test("un vendedor desactivado no lee pedidos", () => assertFails(getDocs(collection(authed("sellerOff"), "pedidos"))));
  test("un perfil inactivo prevalece sobre el claim admin antiguo", () =>
    assertFails(getDocs(collection(authed("legacyOff", { role: "admin" }), "pedidos"))));
  test("el claim admin antiguo sin perfil sigue siendo válido", () =>
    assertSucceeds(getDocs(collection(authed("legacy", { role: "admin" }), "usuarios"))));
});

describe("Administrador", () => {
  const admin = () => authed("admin1");
  test("gestiona productos", () => assertSucceeds(updateDoc(doc(admin(), "productos/1"), { precio: 35000 })));
  test("reabre un pedido entregado", () => assertSucceeds(updateDoc(doc(admin(), "pedidos/entregado"), statusChange("confirmado"))));
  test("no se edita a sí mismo", () =>
    assertFails(updateDoc(doc(admin(), "usuarios/admin1"), { nombre: "x", actualizadoEn: serverTimestamp() })));
  test("no borra perfiles", () => assertFails(deleteDoc(doc(admin(), "usuarios/seller1"))));
  test("no cambia el correo de otro perfil", () =>
    assertFails(updateDoc(doc(admin(), "usuarios/seller1"), { email: "otro@forno.test", actualizadoEn: serverTimestamp() })));
  test("no falsifica creadoPor", () => assertFails(setDoc(doc(admin(), "usuarios/nuevo"), {
    email: "n@forno.test", nombre: "N", rol: "seller", activo: true,
    creadoEn: serverTimestamp(), creadoPor: "otro", actualizadoEn: serverTimestamp(),
  })));
  test("no borra pedidos", () => assertFails(deleteDoc(doc(admin(), "pedidos/abierto"))));
  test("no guarda productos con precio inválido", { todo: "validar el esquema de productos en las reglas" }, () =>
    assertFails(updateDoc(doc(admin(), "productos/1"), { precio: "gratis" })));
});
