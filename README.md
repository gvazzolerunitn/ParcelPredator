# ParcelPredator

Scaffold minimale per un agente Deliveroo ispirato a ASAPlanners, ma costruito da zero. Struttura pensata per evolvere verso BDI (belief–desire–intention) con planner locale/PDDL.

## Struttura
- `src/launcher.js`: entrypoint; connette il client Deliveroo, registra callback, crea l'agente.
- `src/config/default.js`: host e nome agente; token da inserire manualmente.
- `src/client/adapter.js`: adatta le API del client (`emitMove` vs `move`) se necessario.
- `src/client/context.js`: inizializza il client DeliverooApi e esporta eventi/istanze condivise.
- `src/bdi/agent.js`: stato agente + ciclo intenzioni (stub).
- `src/bdi/intention.js`: wrapper per un'intenzione e selezione del piano (stub).
- `src/bdi/plans/`: piani base (stub): `moveBfs`, `goPickUp`, `goDeliver`, `goRandom`.
- `src/bdi/options.js`: logica di generazione opzioni (stub, da completare).
- `src/utils/grid.js`: rappresentazione mappa e BFS (placeholder).
- `src/bdi/belief.js`: credenze (parcels, agents, spawners, delivery zones) (stub).

## Come usare (bozza)
1. Inserisci un token valido in `src/config/default.js` (ottenuto dal server Deliveroo/UI).
2. Avvia il server Deliveroo (backend) su `http://localhost:8080`.
3. Installa dipendenze e lancia:
   ```bash
   npm install
   npm start
   ```
4. Apri la UI Deliveroo e, con un token diverso, osserva l'agente muoversi.

## Roadmap suggerita
- Implementare `Grid.bfsDistance` e `Belief` completo.
- Implementare `optionsGeneration` per scegliere pacchi/delivery con uno score semplice.
- Completare i piani in `plans/` richiamando `adapter.move/pickup/putdown`.
- Aggiungere gestione collisioni e (opzionale) PDDL planner.
