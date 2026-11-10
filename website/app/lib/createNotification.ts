import { createClient } from "../../lib/supabase/client";

type CreateNotificationInput = {
  userId: string;
  title: string;
  message: string;
  type?: string;
};

export async function createNotification({
  userId,
  title,
  message,
  type = "system",
}: CreateNotificationInput) {
  const supabase = createClient();

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    title,
    message,
    type,
  });

  if (error) {
    console.error("Notification error:", error.message);
  }
}