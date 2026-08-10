import { gsap } from "gsap";
import { CANVAS, ANIMATION } from "../../../../config/artboard.config";

export const animateToPosition = (
    element: HTMLElement,
    targetX: number,
    targetY: number,
    onComplete?: () => void
) => {
    gsap.to(element, {
        left: `${targetX * CANVAS.PIXELS_PER_INCH}px`,
        top: `${targetY * CANVAS.PIXELS_PER_INCH}px`,
        duration: 1.8,
        ease: "power2.inOut",
        onComplete,
    });
};

export const animateBounce = (element: HTMLElement, targetY: number, onImpact?: () => void, onComplete?: () => void) => {
    const tl = gsap.timeline({ onComplete });
    const startY = targetY * CANVAS.PIXELS_PER_INCH;
    const bounceHeight = 0.1 * CANVAS.PIXELS_PER_INCH; // Smaller bounce

    // Single small subtle bounce
    tl.to(element, {
        top: `${startY + bounceHeight}px`,
        duration: 0.25,
        ease: "power2.in",
        onComplete: onImpact
    })
        .to(element, {
            top: `${startY}px`,
            duration: 0.5,
            ease: "back.out(2)",
        });
};

export const animateShake = (element: HTMLElement) => {
    // Subtle, professional 'push' ripple effect
    const tl = gsap.timeline({
        onComplete: () => {
            gsap.set(element, { x: 0, rotation: 0, clearProps: "x,rotation" });
        }
    });

    tl.to(element, {
        x: 10,
        rotation: 1,
        duration: 0.2,
        ease: "power2.out"
    })
        .to(element, {
            x: -8,
            rotation: -0.8,
            duration: 0.4,
            ease: "sine.inOut"
        })
        .to(element, {
            x: 4,
            rotation: 0.4,
            duration: 0.5,
            ease: "sine.inOut"
        })
        .to(element, {
            x: 0,
            rotation: 0,
            duration: 1.2,
            ease: "elastic.out(1, 0.4)"
        });
};

export const animateItemPosition = (
    element: HTMLElement,
    posX: number,
    posY: number,
    gravityActive: boolean,
    fromX?: number,
    fromY?: number
) => {
    const PPI = CANVAS.PIXELS_PER_INCH;
    if (gravityActive && fromX !== undefined && fromY !== undefined) {
        // FLIP: React has already rendered the element at its final left/top,
        // so animate a transform offset from the OLD position back to zero.
        // Transforms are never written by React on this element, which means a
        // mid-animation re-render can't snap it to the destination or fight
        // the tween — the exact failure mode of the old left/top tween (and
        // the source of the random-tilt drift, which is gone on purpose).
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
