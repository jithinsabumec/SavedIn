import type { Post } from "@savedin/shared";

/** Convex `posts` row shape returned by `getPosts` (before mapping to shared `Post`). */
export type ConvexPostRow = {
  _id: string;
  userId: string;
  postId: string;
  postText: string;
  authorName: string;
  authorHeadline: string;
  postUrl: string;
  savedDate: string;
  syncedAt: string;
  embedding?: number[];
};

/** Map Convex documents to the shared `Post` type used by the extension and web. */
export function mapConvexPostsToPosts(rows: ConvexPostRow[] | undefined): Post[] {
  if (!rows) return [];
  return rows.map((doc) => ({
    id: doc.postId,
    postText: doc.postText,
    authorName: doc.authorName,
    authorHeadline: doc.authorHeadline,
    postUrl: doc.postUrl,
    savedDate: doc.savedDate,
    syncedAt: doc.syncedAt,
    embedding: doc.embedding,
    userId: doc.userId,
    convexId: doc._id,
  }));
}
