import { catalog, expect, getOrders, LEGACY_PRODUCT, MEDIUM_ONLY_PRODUCT, priceOf, test } from "./fixtures.mjs";

const price = (amount) => `$${amount.toLocaleString("es-CO")}`;
const { envioGratis, costoEnvio } = catalog.tienda;

const productCard = (page, name) => page.locator("article.product-card")
  .filter({ has: page.getByRole("heading", { name, exact: true }) });

async function addToCart(page, name, size = "Personal") {
  const card = productCard(page, name);
  await card.getByRole("button", { name: size, exact: true }).click();
  await card.getByRole("button", { name: `Agregar ${name} al pedido` }).click();
}

async function openCheckout(page) {
  await page.getByRole("button", { name: "Ver pedido" }).click();
  return page.getByRole("dialog", { name: "Resumen del pedido" });
}

async function fillCheckout(drawer, { name = "María García", phone = "300 123 4567", payment = "Nequi", notes } = {}) {
  await drawer.getByLabel("Tu nombre").fill(name);
  await drawer.getByLabel("Número de contacto").fill(phone);
  if (payment) await drawer.getByRole("button", { name: payment, exact: true }).click();
  if (notes) await drawer.getByLabel("Dirección de entrega y notas").fill(notes);
}

test.describe("Catálogo", () => {
  test("carga tienda, promoción y productos activos desde Firestore", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: catalog.tienda.nombre })).toBeVisible();
    await expect(page.locator(".setup-notice")).toHaveCount(0);
    await expect(page.locator(".promo")).toContainText(catalog.tienda.promoTexto);
    await expect(page.locator("article.product-card")).toHaveCount(catalog.productos.length);
    await expect(page.getByText("Pizza Retirada")).toHaveCount(0);
  });

  test("filtra por categoría", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Categorías" }).getByRole("button", { name: "Picantes" }).click();
    const expected = catalog.productos.filter((product) => product.categoria === "Picantes");
    await expect(page.locator("article.product-card")).toHaveCount(expected.length);
    await expect(page.getByRole("heading", { name: expected[0].nombre })).toBeVisible();
  });

  test("busca por referencia y sin tildes, y muestra el estado vacío", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Buscar productos" });
    await search.fill("fb-113");
    await expect(page.locator("article.product-card")).toHaveCount(1);
    await search.fill("diavola");
    await expect(page.getByRole("heading", { name: "Pizza Diávola" })).toBeVisible();
    await search.fill("sushi");
    await expect(page.getByText("Sin resultados")).toBeVisible();
    await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
    await expect(page.locator("article.product-card")).toHaveCount(catalog.productos.length);
  });
});

test.describe("Carrito", () => {
  test("suma productos, cobra envío y lo vuelve gratis desde el mínimo", async ({ page }) => {
    const pepperoni = priceOf("Pizza Pepperoni", "Familiar");
    await page.goto("/");
    await addToCart(page, "Pizza Pepperoni", "Familiar");
    await expect(page.locator(".cart-dock")).toContainText("1 producto en tu pedido");
    await expect(page.locator(".cart-dock")).toContainText(`Total ${price(pepperoni + costoEnvio)}`);

    const drawer = await openCheckout(page);
    await expect(drawer.locator(".cart-item")).toContainText("Familiar · Ref. FB-102");
    const quantity = Math.ceil(envioGratis / pepperoni);
    for (let count = 1; count < quantity; count += 1) {
      await drawer.getByRole("button", { name: "Agregar una Pizza Pepperoni" }).click();
    }
    await expect(drawer.locator(".order-totals")).toContainText("EnvíoGratis");
    await expect(drawer.locator(".grand-total")).toContainText(price(pepperoni * quantity));
  });

  test("quitar la última unidad vacía el carrito y cierra el resumen", async ({ page }) => {
    await page.goto("/");
    await addToCart(page, "Pizza Funghi");
    const drawer = await openCheckout(page);
    await drawer.getByRole("button", { name: "Quitar una Pizza Funghi" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator(".cart-dock")).toBeHidden();
  });

  test("el detalle del producto agrega el tamaño elegido", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ver Pizza Capricciosa" }).click();
    const modal = page.getByRole("dialog", { name: "Pizza Capricciosa" });
    await modal.getByRole("button", { name: "Mediana" }).click();
    await modal.getByRole("button", { name: "Agregar al pedido" }).click();
    await expect(modal).toBeHidden();
    const drawer = await openCheckout(page);
    await expect(drawer.locator(".cart-item")).toContainText("Mediana · Ref. FB-108");
  });
});

test.describe("Solicitud de pedido", () => {
  test("pide método de pago antes de enviar", async ({ page }) => {
    await page.goto("/");
    await addToCart(page, "Pizza Margarita");
    const drawer = await openCheckout(page);
    await fillCheckout(drawer, { payment: null });
    await drawer.getByRole("button", { name: "Guardar solicitud y continuar por WhatsApp" }).click();
    await expect(page.locator(".toast")).toHaveText("Elige un método de pago.");
    expect(await getOrders()).toHaveLength(0);
  });

  test("guarda la solicitud, abre WhatsApp con el detalle y limpia el carrito", async ({ page }) => {
    await page.goto("/");
    await addToCart(page, "Pizza Pepperoni", "Familiar");
    await addToCart(page, "Pizza Pepperoni", "Familiar");
    await addToCart(page, "Pizza Funghi", "Personal");
    const drawer = await openCheckout(page);
    await fillCheckout(drawer, { payment: "Transferencia", notes: "Cra 7 # 45-10, apto 301" });

    const popupPromise = page.waitForEvent("popup");
    await drawer.getByRole("button", { name: "Guardar solicitud y continuar por WhatsApp" }).click();
    const popup = await popupPromise;
    await popup.waitForURL(/^https:\/\/wa\.me\//);

    const [order] = await getOrders();
    expect(order).toMatchObject({
      cliente: { nombre: "María García", telefono: "300 123 4567" },
      items: [
        { productoId: "2", tamano: "Familiar", cantidad: 2 },
        { productoId: "9", tamano: "Personal", cantidad: 1 },
      ],
      metodoPago: "Transferencia",
      notas: "Cra 7 # 45-10, apto 301",
      estado: "pendiente_revision",
      preciosVerificados: false,
    });

    const url = new URL(popup.url());
    expect(url.pathname).toBe(`/${catalog.tienda.whatsapp}`);
    const message = url.searchParams.get("text");
    const pepperoniTotal = priceOf("Pizza Pepperoni", "Familiar") * 2;
    const funghiTotal = priceOf("Pizza Funghi", "Personal");
    expect(message).toContain(`Pizza Pepperoni (Ref. FB-102 · Tamaño Familiar) x2 — ${price(pepperoniTotal)}`);
    expect(message).toContain(`Pizza Funghi (Ref. FB-109 · Tamaño Personal) x1 — ${price(funghiTotal)}`);
    expect(message).toContain(`Total estimado:* ${price(pepperoniTotal + funghiTotal)}`);
    expect(message).toContain("Cra 7 # 45-10, apto 301");
    expect(message).toContain(`Referencia de solicitud: ${order.id}`);

    await expect(page.locator(".cart-dock")).toBeHidden();
  });

  test("acepta el máximo de 15 líneas distintas", async ({ page }) => {
    await page.goto("/");
    for (const product of catalog.productos.slice(0, 5)) {
      for (const size of catalog.tienda.tamanos) await addToCart(page, product.nombre, size);
    }
    const drawer = await openCheckout(page);
    await fillCheckout(drawer);
    const popupPromise = page.waitForEvent("popup");
    await drawer.getByRole("button", { name: "Guardar solicitud y continuar por WhatsApp" }).click();
    await (await popupPromise).waitForURL(/wa\.me/);
    const [order] = await getOrders();
    expect(order.items).toHaveLength(15);
  });

  test("rechaza 16 líneas con un mensaje claro y conserva el carrito", async ({ page }) => {
    await page.goto("/");
    for (const product of catalog.productos.slice(0, 6)) {
      for (const size of catalog.tienda.tamanos) await addToCart(page, product.nombre, size);
    }
    const drawer = await openCheckout(page);
    await fillCheckout(drawer);
    await drawer.getByRole("button", { name: "Guardar solicitud y continuar por WhatsApp" }).click();
    await expect(page.locator(".toast")).toContainText("hasta 15 productos distintos");
    expect(await getOrders()).toHaveLength(0);
    await expect(drawer.locator(".cart-item")).toHaveCount(18);
  });
});

test.describe("Precios por tamaño", () => {
  test("el precio cambia con el tamaño en la tarjeta, el detalle y el carrito", async ({ page }) => {
    await page.goto("/");
    const card = productCard(page, "Pizza Pepperoni");
    for (const size of catalog.tienda.tamanos) {
      await card.getByRole("button", { name: size, exact: true }).click();
      await expect(card.locator(".product-footer strong")).toHaveText(price(priceOf("Pizza Pepperoni", size)));
    }

    await page.getByRole("button", { name: "Ver Pizza Pepperoni" }).click();
    const modal = page.getByRole("dialog", { name: "Pizza Pepperoni" });
    await modal.getByRole("button", { name: "Personal" }).click();
    await expect(modal.locator(".modal-price")).toHaveText(price(priceOf("Pizza Pepperoni", "Personal")));
    await modal.getByRole("button", { name: "Agregar al pedido" }).click();

    await addToCart(page, "Pizza Pepperoni", "Familiar");
    const drawer = await openCheckout(page);
    const personal = priceOf("Pizza Pepperoni", "Personal");
    const familiar = priceOf("Pizza Pepperoni", "Familiar");
    await expect(drawer.locator(".cart-item").filter({ hasText: "Personal" })).toContainText(price(personal));
    await expect(drawer.locator(".cart-item").filter({ hasText: "Familiar" })).toContainText(price(familiar));
    await expect(drawer.locator(".order-totals")).toContainText(`Subtotal${price(personal + familiar)}`);
  });

  test("un producto sin precio en un tamaño no ofrece ese tamaño", async ({ page }) => {
    await page.goto("/");
    const card = productCard(page, MEDIUM_ONLY_PRODUCT);
    await expect(card.locator(".size-chip")).toHaveText(["Mediana"]);
    await expect(card.locator(".product-footer strong")).toHaveText(price(priceOf(MEDIUM_ONLY_PRODUCT, "Mediana")));
  });

  test("un producto con el precio único anterior sigue a la venta en todos los tamaños", async ({ page }) => {
    await page.goto("/");
    const card = productCard(page, LEGACY_PRODUCT);
    await expect(card.locator(".size-chip")).toHaveText(catalog.tienda.tamanos);
    await card.getByRole("button", { name: "Familiar", exact: true }).click();
    await expect(card.locator(".product-footer strong")).toHaveText(price(priceOf(LEGACY_PRODUCT, "Familiar")));
  });
});
