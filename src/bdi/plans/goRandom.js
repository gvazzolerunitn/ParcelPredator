import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";

class GoRandom {
  static isApplicableTo(desire) { return desire === 'go_random'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    // Prova tutte le direzioni in ordine casuale, muovi nella prima valida
    const dirs = ['up','down','left','right'].sort(() => Math.random() - 0.5);
    for (const dir of dirs) {
      if (this.stopped) throw new Error("stopped");
      // Calcola posizione target
      let nx = Math.round(this.parent.x), ny = Math.round(this.parent.y);
      if (dir === 'up') ny += 1;
      else if (dir === 'down') ny -= 1;
      else if (dir === 'left') nx -= 1;
      else if (dir === 'right') nx += 1;
      // Verifica se accessibile
      if (grid.isAccessible(nx, ny)) {
        const res = await adapter.move(dir);
        if (res !== false) return true; // movimento riuscito
      }
    }
    // Nessuna direzione valida, aspetta un po' e ritorna comunque
    await new Promise(r => setTimeout(r, 200));
    return true;
  }
}

export { GoRandom };
