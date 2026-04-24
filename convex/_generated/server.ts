/**
 * Typed Convex function builders. Regenerate with `npx convex dev` when the schema changes.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import type { DataModel } from "./dataModel.js";

export const query = queryGeneric<DataModel>;
export const mutation = mutationGeneric<DataModel>;
