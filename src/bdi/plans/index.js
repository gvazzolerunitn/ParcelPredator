import { MoveBfs } from "./moveBfs.js";
import { PDDLMove } from "./pddlMove.js";
import { GoPickUp } from "./goPickUp.js";
import { GoDeliver } from "./goDeliver.js";
import { GoRandom } from "./goRandom.js";

// PDDLMove is checked first for 'go_to' (only applies if config.usePddl=true)
// Falls back to MoveBfs if PDDL disabled or not applicable
const plans = [GoPickUp, GoDeliver, GoRandom, PDDLMove, MoveBfs];
export { plans };
