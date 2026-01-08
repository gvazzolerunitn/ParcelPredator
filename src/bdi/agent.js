import { Intention } from "./intention.js";

class Agent {
  constructor() {
    this.id = undefined;
    this.name = undefined;
    this.x = undefined;
    this.y = undefined;
    this.score = 0;
    this.carried = 0;
    this.intentions = [];
  }

  setValues({ id, name, x, y, score, carried }) {
    this.id = id; this.name = name; this.x = x; this.y = y; this.score = score;
    if (carried !== undefined) this.carried = carried;
  }

  push(predicate) {
    const last = this.intentions.at(-1);
    if (last && last.predicate.join(" ") === predicate.join(" ")) return;
    const i = new Intention(this, predicate);
    this.intentions.push(i);
    if (last) last.stop();
  }

  async loop() {
    // Aspetta che l'agente abbia ricevuto la propria posizione dal server
    while (this.x === undefined) {
      await new Promise(res => setTimeout(res, 100));
    }
    while (true) {
      if (this.intentions.length > 0) {
        const intention = this.intentions[0];
        try {
          await intention.achieve();
        } catch (err) {
          console.error("intention failed", intention.predicate, err);
        }
        this.intentions.shift();
      }
      await new Promise(res => setTimeout(res, 50));
    }
  }
}

export { Agent };
