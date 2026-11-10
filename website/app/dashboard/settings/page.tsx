"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Shield,
  User,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";
import { createNotification } from "../../lib/createNotification";
import Button from "@/app/components/ui/Button";
import ErrorState from "@/app/components/ui/ErrorState";
import Input from "@/app/components/ui/Input";
import PageHeader from "@/app/components/ui/PageHeader";
import Select from "@/app/components/ui/Select";
import { SettingsSkeleton } from "@/app/components/ui/Skeleton";

const targetLevels = ["Beginner", "Intermediate", "Advanced", "Expert", "Master"];

const categories = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "preferences", label: "Preferences", icon: Bell },
  { id: "subscription", label: "Subscription", icon: CreditCard },
] as const;

const darkFieldClassName =
  "border-white/15 !bg-[#061222] !text-white !shadow-none placeholder:!text-slate-500 focus:!border-cyan-200 focus:!ring-cyan-200 focus:!ring-offset-[#071426] disabled:!bg-white/[0.035] disabled:!text-slate-300";

type SettingsCategoryId = (typeof categories)[number]["id"];

type SettingsSectionProps = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
};

function SettingsSection({
  id,
  title,
  description,
  icon,
  children,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className="scroll-mt-6 overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] text-white shadow-[0_18px_42px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-start gap-3 border-b border-white/10 bg-[#061222] px-4 py-4 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-cyan-100/15 bg-cyan-300/10 text-cyan-200">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-200">
            {description}
          </p>
        </div>
      </div>
      <div className="px-4 py-5 sm:px-5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("Loading...");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("Free Plan");
  const [level, setLevel] = useState("Beginner");
  const [targetLevel, setTargetLevel] = useState("Beginner");
  const [xp, setXp] = useState(0);
  const [notifications, setNotifications] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategoryId>("profile");

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      setError("");

      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          setError(
            "Amniora could not load this data right now. Please try again in a moment."
          );
          return;
        }

        if (!user) {
          setError("You need to be signed in to view your settings.");
          return;
        }

        setUserId(user.id);

        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("full_name, email, plan, level, target_level, xp")
          .eq("id", user.id)
          .single();

        if (profileError) {
          setError(
            "Amniora could not load this data right now. Please try again in a moment."
          );
          return;
        }

        if (data) {
          setName(data.full_name || "User");
          setEmail(data.email || user.email || "");
          setPlan(data.plan || "Free Plan");
          setLevel(data.level || "Beginner");
          setTargetLevel(data.target_level || "Beginner");
          setXp(data.xp || 0);
        }
      } catch {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  async function saveProfile() {
    if (saving) return;
    setError("");
    setSaved(false);

    if (!name.trim()) {
      setError("Name cannot be empty.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("profiles")
      .update({
        full_name: name,
        target_level: targetLevel,
      })
      .eq("id", userId);

    setSaving(false);

    if (saveError) {
      setError(
        "Amniora could not save your settings right now. Please try again in a moment."
      );
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    await createNotification({
      userId,
      title: "Settings updated",
      message: "Your Amniora profile settings were saved successfully.",
      type: "account",
    });
  }

  if (loading) return <SettingsSkeleton />;

  if (error && !userId) {
    return (
      <ErrorState
        title="Unable to load settings"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto w-full max-w-6xl"
    >
      <PageHeader
        eyebrow="Settings"
        title="Account and preferences."
        description="Manage your Amniora account, security and signed-in preferences."
        className="rounded-[4px] border border-white/10 bg-[#071426] px-4 py-5 shadow-sm shadow-black/10 [&_.type-label]:!text-cyan-200 [&_h1]:!text-white [&_p:not(.type-label)]:!text-slate-200 sm:px-5"
      />

      <AnimatePresence>
        {(saved || error) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role={error ? "alert" : "status"}
            aria-live="polite"
            className={`mt-5 flex items-start gap-3 rounded-[4px] border px-4 py-3 text-sm ${
              error
                ? "border-red-300/25 bg-red-500/10 text-red-100"
                : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
            }`}
          >
            {saved && <CheckCircle2 size={18} aria-hidden="true" />}
            {error || "Settings saved successfully."}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-5">
        <nav
          aria-label="Settings categories"
          className="flex gap-1 overflow-x-auto rounded-[4px] border border-white/10 bg-[#071426] p-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible"
        >
          {categories.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveCategory(id)}
              aria-pressed={activeCategory === id}
              className={`flex shrink-0 items-center gap-2 rounded-[4px] border px-3 py-2 text-sm font-medium outline-none transition-[background-color,border-color,color] focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                activeCategory === id
                  ? "border-cyan-200/35 bg-cyan-300/10 text-white"
                  : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.045] hover:text-white"
              }`}
            >
              <Icon size={16} aria-hidden="true" className="shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {activeCategory === "profile" && (
          <SettingsSection
            id="profile"
            title="Profile"
            description="Update the profile fields Amniora currently supports."
            icon={<User size={18} aria-hidden="true" />}
          >
            <div className="grid max-w-2xl gap-5">
              <div>
                <label htmlFor="settings-name" className="text-sm font-medium text-white">
                  Full name
                </label>
                <Input
                  id="settings-name"
                  name="full_name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={`mt-2 ${darkFieldClassName}`}
                  fieldState={error === "Name cannot be empty." ? "error" : "default"}
                  aria-describedby={
                    error === "Name cannot be empty." ? "settings-name-error" : undefined
                  }
                />
                {error === "Name cannot be empty." && (
                  <p id="settings-name-error" className="mt-1.5 text-xs text-red-200">
                    {error}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="settings-email" className="text-sm font-medium text-white">
                  Email address
                </label>
                <Input
                  id="settings-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  disabled
                  className={`mt-2 ${darkFieldClassName}`}
                />
                <p className="mt-1.5 text-xs text-slate-300">
                  Your sign-in email cannot be changed from this page.
                </p>
              </div>

              <div>
                <label htmlFor="settings-target" className="text-sm font-medium text-white">
                  Target level
                </label>
                <Select
                  id="settings-target"
                  name="target_level"
                  value={targetLevel}
                  onChange={(event) => setTargetLevel(event.target.value)}
                  className={`mt-2 ${darkFieldClassName}`}
                  aria-describedby="settings-target-help"
                >
                  {targetLevels.map((levelOption) => (
                    <option key={levelOption} value={levelOption}>
                      {levelOption}
                    </option>
                  ))}
                </Select>
                <p id="settings-target-help" className="mt-1.5 text-xs text-slate-300">
                  Your actual level is earned through XP. Your target helps
                  Amniora guide your roadmap.
                </p>
              </div>

              <div className="grid divide-y divide-white/10 rounded-[3px] border border-white/10 bg-white/[0.035] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {[
                  ["Plan", plan],
                  ["Current level", level],
                  ["XP", xp.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-3">
                    <p className="text-xs text-slate-300">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                <Button onClick={saveProfile} loading={saving} loadingText="Saving...">
                  Save changes
                </Button>
              </div>
            </div>
          </SettingsSection>
          )}

          {activeCategory === "security" && (
          <SettingsSection
            id="security"
            title="Security"
            description="Use the existing secure recovery flow for password changes."
            icon={<Shield size={18} aria-hidden="true" />}
          >
            <div className="flex flex-col gap-4 rounded-[3px] border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Password</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Password changes are handled through the secure reset flow.
                </p>
              </div>
              <Link
                href="/forgot-password"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[4px] border border-white/15 bg-white/[0.045] px-4 text-sm font-semibold text-white outline-none transition-colors hover:border-cyan-300/35 hover:bg-white/[0.075] focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426]"
              >
                <KeyRound size={16} aria-hidden="true" />
                Send password reset email
              </Link>
            </div>
          </SettingsSection>
          )}

          {activeCategory === "preferences" && (
          <SettingsSection
            id="preferences"
            title="Preferences"
            description="Control the signed-in preferences currently available in Amniora."
            icon={<Bell size={18} aria-hidden="true" />}
          >
            <div className="rounded-[3px] border border-white/10 bg-white/[0.035] px-4">
              <button
                type="button"
                onClick={() => setNotifications(!notifications)}
                aria-pressed={notifications}
                className="flex w-full items-center justify-between gap-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              >
                <span>
                  <span className="block text-sm font-medium text-white">
                    In-app notification preference
                  </span>
                  <span className="mt-1 block text-sm text-slate-300">
                    Keep the existing workspace notification preference visible
                    without adding unsupported delivery channels.
                  </span>
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    notifications ? "bg-cyan-300" : "bg-white/20"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                      notifications ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>
          </SettingsSection>
          )}

          {activeCategory === "subscription" && (
          <SettingsSection
            id="subscription"
            title="Subscription"
            description="Review your current plan without changing subscription state."
            icon={<CreditCard size={18} aria-hidden="true" />}
          >
            <div className="flex flex-col gap-4 rounded-[3px] border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-300">
                  Current plan
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-base font-semibold text-white">{plan}</p>
                </div>
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-300">
                Plan changes are not managed from this private-beta settings
                workspace yet.
              </p>
            </div>
          </SettingsSection>
          )}
        </div>
      </div>
    </motion.div>
  );
}
