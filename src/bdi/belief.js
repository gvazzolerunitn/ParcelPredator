// Stato minimo delle credenze: parcels, agents, spawners, delivery zones
class Belief {
  constructor() {
    this.parcels = new Map(); // id -> {id,x,y,reward,carriedBy}
    this.agents = new Map(); // id -> {id,name,x,y,score}
    this.parcelSpawners = [];
    this.deliveryZones = [];
  }
  addParcel(p) { this.parcels.set(p.id, p); }
  removeParcel(id) { this.parcels.delete(id); }
  getParcelsArray() { return Array.from(this.parcels.values()); }
  addAgent(a) { this.agents.set(a.id, a); }
  getAgent(id) { return this.agents.get(id); }
}

export { Belief };
