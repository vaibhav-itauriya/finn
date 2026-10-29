// Squarified treemap (Bruls, Huizing, van Wijk): lays out weighted tiles in a rectangle so each
// tile is as close to square as possible, which keeps small holdings readable.
export interface Tile<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarify<T>(items: { item: T; value: number }[], W: number, H: number): Tile<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const nodes = [...items].sort((a, b) => b.value - a.value).map((i) => ({ ...i, area: (i.value / total) * W * H }));
  const out: Tile<T>[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  const worst = (row: typeof nodes, side: number) => {
    const s = row.reduce((a, r) => a + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area));
    const mn = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h);
    const row = [nodes[i]];
    i++;
    while (i < nodes.length && worst([...row, nodes[i]], side) <= worst(row, side)) row.push(nodes[i++]);
    const s = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      // column on the left
      const cw = s / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / cw;
        out.push({ item: r.item, x, y: cy, w: cw, h: rh });
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const r of row) {
        const rw = r.area / rh;
        out.push({ item: r.item, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
  }
  return out;
}
