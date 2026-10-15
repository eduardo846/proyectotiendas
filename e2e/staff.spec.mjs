import { createOrder, expect, getDocData, LEGACY_PRODUCT, login, PASSWORD, priceOf, test } from "./fixtures.mjs";

const orderCard = (page, id) => page.locator("article.staff-order").filter({ hasText: `Pedido ${id}` });

async function setOrderStatus(page, id, label) {
  const card = orderCard(page, id);
  await card.getByLabel("Estado del pedido").selectOption({ label });
  await card.getByRole("button", { name: "Guardar estado" }).click();
}

const tab = (page, name) => page.getByRole("navigation", { name: "Secciones del personal" }).getByRole("button", { name });

test.describe("Inicio de sesión", () => {
  test("contraseña incorrecta muestra un mensaje comprensible", async ({ page, staff }) => {
    await login(page, staff.seller.email, "incorrecta");
    await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos.");
  });

  // Según qué termine antes (login u observador de sesión) se ve el formulario con
  // "perfil de personal activo" o la pantalla "Sin rol de personal"; ambos niegan el acceso.
  test("una cuenta sin perfil de personal no entra", async ({ page, staff }) => {
    await login(page, staff.noProfile.email);
    await expect(page.getByRole("alert")).toContainText(/no tiene un (perfil|rol) de personal/);
    await expect(page.getByRole("navigation", { name: "Secciones del personal" })).toHaveCount(0);
  });

  test("una cuenta desactivada no entra", async ({ page, staff }) => {
    await login(page, staff.inactive.email);
    await expect(page.getByRole("alert")).toContainText("no tiene un perfil de personal activo");
  });

  test("cerrar sesión vuelve al formulario", async ({ page, staff }) => {
    await login(page, staff.seller.email);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  });
});

test.describe("Vendedor", () => {
  test.beforeEach(async ({ page, staff }) => {
    await createOrder("pedido-a");
    await createOrder("pedido-b", { cliente: { nombre: "<img src=x onerror=alert(1)>", telefono: "3010000000" } });
    page.on("dialog", (dialog) => {
      throw new Error(`Diálogo inesperado: ${dialog.message()}`);
    });
    await login(page, staff.seller.email);
    await expect(page.getByRole("heading", { name: "Pedidos y catálogo" })).toBeVisible();
  });

  test("solo ve pedidos y catálogo", async ({ page }) => {
    await expect(tab(page, "Pedidos")).toBeVisible();
    await expect(tab(page, "Catálogo")).toBeVisible();
    await expect(tab(page, "Usuarios")).toHaveCount(0);
    await expect(tab(page, "Tienda")).toHaveCount(0);
  });

  test("ve la solicitud sin precios verificados y el texto del cliente sin ejecutarlo", async ({ page }) => {
    const card = orderCard(page, "pedido-a");
    await expect(card).toContainText("2 × Pizza Margarita · Familiar");
    await expect(card).toContainText("Por validar");
    await expect(card).toContainText("Total por validar");
    await expect(card).toContainText("Calle 10 # 20-30");
    await expect(orderCard(page, "pedido-b")).toContainText("<img src=x onerror=alert(1)>");
  });

  test("confirma un pedido y el cambio queda guardado", async ({ page }) => {
    await setOrderStatus(page, "pedido-a", "Confirmado");
    await expect(page.getByRole("status")).toHaveText("Estado del pedido actualizado.");
    expect((await getDocData("pedidos/pedido-a")).estado).toBe("confirmado");
  });

  test("un pedido entregado sale de su lista", async ({ page }) => {
    await setOrderStatus(page, "pedido-a", "Entregado");
    await expect(page.getByRole("status")).toHaveText("Estado del pedido actualizado.");
    await expect(orderCard(page, "pedido-a")).toHaveCount(0);
    expect((await getDocData("pedidos/pedido-a")).estado).toBe("entregado");
  });

  test("puede cerrar un pedido", async ({ page }) => {
    await setOrderStatus(page, "pedido-a", "Cerrado");
    await expect(page.getByRole("status")).toHaveText("Estado del pedido actualizado.");
    expect((await getDocData("pedidos/pedido-a")).estado).toBe("cerrado");
  });
});

test.describe("Administrador", () => {
  test.beforeEach(async ({ page, staff }) => {
    await login(page, staff.admin.email);
    await expect(page.getByRole("heading", { name: "Gestión de la tienda" })).toBeVisible();
  });

  test("reabre un pedido entregado", async ({ page }) => {
    await createOrder("pedido-entregado", { estado: "entregado" });
    await tab(page, "Pedidos").click();
    await page.reload();
    await tab(page, "Pedidos").click();
    await setOrderStatus(page, "pedido-entregado", "Confirmado");
    await expect(page.getByRole("status")).toHaveText("Estado del pedido actualizado.");
    expect((await getDocData("pedidos/pedido-entregado")).estado).toBe("confirmado");
  });

  test("crea un producto y aparece en la tienda", async ({ page }) => {
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    const form = page.locator("form.staff-editor");
    await form.getByLabel("Nombre", { exact: true }).fill("Pizza Hawaiana");
    await form.getByLabel("Referencia").fill("FB-200");
    await form.getByLabel("Descripción").fill("Jamón y piña");
    await form.getByLabel("Precio Personal (COP)").fill("24000");
    await form.getByLabel("Precio Mediana (COP)").fill("33000");
    await form.getByLabel("Precio Familiar (COP)").fill("45000");
    await form.getByLabel("Categoría").selectOption({ label: "Especiales" });
    await form.getByLabel("Imagen HTTPS").fill("https://example.com/hawaiana.jpg");
    await form.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");

    await page.goto("/");
    const card = page.locator("article.product-card").filter({ hasText: "Pizza Hawaiana" });
    await expect(card.locator(".product-footer strong")).toHaveText("$24.000");
    await card.getByRole("button", { name: "Familiar", exact: true }).click();
    await expect(card.locator(".product-footer strong")).toHaveText("$45.000");
  });

  test("asigna precios por tamaño a un producto con precio único", async ({ page }) => {
    const record = page.locator("article.staff-record").filter({ hasText: LEGACY_PRODUCT });
    const legacy = priceOf(LEGACY_PRODUCT, "Mediana");
    await expect(record).toContainText(`Personal $${legacy.toLocaleString("es-CO")}`);
    await record.getByRole("button", { name: "Editar" }).click();
    const form = page.locator("form.staff-editor");
    await expect(form).toContainText("aún tiene un solo precio");
    await expect(form.getByLabel("Precio Familiar (COP)")).toHaveValue(String(legacy));
    await form.getByLabel("Precio Personal (COP)").fill("18000");
    await form.getByLabel("Precio Familiar (COP)").fill("");
    await form.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");
    await expect(record).toContainText(`Personal $18.000 · Mediana $${legacy.toLocaleString("es-CO")} · Publicado`);

    const saved = await getDocData("productos/17");
    expect(saved.precios).toEqual({ Personal: 18000, Mediana: legacy });
    expect(saved).not.toHaveProperty("precio");
  });

  test("quitar el precio de un tamaño lo deja de ofrecer en la tienda", async ({ page }) => {
    await page.locator("article.staff-record").filter({ hasText: "Pizza Funghi" })
      .getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Precio Personal (COP)").fill("");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");
    expect((await getDocData("productos/9")).precios).toEqual({
      Mediana: priceOf("Pizza Funghi", "Mediana"), Familiar: priceOf("Pizza Funghi", "Familiar"),
    });
    await page.goto("/");
    await expect(page.locator("article.product-card").filter({ hasText: "Pizza Funghi" }).locator(".size-chip"))
      .toHaveText(["Mediana", "Familiar"]);
  });

  test("exige el precio de al menos un tamaño", async ({ page }) => {
    await page.locator("article.staff-record").filter({ hasText: "Pizza Funghi" })
      .getByRole("button", { name: "Editar" }).click();
    for (const size of ["Personal", "Mediana", "Familiar"]) await page.getByLabel(`Precio ${size} (COP)`).fill("");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("alert")).toHaveText("Define el precio de al menos un tamaño.");
  });

  test("despublicar un producto lo oculta de la tienda", async ({ page }) => {
    await page.locator("article.staff-record").filter({ hasText: "Pizza Funghi" })
      .getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Publicado en la tienda").uncheck();
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");
    await page.goto("/");
    await expect(page.locator("article.product-card").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pizza Funghi" })).toHaveCount(0);
  });

  test("cambia el costo de envío y la tienda lo usa", async ({ page }) => {
    await tab(page, "Tienda").click();
    await page.getByLabel("Costo de envío (COP)").fill("8000");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("status")).toHaveText("Configuración actualizada.");

    await page.goto("/");
    const card = page.locator("article.product-card").filter({ hasText: "Pizza Margarita Personal" });
    await card.getByRole("button", { name: /^Agregar/ }).click();
    await page.getByRole("button", { name: "Ver pedido" }).click();
    await expect(page.locator(".order-totals")).toContainText("Envío$8.000");
  });

  test("no deja borrar una categoría con productos", async ({ page }) => {
    await tab(page, "Categorías").click();
    await page.locator("article.staff-record").filter({ hasText: "Clásicas" })
      .getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByRole("alert")).toHaveText("No se puede eliminar esta categoría: primero reasigna o elimina sus productos.");
  });

  test("ocultar la promoción la quita de la tienda", async ({ page }) => {
    await tab(page, "Promociones").click();
    await page.locator("article.staff-record").filter({ hasText: "COMBO" }).getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Mostrar en la tienda").uncheck();
    await page.getByRole("button", { name: "Guardar promoción" }).click();
    await expect(page.getByRole("status")).toHaveText("Promoción guardada.");
    await page.goto("/");
    await expect(page.locator("article.product-card").first()).toBeVisible();
    await expect(page.locator(".promo")).toHaveCount(0);
  });

  test("quitar acceso a un vendedor le impide entrar", async ({ page, staff }) => {
    await tab(page, "Usuarios").click();
    const card = page.locator("article.staff-user-card").filter({ hasText: staff.seller.email });
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Quitar acceso" }).click();
    await expect(page.getByRole("status")).toContainText("Acceso de personal desactivado");
    expect((await getDocData(`usuarios/${staff.seller.uid}`)).activo).toBe(false);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await login(page, staff.seller.email, PASSWORD);
    await expect(page.getByRole("alert")).toContainText("no tiene un perfil de personal activo");
  });
});
