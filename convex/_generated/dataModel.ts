/**
 * Data model types derived from `schema.ts`. Regenerate with `npx convex dev` after schema edits.
 */
import type { GenericId } from "convex/values";
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
} from "convex/server";
import schema from "../schema.js";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

export type Doc<TableName extends TableNamesInDataModel<DataModel>> = DocumentByName<
  DataModel,
  TableName
>;

export type Id<TableName extends TableNamesInDataModel<DataModel>> = GenericId<TableName>;
