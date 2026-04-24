import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    plan: v.union(v.literal("free"), v.literal("pro")),
    postCount: v.number(),
    createdAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  posts: defineTable({
    userId: v.string(),
    postId: v.string(),
    postText: v.string(),
    authorName: v.string(),
    authorHeadline: v.string(),
    postUrl: v.string(),
    savedDate: v.string(),
    syncedAt: v.string(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_post_id", ["userId", "postId"]),
});
