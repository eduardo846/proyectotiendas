import { existsSync, readFileSync } from "node:fs";
import { catalog, createOrder, expect, getDocData, login, test } from "./fixtures.mjs";

const tab = (page, name) => page.getByRole("navigation", { name: "Secciones del personal" }).getByRole("button", { name });
const record = (page, text) => page.locator("article.staff-record").filter({ hasText: text });

async function addFirstProduct(page) {
  await page.locator("article.product-card").first().getByRole("button", { name: /^Agregar/ }).click();
  await page.getByRole("button", { name: "Ver pedido" }).click();
  return page.getByRole("dialog", { name: "Resumen del pedido" });
}

test.describe("Tienda: casos límite", () => {
  test("rechaza un teléfono demasiado corto", async ({ page }) => {
    await page.goto("/");
    const drawer = await addFirstProduct(page);
    await drawer.getByLabel("Tu nombre").fill("Ana");
    await drawer.getByLabel("Número de contacto").fill("123");
    await drawer.getByRole("button", { name: "Nequi" }).click();
    await drawer.getByRole("button", { name: /Guardar solicitud/ }).click();
    await expect(page.locator(".toast")).toHaveText("Ingresa un número de contacto válido.");
  });

  test("avisa si el navegador bloquea la ventana de WhatsApp y no guarda la solicitud", async ({ page }) => {
    await page.addInitScript(() => { window.open = () => null; });
    await page.goto("/");
    const drawer = await addFirstProduct(page);
    await drawer.getByLabel("Tu nombre").fill("Ana");
    await drawer.getByLabel("Número de contacto").fill("3001234567");
    await drawer.getByRole("button", { name: "Efectivo" }).click();
    await drawer.getByRole("button", { name: /Guardar solicitud/ }).click();
    await expect(page.locator(".toast")).toHaveText("Permite las ventanas emergentes para continuar a WhatsApp.");
    await expect(drawer.locator(".cart-item")).toHaveCount(1);
  });

  test("sin conexión a Firestore muestra el catálogo local y deshabilita el envío", async ({ page }) => {
    await page.route(/127\.0\.0\.1:8080/, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(".setup-notice")).toContainText("No se pudo conectar con Firestore");
    await expect(page.locator("article.product-card")).toHaveCount(catalog.productos.length);
    const drawer = await addFirstProduct(page);
    await expect(drawer.getByRole("button", { name: "Firestore no está disponible" })).toBeDisabled();
  });

  test("Escape cierra la imagen ampliada, el detalle y el resumen en orden", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ver Pizza Funghi" }).click();
    const modal = page.getByRole("dialog", { name: "Pizza Funghi" });
    await modal.getByRole("button", { name: "Ampliar imagen" }).click();
    await expect(page.locator(".lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".lightbox")).toBeHidden();
    await expect(modal).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    const drawer = await addFirstProduct(page);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("el enlace del personal abre el portal y el portal vuelve a la tienda", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Acceso del personal" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await page.getByRole("link", { name: "← Volver a la tienda" }).click();
    await expect(page.getByRole("heading", { level: 1, name: catalog.tienda.nombre })).toBeVisible();
  });

  test("abrir /staff directamente funciona (Netlify incluye la regla de rutas)", async ({ page }) => {
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    const redirects = new URL("../.e2e-dist/_redirects", import.meta.url);
    expect(existsSync(redirects)).toBe(true);
    expect(readFileSync(redirects, "utf8")).toContain("/* /index.html 200");
  });
});

test.describe("Portal: catálogo y tienda", () => {
  test.beforeEach(async ({ page, staff }) => {
    await login(page, staff.admin.email);
    await expect(page.getByRole("heading", { name: "Gestión de la tienda" })).toBeVisible();
  });

  test("crea y renombra una categoría, y rechaza nombres duplicados", async ({ page }) => {
    await tab(page, "Categorías").click();
    await page.getByLabel("Nueva categoría").fill("Calzones");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByRole("status")).toHaveText("Categoría guardada.");
    expect((await getDocData("categorias/calzones")).nombre).toBe("Calzones");

    await page.getByLabel("Nueva categoría").fill("clásicas");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Ya existe una categoría con ese nombre.");

    await record(page, "Calzones").getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Editar categoría").fill("Calzones y panzerotti");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("status")).toHaveText("Categoría guardada.");
    expect((await getDocData("categorias/calzones")).nombre).toBe("Calzones y panzerotti");
  });

  test("una categoría nueva con productos aparece en la tienda", async ({ page }) => {
    await tab(page, "Categorías").click();
    await page.getByLabel("Nueva categoría").fill("Postres");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByRole("status")).toHaveText("Categoría guardada.");

    await tab(page, "Productos").click();
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    const form = page.locator("form.staff-editor");
    await form.getByLabel("Nombre", { exact: true }).fill("Pizza de Nutella");
    await form.getByLabel("Referencia").fill("FB-300");
    await form.getByLabel("Descripción").fill("Nutella y fresas");
    await form.getByLabel("Precio Personal (COP)").fill("19000");
    await form.getByLabel("Categoría").selectOption({ label: "Postres" });
    await form.getByLabel("Imagen HTTPS").fill("https://example.com/nutella.jpg");
    await form.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");

    await page.goto("/");
    await page.getByRole("navigation", { name: "Categorías" }).getByRole("button", { name: "Postres" }).click();
    await expect(page.locator("article.product-card")).toHaveCount(1);
    await expect(page.locator("article.product-card .size-chip")).toHaveText(["Personal"]);
  });

  test("rechaza una imagen sin HTTPS", async ({ page }) => {
    await record(page, "Pizza Funghi").getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Imagen HTTPS").fill("http://example.com/funghi.jpg");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("alert")).toHaveText("La imagen debe tener una URL HTTPS válida.");
  });

  test("crea una promoción y se muestra en la tienda", async ({ page }) => {
    await tab(page, "Promociones").click();
    await record(page, "COMBO").getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Mostrar en la tienda").uncheck();
    await page.getByRole("button", { name: "Guardar promoción" }).click();
    await expect(page.getByRole("status")).toHaveText("Promoción guardada.");

    await page.getByRole("button", { name: "Nueva promoción" }).click();
    await page.getByLabel("Título").fill("MARTES");
    await page.getByLabel("Descripción").fill("Martes de pizza: la segunda a mitad de precio");
    await page.getByRole("button", { name: "Guardar promoción" }).click();
    await expect(page.getByRole("status")).toHaveText("Promoción guardada.");

    await page.goto("/");
    await expect(page.locator(".promo")).toContainText("Martes de pizza: la segunda a mitad de precio");
    await expect(page.locator(".promo")).toContainText("MARTES");
  });

  test("valida el WhatsApp de la tienda y guarda uno correcto", async ({ page }) => {
    await tab(page, "Tienda").click();
    await page.getByLabel("WhatsApp internacional").fill("12345");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("alert")).toContainText("entre 8 y 15 dígitos");

    await page.getByLabel("WhatsApp internacional").fill("+57 310 555 6677");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("status")).toHaveText("Configuración actualizada.");
    expect((await getDocData("configuracion/tienda")).whatsapp).toBe("573105556677");
  });

  test("un tamaño nuevo en la tienda aparece en el formulario de productos", async ({ page }) => {
    await tab(page, "Tienda").click();
    await page.getByLabel("Tamaños disponibles (separados por coma)").fill("Personal, Mediana, Familiar, Gigante");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("status")).toHaveText("Configuración actualizada.");

    await tab(page, "Productos").click();
    await record(page, "Pizza Funghi").getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Precio Gigante (COP)").fill("60000");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByRole("status")).toHaveText("Producto guardado.");

    await page.goto("/");
    const card = page.locator("article.product-card").filter({ hasText: "Pizza Funghi" });
    await card.getByRole("button", { name: "Gigante" }).click();
    await expect(card.locator(".product-footer strong")).toHaveText("$60.000");
    // Los productos sin precio para el tamaño nuevo no lo ofrecen.
    await expect(page.locator("article.product-card").filter({ hasText: "Pizza Spinaci" }).getByRole("button", { name: "Gigante" }))
      .toHaveCount(0);
  });
});

test.describe("Portal: usuarios", () => {
  test.beforeEach(async ({ page, staff }) => {
    await login(page, staff.admin.email);
    await tab(page, "Usuarios").click();
  });

  test("da de alta una cuenta existente como vendedor y la persona puede entrar", async ({ page, staff }) => {
    await page.getByRole("button", { name: "Nuevo usuario" }).click();
    await page.getByLabel("UID de Authentication").fill(staff.noProfile.uid);
    await page.getByLabel("Correo electrónico").fill(staff.noProfile.email);
    await page.getByLabel("Nombre (opcional)").fill("Pedro Cajero");
    await page.getByRole("button", { name: "Agregar al personal" }).click();
    await expect(page.getByRole("status")).toContainText("Perfil de personal agregado");
    expect(await getDocData(`usuarios/${staff.noProfile.uid}`)).toMatchObject({ rol: "seller", activo: true, nombre: "Pedro Cajero" });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await login(page, staff.noProfile.email);
    await expect(page.getByRole("heading", { name: "Pedidos y catálogo" })).toBeVisible();
  });

  test("rechaza un UID que ya tiene perfil", async ({ page, staff }) => {
    await page.getByRole("button", { name: "Nuevo usuario" }).click();
    await page.getByLabel("UID de Authentication").fill(staff.seller.uid);
    await page.getByLabel("Correo electrónico").fill(staff.seller.email);
    await page.getByRole("button", { name: "Agregar al personal" }).click();
    await expect(page.getByRole("alert")).toContainText("ya tiene un perfil de personal");
  });

  test("asciende a un vendedor a administrador", async ({ page, staff }) => {
    const card = page.locator("article.staff-user-card").filter({ hasText: staff.seller.email });
    await card.getByLabel("Rol").selectOption({ label: "Administrador" });
    await card.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status")).toHaveText("Perfil del personal actualizado.");
    expect((await getDocData(`usuarios/${staff.seller.uid}`)).rol).toBe("admin");
  });

  test("no permite editarse ni quitarse acceso a sí mismo", async ({ page, staff }) => {
    const self = page.locator("article.staff-user-card").filter({ hasText: `${staff.admin.email} · Tú` });
    await expect(self.getByLabel("Rol")).toBeDisabled();
    await expect(self.getByLabel("Acceso activo")).toBeDisabled();
    await expect(self.getByRole("button", { name: "Quitar acceso" })).toBeDisabled();
  });

  test("solicita el correo de restablecimiento de contraseña", async ({ page, staff }) => {
    const card = page.locator("article.staff-user-card").filter({ hasText: staff.seller.email });
    await card.getByRole("button", { name: "Enviar restablecimiento de contraseña" }).click();
    await expect(page.getByRole("status")).toHaveText(`Se solicitó a Firebase un correo de restablecimiento para ${staff.seller.email}.`);
  });

  test("reactiva a un vendedor desactivado", async ({ page, staff }) => {
    const card = page.locator("article.staff-user-card").filter({ hasText: staff.inactive.email });
    await card.getByLabel("Acceso activo").check();
    await card.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status")).toHaveText("Perfil del personal actualizado.");
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await login(page, staff.inactive.email);
    await expect(page.getByRole("heading", { name: "Pedidos y catálogo" })).toBeVisible();
  });
});

test.describe("Portal: pedidos", () => {
  test("muestra los pedidos del más antiguo al más reciente", async ({ page, staff }) => {
    const { Timestamp } = await import("firebase/firestore");
    await createOrder("reciente", { creadoEn: Timestamp.fromMillis(Date.now()) });
    await createOrder("antiguo", { creadoEn: Timestamp.fromMillis(Date.now() - 3_600_000) });
    await login(page, staff.seller.email);
    await expect(page.locator("article.staff-order header strong")).toHaveText(["Pedido antiguo", "Pedido reciente"]);
  });

  test("el vendedor ve el catálogo con precios por tamaño y sin edición", async ({ page, staff }) => {
    await login(page, staff.seller.email);
    await tab(page, "Catálogo").click();
    await expect(record(page, "Pizza Funghi")).toContainText("Personal $24.000 · Mediana $34.000 · Familiar $46.000");
    await expect(page.getByRole("button", { name: "Nuevo producto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
  });
});
