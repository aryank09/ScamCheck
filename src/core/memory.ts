import { listRecentCases } from "../db/cases.js";
import type { User } from "../db/users.js";

export async function recentSummaries(user: User): Promise<string[]> {
  const cases = await listRecentCases({
    userId: user._id,
    familyGroupId: user.familyGroupId,
    days: 7,
  });
  return cases.slice(0, 5).map((item) => `${item.scamType}: ${item.summary}`);
}
