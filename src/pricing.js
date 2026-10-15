// Cada producto guarda `precios`, un mapa de tamaño a precio en COP. Los productos
// cargados antes de los precios por tamaño solo tienen `precio` y lo usan en
// todos los tamaños hasta que se editen.
export function getSizePrice(product, size) {
  const price = product.precios ? product.precios[size] : product.precio;
  return Number.isSafeInteger(price) && price >= 0 ? price : null;
}

// Tamaños de la tienda que el producto ofrece (los que tienen precio).
export function getAvailableSizes(product, sizes) {
  return sizes.filter((size) => getSizePrice(product, size) !== null);
}
