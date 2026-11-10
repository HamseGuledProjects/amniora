import { createClient } from "../../lib/supabase/client";

export type AchievementEvent =
  | "lab_completed"
  | "xp_gained"
  | "roadmap_completed"
  | "ai_prompt_used"
  | "subscription_upgraded";

type Achievement = {
  id: number;
  name: string;
  description: string;
  requirement_type: string;
  requirement_value: number;
};

function matchesEvent(type: string, events: AchievementEvent[]) {
  const t = type.toLowerCase();

  if (events.includes("lab_completed") && t === "labs_completed") return true;
  if (events.includes("xp_gained") && t === "xp") return true;
  if (events.includes("roadmap_completed") && t.includes("roadmap")) return true;
  if (events.includes("ai_prompt_used") && t.includes("ai")) return true;
  if (events.includes("subscription_upgraded") && t.includes("subscription")) return true;

  return false;
}

export async function checkAchievements(
  userId: string,
  events: AchievementEvent[]
) {
  const supabase = createClient();

  const { count: labsCompleted } = await supabase
    .from("labs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true);

  const { data: profile } = await supabase
    .from("profiles")
    .select("xp")
    .eq("id", userId)
    .single();

  const { data: achievements } = await supabase
    .from("achievements")
    .select("id, name, description, requirement_type, requirement_value");

  const { data: unlocked } = await supabase
    .from("user_achievements")
    .select("achievement_id")
    .eq("user_id", userId);

  if (!achievements) return;

  const unlockedIds = new Set(
    unlocked?.map((item) => item.achievement_id) || []
  );

  const newlyUnlocked = achievements.filter((achievement: Achievement) => {
    if (unlockedIds.has(achievement.id)) return false;
    if (!matchesEvent(achievement.requirement_type, events)) return false;

    if (achievement.requirement_type === "labs_completed") {
      return (labsCompleted || 0) >= achievement.requirement_value;
    }

    if (achievement.requirement_type === "xp") {
      return (profile?.xp || 0) >= achievement.requirement_value;
    }

    return false;
  });

  for (const achievement of newlyUnlocked) {
    const { error: unlockError } = await supabase
      .from("user_achievements")
      .insert({
        user_id: userId,
        achievement_id: achievement.id,
        notification_sent: false,
      });

    if (unlockError) {
      console.error("Achievement unlock failed:", unlockError.message);
      continue;
    }

    const { error: notificationError } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        title: achievement.name,
        message: achievement.description,
        type: "achievement",
        read: false,
      });

    if (notificationError) {
      console.error("Achievement notification failed:", notificationError.message);
      continue;
    }

    await supabase
      .from("user_achievements")
      .update({ notification_sent: true })
      .eq("user_id", userId)
      .eq("achievement_id", achievement.id);
  }
}