"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import BrandLogo from "./BrandLogo";
import {
  Bot,
  CheckCircle2,
  FileArchive,
  FlaskConical,
  Gauge,
  Home,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
} from "lucide-react";

gsap.registerPlugin(useGSAP);

type TourAct = "dashboard" | "generate" | "investigate";
type TourMode = "desktop" | "mobile";

type TourControl = {
  id: TourAct;
  label: string;
  time: number;
};

const fixture = {
  title: "Linux Cron Review",
  category: "Linux",
  difficulty: "Intermediate",
  duration: "30 mins",
  metrics: [
    ["Labs", "12"],
    ["XP", "2,840"],
    ["Streak", "4 days"],
  ],
  recentLab: "Linux Cron Review",
  nav: ["Dashboard", "AI Tutor", "Generate Labs", "Saved Labs", "Learning Roadmap", "Progress"],
  evidence: [
    ["assets/docs/change_request.md", "Change"],
    ["assets/scheduled/cron.d/platform-sync", "Cron"],
  ],
  taskTitle: "Map change to cron activity",
  deliverable: "Compare the cron definition with the change record.",
  preview: "*/15 * * * * svc-report platform-sync.sh",
  hint: "Check the cron definition before naming the account.",
} as const;

const controls = [
  { id: "dashboard", label: "Dashboard", time: 0 },
  { id: "generate", label: "Generate", time: 3.8 },
  { id: "investigate", label: "Investigate", time: 8.7 },
] as const satisfies readonly TourControl[];

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const mobileTourQuery = "(max-width: 600px)";
const animatedElementSelector = [
  ".product-tour__cursor",
  ".product-tour__click",
  ".product-tour__mobile-step",
  ".product-tour__scene",
  ".product-tour__field",
  ".product-tour__progress-row",
  ".product-tour__ready",
  ".product-tour__task",
  ".product-tour__evidence-row",
  ".product-tour__evidence-preview",
  ".product-tour__hint",
  ".product-tour__touch-ripple",
  ".product-tour__end-state",
].join(", ");

function modeForWidth(width: number): TourMode {
  return width <= 600 ? "mobile" : "desktop";
}

export default function ProductProofDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const controlTweenRef = useRef<gsap.core.Tween | null>(null);
  const activeActRef = useRef<TourAct>("dashboard");
  const tourModeRef = useRef<TourMode>("desktop");
  const hiddenRef = useRef(false);
  const userPausedRef = useRef(false);
  const interactionPausedRef = useRef(false);
  const [activeAct, setActiveAct] = useState<TourAct>("dashboard");
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [autoPaused, setAutoPaused] = useState(true);
  const [ready, setReady] = useState(false);
  const [tourMode, setTourMode] = useState<TourMode>("desktop");
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [animationEpoch, setAnimationEpoch] = useState(0);

  const setAct = useCallback((act: TourAct) => {
    if (activeActRef.current === act) return;
    activeActRef.current = act;
    setActiveAct(act);
  }, []);

  const syncPlayback = useCallback(() => {
    const timeline = timelineRef.current;
    const shouldPause = userPausedRef.current || interactionPausedRef.current || hiddenRef.current;
    setAutoPaused(shouldPause);
    if (!timeline || reducedMotion) return;
    if (shouldPause) timeline.pause();
    else timeline.play();
  }, [reducedMotion]);

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let releaseFrame = 0;
    const applyMeasuredMode = () => {
      frame = 0;
      const nextMode = modeForWidth(window.innerWidth);
      if (tourModeRef.current === nextMode) return;
      tourModeRef.current = nextMode;
      controlTweenRef.current?.kill();
      controlTweenRef.current = null;
      timelineRef.current?.pause(0).kill();
      timelineRef.current = null;
      setReady(false);
      setModeTransitioning(true);
      setAct("dashboard");
      setTourMode(nextMode);
      setAnimationEpoch((value) => value + 1);
      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = window.requestAnimationFrame(() => {
        releaseFrame = window.requestAnimationFrame(() => {
          releaseFrame = 0;
          setModeTransitioning(false);
        });
      });
    };
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyMeasuredMode);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [setAct]);

  useEffect(() => {
    const update = () => {
      hiddenRef.current = document.hidden;
      syncPlayback();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [syncPlayback]);


  const timelineData = useMemo(() => ({ controls }), []);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const select = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
      const scene = (id: TourAct) => select(`[data-tour-scene="${id}"]`);
      const mobileStep = (id: TourAct) => select(`[data-mobile-tour-step="${id}"]`);
      const cursorTarget = () => select(".product-tour__cursor");
      const clickTarget = () => select(".product-tour__click");
      const animatedTargets = () => select(animatedElementSelector);
      const addSet = (timeline: gsap.core.Timeline, targets: Element[], vars: gsap.TweenVars, position?: gsap.Position) => {
        if (targets.length > 0) timeline.set(targets, vars, position);
        return timeline;
      };
      const addTo = (timeline: gsap.core.Timeline, targets: Element[], vars: gsap.TweenVars, position?: gsap.Position) => {
        if (targets.length > 0) timeline.to(targets, vars, position);
        return timeline;
      };
      const addFromTo = (timeline: gsap.core.Timeline, targets: Element[], fromVars: gsap.TweenVars, toVars: gsap.TweenVars, position?: gsap.Position) => {
        if (targets.length > 0) timeline.fromTo(targets, fromVars, toVars, position);
        return timeline;
      };
      const setTargets = (targets: Element[], vars: gsap.TweenVars) => {
        if (targets.length > 0) gsap.set(targets, vars);
      };
      const killAndClearTargets = (targets: Element[]) => {
        if (targets.length === 0) return;
        gsap.killTweensOf(targets);
        gsap.set(targets, { clearProps: "all" });
      };
      const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
      const targetPoint = (selector: string, fallbackX: number, fallbackY: number) => {
        const target = root.querySelector<HTMLElement>(selector);
        const frame = root.querySelector<HTMLElement>(".product-tour__frame");
        if (!frame) return { x: fallbackX, y: fallbackY };
        const cursor = root.querySelector<HTMLElement>(".product-tour__cursor");
        const click = root.querySelector<HTMLElement>(".product-tour__click");
        const cursorWidth = cursor?.offsetWidth || 20;
        const cursorHeight = cursor?.offsetHeight || 20;
        const clickSize = Math.max(click?.offsetWidth || 0, click?.offsetHeight || 0);
        const guardX = Math.max(cursorWidth, clickSize) + 8;
        const guardY = Math.max(cursorHeight, clickSize) + 8;
        const maxX = Math.max(0, frame.clientWidth - guardX);
        const maxY = Math.max(0, frame.clientHeight - guardY);
        if (!target) return { x: clamp(fallbackX, 4, maxX), y: clamp(fallbackY, 4, maxY) };
        const targetRect = target.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const x = targetRect.left - frameRect.left + targetRect.width * 0.62 - cursorWidth * 0.12;
        const y = targetRect.top - frameRect.top + targetRect.height * 0.56 - cursorHeight * 0.08;
        return {
          x: clamp(x, 4, maxX),
          y: clamp(y, 4, maxY),
        };
      };
      const moveCursor = (selector: string, fallbackX: number, fallbackY: number, duration = 0.74) => {
        const targets = cursorTarget();
        const timeline = gsap.timeline();
        if (targets.length === 0) return timeline.to({}, { duration });
        return timeline.to(targets, {
          x: () => targetPoint(selector, fallbackX, fallbackY).x,
          y: () => targetPoint(selector, fallbackX, fallbackY).y,
          duration,
          ease: "power3.inOut",
        });
      };
      const press = () => {
        const cursor = cursorTarget();
        const click = clickTarget();
        const timeline = gsap.timeline();
        if (cursor.length === 0 || click.length === 0) return timeline.to({}, { duration: 0.6 });
        return timeline
          .to(cursor, { scale: 0.88, duration: 0.12, ease: "power2.out" })
          .to(click, { autoAlpha: 1, scale: 1, duration: 0.16, ease: "power2.out" }, "<")
          .to(cursor, { scale: 1, duration: 0.16, ease: "power2.out" })
          .to(click, { autoAlpha: 0, scale: 1.45, duration: 0.32, ease: "power2.out" }, "<");
      };

      const resetAnimatedElements = (options: { clearTweens?: boolean } = {}) => {
        const { clearTweens = true } = options;
        if (clearTweens) killAndClearTargets(animatedTargets());
        setTargets(cursorTarget(), { autoAlpha: 0, x: 34, y: 72, scale: 1 });
        setTargets(select(".product-tour__mobile-step"), { autoAlpha: 0, y: 8 });
        setTargets(mobileStep("dashboard"), { autoAlpha: 1, y: 0 });
        setTargets(clickTarget(), { autoAlpha: 0, scale: 0.4 });
        setTargets(scene("dashboard"), { autoAlpha: 1, xPercent: 0 });
        setTargets(scene("generate"), { autoAlpha: 0, xPercent: 4 });
        setTargets(scene("investigate"), { autoAlpha: 0, xPercent: 4 });
        setTargets(select(".product-tour__field"), { backgroundColor: "#0e2034", borderColor: "rgba(148, 163, 184, 0.22)" });
        setTargets(select(".product-tour__progress-row"), { autoAlpha: 0.38, x: -8 });
        setTargets(select(".product-tour__ready"), { autoAlpha: 0, y: 8 });
        setTargets(select(".product-tour__task"), { clipPath: "inset(0 0 100% 0)", autoAlpha: 0.7 });
        setTargets(select(".product-tour__evidence-row"), { backgroundColor: "#0d1d30", borderColor: "rgba(148, 163, 184, 0.18)" });
        setTargets(select(".product-tour__evidence-preview"), { autoAlpha: 0, y: 8, clipPath: "inset(0 0 28% 0)" });
        setTargets(select(".product-tour__hint"), { autoAlpha: 0, y: 8 });
        setTargets(select(".product-tour__touch-ripple"), { autoAlpha: 0, scale: 0.72 });
      };

      resetAnimatedElements();
      setReady(false);

      if (reducedMotion) {
        setTargets(cursorTarget(), { autoAlpha: 0, display: "none" });
        setTargets(select(".product-tour__mobile-step"), { autoAlpha: 0, y: 8 });
        setTargets(mobileStep("investigate"), { autoAlpha: 1, y: 0 });
        setTargets(scene("dashboard"), { autoAlpha: 1, xPercent: 0 });
        setTargets(scene("generate"), { autoAlpha: 0, xPercent: 4 });
        setTargets(scene("investigate"), { autoAlpha: 1, xPercent: 0 });
        setTargets(select(".product-tour__task"), { clipPath: "inset(0 0 0% 0)", autoAlpha: 1 });
        setTargets(select(".product-tour__evidence-preview"), { autoAlpha: 1, y: 0, clipPath: "inset(0 0 0% 0)" });
        setTargets(select(".product-tour__hint"), { autoAlpha: 1, y: 0 });
        setAct("investigate");
        setReady(true);
        timelineRef.current = null;
        return;
      }

      const media = gsap.matchMedia();
      media.add(mobileTourQuery, () => {
        setTargets(cursorTarget(), { autoAlpha: 0, display: "none" });
        return () => setTargets(cursorTarget(), { clearProps: "display" });
      });
      media.add(`(min-width: 601px)`, () => {
        setTargets(cursorTarget(), { clearProps: "display" });
        return () => undefined;
      });


      const master = gsap.timeline({
        repeat: -1,
        repeatDelay: 0.45,
        defaults: { ease: "power2.out" },
        repeatRefresh: true,
        onRepeat: () => setAct("dashboard"),
      });

      master.addLabel("dashboard", timelineData.controls[0].time);
      master.call(() => setAct("dashboard"), undefined, "dashboard");
      addSet(master, select(".product-tour__mobile-step"), { autoAlpha: 0, y: 8 }, "dashboard");
      addTo(master, mobileStep("dashboard"), { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out" }, "dashboard");
      addSet(master, cursorTarget(), { autoAlpha: 1 }, "dashboard+=0.25");
      master.add(moveCursor('[data-tour-target="recent-lab"]', 330, 232, 0.9), "dashboard+=0.45");
      addTo(master, select('[data-tour-target="recent-lab"]'), { borderColor: "rgba(125, 211, 252, 0.48)", backgroundColor: "#122941", duration: 0.32 }, "<0.45");
      master.add(moveCursor('[data-tour-target="generate-action"]', 570, 82, 0.95), "dashboard+=1.85");
      addTo(master, select('[data-tour-target="generate-action"]'), { backgroundColor: "#0d6a83", borderColor: "rgba(125, 211, 252, 0.72)", duration: 0.28 }, "<0.6");
      master.add(press(), "dashboard+=3.05");

      master.addLabel("generate", timelineData.controls[1].time);
      master.call(() => setAct("generate"), undefined, "generate");
      addTo(master, select(".product-tour__mobile-step"), { autoAlpha: 0, y: 8, duration: 0.22, ease: "power2.out" }, "generate");
      addTo(master, mobileStep("generate"), { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out" }, "generate+=0.03");
      addTo(master, scene("dashboard"), { autoAlpha: 0, xPercent: -3, duration: 0.5, ease: "power2.inOut" }, "generate");
      addFromTo(master, scene("generate"), { autoAlpha: 0, xPercent: 4 }, { autoAlpha: 1, xPercent: 0, duration: 0.55, ease: "power2.inOut" }, "generate+=0.05");
      master.add(moveCursor('[data-tour-target="category"]', 368, 198, 0.58), "generate+=0.72");
      addTo(master, select('[data-tour-target="category"]'), { borderColor: "rgba(125, 211, 252, 0.6)", backgroundColor: "#12324d", duration: 0.24 }, "<0.25");
      master.add(press(), "generate+=1.22");
      master.add(moveCursor('[data-tour-target="difficulty"]', 370, 278, 0.5), "generate+=1.72");
      addTo(master, select('[data-tour-target="difficulty"]'), { borderColor: "rgba(125, 211, 252, 0.58)", backgroundColor: "#12324d", duration: 0.24 }, "<0.2");
      master.add(press(), "generate+=2.14");
      master.add(moveCursor('[data-tour-target="duration"]', 370, 354, 0.5), "generate+=2.56");
      addTo(master, select('[data-tour-target="duration"]'), { borderColor: "rgba(125, 211, 252, 0.58)", backgroundColor: "#12324d", duration: 0.24 }, "<0.2");
      master.add(press(), "generate+=2.95");
      master.add(moveCursor('[data-tour-target="generate-submit"]', 548, 412, 0.64), "generate+=3.3");
      addTo(master, select('[data-tour-target="generate-submit"]'), { backgroundColor: "#0d6a83", borderColor: "rgba(125, 211, 252, 0.72)", duration: 0.24 }, "<0.35");
      master.add(press(), "generate+=3.95");
      addTo(master, select(".product-tour__touch-ripple"), { autoAlpha: 1, scale: 1, duration: 0.22, ease: "power2.out" }, "generate+=3.95");
      addTo(master, select(".product-tour__touch-ripple"), { autoAlpha: 0, scale: 1.22, duration: 0.38, ease: "power2.out" }, "generate+=4.13");

      master.addLabel("progress", 7.85);
      addTo(master, select(".product-tour__progress-row"), { autoAlpha: 1, x: 0, stagger: 0.26, duration: 0.34 }, "progress");
      addTo(master, select(".product-tour__ready"), { autoAlpha: 1, y: 0, duration: 0.38 }, "progress+=0.82");

      master.addLabel("investigation", timelineData.controls[2].time);
      master.call(() => setAct("investigate"), undefined, "investigation");
      addTo(master, select(".product-tour__mobile-step"), { autoAlpha: 0, y: 8, duration: 0.22, ease: "power2.out" }, "investigation");
      addTo(master, mobileStep("investigate"), { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out" }, "investigation+=0.03");
      addTo(master, scene("generate"), { autoAlpha: 0, xPercent: -3, duration: 0.48, ease: "power2.inOut" }, "investigation");
      addFromTo(master, scene("investigate"), { autoAlpha: 0, xPercent: 4 }, { autoAlpha: 1, xPercent: 0, duration: 0.55, ease: "power2.inOut" }, "investigation+=0.04");
      addTo(master, select(".product-tour__task"), { clipPath: "inset(0 0 0% 0)", autoAlpha: 1, duration: 0.55, ease: "power2.inOut" }, "investigation+=0.45");
      master.add(moveCursor('[data-tour-target="task-one"]', 294, 188, 0.72), "investigation+=0.72");
      master.add(press(), "investigation+=1.42");
      master.add(moveCursor('[data-tour-target="evidence-definition"]', 336, 318, 0.66), "investigation+=1.86");
      addTo(master, select('[data-tour-target="evidence-definition"]'), { backgroundColor: "#12324d", borderColor: "rgba(125, 211, 252, 0.64)", duration: 0.24 }, "<0.38");
      master.add(press(), "investigation+=2.46");
      addTo(master, select(".product-tour__evidence-preview"), { autoAlpha: 1, y: 0, clipPath: "inset(0 0 0% 0)", duration: 0.5, ease: "power2.out" }, "investigation+=2.62");
      master.add(moveCursor('[data-tour-target="hint"]', 444, 395, 0.68), "investigation+=3.14");
      addTo(master, select('[data-tour-target="hint"]'), { backgroundColor: "#12324d", borderColor: "rgba(125, 211, 252, 0.6)", duration: 0.24 }, "<0.42");
      master.add(press(), "investigation+=3.82");
      addTo(master, select(".product-tour__hint"), { autoAlpha: 1, y: 0, duration: 0.45 }, "investigation+=3.98");
      master.add(moveCursor('[data-tour-target="rest"]', 618, 418, 0.75), "investigation+=4.6");
      addTo(master, select(".product-tour__end-state"), { autoAlpha: 1, y: 0, duration: 0.42 }, "investigation+=5.05");
      master.to({}, { duration: 1.15 });
      addTo(master, [...scene("generate"), ...scene("investigate")], { autoAlpha: 0, xPercent: 4, duration: 0.5, ease: "power2.inOut" });
      addTo(master, scene("dashboard"), { autoAlpha: 1, xPercent: 0, duration: 0.5, ease: "power2.inOut" }, "<");
      master.call(() => {
        resetAnimatedElements({ clearTweens: false });
        setAct("dashboard");
      }, undefined, ">-0.02");

      timelineRef.current = master;

      let geometryFrame = 0;
      const refreshGeometry = () => {
        if (geometryFrame) window.cancelAnimationFrame(geometryFrame);
        geometryFrame = window.requestAnimationFrame(() => {
          geometryFrame = 0;
          const timeline = timelineRef.current;
          if (!timeline) return;
          const time = timeline.time();
          const wasPaused = timeline.paused();
          timeline.invalidate();
          timeline.time(time, false);
          if (window.innerWidth > 600) {
            const activeTarget = activeActRef.current === "generate"
              ? targetPoint('[data-tour-target="category"]', 368, 198)
              : activeActRef.current === "investigate"
                ? targetPoint('[data-tour-target="task-one"]', 294, 188)
                : targetPoint('[data-tour-target="recent-lab"]', 330, 232);
            setTargets(cursorTarget(), { x: activeTarget.x, y: activeTarget.y });
          }
          if (wasPaused) timeline.pause();
          else syncPlayback();
        });
      };
      const frame = root.querySelector<HTMLElement>(".product-tour__frame");
      const geometryObserver = new ResizeObserver(refreshGeometry);
      geometryObserver.observe(root);
      if (frame) geometryObserver.observe(frame);
      window.addEventListener("resize", refreshGeometry, { passive: true });
      window.addEventListener("orientationchange", refreshGeometry);
      void document.fonts?.ready.then(refreshGeometry).catch(() => undefined);

      setReady(true);
      syncPlayback();

      return () => {
        if (geometryFrame) window.cancelAnimationFrame(geometryFrame);
        controlTweenRef.current?.kill();
        controlTweenRef.current = null;
        geometryObserver.disconnect();
        window.removeEventListener("resize", refreshGeometry);
        window.removeEventListener("orientationchange", refreshGeometry);
        master.kill();
        media.revert();
        killAndClearTargets(animatedTargets());
        timelineRef.current = null;
      };
    },
    { scope: rootRef, dependencies: [reducedMotion, tourMode, animationEpoch], revertOnUpdate: true },
  );

  const setUserPauseState = useCallback((value: boolean) => {
    userPausedRef.current = value;
    setUserPaused(value);
    syncPlayback();
  }, [syncPlayback]);

  const setInteractionPauseState = useCallback((value: boolean) => {
    interactionPausedRef.current = value;
    syncPlayback();
  }, [syncPlayback]);

  const seekToAct = useCallback((act: TourAct) => {
    const timeline = timelineRef.current;
    userPausedRef.current = true;
    setUserPaused(true);
    setAct(act);
    if (reducedMotion || !timeline) return;
    timeline.pause();
    controlTweenRef.current?.kill();
    controlTweenRef.current = timeline.tweenTo(act === "investigate" ? "investigation" : act, { duration: 0.52, ease: "power2.inOut" });
  }, [reducedMotion, setAct]);

  const restart = useCallback(() => {
    const timeline = timelineRef.current;
    userPausedRef.current = false;
    setUserPaused(false);
    setAct("dashboard");
    if (!timeline || reducedMotion) return;
    timeline.restart();
    syncPlayback();
  }, [reducedMotion, setAct, syncPlayback]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = controls.findIndex((item) => item.id === activeAct);
    if (event.key === "Home") return seekToAct("dashboard");
    if (event.key === "End") return seekToAct("investigate");
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = controls[(index + delta + controls.length) % controls.length];
    seekToAct(next.id);
  }

  return (
    <section
      ref={rootRef}
      className="product-tour motion-proof-enter"
      aria-label="Amniora compact product teaser"
      data-product-proof="compact-gsap-tour"
      data-tour-act={activeAct}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-tour-ready={ready ? "true" : "false"}
      data-tour-mode={tourMode}
      data-tour-transitioning={modeTransitioning ? "true" : "false"}
      data-tour-animation-epoch={animationEpoch}
      data-cursor-geometry="measured-clamped"
      data-tour-paused={autoPaused || reducedMotion ? "true" : "false"}
      onMouseEnter={() => setInteractionPauseState(true)}
      onMouseLeave={() => setInteractionPauseState(false)}
      onFocusCapture={() => setInteractionPauseState(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteractionPauseState(false);
      }}
    >
      <div className="product-tour__header">
        <div>
          <p className="product-tour__eyebrow">Product tour</p>
          <h2>See Amniora in motion.</h2>
          <p>Generate a lab, open it, and start investigating evidence.</p>
        </div>
        <div className="product-tour__controls" aria-label="Tour controls">
          <button type="button" onClick={() => setUserPauseState(!userPaused)} aria-pressed={userPaused || reducedMotion}>
            {userPaused || reducedMotion ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            {userPaused || reducedMotion ? "Play" : "Pause"}
          </button>
          <button type="button" onClick={restart}>
            <RotateCcw size={15} aria-hidden="true" />
            Restart
          </button>
        </div>
      </div>

      <div className="product-tour__frame" data-tour-frame="true">
        <div className="product-tour__cursor" aria-hidden="true">
          <span className="product-tour__cursor-shape" />
          <span className="product-tour__click" />
        </div>
        {tourMode === "desktop" ? (
          <>
            <aside className="product-tour__sidebar" aria-label="Synthetic Amniora navigation">
              <div className="product-tour__brand"><BrandLogo variant="icon" theme="dark" size="md" /></div>
              <div className="product-tour__nav-list">
                {fixture.nav.map((item) => (
                  <span key={item} className="product-tour__nav-item" data-active={navIsActive(item, activeAct) ? "true" : "false"}>
                    {navIcon(item)}
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            </aside>
            <div className="product-tour__main">
              <div className="product-tour__topbar">
                <div>
                  <p>{topbarRoute(activeAct)}</p>
                  <strong>{topbarStatus(activeAct)}</strong>
                </div>
                <span className="product-tour__status">{activeAct === "investigate" ? "Ready to investigate" : "Synthetic demo"}</span>
              </div>
              <div className="product-tour__stage" id="product-tour-stage">
                <DashboardAct />
                <GenerateAct />
                <InvestigateAct />
              </div>
            </div>
          </>
        ) : (
          <div className="product-tour__mobile-shell" aria-label="Mobile Amniora product teaser">
            <MobileDashboardStep />
            <MobileGenerateStep />
            <MobileInvestigateStep />
          </div>
        )}
      </div>

      <div className="product-tour__footer">
        <div className="product-tour__progress" role="tablist" aria-label="Product teaser acts" onKeyDown={onKeyDown}>
          {controls.map((control) => (
            <button
              key={control.id}
              type="button"
              role="tab"
              aria-controls="product-tour-stage"
              aria-selected={activeAct === control.id}
              data-active={activeAct === control.id ? "true" : "false"}
              onClick={() => seekToAct(control.id)}
            >
              {control.label}
            </button>
          ))}
        </div>
        <p>Demonstration uses synthetic data.</p>
      </div>
    </section>
  );
}

function navIsActive(item: string, act: TourAct) {
  if (act === "dashboard") return item === "Dashboard";
  if (act === "generate") return item === "Generate Labs";
  return item === "Saved Labs";
}

function topbarRoute(act: TourAct) {
  if (act === "dashboard") return "Dashboard";
  if (act === "generate") return "Generate Labs";
  return "Saved Labs";
}

function topbarStatus(act: TourAct) {
  if (act === "dashboard") return "Learning workspace";
  if (act === "generate") return "Preparing lab";
  return "Ready to investigate";
}

function navIcon(item: string) {
  if (item === "Dashboard") return <Home size={14} aria-hidden="true" />;
  if (item === "AI Tutor") return <Bot size={14} aria-hidden="true" />;
  if (item === "Generate Labs") return <FlaskConical size={14} aria-hidden="true" />;
  if (item === "Saved Labs") return <FileArchive size={14} aria-hidden="true" />;
  if (item === "Learning Roadmap") return <ListChecks size={14} aria-hidden="true" />;
  return <Gauge size={14} aria-hidden="true" />;
}

function DashboardAct() {
  return (
    <section className="product-tour__scene product-tour__scene--dashboard" data-tour-scene="dashboard" aria-label="Synthetic dashboard act">
      <div className="product-tour__scene-head">
        <div>
          <p className="product-tour__label">Dashboard</p>
          <h3>Welcome back.</h3>
        </div>
        <button className="product-tour__primary" type="button" tabIndex={-1} data-tour-target="generate-action">
          <FlaskConical size={14} aria-hidden="true" />
          Generate New Lab
        </button>
      </div>
      <div className="product-tour__metrics">
        {fixture.metrics.map(([label, value]) => (
          <span key={label}>
            <em>{label}</em>
            <strong>{value}</strong>
          </span>
        ))}
      </div>
      <div className="product-tour__dashboard-grid">
        <div className="product-tour__panel">
          <p className="product-tour__label">Recent lab</p>
          <div className="product-tour__recent" data-tour-target="recent-lab">
            <Search size={14} aria-hidden="true" />
            <span>{fixture.recentLab}</span>
            <em>In progress</em>
          </div>
        </div>
        <div className="product-tour__panel product-tour__nudge">
          <MessageCircle size={16} aria-hidden="true" />
          <strong>Guidance is available when you need it.</strong>
        </div>
      </div>
    </section>
  );
}

function GenerateAct() {
  return (
    <section className="product-tour__scene product-tour__scene--generate" data-tour-scene="generate" aria-label="Synthetic generate lab act">
      <div className="product-tour__scene-head">
        <div>
          <p className="product-tour__label">Generate Labs</p>
          <h3>Create a lab.</h3>
        </div>
        <span className="product-tour__badge">Private beta</span>
      </div>
      <div className="product-tour__generate-grid">
        <form className="product-tour__form" aria-label="Synthetic generate lab form">
          <label>
            <span>Category</span>
            <output className="product-tour__field" data-tour-target="category">{fixture.category}</output>
          </label>
          <label>
            <span>Difficulty</span>
            <output className="product-tour__field" data-tour-target="difficulty">{fixture.difficulty}</output>
          </label>
          <label>
            <span>Duration</span>
            <output className="product-tour__field" data-tour-target="duration">{fixture.duration}</output>
          </label>
          <button className="product-tour__primary" type="button" tabIndex={-1} data-tour-target="generate-submit">
            Generate Lab
          </button>
        </form>
        <div className="product-tour__panel product-tour__build">
          <p className="product-tour__label">Progress</p>
          <span className="product-tour__progress-row">Preparing lab</span>
          <span className="product-tour__progress-row">Building evidence</span>
          <span className="product-tour__progress-row">Ready</span>
          <strong className="product-tour__ready"><CheckCircle2 size={14} aria-hidden="true" /> {fixture.title}</strong>
        </div>
      </div>
    </section>
  );
}

function InvestigateAct() {
  return (
    <section className="product-tour__scene product-tour__scene--investigate" data-tour-scene="investigate" aria-label="Synthetic investigation act">
      <div className="product-tour__scene-head">
        <div>
          <p className="product-tour__label">Saved Investigation</p>
          <h3>{fixture.title}</h3>
        </div>
        <span className="product-tour__badge" data-tone="ready">Ready to investigate</span>
      </div>
      <article className="product-tour__task" data-tour-target="task-one">
        <div className="product-tour__task-head">
          <span>1</span>
          <div>
            <p className="product-tour__label">Task 1</p>
            <h4>{fixture.taskTitle}</h4>
          </div>
        </div>
        <div className="product-tour__task-body">
          <div className="product-tour__evidence-list">
            {fixture.evidence.map(([path, label], index) => (
              <button
                key={path}
                type="button"
                tabIndex={-1}
                className="product-tour__evidence-row technical-value"
                data-tour-target={index === 1 ? "evidence-definition" : undefined}
              >
                <code>{path}</code>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="product-tour__deliverable">
            <p className="product-tour__label">Deliverable</p>
            <p>{fixture.deliverable}</p>
            <button type="button" tabIndex={-1} data-tour-target="hint">
              <Lightbulb size={13} aria-hidden="true" />
              Hint
            </button>
          </div>
        </div>
      </article>
      <div className="product-tour__investigation-side">
        <div className="product-tour__evidence-preview">
          <p className="product-tour__label">Evidence preview</p>
          <code>assets/scheduled/cron.d/platform-sync</code>
          <span>{fixture.preview}</span>
        </div>
        <div className="product-tour__hint">
          <p className="product-tour__label">Hint</p>
          <p>{fixture.hint}</p>
        </div>
        <div className="product-tour__end-state" data-tour-target="rest">Ready to investigate</div>
      </div>
    </section>
  );
}
function MobileDashboardStep() {
  return (
    <section className="product-tour__mobile-step product-tour__mobile-step--dashboard" data-mobile-tour-step="dashboard" aria-label="Mobile dashboard summary">
      <div className="product-tour__mobile-topline">
        <BrandLogo variant="icon" theme="dark" size="md" />
        <span>Dashboard</span>
      </div>
      <h3>Continue your investigation practice.</h3>
      <div className="product-tour__mobile-metrics">
        {fixture.metrics.map(([label, value]) => (
          <span key={label}>
            <em>{label}</em>
            <strong>{value}</strong>
          </span>
        ))}
      </div>
      <div className="product-tour__mobile-card" data-mobile-tour-target="recent-lab">
        <Search size={14} aria-hidden="true" />
        <span>{fixture.recentLab}</span>
        <em>Resume</em>
      </div>
    </section>
  );
}

function MobileGenerateStep() {
  return (
    <section className="product-tour__mobile-step product-tour__mobile-step--generate" data-mobile-tour-step="generate" aria-label="Mobile lab generation">
      <div className="product-tour__mobile-topline">
        <FlaskConical size={16} aria-hidden="true" />
        <span>Generate a lab</span>
      </div>
      <h3>Choose the case shape.</h3>
      <div className="product-tour__mobile-form">
        <span><em>Category</em><strong>{fixture.category}</strong></span>
        <span><em>Difficulty</em><strong>{fixture.difficulty}</strong></span>
        <span><em>Duration</em><strong>{fixture.duration}</strong></span>
      </div>
      <div className="product-tour__mobile-action">
        <span className="product-tour__touch-ripple" aria-hidden="true" />
        Generate Investigation
      </div>
      <div className="product-tour__mobile-progress" aria-label="Synthetic generation progress">
        <span>Preparing lab</span>
        <span>Building evidence</span>
        <strong><CheckCircle2 size={13} aria-hidden="true" /> Ready</strong>
      </div>
    </section>
  );
}

function MobileInvestigateStep() {
  return (
    <section className="product-tour__mobile-step product-tour__mobile-step--investigate" data-mobile-tour-step="investigate" aria-label="Mobile saved investigation preview">
      <div className="product-tour__mobile-topline">
        <FileArchive size={16} aria-hidden="true" />
        <span>Saved lab</span>
      </div>
      <h3>{fixture.title}</h3>
      <article className="product-tour__mobile-task">
        <p className="product-tour__label">Task 1</p>
        <h4>{fixture.taskTitle}</h4>
        <code className="technical-value">assets/scheduled/cron.d/platform-sync</code>
        <p>{fixture.deliverable}</p>
      </article>
      <div className="product-tour__mobile-action" data-tone="ready">Open investigation</div>
    </section>
  );
}
