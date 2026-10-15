import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
try {
  await access(envPath);
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const expectedProjectId = process.env.VITE_FIREBASE_PROJECT_ID;
if (!expectedProjectId) {
  throw new Error("Falta VITE_FIREBASE_PROJECT_ID en el archivo .env del proyecto.");
}

const catalog = JSON.parse(await readFile(new URL("../catalogo.json", import.meta.url), "utf8"));
const dryRun = process.argv.includes("--dry-run");

function categoryId(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateCatalog() {
  const store = catalog.tienda;
  if (!store.nombre || !/^\d{8,15}$/.test(store.whatsapp)) {
    throw new Error("La tienda necesita nombre y número de WhatsApp internacional válido.");
  }
  if (!Array.isArray(store.tamanos) || store.tamanos.length === 0 ||
      new Set(store.tamanos).size !== store.tamanos.length) {
    throw new Error("La tienda necesita tamaños válidos y sin duplicados.");
  }
  if (!Number.isSafeInteger(store.envioGratis) || store.envioGratis < 0 ||
      !Number.isSafeInteger(store.costoEnvio) || store.costoEnvio < 0) {
    throw new Error("Las tarifas de envío deben ser valores enteros no negativos.");
  }
  if (!Array.isArray(catalog.categorias) || catalog.categorias.length === 0 ||
      catalog.categorias.some((category) => typeof category !== "string" || !category.trim())) {
    throw new Error("El catálogo necesita categorías con nombre.");
  }
  const categories = new Set(catalog.categorias.map(categoryId));
  if (categories.size !== catalog.categorias.length) {
    throw new Error("El catálogo contiene categorías duplicadas después de normalizar sus nombres.");
  }
  const productIds = new Set();
  const references = new Set();
  for (const product of catalog.productos) {
    if (!Number.isInteger(product.id) || product.id <= 0 || productIds.has(String(product.id))) {
      throw new Error(`ID de producto inválido o duplicado: ${product.id}.`);
    }
    if (typeof product.nombre !== "string" || !product.nombre.trim() ||
        typeof product.descripcion !== "string" || !product.descripcion.trim() ||
        typeof product.referencia !== "string" || !product.referencia.trim() ||
        references.has(product.referencia)) {
      throw new Error(`Nombre, descripción o referencia inválidos para el producto ${product.id}.`);
    }
    if (!categories.has(categoryId(product.categoria))) {
      throw new Error(`Categoría inexistente para el producto ${product.referencia}.`);
    }
    // `precios` por tamaño; `precio` único se admite para catálogos anteriores.
    const prices = product.precios ?? (product.precio === undefined ? undefined : { [store.tamanos[0]]: product.precio });
    if (!prices || typeof prices !== "object" || Object.keys(prices).length === 0 ||
        (product.precios && product.precio !== undefined) ||
        Object.entries(prices).some(([size, price]) =>
          (product.precios && !store.tamanos.includes(size)) || !Number.isSafeInteger(price) || price < 0)) {
      throw new Error(`Precios inválidos para el producto ${product.referencia}: usa "precios" con los tamaños ${store.tamanos.join(", ")}.`);
    }
    try {
      if (new URL(product.imagen).protocol !== "https:") {
        throw new Error("La URL debe usar HTTPS.");
      }
    } catch {
      throw new Error(`URL de imagen inválida para el producto ${product.referencia}.`);
    }
    productIds.add(String(product.id));
    references.add(product.referencia);
  }
}

validateCatalog();
if (dryRun) {
  console.log(
    `Catálogo válido: 1 tienda, ${catalog.categorias.length} categorías, ${catalog.productos.length} productos y ${catalog.tienda.promoTexto ? 1 : 0} promoción informativa. Sin escrituras a Firestore.`,
  );
  process.exit(0);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    "Configura GOOGLE_APPLICATION_CREDENTIALS con la ruta local de una clave de cuenta de servicio de Firebase.",
  );
}

const app = initializeApp({
  credential: applicationDefault(),
  projectId: expectedProjectId,
});
const db = getFirestore(app);

const batch = db.batch();
const store = { ...catalog.tienda };
delete store.promoTexto;
delete store.promoBadge;

batch.set(db.doc("configuracion/tienda"), {
  ...store,
  moneda: "COP",
  actualizadoEn: FieldValue.serverTimestamp(),
});

catalog.categorias.forEach((name, index) => {
  const id = categoryId(name);
  batch.set(db.doc(`categorias/${id}`), {
    nombre: name,
    orden: index + 1,
    activa: true,
    actualizadoEn: FieldValue.serverTimestamp(),
  });
});

for (const product of catalog.productos) {
  const { id, categoria, ...fields } = product;
  batch.set(db.doc(`productos/${id}`), {
    ...fields,
    categoriaId: categoryId(categoria),
    activo: true,
    actualizadoEn: FieldValue.serverTimestamp(),
  });
}

if (catalog.tienda.promoTexto) {
  batch.set(db.doc("promociones/combo-familiar"), {
    titulo: catalog.tienda.promoBadge || "Promoción",
    descripcion: catalog.tienda.promoTexto,
    tipo: "informativa",
    activa: true,
    orden: 1,
    condicion: { tamano: "Familiar", cantidadMinima: 2 },
    actualizadoEn: FieldValue.serverTimestamp(),
  });
}

await batch.commit();
console.log(
  `Catálogo cargado: 1 tienda, ${catalog.categorias.length} categorías, ${catalog.productos.length} productos y ${catalog.tienda.promoTexto ? 1 : 0} promoción informativa.`,
);
