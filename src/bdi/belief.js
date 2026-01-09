// Stato minimo delle credenze: parcels, agents, spawners, delivery zones
class Belief {
  constructor() {
    this.parcels = new Map(); // id -> {id,x,y,reward,carriedBy}
    this.agents = new Map(); // id -> {id,name,x,y,score}
    this.parcelSpawners = [];
    this.deliveryZones = [];
  }
  // Sincronizza i pacchi: sostituisce tutti con quelli del sensing
  syncParcels(parcelsArray) {
    this.parcels.clear();
    for (const p of parcelsArray) {
      this.parcels.set(p.id, p);
    }
  }
  addParcel(p) { this.parcels.set(p.id, p); }
  removeParcel(id) { this.parcels.delete(id); }
  // Restituisce solo i pacchi liberi (non trasportati)
  getFreeParcels() {
    return Array.from(this.parcels.values()).filter(p => 
      p.carriedBy === null || p.carriedBy === undefined || p.carriedBy === ''
    );
  }
  getParcelsArray() { return Array.from(this.parcels.values()); }
  addAgent(a) { this.agents.set(a.id, a); }
  getAgent(id) { return this.agents.get(id); }
}

export { Belief };
