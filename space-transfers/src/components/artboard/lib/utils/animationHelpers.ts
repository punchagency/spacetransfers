import { gsap } from "gsap";
import { CANVAS, ANIMATION } from "../../../../config/artboard.config";

export const animateItemPosition = (
    element: HTMLElement,
    posX: number,
    posY: number,
    gravityActive: boolean,
    fromX?: number,
    fromY?: number
) => {
    const PPI = CANVAS.PIXELS_PER_INCH;
    /*
     * A tween still running from an earlier move owns `left`/`top` until it
     * finishes, and would drag the element back to that older target after this
     * one placed it. That is what left a duplicate drawn on top of its original:
     * the copy's first tween (towards its 0.5in offset) outlived the move
     * auto-nest made a moment later, so the piece was stored beside the original
     * but drawn over it — and clicks there picked the wrong piece.
     */
    gsap.killTweensOf(element, "left,top");
    if (gravityActive && fromX !== undefined && fromY !== undefined) {
        gsap.set(element, { left: `${posX * PPI}px`, top: `${posY * PPI}px` });
        gsap.fromTo(element,
            { x: (fromX - posX) * PPI, y: (fromY - posY) * PPI },
            {
                x: 0,
                y: 0,
                duration: 0.5,
                ease: "back.out(1.2)",
                overwrite: "auto",
            });
    } else {
        gsap.to(element, {
            left: `${posX * PPI}px`,
            top: `${posY * PPI}px`,
            duration: ANIMATION.NORMAL_DURATION,
            ease: "power2.out",
        });
    }
};
