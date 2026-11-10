"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, MessageSquare, Send } from "lucide-react";
import Button from "@/app/components/ui/Button";

const ratings = [
  { value: "poor", label: "Poor" },
  { value: "fair", label: "Fair" },
  { value: "good", label: "Good" },
  { value: "excellent", label: "Excellent" },
];

const categories = [
  ["incorrect_or_contradictory_evidence", "Incorrect or contradictory evidence"],
  ["task_cannot_be_completed", "Task cannot be completed"],
  ["grading_problem", "Grading problem"],
  ["offensive_or_inappropriate_content", "Offensive or inappropriate content"],
  ["privacy_or_security_concern", "Privacy or security concern"],
  ["export_or_download_problem", "Export or download problem"],
  ["other", "Other"],
];

const feedbackMax = 1500;
const complaintMax = 3000;
const taskReferenceMax = 100;

type FeedbackRow = {
  reference: string;
  rating: string;
  improvementNote: string;
  updatedAt: string;
};

type ComplaintRow = {
  reference: string;
  categoryLabel: string;
  status: string;
  createdAt: string;
};

export default function LabFeedbackCard({ labId }: { labId: string }) {
  const [rating, setRating] = useState("good");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<FeedbackRow | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [feedbackState, setFeedbackState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [complaintState, setComplaintState] = useState<"idle" | "open" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [complaintCategory, setComplaintCategory] = useState("incorrect_or_contradictory_evidence");
  const [complaintDescription, setComplaintDescription] = useState("");
  const [taskReference, setTaskReference] = useState("");
  const [latestReference, setLatestReference] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [feedbackRes, complaintsRes] = await Promise.all([
          fetch(`/api/labs/${encodeURIComponent(labId)}/feedback`, { headers: { Accept: "application/json" } }),
          fetch(`/api/labs/${encodeURIComponent(labId)}/complaints`, { headers: { Accept: "application/json" } }),
        ]);
        const feedbackData = await feedbackRes.json();
        const complaintData = await complaintsRes.json();
        if (cancelled) return;
        if (feedbackRes.ok && feedbackData.feedback) {
          setFeedback(feedbackData.feedback);
          setRating(feedbackData.feedback.rating || "good");
          setNote(feedbackData.feedback.improvementNote || "");
        }
        if (complaintsRes.ok && Array.isArray(complaintData.complaints)) {
          setComplaints(complaintData.complaints);
        }
      } catch {
        if (!cancelled) setMessage("Feedback status could not be loaded right now.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [labId]);

  const noteRemaining = feedbackMax - note.length;
  const complaintRemaining = complaintMax - complaintDescription.length;
  const taskReferenceRemaining = taskReferenceMax - taskReference.length;
  const canSubmitComplaint = useMemo(() => complaintDescription.trim().length > 0 && complaintState !== "submitting", [complaintDescription, complaintState]);

  async function submitFeedback() {
    setFeedbackState("loading");
    setMessage("");
    try {
      const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/feedback`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, improvementNote: note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackState("error");
        setMessage(data.error || "Feedback could not be saved.");
        return;
      }
      setFeedback(data.feedback);
      setFeedbackState("success");
      setMessage(data.message || "Sample feedback saved locally.");
    } catch {
      setFeedbackState("error");
      setMessage("Feedback could not be saved right now.");
    }
  }

  async function submitComplaint() {
    if (!canSubmitComplaint) return;
    setComplaintState("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/complaints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: complaintCategory,
          description: complaintDescription,
          taskReference,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setComplaintState("error");
        setMessage(data.error || "Report could not be submitted.");
        return;
      }
      setLatestReference(data.reference || data.complaint?.reference || "");
      setComplaints((current) => data.complaint ? [data.complaint, ...current] : current);
      setComplaintDescription("");
      setTaskReference("");
      setComplaintState("success");
      setMessage(data.message || "Sample report complete. Nothing was sent for review.");
    } catch {
      setComplaintState("error");
      setMessage("Report could not be submitted right now.");
    }
  }

  return (
    <section
      data-saved-investigation-feedback="dark"
      className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white"
      aria-labelledby="saved-investigation-feedback-title"
    >
      <div className="border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
        <div className="flex items-start gap-space-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-cyan-100/15 bg-[#071426] text-cyan-100">
            <MessageSquare size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="type-label text-cyan-200/75">Feedback</p>
            <h2 id="saved-investigation-feedback-title" className="type-section-title mt-0.5 text-white">
              Try local feedback
            </h2>
            <p className="type-body mt-space-2 max-w-2xl text-slate-300">
              Explore the feedback form with sample text. It stays in this local server session and is not sent for review.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-space-5 p-space-4 sm:p-space-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-space-4">
          <fieldset>
            <legend className="type-caption mb-space-2 font-semibold text-slate-100">Overall rating</legend>
            <div className="grid grid-cols-2 gap-space-2 sm:flex sm:flex-wrap">
              {ratings.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={rating === item.value}
                  onClick={() => setRating(item.value)}
                  className={`type-button h-10 rounded-[4px] border px-3 outline-none transition-[background-color,border-color,color] focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] ${
                    rating === item.value
                      ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block" htmlFor="lab-feedback-note">
            <span className="type-caption mb-space-2 block font-semibold text-slate-100">
              What could be improved? <span className="font-normal text-slate-400">Optional</span>
            </span>
            <textarea
              id="lab-feedback-note"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, feedbackMax))}
              maxLength={feedbackMax}
              rows={4}
              placeholder="Share anything about clarity, realism, pacing, evidence, or task wording."
              className="type-body min-h-28 w-full resize-y rounded-[4px] border border-cyan-100/15 bg-[#081827] px-3 py-3 leading-6 text-white outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20"
            />
          </label>
          <div className="flex flex-col gap-space-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="type-caption text-slate-400">{noteRemaining.toLocaleString()} characters remaining</p>
            <Button
              className="border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white"
              onClick={submitFeedback}
              loading={feedbackState === "loading"}
              loadingText="Saving…"
              leadingIcon={<CheckCircle2 size={16} aria-hidden="true" />}
            >
              {feedback ? "Update local feedback" : "Save local feedback"}
            </Button>
          </div>
        </div>

        <aside className="rounded-[3px] border border-white/10 bg-[#061222] p-space-4">
          <div className="flex items-start gap-space-3">
            <Flag size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-200" />
            <div>
              <h3 className="type-body font-semibold text-slate-100">Example issue report</h3>
              <p className="type-caption mt-space-1 leading-5 text-slate-300">
                This sample form demonstrates issue reporting. It does not contact anyone or create a support request.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-space-4 w-full border-amber-300/25 bg-transparent text-amber-100 hover:border-amber-200/45 hover:bg-amber-300/10 hover:text-white"
            onClick={() => setComplaintState(complaintState === "open" ? "idle" : "open")}
            leadingIcon={<AlertTriangle size={15} aria-hidden="true" />}
          >
            Try sample report
          </Button>
          {complaints.length > 0 && (
            <div className="mt-space-4 space-y-space-2">
              <p className="type-caption font-semibold text-slate-100">Recent reports</p>
              {complaints.slice(0, 2).map((complaint) => (
                <div key={complaint.reference} className="rounded-[3px] border border-white/10 bg-[#071426] p-space-3">
                  <div className="flex items-center justify-between gap-space-2">
                    <span className="type-caption font-semibold text-slate-100">{complaint.reference}</span>
                    <span
                      className={`type-caption rounded-[3px] border px-2 py-0.5 font-semibold ${
                        complaint.status === "resolved"
                          ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-100"
                      }`}
                    >
                      {complaint.status}
                    </span>
                  </div>
                  <p className="type-caption mt-1 text-slate-400">{complaint.categoryLabel}</p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {(complaintState === "open" || complaintState === "submitting" || complaintState === "error") && (
        <div className="border-t border-white/10 bg-[#061222] p-space-4 sm:p-space-5">
          <div className="grid gap-space-4 lg:grid-cols-2">
            <label className="block" htmlFor="lab-complaint-category">
              <span className="type-caption mb-space-2 block font-semibold text-slate-100">Problem category</span>
              <select
                id="lab-complaint-category"
                value={complaintCategory}
                onChange={(event) => setComplaintCategory(event.target.value)}
                className="type-body h-11 w-full rounded-[4px] border border-cyan-100/15 bg-[#081827] px-3 text-white outline-none focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20"
              >
                {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block" htmlFor="lab-complaint-task-reference">
              <span className="type-caption mb-space-2 block font-semibold text-slate-100">
                Task number or reference <span className="font-normal text-slate-400">Optional</span>
              </span>
              <input
                id="lab-complaint-task-reference"
                value={taskReference}
                onChange={(event) => setTaskReference(event.target.value.slice(0, taskReferenceMax))}
                maxLength={taskReferenceMax}
                className="type-body h-11 w-full rounded-[4px] border border-cyan-100/15 bg-[#081827] px-3 text-white outline-none focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20"
                placeholder="Example: Task 3"
              />
              <span className="type-caption mt-1 block text-slate-400">{taskReferenceRemaining} characters remaining</span>
            </label>
          </div>
          <label className="mt-space-4 block" htmlFor="lab-complaint-description">
            <span className="type-caption mb-space-2 block font-semibold text-slate-100">Describe the problem</span>
            <textarea
              id="lab-complaint-description"
              value={complaintDescription}
              onChange={(event) => setComplaintDescription(event.target.value.slice(0, complaintMax))}
              maxLength={complaintMax}
              rows={5}
              placeholder="Describe what appears wrong. Do not include passwords, private keys, access tokens, production logs, or other sensitive information."
              required
              aria-invalid={complaintState === "error"}
              className={`type-body min-h-32 w-full resize-y rounded-[4px] border bg-[#081827] px-3 py-3 leading-6 text-white outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:ring-2 ${
                complaintState === "error"
                  ? "border-red-300/35 focus:border-red-200 focus:ring-red-300/20"
                  : "border-cyan-100/15 focus:border-cyan-300/55 focus:ring-cyan-300/20"
              }`}
            />
          </label>
          <p className="type-caption mt-space-2 leading-5 text-slate-400">
            Use invented sample text. This form demonstrates the interface and does not submit a support request.
          </p>
          <div className="mt-space-4 flex flex-col gap-space-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="type-caption text-slate-400">{complaintRemaining.toLocaleString()} characters remaining</p>
            <div className="flex flex-col-reverse gap-space-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                className="border-white/10 bg-[#081827] text-slate-200 hover:bg-[#0b2033] hover:text-white"
                onClick={() => setComplaintState("idle")}
              >
                Cancel
              </Button>
              <Button
                className="border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white"
                onClick={submitComplaint}
                disabled={!canSubmitComplaint}
                loading={complaintState === "submitting"}
                loadingText="Submitting…"
                leadingIcon={<Send size={16} aria-hidden="true" />}
              >
                Finish sample report
              </Button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          role={feedbackState === "error" || complaintState === "error" ? "alert" : "status"}
          className={`border-t border-white/10 p-space-4 type-caption leading-5 ${
            feedbackState === "error" || complaintState === "error"
              ? "bg-red-950/25 text-red-100"
              : "bg-cyan-300/10 text-cyan-100"
          }`}
        >
          {message}{latestReference ? ` Reference ${latestReference}.` : ""}
        </div>
      )}
    </section>
  );
}
