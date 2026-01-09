import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 150;

class MoveBfs {
  static isApplicableTo(desire) { return desire === 'go_to'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  
  async execute(_desire, x, y) {
    const tx = Math.round(x); 
    const ty = Math.round(y);
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
      if (this.stopped) throw new Error("stopped");
      
      const sx = Math.round(this.parent.x);
      const sy = Math.round(this.parent.y);
      
      // Già arrivato
      if (sx === tx && sy === ty) return true;
      
      const path = grid.bfsPath(sx, sy, tx, ty);
      if (!path || path.length === 0) {
        throw new Error('MoveBfs: path not found');
      }
      
      let blocked = false;
      for (const dir of path) {
        if (this.stopped) throw new Error("stopped");
        const ok = await adapter.move(dir);
        
        if (ok === false) {
          // Movimento bloccato: attendi e riprova con nuovo path
          blocked = true;
          retries++;
          if (retries < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          }
          break; // Esci dal for per ricalcolare il path
        }
      }
      
      if (!blocked) {
        return true; // Percorso completato con successo
      }
    }
    
    // Dopo MAX_RETRIES, lancia errore
    throw new Error("move blocked after retries");
  }
}

export { MoveBfs };
