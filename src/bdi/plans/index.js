import { MoveBfs } from "./moveBfs.js";
import { GoPickUp } from "./goPickUp.js";
import { GoDeliver } from "./goDeliver.js";
import { GoRandom } from "./goRandom.js";

const plans = [GoPickUp, GoDeliver, GoRandom, MoveBfs];
export { plans };
