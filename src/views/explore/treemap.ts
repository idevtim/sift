// Binary-split treemap from the prototype: split the (size-sorted) items
// where the running total first passes half, cutting across the longer
// side (`w * 1.35 >= h` → vertical cut), and recurse. Units are percent.

export interface Rect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function layout<T>(items: T[], size: (t: T) => number, x = 0, y = 0, w = 100, h = 100): Rect<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ item: items[0], x, y, w, h }];
  const total = items.reduce((a, t) => a + size(t), 0);
  if (total <= 0) return [];
  let acc = 0;
  let k = 0;
  while (k < items.length - 1 && acc + size(items[k]) <= total / 2) acc += size(items[k++]);
  if (k === 0) {
    acc = size(items[0]);
    k = 1;
  }
  const f = acc / total;
  const [a, b] = [items.slice(0, k), items.slice(k)];
  return w * 1.35 >= h
    ? [...layout(a, size, x, y, w * f, h), ...layout(b, size, x + w * f, y, w * (1 - f), h)]
    : [...layout(a, size, x, y, w, h * f), ...layout(b, size, x, y + h * f, w, h * (1 - f))];
}
