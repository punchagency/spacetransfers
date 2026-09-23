import { useState, useEffect } from "react";

interface IntroAnimationProps {
  onComplete: () => void;
}

/**
 * The opening screen: a still of the earth, the name, then the tagline.
 *
 * The still is the point. The background behind the text used to be whatever had
 * downloaded so far — often black, because the animation is a video and the
 * poster was an 825KB PNG that hadn't arrived either. So the first thing a
 * customer saw was floating text on nothing, and it read as broken rather than
 * as loading. Now a 32KB still paints immediately (it is a frame of the video,
 * so nothing jumps) and the video fades in over it once it can actually play.
 *
 * The video is also H.264 MP4 rather than the HEVC .mov it was: Chrome cannot
 * play HEVC in a QuickTime container at all — `canPlayType("video/quicktime")`
 * is empty — so every Chrome visitor downloaded 9.3MB that could never render,
 * while the still they were looking at waited behind it in the queue.
 */
export default function IntroAnimation({ onComplete }: IntroAnimationProps) {
  const [currentFrame, setCurrentFrame] = useState(0);
  /** The video has enough data to show something; until then the still stands alone. */
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    // Frame 0: Logo (2s)
    // Frame 1: Blank/Transition (0.5s)
    // Frame 2: Tagline (3s)
    // End -> Home

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    timeouts.push(setTimeout(() => setCurrentFrame(1), 2000));
    timeouts.push(setTimeout(() => setCurrentFrame(2), 2500));
    timeouts.push(setTimeout(() => onComplete(), 5500));

    return () => timeouts.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <picture>
        <source srcSet="/space-bg.webp" type="image/webp" />
        <img
          src="/space-bg.jpg"
          alt=""
          aria-hidden
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
      <video
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
        style={{ opacity: videoReady ? 0.6 : 0 }}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/space-bg.webp"
        onCanPlay={() => setVideoReady(true)}
      >
        <source src="/space-video.mp4" type="video/mp4" />
      </video>

      {/* Content */}
      <div className="relative z-10 w-full h-full flex items-center justify-center">
        {currentFrame === 0 && (
          <div className="flex items-center gap-3">
            <span className="text-3xl md:text-[63px] font-bold text-white tracking-wide font-sans shimmer-text fade-in-out-2s-effects">
              spacetransfers
            </span>
            <img
              src="/space-facing-left.svg"
              alt="space"
              className="w-10 h-10 md:w-26 md:h-26 animate-bounce"
            />
          </div>
        )}

        {currentFrame === 2 && (
          <div className="px-10 text-center">
            <h1 className="text-3xl md:text-[63px] font-extrabold text-white drop-shadow-lg leading-tight shimmer-text fade-in-out-3s-effects md:whitespace-nowrap">
              DTF Transfers that are out of this world
            </h1>
          </div>
        )}
      </div>
    </div>
  );
}
