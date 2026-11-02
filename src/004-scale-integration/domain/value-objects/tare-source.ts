/**
 * TareSource — where the tare VALUE came from.
 *
 * A CLOSED SET, so the source is DATA rather than prose assembled at the
 * call site. The story requires the source to be recorded, and the two
 * sources are different FACTS:
 *
 *   - a master tare is a CLAIM — the container's known weight;
 *   - a weighed tare is a MEASUREMENT — the container was put on the
 *     scale and read.
 *
 * The distinction is not cosmetic. A claim can be wrong, and a
 * measurement cannot be; an investigation that needs to know which one
 * produced the quantity has to be able to tell them apart.
 *
 * THIS IS NOT THE SAME FACT AS `TareMechanism`
 * --------------------------------------------
 * The source says where the VALUE came from. The mechanism says where the
 * tare was APPLIED — at the indicator, or in the software. A master tare
 * applied in software and a master tare applied at the indicator are the
 * same source and different mechanisms. The story requires both, and
 * conflating them would lose one of the two facts.
 */
export type TareSource = 'CONTAINER_MASTER' | 'WEIGHED_EMPTY_CONTAINER';
