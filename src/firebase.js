import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore/lite";
import {
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = Object.values(firebaseConfig);
export const isFirebaseConfigured = requiredConfig.every((value) => Boolean(value?.trim()));

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;

function requireFirebase() {
  if (!db) throw new Error("Firebase no está configurado.");
}

function requireAuth() {
  if (!auth) throw new Error("Firebase Authentication no está configurado.");
}

export async function getStoreData() {
  requireFirebase();

  const [storeSnapshot, categoriesSnapshot, productsSnapshot, promotionsSnapshot] = await Promise.all([
    getDoc(doc(db, "configuracion", "tienda")),
    getDocs(query(collection(db, "categorias"), where("activa", "==", true))),
    getDocs(query(collection(db, "productos"), where("activo", "==", true))),
    getDocs(query(collection(db, "promociones"), where("activa", "==", true))),
  ]);

  if (!storeSnapshot.exists()) {
    throw new Error("Falta el documento configuracion/tienda en Firestore.");
  }
  const categorias = categoriesSnapshot.docs
    .map((categoryDoc) => ({ id: categoryDoc.id, ...categoryDoc.data() }))
    .sort((a, b) => a.orden - b.orden);
  if (categorias.length === 0) {
    throw new Error("No hay categorías activas en Firestore. Ejecuta npm run seed:catalog.");
  }

  const categoryNames = new Map(categorias.map((category) => [category.id, category.nombre]));
  const productos = productsSnapshot.docs
    .map((productDoc) => ({
      ...productDoc.data(),
      id: productDoc.id,
      categoria: categoryNames.get(productDoc.data().categoriaId),
    }))
    .filter((product) => product.categoria)
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  if (productos.length === 0) {
    throw new Error("No hay productos activos en Firestore. Ejecuta npm run seed:catalog.");
  }

  const promociones = promotionsSnapshot.docs
    .map((promotionDoc) => ({ id: promotionDoc.id, ...promotionDoc.data() }))
    .sort((a, b) => a.orden - b.orden);
  const promocion = promociones[0];
  const tienda = {
    ...storeSnapshot.data(),
    promoTexto: promocion?.descripcion ?? "",
    promoBadge: promocion?.titulo ?? "",
  };

  return { tienda, categorias: categorias.map((category) => category.nombre), productos };
}

export function observeStaffAuth(callback, onError) {
  requireAuth();
  return onAuthStateChanged(auth, callback, onError);
}

export async function signInStaff(email, password) {
  requireAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const role = await getStaffRole(credential.user);
  if (role !== "admin" && role !== "seller") {
    await signOut(auth);
    throw new Error("Esta cuenta no tiene un perfil de personal activo. Contacta al administrador.");
  }
  return { user: credential.user, role };
}

export async function getStaffRole(user) {
  requireFirebase();
  const profile = await getDoc(doc(db, "usuarios", user.uid));
  if (profile.exists()) {
    const userData = profile.data();
    return userData.activo === true && ["admin", "seller"].includes(userData.rol)
      ? userData.rol
      : null;
  }
  const token = await user.getIdTokenResult(true);
  const role = token.claims.role;
  return role === "admin" || role === "seller" ? role : null;
}

export async function signOutStaff() {
  requireAuth();
  await signOut(auth);
}

export async function getStaffUsers(currentUser) {
  requireFirebase();
  const userSnapshots = await getDocs(collection(db, "usuarios"));
  const profiles = userSnapshots.docs.map((snapshot) => ({
    uid: snapshot.id,
    ...snapshot.data(),
    emailVerified: false,
    createdAt: snapshot.data().creadoEn?.toDate?.()?.toISOString() ?? "",
    lastSignInAt: "",
    perfilPendiente: false,
  }));
  const currentProfileIndex = profiles.findIndex((profile) => profile.uid === currentUser.uid);
  const token = await currentUser.getIdTokenResult();
  const currentRole = profiles[currentProfileIndex]?.rol ?? token.claims.role;
  if (currentRole === "admin" && currentProfileIndex === -1) {
    profiles.push({
      uid: currentUser.uid,
      email: currentUser.email ?? "",
      nombre: currentUser.displayName ?? "",
      rol: "admin",
      activo: true,
      emailVerified: currentUser.emailVerified,
      createdAt: currentUser.metadata.creationTime ?? "",
      lastSignInAt: currentUser.metadata.lastSignInTime ?? "",
      perfilPendiente: true,
    });
  } else if (currentProfileIndex >= 0) {
    profiles[currentProfileIndex] = {
      ...profiles[currentProfileIndex],
      emailVerified: currentUser.emailVerified,
      lastSignInAt: currentUser.metadata.lastSignInTime ?? "",
    };
  }
  return profiles.filter((profile) => ["admin", "seller"].includes(profile.rol))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

export async function createStaffUserProfile({ uid, email, nombre, rol }) {
  requireFirebase();
  requireAuth();
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedName = typeof nombre === "string" ? nombre.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedUid)) {
    throw new Error("El UID debe copiarse desde la cuenta creada en Firebase Authentication.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error("Ingresa el mismo correo usado para crear la cuenta en Authentication.");
  }
  if (!["admin", "seller"].includes(rol)) throw new Error("El rol debe ser admin o seller.");
  if (normalizedName.length > 120) throw new Error("El nombre no puede superar 120 caracteres.");
  const userProfile = doc(db, "usuarios", normalizedUid);
  if ((await getDoc(userProfile)).exists()) {
    throw new Error("Este UID ya tiene un perfil de personal. Actualiza el perfil existente.");
  }
  const profile = {
    email: normalizedEmail,
    nombre: normalizedName,
    rol,
    activo: true,
    creadoEn: serverTimestamp(),
    creadoPor: auth.currentUser.uid,
    actualizadoEn: serverTimestamp(),
  };
  await setDoc(userProfile, profile);
}

export async function updateStaffUserProfile(uid, updates) {
  requireFirebase();
  if (!auth?.currentUser) throw new Error("Inicia sesión para administrar usuarios.");
  if (uid === auth.currentUser.uid) {
    throw new Error("No puedes editar tu propio perfil de administrador desde esta pantalla.");
  }
  if (updates.rol !== undefined && !["admin", "seller"].includes(updates.rol)) {
    throw new Error("El rol debe ser admin o seller.");
  }
  if (updates.activo !== undefined && typeof updates.activo !== "boolean") {
    throw new Error("El estado de la cuenta no es válido.");
  }
  if (updates.nombre !== undefined &&
      (typeof updates.nombre !== "string" || updates.nombre.trim().length > 120)) {
    throw new Error("El nombre no puede superar 120 caracteres.");
  }
  await updateDoc(doc(db, "usuarios", uid), {
    ...updates,
    ...(updates.nombre !== undefined ? { nombre: updates.nombre.trim() } : {}),
    actualizadoEn: serverTimestamp(),
  });
}

export async function deactivateStaffUserProfile(uid) {
  requireFirebase();
  if (!auth?.currentUser) throw new Error("Inicia sesión para administrar usuarios.");
  if (uid === auth.currentUser.uid) {
    throw new Error("No puedes eliminar tu propio perfil de administrador desde esta pantalla.");
  }
  await updateDoc(doc(db, "usuarios", uid), {
    activo: false,
    actualizadoEn: serverTimestamp(),
  });
}

export async function sendStaffPasswordReset(email) {
  requireAuth();
  await sendPasswordResetEmail(auth, email);
}

export async function getStaffData(role) {
  requireFirebase();
  if (role !== "admin" && role !== "seller") {
    throw new Error("Se requiere un rol válido de personal para consultar estos datos.");
  }
  const categoryCollection = collection(db, "categorias");
  const productCollection = collection(db, "productos");
  const promotionCollection = collection(db, "promociones");
  const [storeSnapshot, categoriesSnapshot, productsSnapshot, promotionsSnapshot, ordersSnapshot] = await Promise.all([
    getDoc(doc(db, "configuracion", "tienda")),
    getDocs(role === "admin"
      ? query(categoryCollection, orderBy("orden"))
      : query(categoryCollection, where("activa", "==", true))),
    getDocs(role === "admin"
      ? productCollection
      : query(productCollection, where("activo", "==", true))),
    getDocs(role === "admin"
      ? query(promotionCollection, orderBy("orden"))
      : query(promotionCollection, where("activa", "==", true))),
    getDocs(query(collection(db, "pedidos"), orderBy("creadoEn", "desc"))),
  ]);
  if (!storeSnapshot.exists()) throw new Error("Falta el documento de configuración de la tienda.");
  return {
    store: storeSnapshot.data(),
    categories: categoriesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    products: productsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    promotions: promotionsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    orders: ordersSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
  };
}

export async function saveStoreSettings(settings) {
  requireFirebase();
  await setDoc(doc(db, "configuracion", "tienda"), {
    ...settings,
    actualizadoEn: serverTimestamp(),
  }, { merge: true });
}

export async function saveStaffProduct(product, productId) {
  requireFirebase();
  const values = { ...product, actualizadoEn: serverTimestamp() };
  if (productId) {
    await setDoc(doc(db, "productos", productId), values, { merge: true });
    return productId;
  }
  const created = await addDoc(collection(db, "productos"), values);
  return created.id;
}

export async function removeStaffProduct(productId) {
  requireFirebase();
  await deleteDoc(doc(db, "productos", productId));
}

export async function saveStaffCategory(category, categoryId) {
  requireFirebase();
  const reference = categoryId
    ? doc(db, "categorias", categoryId)
    : doc(collection(db, "categorias"));
  await setDoc(reference, { ...category, actualizadoEn: serverTimestamp() }, { merge: true });
  return reference.id;
}

export async function removeStaffCategory(categoryId) {
  requireFirebase();
  await deleteDoc(doc(db, "categorias", categoryId));
}

export async function saveStaffPromotion(promotion, promotionId) {
  requireFirebase();
  const values = { ...promotion, actualizadoEn: serverTimestamp() };
  if (promotionId) {
    await setDoc(doc(db, "promociones", promotionId), values, { merge: true });
    return promotionId;
  }
  const created = await addDoc(collection(db, "promociones"), values);
  return created.id;
}

export async function removeStaffPromotion(promotionId) {
  requireFirebase();
  await deleteDoc(doc(db, "promociones", promotionId));
}

export async function savePendingOrder(order) {
  requireFirebase();
  if (!order || !Array.isArray(order.items) || order.items.length < 1 || order.items.length > 30) {
    throw new Error("El pedido debe tener entre 1 y 30 productos.");
  }
  if (order.items.some((item) =>
    !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 50 ||
    typeof item.productoId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.productoId) ||
    typeof item.tamano !== "string" || item.tamano.length < 1 || item.tamano.length > 40
  )) {
    throw new Error("El pedido contiene un producto, tamaño o cantidad no válidos.");
  }
  const orderRef = await addDoc(collection(db, "pedidos"), {
    ...order,
    estado: "pendiente_revision",
    preciosVerificados: false,
    creadoEn: serverTimestamp(),
  });
  return { id: orderRef.id };
}
