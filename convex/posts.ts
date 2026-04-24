import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Post } from "@savedin/shared";

export const upsertPosts = mutation({
  args: {
    posts: v.array(
      v.object({
        id: v.string(),
        postText: v.string(),
        authorName: v.string(),
        authorHeadline: v.string(),
        postUrl: v.string(),
        savedDate: v.string(),
        syncedAt: v.string(),
        embedding: v.optional(v.array(v.float64())),
        userId: v.optional(v.string()),
        convexId: v.optional(v.string()),
      }),
    ),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;

    for (const post of args.posts as Post[]) {
      const existing = await ctx.db
        .query("posts")
        .withIndex("by_user_and_post_id", (q) => q.eq("userId", args.userId).eq("postId", post.id))
        .unique();

      if (existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("posts", {
        userId: args.userId,
        postId: post.id,
        postText: post.postText,
        authorName: post.authorName,
        authorHeadline: post.authorHeadline,
        postUrl: post.postUrl,
        savedDate: post.savedDate,
        syncedAt: post.syncedAt,
        embedding: post.embedding,
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});

export const getPosts = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return posts.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  },
});

export const searchPosts = query({
  args: {
    userId: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const needle = args.query.trim().toLowerCase();
    if (!needle) {
      return posts.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
    }

    return posts
      .filter((post) => (
        post.postText.toLowerCase().includes(needle)
        || post.authorName.toLowerCase().includes(needle)
      ))
      .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  },
});

export const deletePost = mutation({
  args: {
    convexId: v.id("posts"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.convexId as Id<"posts">);
    if (!post || post.userId !== args.userId) {
      throw new Error("Post not found for this user");
    }

    await ctx.db.delete(args.convexId);
    return { deleted: true };
  },
});
