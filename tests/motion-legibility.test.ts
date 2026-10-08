// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
const css = readFileSync("src/ui/styles.css", "utf8");
afterEach(() => {
  document.head.querySelector("[data-motion-css]")?.remove();
  document.body.innerHTML = "";
});
it("reduced-motion cues outline the destination without painting over its piece and life badge", () => {
  const style = document.createElement("style");
  style.dataset.motionCss = "";
  style.textContent = css;
  document.head.append(style);
  document.body.innerHTML =
    '<div class="board-effects reduced"><span class="action-cue cue-summon">召喚</span><span class="action-cue cue-capture">+9糧</span></div>';
  for (const cue of document.querySelectorAll(".action-cue")) {
    const computed = getComputedStyle(cue);
    expect(computed.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(computed.color).toBe("rgba(0, 0, 0, 0)");
    expect(computed.animation).toBe("none");
    expect(cue.textContent?.length).toBeGreaterThan(0);
  }
});
