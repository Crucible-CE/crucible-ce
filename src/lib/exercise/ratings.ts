// HSEEP capability ratings (P, S, M, U). Ratings are per objective and
// capability, never per person.

export const RATINGS = ["P", "S", "M", "U"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  P: "Performed without challenges",
  S: "Performed with some challenges",
  M: "Performed with major challenges",
  U: "Unable to be performed",
};
