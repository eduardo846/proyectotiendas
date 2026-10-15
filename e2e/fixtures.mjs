import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { initializeApp } from "firebase/app";
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc,
  setLogLevel, Timestamp,
} from "firebase/firestore";

setLogLevel("silent");
const projectId = "demo-forno-bello";
const firestoreUrl = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}`;
const authUrl = "http://127.0.0.1:9099";

export const catalog = JSON.parse(readFileSync(new URL("../catalogo.json", import.meta.url), "utf8"));
export const PASSWORD = "Clave-segura-123";

// Precios de prueba: el precio del catálogo es el de la Mediana. "Pizza Margarita
// Personal" conserva el precio único anterior y "Pizza Rúcula..." solo se vende en Mediana.
export const LEGACY_PRODUCT = "Pizza Margarita Personal";
export const MEDIUM_ONLY_PRODUCT = "Pizza Rúcula, Parmesano y Piñones";
function testPrices(product) {
  if (product.nombre === LEGACY_PRODUCT) return { precio: product.precio };
  if (product.nombre === MEDIUM_ONLY_PRODUCT) return { precios: { Mediana: product.precio } };
  return { precios: { Personal: product.precio - 10000, Mediana: product.precio, Familiar: product.precio + 12000 } };
}
export function priceOf(name, size) {
  const product = catalog.productos.find((entry) => entry.nombre === name);
  const prices = testPrices(product);
  return prices.precios ? prices.precios[size] : prices.precio;
}

// Acceso de administrador al emulador ("owner" omite las reglas) para preparar y comprobar datos.
const adminApp = initializeApp({ projectId, apiKey: "demo-key" }, "e2e-owner");
export const adminDb = getFirestore(adminApp);
connectFirestoreEmulator(adminDb, "127.0.0.1", 8080, { mockUserToken: "owner" });

const categoryId = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function request(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function createAuthUser(email) {
  const { localId } = await request(
    `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) },
  );
  return localId;
}

// Misma transformación que functions/seed-firestore.mjs, más personal y un producto retirado.
async function seed() {
  await Promise.all([
    request(`${firestoreUrl}/databases/(default)/documents`, { method: "DELETE" }),
    request(`${authUrl}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" }),
  ]);
  const now = Timestamp.now();
  const { promoTexto, promoBadge, ...store } = catalog.tienda;
  const writes = [
    setDoc(doc(adminDb, "configuracion/tienda"), { ...store, moneda: "COP" }),
    setDoc(doc(adminDb, "promociones/combo-familiar"), {
      titulo: promoBadge, descripcion: promoTexto, tipo: "informativa", activa: true, orden: 1,
    }),
    setDoc(doc(adminDb, "productos/99"), {
      nombre: "Pizza Retirada", descripcion: "No debe verse", referencia: "FB-999",
      imagen: "https://example.com/x.jpg", precios: { Mediana: 1000 }, categoriaId: "clasicas", activo: false,
    }),
    ...catalog.categorias.map((name, index) => setDoc(doc(adminDb, "categorias", categoryId(name)), {
      nombre: name, orden: index + 1, activa: true,
    })),
    ...catalog.productos.map(({ id, categoria, precio, ...fields }) => setDoc(doc(adminDb, "productos", String(id)), {
      ...fields, ...testPrices({ ...fields, precio }), categoriaId: categoryId(categoria), activo: true,
    })),
  ];
  const staff = {};
  for (const [key, rol, activo] of [["admin", "admin", true], ["seller", "seller", true], ["inactive", "seller", false]]) {
    const email = `${key}@forno.test`;
    const uid = await createAuthUser(email);
    staff[key] = { uid, email };
    writes.push(setDoc(doc(adminDb, "usuarios", uid), {
      email, nombre: key, rol, activo, creadoEn: now, creadoPor: "seed", actualizadoEn: now,
    }));
  }
  staff.noProfile = { uid: await createAuthUser("cliente@forno.test"), email: "cliente@forno.test" };
  await Promise.all(writes);
  return staff;
}

export async function getOrders() {
  const snapshot = await getDocs(collection(adminDb, "pedidos"));
  return snapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
}

export async function createOrder(id, overrides = {}) {
  await setDoc(doc(adminDb, "pedidos", id), {
    cliente: { nombre: "Laura Gómez", telefono: "3001234567" },
    items: [{ productoId: "1", tamano: "Familiar", cantidad: 2 }],
    metodoPago: "Efectivo",
    estado: "pendiente_revision",
    preciosVerificados: false,
    creadoEn: Timestamp.now(),
    notas: "Calle 10 # 20-30",
    ...overrides,
  });
}

export async function getDocData(path) {
  return (await getDoc(doc(adminDb, path))).data();
}

export const test = base.extend({
  staff: async ({}, use) => use(await seed()),
  // Sin red externa: WhatsApp, imágenes y fuentes se simulan para pruebas deterministas.
  page: async ({ page, staff }, use) => {
    await page.context().route(/^https:\/\/wa\.me\//, (route) => route.fulfill({ body: "WhatsApp simulado" }));
    await page.context().route(/^https:\/\/(previews\.123rf\.com|example\.com|fonts\.(googleapis|gstatic)\.com)\//,
      (route) => route.abort());
    void staff;
    await use(page);
  },
});

export async function login(page, email, password = PASSWORD) {
  await page.goto("/staff");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

export { expect };
