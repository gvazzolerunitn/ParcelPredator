// Intention: associa un predicato a un piano e lo esegue
import { plans } from "./plans/index.js";

class Intention {
  constructor(parent, predicate) {
    this.parent = parent;
    this.predicate = predicate;
    this.currentPlan = null;
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
    if (this.currentPlan && this.currentPlan.stop) this.currentPlan.stop();
  }
  async achieve() {
    for (const PlanClass of plans) {
      if (this.stopped) throw new Error("stopped intention");
      if (PlanClass.isApplicableTo(...this.predicate)) {
        this.currentPlan = new PlanClass(this.parent);
        return this.currentPlan.execute(...this.predicate);
      }
    }
    throw new Error("no plan matched predicate " + this.predicate.join(" "));
  }
}

export { Intention };
