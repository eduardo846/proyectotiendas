import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";

initializeApp();

const db = getFirestore();
const allowedPayments = new Set(["Nequi", "Transferencia", "Efectivo"]);

function invalidArgument(message) {
  throw new HttpsError("invalid-argument", message);
}

function validateRequest(data) {
  if (!data || typeof data !== "object") invalidArgument("Solicitud de pedido inválida.");
  if (Object.keys(data).some((key) => !["cliente", "items", "metodoPago", "notas"].includes(key))) {
    invalidArgument("La solicitud contiene campos no permitidos.");
  }

  const customer = data.cliente;
  if (!customer || typeof customer !== "object" ||
      Object.keys(customer).some((key) => !["nombre", "telefono"].includes(key))) {
    invalidArgument("Los datos del cliente son inválidos.");
  }
  const name = typeof customer.nombre === "string" ? customer.nombre.trim() : "";
  const phone = typeof customer.telefono === "string" ? customer.telefono.trim() : "";
  if (name.length > 120) invalidArgument("El nombre no puede superar 120 caracteres.");
  if (!name) invalidArgument("El nombre del cliente es obligatorio.");
  if (!/^[+\d\s().-]{7,24}$/.test(phone)) invalidArgument("Ingresa un teléfono válido.");

  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 30) {
    invalidArgument("El pedido debe tener entre 1 y 30 líneas de productos.");
  }
  const items = data.items.map((item) => {
    if (!item || typeof item !== "object" ||
        Object.keys(item).some((key) => !["productoId", "tamano", "cantidad"].includes(key)) ||
        typeof item.productoId !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(item.productoId) ||
        typeof item.tamano !== "string" ||
        item.tamano.length < 1 ||
        item.tamano.length > 40 ||
        !Number.isInteger(item.cantidad) ||
        item.cantidad < 1 ||
        item.cantidad > 50) {
      invalidArgument("Una línea del pedido contiene datos inválidos.");
    }
    return { productoId: item.productoId, tamano: item.tamano, cantidad: item.cantidad };
  });

  if (typeof data.metodoPago !== "string" || !allowedPayments.has(data.metodoPago)) {
    invalidArgument("El método de pago seleccionado no es válido.");
  }
  const notes = data.notas === undefined ? "" : data.notas;
  if (typeof notes !== "string" || notes.length > 1000) {
    invalidArgument("Las notas no pueden superar 1000 caracteres.");
  }

  const quantities = new Map();
  for (const item of items) {
    const key = `${item.productoId}_${item.tamano}`;
    const quantity = (quantities.get(key) ?? 0) + item.cantidad;
    if (quantity > 50) invalidArgument("La cantidad máxima por producto y tamaño es 50.");
    quantities.set(key, quantity);
  }

  return { name, phone, items, payment: data.metodoPago, notes: notes.trim() };
}

export const createOrder = onCall(
  { region: "us-central1", enforceAppCheck: true, maxInstances: 10 },
  async (request) => {
    const input = validateRequest(request.data);
    const storeSnapshot = await db.doc("configuracion/tienda").get();
    if (!storeSnapshot.exists) {
      throw new HttpsError("failed-precondition", "La configuración de la tienda no existe.");
    }

    const store = storeSnapshot.data();
    const sizes = store.tamanos;
    if (!Array.isArray(sizes) || !Number.isSafeInteger(store.envioGratis) ||
        store.envioGratis < 0 || !Number.isSafeInteger(store.costoEnvio) ||
        store.costoEnvio < 0 || typeof store.whatsapp !== "string") {
      throw new HttpsError("failed-precondition", "La configuración de pedidos está incompleta.");
    }

    const uniqueProductIds = [...new Set(input.items.map((item) => item.productoId))];
    const productSnapshots = await Promise.all(
      uniqueProductIds.map((productId) => db.doc(`productos/${productId}`).get()),
    );
    const products = new Map();
    for (const productSnapshot of productSnapshots) {
      if (!productSnapshot.exists || productSnapshot.data().activo !== true) {
        throw new HttpsError("failed-precondition", "Uno de los productos ya no está disponible.");
      }
      products.set(productSnapshot.id, productSnapshot.data());
    }

    const items = input.items.map((item) => {
      const product = products.get(item.productoId);
      if (!sizes.includes(item.tamano)) invalidArgument("El tamaño seleccionado no está disponible.");
      // Igual que src/pricing.js: `precios` por tamaño, o el precio único anterior.
      const price = product.precios ? product.precios[item.tamano] : product.precio;
      if (price === undefined) invalidArgument("El tamaño seleccionado no está disponible para este producto.");
      if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(price * item.cantidad)) {
        throw new HttpsError("failed-precondition", "Un producto tiene un precio inválido.");
      }
      return {
        productoId: item.productoId,
        nombre: product.nombre,
        referencia: product.referencia,
        tamano: item.tamano,
        cantidad: item.cantidad,
        precioUnitario: price,
        totalLinea: price * item.cantidad,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.totalLinea, 0);
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(subtotal + store.costoEnvio)) {
      invalidArgument("El valor del pedido supera el límite permitido.");
    }
    const envio = subtotal >= store.envioGratis ? 0 : store.costoEnvio;
    const total = subtotal + envio;
    const order = {
      cliente: { nombre: input.name, telefono: input.phone },
      items,
      subtotal,
      envio,
      total,
      metodoPago: input.payment,
      estado: "pendiente",
      origen: "tienda-web",
      creadoEn: FieldValue.serverTimestamp(),
      ...(input.notes ? { notas: input.notes } : {}),
    };
    const orderReference = await db.collection("pedidos").add(order);

    return {
      id: orderReference.id,
      items,
      subtotal,
      envio,
      total,
    };
  },
);
