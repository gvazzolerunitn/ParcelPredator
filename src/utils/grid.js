// Grid con BFS reale e distanza Manhattan
class Grid {
  constructor(width, height, tiles) {
    this.width = width;
    this.height = height;
    this.accessible = Array.from({ length: width }, () => Array(height).fill(false));
    if (tiles) {
      for (const t of tiles) {
        // type "0" o 0 = wall; altri accessibili
        this.accessible[t.x][t.y] = t.type != 0 && t.type !== '0';
      }
    }
  }

  isAccessible(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.accessible[x][y];
  }

  manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(Math.round(x1) - Math.round(x2)) + Math.abs(Math.round(y1) - Math.round(y2));
  }

  bfsPath(sx, sy, tx, ty) {
    sx = Math.round(sx); sy = Math.round(sy); tx = Math.round(tx); ty = Math.round(ty);
    if (!this.isAccessible(tx, ty) || !this.isAccessible(sx, sy)) return null;
    // In Deliveroo: up = y+1, down = y-1, right = x+1, left = x-1
    const dirs = [ ['up',0,1], ['down',0,-1], ['left',-1,0], ['right',1,0] ];
    const q = [[sx, sy]];
    const prev = new Map();
    const key = (x,y)=> `${x},${y}`;
    prev.set(key(sx,sy), null);
    while (q.length) {
      const [x,y] = q.shift();
      if (x === tx && y === ty) break;
      for (const [name,dx,dy] of dirs) {
        const nx = x+dx, ny = y+dy;
        const k = key(nx,ny);
        if (!this.isAccessible(nx,ny) || prev.has(k)) continue;
        prev.set(k, [x,y,name]);
        q.push([nx,ny]);
      }
    }
    if (!prev.has(key(tx,ty))) return null;
    // Ricostruisci percorso di direzioni
    const path = [];
    let cur = [tx,ty];
    while (cur) {
      const k = key(cur[0],cur[1]);
      const p = prev.get(k);
      if (!p) break;
      const [px,py,dir] = p;
      path.push(dir);
      cur = [px,py];
    }
    return path.reverse();
  }
}

// Singleton di comodo (sovrascritto dal launcher quando arriva la mappa)
let grid = new Grid(0,0);
export { Grid, grid };
export function setGrid(g) { grid = g; }
