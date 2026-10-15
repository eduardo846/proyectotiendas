import { useEffect, useMemo, useRef, useState } from "react";
import localCatalog from "../catalogo.json";
import {
  getStoreData,
  isAppCheckConfigured,
  isFirebaseConfigured,
  saveOrder,
} from "./firebase.js";

const normalize = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const formatPrice = (amount) => `$${Math.round(amount).toLocaleString("es-CO")}`;

function getTotals(cart, products, store) {
  const items = Object.values(cart);
  const subtotal = items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return sum + product.precio * item.quantity;
  }, 0);
  const delivery = subtotal >= store.envioGratis ? 0 : store.costoEnvio;
  return { count: items.reduce((sum, item) => sum + item.quantity, 0), subtotal, delivery, total: subtotal + delivery };
}

export default function App() {
  const [data, setData] = useState(isFirebaseConfigured ? null : localCatalog);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [backendIssue, setBackendIssue] = useState(
    isFirebaseConfigured ? "" : "Vista previa local: Firebase no está conectado.",
  );
  const [category, setCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [selectedSizes, setSelectedSizes] = useState({});
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [modalProduct, setModalProduct] = useState(null);
  const [modalSize, setModalSize] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", payment: "", notes: "" });
  const [toast, setToast] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const categoryNavRef = useRef(null);
  const [categoryScroll, setCategoryScroll] = useState({ left: false, right: false });

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    getStoreData()
      .then((storeData) => {
        if (active) {
          setData(storeData);
          setFirestoreReady(true);
          setBackendIssue("");
        }
      })
      .catch((error) => {
        console.error("No se pudo cargar el catálogo de Firestore:", error);
        if (active) {
          setData(localCatalog);
          setFirestoreReady(false);
          setBackendIssue(
            "Firestore no está disponible. Puedes explorar el catálogo, pero los pedidos quedan deshabilitados hasta crear la base de datos y cargar el menú.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!cartOpen && !modalProduct && !lightboxOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (lightboxOpen) setLightboxOpen(false);
        else if (modalProduct) setModalProduct(null);
        else setCartOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cartOpen, lightboxOpen, modalProduct]);

  const store = data?.tienda;
  const products = data?.productos ?? [];
  const totals = useMemo(
    () => (store ? getTotals(cart, products, store) : { count: 0, subtotal: 0, delivery: 0, total: 0 }),
    [cart, products, store],
  );

  useEffect(() => {
    if (totals.count === 0) setCartOpen(false);
  }, [totals.count]);

  const filteredProducts = useMemo(() => {
    const searchTerm = normalize(query.trim());
    return products.filter((product) => {
      const categoryMatches = category === "Todos" || product.categoria === category;
      const searchMatches =
        !searchTerm ||
        [product.nombre, product.descripcion, product.categoria, product.referencia]
          .some((field) => normalize(field ?? "").includes(searchTerm));
      return categoryMatches && searchMatches;
    });
  }, [category, products, query]);

  useEffect(() => {
    const nav = categoryNavRef.current;
    if (!nav) return undefined;

    const updateScrollButtons = () => {
      setCategoryScroll({
        left: nav.scrollLeft > 1,
        right: nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 1,
      });
    };
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(nav);
    nav.addEventListener("scroll", updateScrollButtons, { passive: true });
    updateScrollButtons();

    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", updateScrollButtons);
    };
  }, [data]);

  function scrollCategories(direction) {
    categoryNavRef.current?.scrollBy({
      left: direction * Math.max(160, categoryNavRef.current.clientWidth * 0.75),
      behavior: "smooth",
    });
  }

  function addProduct(product, size) {
    const key = `${product.id}_${size}`;
    setCart((current) => ({
      ...current,
      [key]: { id: product.id, size, quantity: (current[key]?.quantity ?? 0) + 1 },
    }));
    setToast(`¡${product.nombre} agregado al pedido!`);
  }

  function changeQuantity(key, change) {
    setCart((current) => {
      const quantity = (current[key]?.quantity ?? 0) + change;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: { ...current[key], quantity } };
    });
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!totals.count || submitting) return;
    if (!firestoreReady) {
      setToast("Firestore no está disponible para guardar el pedido.");
      return;
    }
    const phone = form.phone.trim();
    if (phone.length < 7) {
      setToast("Ingresa un número de contacto válido.");
      return;
    }
    if (!form.payment) {
      setToast("Elige un método de pago.");
      return;
    }
    if (!isFirebaseConfigured) {
      setToast("Conecta Firebase para guardar y enviar el pedido.");
      return;
    }

    const whatsappWindow = window.open("", "_blank");
    if (!whatsappWindow) {
      setToast("Permite las ventanas emergentes para continuar a WhatsApp.");
      return;
    }

    setSubmitting(true);
    const requestedItems = Object.values(cart).map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      return {
        productoId: String(product.id),
        tamano: item.size,
        cantidad: item.quantity,
      };
    });

    try {
      const order = await saveOrder({
        cliente: { nombre: form.name.trim(), telefono: phone },
        items: requestedItems,
        metodoPago: form.payment,
        ...(form.notes.trim() ? { notas: form.notes.trim() } : {}),
      });
      const message = [
        `🍕 *Nuevo pedido — ${store.nombre}*`,
        "",
        ...(form.name.trim() ? [`👤 *Cliente:* ${form.name.trim()}`] : []),
        `📱 *Contacto:* ${phone}`,
        `💳 *Pago:* ${form.payment}`,
        "",
        "*Detalle:*",
        ...order.items.map((item) =>
          `• ${item.nombre} (Ref. ${item.referencia} · Tamaño ${item.tamano}) x${item.cantidad} — ${formatPrice(item.totalLinea)}`,
        ),
        "",
        `🚚 *Envío:* ${order.envio === 0 ? "Gratis" : formatPrice(order.envio)}`,
        `💰 *Total:* ${formatPrice(order.total)}`,
        ...(form.notes.trim() ? ["", `📝 *Notas:* ${form.notes.trim()}`] : []),
        `\n_N.º pedido: ${order.id}_`,
        `_Pedido desde ${store.nombre} Online_ 🍕`,
      ].join("\n");
      whatsappWindow.opener = null;
      whatsappWindow.location.href =
        `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(message)}`;
    } catch (error) {
      whatsappWindow.close();
      console.error("No se pudo guardar el pedido en Firestore:", error);
      setToast(error.message || "No se pudo guardar el pedido. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) {
    return (
      <main className="status-screen">
        <section className="status-card" aria-live="polite">
          <span className="brand-mark" aria-hidden="true">🍕</span>
          <div className="spinner" />
          <p>Cargando catálogo desde Firestore…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="store-card" aria-label={store.nombre}>
        <header className="hero">
          <span className="hero-kicker">{store.descripcion}</span>
          <div className="brand-mark" aria-label={store.nombre}>🍕</div>
          <h1>{store.nombre}</h1>
          <p className="hero-tagline">{store.slogan}</p>
          <div className="hero-facts">
            <span>🚚 {store.tiempoEntrega}</span>
            <span>📦 Envío gratis desde {formatPrice(store.envioGratis)}</span>
            <span>⭐ {store.rating} · {store.pedidos} pedidos</span>
          </div>
        </header>

        {backendIssue && (
          <aside className="setup-notice" role="status">
            {backendIssue}
          </aside>
        )}

        {store.promoTexto && (
          <div className="promo">
            <span aria-hidden="true">🔥</span>
            <span>{store.promoTexto}</span>
            <strong>{store.promoBadge}</strong>
          </div>
        )}

        <div className="category-bar">
          <button
            className={`category-scroll-button${categoryScroll.left ? "" : " is-hidden"}`}
            type="button"
            aria-label="Desplazar categorías a la izquierda"
            aria-hidden={!categoryScroll.left}
            disabled={!categoryScroll.left}
            onClick={() => scrollCategories(-1)}
          >
            ‹
          </button>
          <nav className="category-tabs" aria-label="Categorías" ref={categoryNavRef}>
            {["Todos", ...data.categorias].map((item) => (
              <button
                className={`category-tab${category === item ? " selected" : ""}`}
                key={item}
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
              >
                {item}
              </button>
            ))}
          </nav>
          <button
            className={`category-scroll-button${categoryScroll.right ? "" : " is-hidden"}`}
            type="button"
            aria-label="Desplazar categorías a la derecha"
            aria-hidden={!categoryScroll.right}
            disabled={!categoryScroll.right}
            onClick={() => scrollCategories(1)}
          >
            ›
          </button>
        </div>

        <section className="catalog-section" aria-label="Catálogo de pizzas">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Buscar por nombre o código…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar productos"
            />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">×</button>}
          </label>
          {query && <p className="search-count">{filteredProducts.length} resultado(s)</p>}
          {filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product) => {
                const size = selectedSizes[product.id] ?? store.tamanos[0];
                return (
                  <article className="product-card" key={product.id}>
                    <button
                      className="product-image"
                      type="button"
                      onClick={() => { setModalProduct(product); setModalSize(size); }}
                      aria-label={`Ver ${product.nombre}`}
                    >
                      {product.popular && <span className="popular-badge">★ Popular</span>}
                      <img
                        src={product.imagen}
                        alt={product.nombre}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                          event.currentTarget.nextElementSibling.style.display = "grid";
                        }}
                      />
                      <span className="image-fallback" aria-hidden="true">🍕</span>
                    </button>
                    <div className="product-content">
                      <h2>{product.nombre}</h2>
                      <span className="product-reference">Ref. {product.referencia}</span>
                      <p className="product-description">{product.descripcion}</p>
                      <div className="size-options" aria-label={`Tamaño para ${product.nombre}`}>
                        {store.tamanos.map((option) => (
                          <button
                            key={option}
                            className={`size-chip${size === option ? " selected" : ""}`}
                            type="button"
                            onClick={() => setSelectedSizes((current) => ({ ...current, [product.id]: option }))}
                            aria-pressed={size === option}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      <div className="product-footer">
                        <strong>{formatPrice(product.precio)}</strong>
                        <button
                          className="add-button"
                          type="button"
                          onClick={() => addProduct(product, size)}
                          aria-label={`Agregar ${product.nombre} al pedido`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="no-results">
              <span aria-hidden="true">🔎</span>
              <strong>Sin resultados</strong>
              <p>No encontramos productos para esa búsqueda o categoría.</p>
            </div>
          )}
        </section>

        <footer className="store-footer">
          🍕 {store.nombre} · Pizza artesanal a domicilio 🍕
          <a href="/staff">Acceso del personal</a>
        </footer>
      </section>

      {totals.count > 0 && (
        <div className="cart-dock">
          <div>
            <span>{totals.count} {totals.count === 1 ? "producto" : "productos"} en tu pedido</span>
            <strong>Total {formatPrice(totals.total)}</strong>
          </div>
          <button type="button" onClick={() => setCartOpen(true)}>Ver pedido</button>
        </div>
      )}

      {cartOpen && (
        <div className="drawer-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCartOpen(false);
        }}>
          <section className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <header className="drawer-header">
              <h2 id="cart-title">Resumen del pedido</h2>
              <span className="cart-count">{totals.count}</span>
              <button type="button" className="icon-button" onClick={() => setCartOpen(false)} aria-label="Cerrar pedido">×</button>
            </header>
            <div className="cart-items">
              {Object.entries(cart).map(([key, item]) => {
                const product = products.find((entry) => entry.id === item.id);
                return (
                  <article className="cart-item" key={key}>
                    <div className="cart-item-image">
                      <img
                        src={product.imagen}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                          event.currentTarget.nextElementSibling.style.display = "grid";
                        }}
                      />
                      <span aria-hidden="true">🍕</span>
                    </div>
                    <div className="cart-item-info">
                      <strong>{product.nombre}</strong>
                      <span>{item.size} · Ref. {product.referencia}</span>
                      <b>{formatPrice(product.precio * item.quantity)}</b>
                    </div>
                    <div className="quantity-control">
                      <button type="button" onClick={() => changeQuantity(key, -1)} aria-label={`Quitar una ${product.nombre}`}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => changeQuantity(key, 1)} aria-label={`Agregar una ${product.nombre}`}>+</button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="order-totals">
              <div><span>Subtotal</span><span>{formatPrice(totals.subtotal)}</span></div>
              <div><span>Envío</span><span>{totals.delivery ? formatPrice(totals.delivery) : "Gratis"}</span></div>
              <div className="grand-total"><strong>Total</strong><strong>{formatPrice(totals.total)}</strong></div>
            </div>
            <form className="checkout-form" onSubmit={submitOrder}>
              <label>Tu nombre *
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej: María García" autoComplete="name" required />
              </label>
              <label>Número de contacto *
                <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Ej: 300 123 4567" autoComplete="tel" required />
              </label>
              <fieldset>
                <legend>Método de pago *</legend>
                <div className="payment-options">
                  {["Nequi", "Transferencia", "Efectivo"].map((payment) => (
                    <button
                      className={form.payment === payment ? "selected" : ""}
                      key={payment}
                      type="button"
                      onClick={() => setForm({ ...form, payment })}
                      aria-pressed={form.payment === payment}
                    >
                      {payment}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>Dirección de entrega y notas
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Dirección, apartamento u observaciones" maxLength={1000} />
              </label>
              <button className="whatsapp-button" type="submit" disabled={submitting || !firestoreReady || !isAppCheckConfigured}>
                {submitting ? "Guardando pedido…" : !firestoreReady ? "Firestore no está disponible" : !isAppCheckConfigured ? "Configura App Check para confirmar" : "Guardar y continuar por WhatsApp"}
              </button>
            </form>
          </section>
        </div>
      )}

      {modalProduct && (
        <div className="product-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModalProduct(null);
        }}>
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
            <button className="modal-close" type="button" onClick={() => setModalProduct(null)} aria-label="Cerrar">×</button>
            <button className="modal-image" type="button" onClick={() => setLightboxOpen(true)} aria-label="Ampliar imagen">
              <img src={modalProduct.imagen} alt={modalProduct.nombre} />
            </button>
            <h2 id="product-modal-title">{modalProduct.nombre}</h2>
            <p className="product-reference">Ref. {modalProduct.referencia}</p>
            <strong className="modal-price">{formatPrice(modalProduct.precio)}</strong>
            <h3>Elige el tamaño</h3>
            <div className="size-options">
              {store.tamanos.map((size) => (
                <button className={`size-chip${modalSize === size ? " selected" : ""}`} key={size} type="button" onClick={() => setModalSize(size)} aria-pressed={modalSize === size}>{size}</button>
              ))}
            </div>
            <button className="primary-button" type="button" onClick={() => {
              addProduct(modalProduct, modalSize);
              setSelectedSizes((current) => ({ ...current, [modalProduct.id]: modalSize }));
              setModalProduct(null);
            }}>
              Agregar al pedido
            </button>
          </section>
        </div>
      )}

      {lightboxOpen && modalProduct && (
        <div className="lightbox" role="presentation" onMouseDown={() => setLightboxOpen(false)}>
          <button type="button" onClick={() => setLightboxOpen(false)} aria-label="Cerrar imagen">×</button>
          <img src={modalProduct.imagen} alt={modalProduct.nombre} />
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
