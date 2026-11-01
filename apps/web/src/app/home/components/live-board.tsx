"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { BOARD_TASKS, DIRECTION } from "../home-data";

const SESSION_SECONDS = 1500;
const WEEK_BARS = ["42%", "66%", "54%", "78%", "60%"] as const;
const WEEK_LABELS = ["M", "T", "W", "T", "F", "Today"] as const;

export function LiveBoard() {
  const boardRef = useRef<HTMLDivElement>(null);
  const demoTimers = useRef<number[]>([]);
  const interacted = useRef(false);
  const reduceMotion = useReducedMotion();

  const [done, setDone] = useState<boolean[]>(() => BOARD_TASKS.map((task) => task.done));
  const [secondsLeft, setSecondsLeft] = useState(SESSION_SECONDS);
  const [running, setRunning] = useState(false);
  const [dateLabel, setDateLabel] = useState("Your day");

  const count = done.filter(Boolean).length;
  const total = done.length;
  const pct = Math.round((count / total) * 100);
  const closed = count === total;
  const threadWidth = `${(count / total) * 100}%`;
  const todayHeight = `${18 + pct * 0.72}%`;
  const progress = `${((SESSION_SECONDS - secondsLeft) / SESSION_SECONDS) * 100}%`;
  const isRunning = running && secondsLeft > 0;

  useEffect(() => {
    try {
      // Locale and timezone are client-only, so SSR renders the neutral label.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDateLabel(
        new Date().toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
      );
    } catch {
      setDateLabel("Your day");
    }
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((left) => Math.max(0, left - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const stopTimers = () => {
      demoTimers.current.forEach((timer) => window.clearTimeout(timer));
      demoTimers.current = [];
    };

    const onInteract = () => {
      interacted.current = true;
      stopTimers();
    };

    board.addEventListener("pointerdown", onInteract);
    board.addEventListener("keydown", onInteract);

    if (reduceMotion || interacted.current || !("IntersectionObserver" in window)) {
      return () => {
        board.removeEventListener("pointerdown", onInteract);
        board.removeEventListener("keydown", onInteract);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        if (interacted.current) return;
        for (let index = 1; index < BOARD_TASKS.length; index += 1) {
          demoTimers.current.push(
            window.setTimeout(
              () => {
                setDone((current) => current.map((value, i) => (i === index ? true : value)));
              },
              900 + (index - 1) * 900,
            ),
          );
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(board);

    return () => {
      observer.disconnect();
      board.removeEventListener("pointerdown", onInteract);
      board.removeEventListener("keydown", onInteract);
      stopTimers();
    };
  }, [reduceMotion]);

  const toggleTask = (index: number) => {
    setDone((current) => current.map((value, i) => (i === index ? !value : value)));
  };

  const toggleTimer = () => {
    if (isRunning) {
      setRunning(false);
      return;
    }
    if (secondsLeft === 0) {
      setSecondsLeft(SESSION_SECONDS);
    }
    setRunning(true);
  };

  const timerLabel = isRunning
    ? "Pause"
    : secondsLeft === 0
      ? "Start again"
      : secondsLeft < SESSION_SECONDS
        ? "Resume"
        : "Start session";
  const minutes = Math.floor(secondsLeft / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (secondsLeft % 60).toString().padStart(2, "0");

  return (
    <div
      ref={boardRef}
      id="product"
      className={closed ? "home-board home-board--closed" : "home-board"}
    >
      <div className="home-thread" aria-hidden="true">
        <i className="home-thread__fill" style={{ width: threadWidth }} />
      </div>

      <div className="home-board__head">
        <b>Today</b>
        <span id="home-board-date">{closed ? "All done. Loop closed." : dateLabel}</span>
      </div>

      <div className="home-board__cols">
        <div className="home-board__col">
          <h3>Direction</h3>
          <ol className="home-path">
            {DIRECTION.map((item) => (
              <li key={item.text} className={item.current ? "is-now" : undefined}>
                <small>{item.label}</small>
                <b>{item.text}</b>
              </li>
            ))}
          </ol>
        </div>

        <div className="home-board__col">
          <h3>Today’s work</h3>
          <ul className="home-tasks">
            {BOARD_TASKS.map((task, index) => (
              <li key={task.label}>
                <label className="home-task">
                  <input
                    type="checkbox"
                    checked={done[index]}
                    onChange={() => toggleTask(index)}
                  />
                  <span>{task.label}</span>
                  <em>{task.kind}</em>
                </label>
              </li>
            ))}
          </ul>
          <div className="home-sum">
            <span aria-live="polite">
              {count} of {total} done
            </span>
            <span>
              Execution <b>{pct}%</b>
            </span>
          </div>
        </div>

        <div className="home-board__col">
          <h3>Focus</h3>
          <div
            className="home-ring"
            style={{ "--home-p": progress } as CSSProperties}
            role="timer"
            aria-label={`${minutes}:${seconds} remaining`}
          >
            <span>
              {minutes}:{seconds}
            </span>
          </div>
          <button className="home-btn home-btn--sm home-focus-btn" type="button" onClick={toggleTimer}>
            {timerLabel}
          </button>
          <div className="home-week" aria-hidden="true">
            {WEEK_BARS.map((height, index) => (
              <i key={`${height}-${index}`} style={{ "--home-h": height } as CSSProperties} />
            ))}
            <i
              className="is-today"
              style={{ "--home-h": todayHeight } as CSSProperties}
            />
          </div>
          <div className="home-week__labels" aria-hidden="true">
            {WEEK_LABELS.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
