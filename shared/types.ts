export interface Post {
  id: string;
  postText: string;
  authorName: string;
  authorHeadline: string;
  postUrl: string;
  savedDate: string;
  syncedAt: string;
  embedding?: number[];
  userId?: string;
  convexId?: string;
}

export interface SyncResult {
  partial: boolean;
  newCount: number;
  totalThisSession: number;
  totalCount: number;
  at: number;
  warning?: string;
}

export interface Settings {
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citedPostIds?: string[];
}
