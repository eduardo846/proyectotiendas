import { useEffect, useState } from "react";
import {
  getStaffData,
  getStaffRole,
  getStaffUsers,
  isFirebaseConfigured,
  observeStaffAuth,
  removeStaffCategory,
  removeStaffProduct,
  removeStaffPromotion,
  saveStaffCategory,
  saveStaffProduct,
  saveStaffPromotion,
  saveStoreSettings,
  createStaffUserProfile,
  deactivateStaffUserProfile,
  sendStaffPasswordReset,
  signInStaff,
  signOutStaff,
  updateStaffUserProfile,
} from "./firebase.js";
import "./staff.css";

const formatPrice = (amount) => `$${Number(amount || 0).toLocaleString("es-CO")}`;
const formatDate = (value) => value?.toDate
  ? value.toDate().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
  : "Fecha no disponible";
const toSlug = (value) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const initialProduct = {
  nombre: "",
  descripcion: "",
  referencia: "",
  imagen: "",
  precio: "",
  categoriaId: "",
  popular: false,
  activo: true,
};

function StaffLogin({ onLogin, error, busy }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event) {
    event.preventDefault();
    onLogin(email.trim(), password);
  }

  return (
    <main className="staff-screen">
      <section className="staff-login-card">
        <a className="staff-back-link" href="/">← Volver a la tienda</a>
        <span className="staff-brand-mark" aria-hidden="true">🍕</span>
        <p className="staff-eyebrow">Forno Bello · Personal</p>
        <h1>Iniciar sesión</h1>
        <p className="staff-muted">Acceso exclusivo para administradores y vendedores.</p>
        {!isFirebaseConfigured && (
          <div className="staff-alert" role="alert">Completa la configuración de Firebase para habilitar el acceso.</div>
        )}
        {error && <div className="staff-alert" role="alert">{error}</div>}
        <form className="staff-form" onSubmit={submit}>
          <label>Correo electrónico
            <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>Contraseña
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="staff-primary-button" type="submit" disabled={busy || !isFirebaseConfigured}>
            {busy ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}

function StaffStatus({ title, message, actionLabel, onAction }) {
  return (
    <main className="staff-screen">
      <section className="staff-login-card">
        <a className="staff-back-link" href="/">← Volver a la tienda</a>
        <span className="staff-brand-mark" aria-hidden="true">🍕</span>
        <p className="staff-eyebrow">Forno Bello · Personal</p>
        <h1>{title}</h1>
        <div className="staff-alert" role="alert">{message}</div>
        <button className="staff-secondary-button" type="button" onClick={onAction}>{actionLabel}</button>
      </section>
    </main>
  );
}

function StoreSettings({ store, busy, onSave }) {
  const [form, setForm] = useState(() => ({
    nombre: store.nombre ?? "",
    slogan: store.slogan ?? "",
    descripcion: store.descripcion ?? "",
    whatsapp: store.whatsapp ?? "",
    rating: store.rating ?? "",
    pedidos: store.pedidos ?? "",
    tiempoEntrega: store.tiempoEntrega ?? "",
    envioGratis: store.envioGratis ?? 0,
    costoEnvio: store.costoEnvio ?? 0,
    tamanos: (store.tamanos ?? []).join(", "),
  }));

  function submit(event) {
    event.preventDefault();
    const sizes = [...new Set(form.tamanos.split(",").map((size) => size.trim()).filter(Boolean))];
    if (sizes.length === 0) {
      onSave(null, "Define al menos un tamaño de pizza.");
      return;
    }
    const whatsapp = form.whatsapp.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(whatsapp)) {
      onSave(null, "El WhatsApp debe incluir el código de país y tener entre 8 y 15 dígitos.");
      return;
    }
    const envioGratis = Number(form.envioGratis);
    const costoEnvio = Number(form.costoEnvio);
    if (!Number.isSafeInteger(envioGratis) || envioGratis < 0 ||
        !Number.isSafeInteger(costoEnvio) || costoEnvio < 0) {
      onSave(null, "Los valores de envío deben ser enteros no negativos.");
      return;
    }
    onSave({
      nombre: form.nombre.trim(),
      slogan: form.slogan.trim(),
      descripcion: form.descripcion.trim(),
      whatsapp,
      rating: String(form.rating).trim(),
      pedidos: String(form.pedidos).trim(),
      tiempoEntrega: form.tiempoEntrega.trim(),
      envioGratis,
      costoEnvio,
      tamanos: sizes,
    });
  }

  return (
    <section className="staff-panel">
      <div className="staff-panel-heading">
        <div><p className="staff-eyebrow">Administración</p><h2>Configuración de la tienda</h2></div>
      </div>
      <form className="staff-form staff-form-grid" onSubmit={submit}>
        <label>Nombre<input required value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label>
        <label>Descripción breve<input required value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></label>
        <label className="staff-field-wide">Eslogan<textarea required rows="2" value={form.slogan} onChange={(event) => setForm({ ...form, slogan: event.target.value })} /></label>
        <label>WhatsApp internacional<input required inputMode="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} /></label>
        <label>Tiempo de entrega<input required value={form.tiempoEntrega} onChange={(event) => setForm({ ...form, tiempoEntrega: event.target.value })} /></label>
        <label>Envío gratis desde (COP)<input type="number" min="0" step="1" required value={form.envioGratis} onChange={(event) => setForm({ ...form, envioGratis: event.target.value })} /></label>
        <label>Costo de envío (COP)<input type="number" min="0" step="1" required value={form.costoEnvio} onChange={(event) => setForm({ ...form, costoEnvio: event.target.value })} /></label>
        <label>Tamaños disponibles (separados por coma)<input required value={form.tamanos} onChange={(event) => setForm({ ...form, tamanos: event.target.value })} /></label>
        <label>Calificación mostrada<input value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} /></label>
        <label>Pedidos mostrados<input value={form.pedidos} onChange={(event) => setForm({ ...form, pedidos: event.target.value })} /></label>
        <button className="staff-primary-button staff-field-wide" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar configuración"}</button>
      </form>
    </section>
  );
}

function ProductManager({ data, busy, onSave, onDelete }) {
  const [form, setForm] = useState(initialProduct);
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const activeCategories = data.categories.filter((category) => category.activa !== false);

  useEffect(() => {
    if (!form.categoriaId && activeCategories.length) {
      setForm((current) => ({ ...current, categoriaId: activeCategories[0].id }));
    }
  }, [activeCategories, form.categoriaId]);

  function edit(product) {
    setEditingId(product.id);
    setForm({
      nombre: product.nombre ?? "",
      descripcion: product.descripcion ?? "",
      referencia: product.referencia ?? "",
      imagen: product.imagen ?? "",
      precio: String(product.precio ?? ""),
      categoriaId: activeCategories.some((category) => category.id === product.categoriaId)
        ? product.categoriaId
        : activeCategories[0]?.id ?? "",
      popular: Boolean(product.popular),
      activo: product.activo !== false,
    });
    setShowForm(true);
  }

  function reset() {
    setEditingId("");
    setForm({ ...initialProduct, categoriaId: activeCategories[0]?.id ?? "" });
    setShowForm(false);
  }

  function submit(event) {
    event.preventDefault();
    const price = Number(form.precio);
    if (!Number.isSafeInteger(price) || price < 0) {
      onSave(null, "El precio debe ser un valor entero no negativo en COP.");
      return;
    }
    try {
      if (new URL(form.imagen).protocol !== "https:") throw new Error();
    } catch {
      onSave(null, "La imagen debe tener una URL HTTPS válida.");
      return;
    }
    onSave({
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim(),
      referencia: form.referencia.trim(),
      imagen: form.imagen.trim(),
      precio: price,
      categoriaId: form.categoriaId,
      popular: form.popular,
      activo: form.activo,
    }, editingId, reset);
  }

  const products = [...data.products].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return (
    <section className="staff-panel">
      <div className="staff-panel-heading">
        <div><p className="staff-eyebrow">{data.products.length} productos</p><h2>Catálogo de productos</h2></div>
        <button className="staff-primary-button" type="button" onClick={() => { reset(); setShowForm(true); }}>Nuevo producto</button>
      </div>
      {showForm && (
        <form className="staff-form staff-form-grid staff-editor" onSubmit={submit}>
          <h3 className="staff-field-wide">{editingId ? "Editar producto" : "Nuevo producto"}</h3>
          <label>Nombre<input required maxLength="120" value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label>
          <label>Referencia<input required maxLength="40" value={form.referencia} onChange={(event) => setForm({ ...form, referencia: event.target.value })} /></label>
          <label className="staff-field-wide">Descripción<textarea required maxLength="500" rows="2" value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></label>
          <label>Precio (COP)<input type="number" min="0" step="1" required value={form.precio} onChange={(event) => setForm({ ...form, precio: event.target.value })} /></label>
          <label>Categoría<select required value={form.categoriaId} onChange={(event) => setForm({ ...form, categoriaId: event.target.value })}>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select></label>
          <label className="staff-field-wide">Imagen HTTPS<input type="url" required value={form.imagen} onChange={(event) => setForm({ ...form, imagen: event.target.value })} /></label>
          <label className="staff-check"><input type="checkbox" checked={form.popular} onChange={(event) => setForm({ ...form, popular: event.target.checked })} /> Producto popular</label>
          <label className="staff-check"><input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} /> Publicado en la tienda</label>
          <div className="staff-form-actions staff-field-wide">
            <button className="staff-primary-button" type="submit" disabled={busy || activeCategories.length === 0}>{busy ? "Guardando…" : "Guardar producto"}</button>
            <button className="staff-secondary-button" type="button" onClick={reset}>Cancelar</button>
          </div>
        </form>
      )}
      {activeCategories.length === 0 && <p className="staff-muted">Activa o crea una categoría antes de publicar productos.</p>}
      <div className="staff-record-list">
        {products.map((product) => (
          <article className="staff-record" key={product.id}>
            <div className="staff-record-copy">
              <strong>{product.nombre}</strong>
              <span>Ref. {product.referencia} · {data.categories.find((category) => category.id === product.categoriaId)?.nombre ?? "Sin categoría"}</span>
              <span>{formatPrice(product.precio)} · {product.activo === false ? "No publicado" : "Publicado"}</span>
            </div>
            <div className="staff-record-actions">
              <button className="staff-secondary-button" type="button" onClick={() => edit(product)}>Editar</button>
              <button className="staff-danger-button" type="button" disabled={busy} onClick={() => onDelete(product, () => window.confirm(`¿Eliminar ${product.nombre}?`))}>Eliminar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CategoryManager({ data, busy, onSave, onDelete }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);

  function submit(event) {
    event.preventDefault();
    const normalized = name.trim();
    const duplicate = data.categories.some((category) =>
      category.id === toSlug(normalized) && category.id !== editing?.id);
    if (!normalized || duplicate) {
      onSave(null, duplicate ? "Ya existe una categoría con ese nombre." : "Escribe el nombre de la categoría.");
      return;
    }
    onSave({
      nombre: normalized,
      orden: editing?.orden ?? data.categories.length + 1,
      activa: editing?.activa !== false,
    }, editing?.id, () => { setName(""); setEditing(null); });
  }

  return (
    <section className="staff-panel">
      <div className="staff-panel-heading"><div><p className="staff-eyebrow">{data.categories.length} categorías</p><h2>Categorías</h2></div></div>
      <form className="staff-inline-form" onSubmit={submit}>
        <label>{editing ? "Editar categoría" : "Nueva categoría"}
          <input required maxLength="60" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="staff-primary-button" type="submit" disabled={busy}>{editing ? "Guardar" : "Agregar"}</button>
        {editing && <button className="staff-secondary-button" type="button" onClick={() => { setName(""); setEditing(null); }}>Cancelar</button>}
      </form>
      <div className="staff-record-list">
        {[...data.categories].sort((a, b) => a.orden - b.orden).map((category) => {
          const productsInCategory = data.products.filter((product) => product.categoriaId === category.id).length;
          return (
            <article className="staff-record" key={category.id}>
              <div className="staff-record-copy"><strong>{category.nombre}</strong><span>Orden {category.orden} · {productsInCategory} producto(s) · {category.activa ? "Activa" : "Inactiva"}</span></div>
              <div className="staff-record-actions">
                <button className="staff-secondary-button" type="button" onClick={() => { setEditing(category); setName(category.nombre); }}>Editar</button>
                <button className="staff-danger-button" type="button" disabled={busy} onClick={() => onDelete(category, () => window.confirm(`¿Eliminar la categoría ${category.nombre}?`))}>Eliminar</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PromotionManager({ data, busy, onSave, onDelete }) {
  const [form, setForm] = useState({ titulo: "", descripcion: "", activa: true });
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);

  function edit(promotion) {
    setEditingId(promotion.id);
    setForm({ titulo: promotion.titulo ?? "", descripcion: promotion.descripcion ?? "", activa: promotion.activa !== false });
    setShowForm(true);
  }

  function reset() {
    setEditingId("");
    setForm({ titulo: "", descripcion: "", activa: true });
    setShowForm(false);
  }

  function submit(event) {
    event.preventDefault();
    const order = editingId
      ? data.promotions.find((promotion) => promotion.id === editingId)?.orden ?? 1
      : data.promotions.length + 1;
    onSave({
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim(),
      tipo: "informativa",
      activa: form.activa,
      orden: order,
    }, editingId, reset);
  }

  return (
    <section className="staff-panel">
      <div className="staff-panel-heading"><div><p className="staff-eyebrow">{data.promotions.length} promociones</p><h2>Promociones informativas</h2></div><button className="staff-primary-button" type="button" onClick={() => { reset(); setShowForm(true); }}>Nueva promoción</button></div>
      <p className="staff-muted">Estas promociones se muestran como información; no aplican descuentos automáticos al pedido.</p>
      {showForm && (
        <form className="staff-form staff-form-grid staff-editor" onSubmit={submit}>
          <h3 className="staff-field-wide">{editingId ? "Editar promoción" : "Nueva promoción"}</h3>
          <label>Título<input required maxLength="40" value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} /></label>
          <label className="staff-check"><input type="checkbox" checked={form.activa} onChange={(event) => setForm({ ...form, activa: event.target.checked })} /> Mostrar en la tienda</label>
          <label className="staff-field-wide">Descripción<textarea required maxLength="240" rows="3" value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></label>
          <div className="staff-form-actions staff-field-wide">
            <button className="staff-primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar promoción"}</button>
            <button className="staff-secondary-button" type="button" onClick={reset}>Cancelar</button>
          </div>
        </form>
      )}
      <div className="staff-record-list">
        {data.promotions.map((promotion) => (
          <article className="staff-record" key={promotion.id}>
            <div className="staff-record-copy"><strong>{promotion.titulo}</strong><span>{promotion.descripcion}</span><span>{promotion.activa ? "Visible" : "Oculta"}</span></div>
            <div className="staff-record-actions">
              <button className="staff-secondary-button" type="button" onClick={() => edit(promotion)}>Editar</button>
              <button className="staff-danger-button" type="button" disabled={busy} onClick={() => onDelete(promotion, () => window.confirm(`¿Eliminar la promoción ${promotion.titulo}?`))}>Eliminar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StaffUserManager({ users, usersLoaded, currentUid, busy, onCreate, onUpdate, onDelete, onReset, onRefresh }) {
  const [form, setForm] = useState({ uid: "", email: "", nombre: "", rol: "seller" });
  const [drafts, setDrafts] = useState({});
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(users.map((user) => [user.uid, {
      rol: user.rol,
      nombre: user.nombre,
      activo: user.activo,
    }])));
  }, [users]);

  function submit(event) {
    event.preventDefault();
    onCreate({
      uid: form.uid.trim(),
      email: form.email.trim(),
      nombre: form.nombre.trim(),
      rol: form.rol,
    }, () => {
      setForm({ uid: "", email: "", nombre: "", rol: "seller" });
      setShowForm(false);
    });
  }

  const sortedUsers = [...users].sort((a, b) => a.email.localeCompare(b.email));
  return (
    <section className="staff-panel">
      <div className="staff-panel-heading">
        <div><p className="staff-eyebrow">{usersLoaded ? `${users.length} cuentas internas` : "Cuentas internas"}</p><h2>Administrar usuarios</h2></div>
        <div className="staff-record-actions">
          <button className="staff-secondary-button" type="button" onClick={onRefresh} disabled={busy}>Actualizar</button>
          <button className="staff-primary-button" type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Cancelar" : "Nuevo usuario"}</button>
        </div>
      </div>
      <p className="staff-muted">Primero crea la cuenta en Firebase Authentication. Luego agrega su UID y correo aquí para asignarle rol y acceso. Los clientes no necesitan cuenta.</p>
      {showForm && (
        <form className="staff-form staff-form-grid staff-editor" onSubmit={submit}>
          <h3 className="staff-field-wide">Agregar cuenta existente</h3>
          <label className="staff-field-wide">UID de Authentication<input required minLength="1" maxLength="128" autoComplete="off" value={form.uid} onChange={(event) => setForm({ ...form, uid: event.target.value })} /></label>
          <label>Correo electrónico<input type="email" autoComplete="off" required maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Nombre (opcional)<input maxLength="120" value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label>
          <label>Rol<select value={form.rol} onChange={(event) => setForm({ ...form, rol: event.target.value })}><option value="seller">Vendedor</option><option value="admin">Administrador</option></select></label>
          <div className="staff-form-actions staff-field-wide">
            <button className="staff-primary-button" type="submit" disabled={busy}>{busy ? "Agregando…" : "Agregar al personal"}</button>
            <button className="staff-secondary-button" type="button" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {sortedUsers.length === 0
        ? <p className="staff-muted">{usersLoaded ? "No hay cuentas con rol de personal." : "No se pudo cargar la lista de cuentas. Actualiza para volver a intentarlo."}</p>
        : <div className="staff-user-list">
          {sortedUsers.map((staffUser) => {
            const draft = drafts[staffUser.uid] ?? {
              rol: staffUser.rol,
              nombre: staffUser.nombre,
              activo: staffUser.activo,
            };
            const self = staffUser.uid === currentUid;
            const changed = draft.rol !== staffUser.rol ||
              draft.nombre !== staffUser.nombre ||
              draft.activo !== staffUser.activo;
            return (
              <article className="staff-user-card" key={staffUser.uid}>
                <div className="staff-user-heading">
                  <div className="staff-record-copy">
                    <strong>{staffUser.email}{self ? " · Tú" : ""}</strong>
                    <span>UID: {staffUser.uid}</span>
                    <span>{staffUser.emailVerified ? "Correo verificado" : "Correo pendiente de verificación"} · Alta: {staffUser.createdAt ? new Date(staffUser.createdAt).toLocaleDateString("es-CO") : "—"}</span>
                    <span>{staffUser.lastSignInAt ? `Último ingreso: ${new Date(staffUser.lastSignInAt).toLocaleString("es-CO")}` : "Aún no ha iniciado sesión"}</span>
                  </div>
                  <span className={`staff-status ${!draft.activo ? "staff-status-disabled" : "staff-status-entregado"}`}>{draft.activo ? "Activo" : "Acceso desactivado"}</span>
                </div>
                <div className="staff-user-controls">
                  <label>Nombre
                    <input maxLength="120" value={draft.nombre} onChange={(event) => setDrafts((current) => ({ ...current, [staffUser.uid]: { ...draft, nombre: event.target.value } }))} />
                  </label>
                  <label>Rol
                    <select value={draft.rol} disabled={self} onChange={(event) => setDrafts((current) => ({ ...current, [staffUser.uid]: { ...draft, rol: event.target.value } }))}>
                      <option value="seller">Vendedor</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>
                  <label className="staff-check"><input type="checkbox" checked={draft.activo} disabled={self} onChange={(event) => setDrafts((current) => ({ ...current, [staffUser.uid]: { ...draft, activo: event.target.checked } }))} /> Acceso activo</label>
                </div>
                <div className="staff-user-actions">
                  <button className="staff-primary-button" type="button" disabled={!changed || busy || self} onClick={() => onUpdate(staffUser.uid, draft)}>Guardar cambios</button>
                  <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => onReset(staffUser)}>Enviar restablecimiento de contraseña</button>
                  <button className="staff-danger-button" type="button" disabled={busy || self || staffUser.perfilPendiente || !staffUser.activo} onClick={() => onDelete(staffUser)}>Quitar acceso</button>
                </div>
              </article>
            );
          })}
        </div>}
    </section>
  );
}

function OrderList({ orders, products }) {
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  if (!orders.length) return <section className="staff-panel"><div className="staff-panel-heading"><div><p className="staff-eyebrow">Pedidos recibidos</p><h2>Pedidos</h2></div></div><p className="staff-muted">Todavía no hay pedidos registrados.</p></section>;
  return (
    <section className="staff-panel">
      <div className="staff-panel-heading"><div><p className="staff-eyebrow">{orders.length} pedidos</p><h2>Pedidos recibidos</h2></div></div>
      <div className="staff-order-list">
        {orders.map((order) => (
          <article className="staff-order" key={order.id}>
            <header><div><strong>Pedido {order.id}</strong><span>{formatDate(order.creadoEn)}</span></div><span className={`staff-status staff-status-${order.estado ?? "pendiente"}`}>{order.estado ?? "pendiente"}</span></header>
            <div className="staff-order-customer"><strong>{order.cliente?.nombre || "Cliente"}</strong><a href={`tel:${order.cliente?.telefono ?? ""}`}>{order.cliente?.telefono || "Sin teléfono"}</a></div>
            {order.preciosVerificados === false && <p className="staff-order-unverified">Solicitud recibida desde la tienda. Verifica los productos y precios del catálogo antes de confirmar el total con el cliente.</p>}
            <ul>{(order.items ?? []).map((item, index) => {
              const product = productsById.get(String(item.productoId));
              const name = item.nombre ?? product?.nombre ?? `Producto ${item.productoId}`;
              const lineTotal = order.preciosVerificados === false ? null : item.totalLinea;
              return <li key={`${item.productoId}-${item.tamano}-${index}`}><span>{item.cantidad} × {name} · {item.tamano}</span><strong>{lineTotal == null ? "Por validar" : formatPrice(lineTotal)}</strong></li>;
            })}</ul>
            {order.notas && <p className="staff-order-notes"><strong>Notas / dirección:</strong> {order.notas}</p>}
            <footer><span>{order.metodoPago}</span><strong>{order.preciosVerificados === false ? "Total por validar" : `Total ${formatPrice(order.total)}`}</strong></footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReadOnlyCatalog({ data }) {
  const products = data.products.filter((product) => product.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return (
    <section className="staff-panel">
      <div className="staff-panel-heading"><div><p className="staff-eyebrow">{products.length} productos publicados</p><h2>Catálogo</h2></div></div>
      <div className="staff-record-list">
        {products.map((product) => (
          <article className="staff-record" key={product.id}>
            <div className="staff-record-copy"><strong>{product.nombre}</strong><span>Ref. {product.referencia} · {data.categories.find((category) => category.id === product.categoriaId)?.nombre ?? "Sin categoría"}</span><span>{product.descripcion}</span></div>
            <strong className="staff-product-price">{formatPrice(product.precio)}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function StaffPortal() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [data, setData] = useState(null);
  const [staffUsers, setStaffUsers] = useState([]);
  const [staffUsersLoaded, setStaffUsersLoaded] = useState(false);
  const [tab, setTab] = useState("orders");
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadData(staffRole = role) {
    const staffData = await getStaffData(staffRole);
    setData(staffData);
  }

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    const unsubscribe = observeStaffAuth(async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setData(null);
      setRole(null);
      setError("");
      setNotice("");
      if (!nextUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const nextRole = await getStaffRole(nextUser);
        if (!active) return;
        if (!nextRole) {
          setError("Esta cuenta no tiene un rol de personal asignado. Contacta al administrador.");
          return;
        }
        setRole(nextRole);
        setTab(nextRole === "seller" ? "orders" : "products");
        const staffData = await getStaffData(nextRole);
        if (active) setData(staffData);
      } catch (loadError) {
        console.error("No se pudo cargar el portal del personal:", loadError);
        if (active) setError(loadError.message || "No se pudo cargar la información del personal.");
      } finally {
        if (active) setLoading(false);
      }
    }, (authError) => {
      console.error("No se pudo comprobar la sesión del personal:", authError);
      if (active) {
        setError(authError.message || "No se pudo comprobar la sesión.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function login(email, password) {
    setLoginBusy(true);
    setError("");
    try {
      await signInStaff(email, password);
    } catch (loginError) {
      console.error("No se pudo iniciar sesión del personal:", loginError);
      const message = loginError.code === "auth/invalid-credential"
        ? "Correo o contraseña incorrectos."
        : loginError.message || "No se pudo iniciar sesión.";
      setError(message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function perform(action, successMessage, onSuccess) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await loadData();
      if (onSuccess) onSuccess();
      setNotice(successMessage);
    } catch (actionError) {
      console.error("No se pudo completar la operación del personal:", actionError);
      setError(actionError.message || "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshStaffUsers() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setStaffUsers(await getStaffUsers(user));
      setStaffUsersLoaded(true);
    } catch (loadError) {
      console.error("No se pudo cargar las cuentas del personal:", loadError);
      setError(loadError.message || "No se pudo cargar las cuentas del personal.");
    } finally {
      setBusy(false);
    }
  }

  async function createStaffUser(values, onSuccess) {
    await manageStaffProfileChange(
      () => createStaffUserProfile(values),
      "Perfil de personal agregado. Envía un correo de restablecimiento para que la persona establezca su contraseña.",
      onSuccess,
    );
  }

  async function updateStaffUser(uid, updates) {
    if (staffUsers.find((staffUser) => staffUser.uid === uid)?.perfilPendiente) {
      setError("El administrador principal se conserva desde Firebase Authentication y no se edita aquí.");
      return;
    }
    const { activo, nombre, rol } = updates;
    await manageStaffProfileChange(
      () => updateStaffUserProfile(uid, { activo, nombre, rol }),
      "Perfil del personal actualizado.",
    );
  }

  async function deleteStaffUser(staffUser) {
    if (staffUser.perfilPendiente) {
      setError("El administrador principal se conserva desde Firebase Authentication y no se puede quitar aquí.");
      return;
    }
    if (!window.confirm(`¿Desactivar el acceso de personal de ${staffUser.email}? La cuenta de Authentication y los pedidos se conservarán.`)) return;
    await manageStaffProfileChange(
      () => deactivateStaffUserProfile(staffUser.uid),
      "Acceso de personal desactivado. La cuenta de Authentication y los pedidos existentes se conservaron.",
    );
  }

  async function resetStaffPassword(staffUser) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await sendStaffPasswordReset(staffUser.email);
      setNotice(`Se solicitó a Firebase un correo de restablecimiento para ${staffUser.email}.`);
    } catch (resetError) {
      console.error("No se pudo solicitar el correo de contraseña:", resetError);
      setError(resetError.message || "No se pudo solicitar el correo de restablecimiento.");
    } finally {
      setBusy(false);
    }
  }

  async function manageStaffProfileChange(action, successMessage, onSuccess) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setStaffUsers(await getStaffUsers(user));
      setStaffUsersLoaded(true);
      if (onSuccess) onSuccess();
      setNotice(successMessage);
    } catch (actionError) {
      console.error("No se pudo administrar el perfil del personal:", actionError);
      setError(actionError.message || "No se pudo administrar el perfil del personal.");
      try {
        setStaffUsers(await getStaffUsers(user));
        setStaffUsersLoaded(true);
      } catch (refreshError) {
        console.error("No se pudo actualizar la lista después de la operación:", refreshError);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(product, productId, onSuccess) {
    if (!product) {
      setError(productId);
      return;
    }
    await perform(() => saveStaffProduct(product, productId), "Producto guardado.", onSuccess);
  }

  async function deleteProduct(product, confirmDelete) {
    if (!confirmDelete()) return;
    await perform(() => removeStaffProduct(product.id), "Producto eliminado.");
  }

  async function saveCategory(category, categoryId, onSuccess) {
    if (!category) {
      setError(categoryId);
      return;
    }
    const id = categoryId || toSlug(category.nombre);
    if (!id) {
      setError("El nombre de la categoría debe contener letras o números.");
      return;
    }
    await perform(() => saveStaffCategory(category, id), "Categoría guardada.", onSuccess);
  }

  async function deleteCategory(category, confirmDelete) {
    if (data.products.some((product) => product.categoriaId === category.id)) {
      setError("No se puede eliminar esta categoría: primero reasigna o elimina sus productos.");
      return;
    }
    if (!confirmDelete()) return;
    await perform(() => removeStaffCategory(category.id), "Categoría eliminada.");
  }

  async function savePromotion(promotion, promotionId, onSuccess) {
    if (!promotion) {
      setError(promotionId);
      return;
    }
    await perform(() => saveStaffPromotion(promotion, promotionId), "Promoción guardada.", onSuccess);
  }

  async function deletePromotion(promotion, confirmDelete) {
    if (!confirmDelete()) return;
    await perform(() => removeStaffPromotion(promotion.id), "Promoción eliminada.");
  }

  async function saveStore(settings, validationError) {
    if (!settings) {
      setError(validationError);
      return;
    }
    await perform(() => saveStoreSettings(settings), "Configuración actualizada.");
  }

  async function logout() {
    try {
      await signOutStaff();
    } catch (logoutError) {
      console.error("No se pudo cerrar la sesión del personal:", logoutError);
      setError(logoutError.message || "No se pudo cerrar la sesión.");
    }
  }

  if (loading) {
    return <main className="staff-screen"><section className="staff-login-card"><span className="staff-brand-mark">🍕</span><div className="staff-spinner" /><p>Verificando acceso al portal…</p></section></main>;
  }

  if (!user) {
    return <StaffLogin onLogin={login} error={error} busy={loginBusy} />;
  }
  if (!role) {
    return <StaffStatus
      title="Sin rol de personal"
      message={error || "Esta cuenta no tiene un rol de personal asignado."}
      actionLabel="Cerrar sesión"
      onAction={logout}
    />;
  }
  if (!data) {
    return <StaffStatus
      title="No se pudo cargar el portal"
      message={error || "No se pudo cargar la información del personal."}
      actionLabel="Reintentar"
      onAction={async () => {
        setLoading(true);
        setError("");
        try {
          await loadData(role);
        } catch (loadError) {
          console.error("No se pudo volver a cargar el portal del personal:", loadError);
          setError(loadError.message || "No se pudo cargar la información del personal.");
        } finally {
          setLoading(false);
        }
      }}
    />;
  }

  const isAdmin = role === "admin";
  const tabs = isAdmin
    ? [["orders", "Pedidos"], ["products", "Productos"], ["categories", "Categorías"], ["promotions", "Promociones"], ["store", "Tienda"], ["users", "Usuarios"]]
    : [["orders", "Pedidos"], ["products", "Catálogo"]];

  return (
    <main className="staff-app">
      <header className="staff-topbar">
        <a className="staff-topbar-brand" href="/"><span>🍕</span> Forno Bello</a>
        <div className="staff-session">
          <span>{user.email} · {isAdmin ? "Administrador" : "Vendedor"}</span>
          <button className="staff-secondary-button" type="button" onClick={logout}>Cerrar sesión</button>
        </div>
      </header>
      <div className="staff-content">
        <div className="staff-welcome"><div><p className="staff-eyebrow">Panel de {isAdmin ? "administración" : "ventas"}</p><h1>{isAdmin ? "Gestión de la tienda" : "Pedidos y catálogo"}</h1></div></div>
        <nav className="staff-tabs" aria-label="Secciones del personal">
          {tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? "selected" : ""} onClick={() => { setTab(id); setError(""); setNotice(""); if (id === "users" && !staffUsersLoaded) void refreshStaffUsers(); }}>{label}</button>)}
        </nav>
        {error && <div className="staff-alert" role="alert">{error}</div>}
        {notice && <div className="staff-success" role="status">{notice}</div>}
        {tab === "orders" && <OrderList orders={data.orders} products={data.products} />}
        {tab === "products" && (isAdmin
          ? <ProductManager data={data} busy={busy} onSave={saveProduct} onDelete={deleteProduct} />
          : <ReadOnlyCatalog data={data} />)}
        {isAdmin && tab === "categories" && <CategoryManager data={data} busy={busy} onSave={saveCategory} onDelete={deleteCategory} />}
        {isAdmin && tab === "promotions" && <PromotionManager data={data} busy={busy} onSave={savePromotion} onDelete={deletePromotion} />}
        {isAdmin && tab === "store" && <StoreSettings store={data.store} busy={busy} onSave={saveStore} />}
        {isAdmin && tab === "users" && <StaffUserManager
          users={staffUsers}
          usersLoaded={staffUsersLoaded}
          currentUid={user.uid}
          busy={busy}
          onCreate={createStaffUser}
          onUpdate={updateStaffUser}
          onDelete={deleteStaffUser}
          onReset={resetStaffPassword}
          onRefresh={refreshStaffUsers}
        />}
      </div>
    </main>
  );
}
