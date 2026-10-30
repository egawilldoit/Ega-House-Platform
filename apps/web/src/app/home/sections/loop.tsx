import type { CSSProperties } from "react";

import { RevealOnView } from "../components/reveal-on-view";
import { LOOP_STEPS } from "../home-data";

export function Loop() {
  return (
    <RevealOnView className="home-loop">
      <section id="loop" className="home-loop__section">
        <div className="home-wrap">
          <h2>A loop, not a list.</h2>
          <p className="home-loop__sub">
            Most tools stop at the task. EGA House carries each one back to the goal it serves,
            then back again at the end of the week.
          </p>

          <ol className="home-steps">
            {LOOP_STEPS.map((step, index) => (
              <li key={step.title}>
                <div
                  className={
                    index === 1 ? "home-art home-art--days" : "home-art"
                  }
                  aria-hidden="true"
                >
                  {index === 0 ? (
                    <>
                      <i style={{ width: "100%" }} />
                      <i style={{ width: "72%", marginLeft: "12%" }} />
                      <i style={{ width: "46%", marginLeft: "24%" }} />
                    </>
                  ) : null}
                  {index === 1 ? (
                    <>
                      {[
                        { height: "45%", on: true },
                        { height: "70%", on: true },
                        { height: "35%", on: false },
                        { height: "90%", on: true },
                        { height: "55%", on: false },
                        { height: "65%", on: true },
                        { height: "30%", on: false },
                      ].map((bar, barIndex) => (
                        <i
                          key={bar.height}
                          className={bar.on ? "is-on" : undefined}
                          style={
                            {
                              "--home-h": bar.height,
                              "--home-k": barIndex,
                            } as CSSProperties
                          }
                        />
                      ))}
                    </>
                  ) : null}
                  {index === 2 ? <div className="home-mini" /> : null}
                  {index === 3 ? (
                    <>
                      <i className="is-plan" style={{ width: "100%" }} />
                      <i className="is-done" style={{ width: "72%" }} />
                    </>
                  ) : null}
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>

          <div className="home-back" aria-hidden="true">
            <span>The review sets next week’s goals</span>
          </div>
        </div>
      </section>
    </RevealOnView>
  );
}
