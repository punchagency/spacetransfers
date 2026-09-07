import type { AvailabilityStatus } from '../../types/partners';

/**
 * Whether a partner is currently taking work.
 *
 * Deliberately not the same thing as account status. `status` (Active /
 * Suspended / Rejected) is a judgement about the account and decides whether
 * they can sign in at all; this is operational — an Active partner who has
 * paused themselves is in good standing and simply is not being auto-assigned
 * right now.
 *
 * The colours match the pill the partner sees in their own portal, so the two
 * sides describe the same state in the same words: green Open, amber Paused.
 */

const CONFIG: Record<AvailabilityStatus, { label: string; className: string; dot: string }> = {
  open: {
    label: 'Open',
    className: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
  },
  paused: {
    label: 'Paused',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-400',
  },
};

export const AvailabilityBadge = ({
  status,
  capacityPaused = false,
  size = 'md',
  className = '',
}: {
  status: AvailabilityStatus;
  /**
   * True when the *system* paused them for hitting their job limit rather than
   * a person choosing to. It reads the same on the pill but means something
   * different: it clears itself when their active jobs drop, so an admin should
   * not chase it.
   */
  capacityPaused?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) => {
  const cfg = CONFIG[status] ?? CONFIG.open;
  const sizing = size === 'sm' ? 'px-2 py-0.5 text-[10px] gap-1' : 'px-2.5 py-1 text-[11px] gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${sizing} ${cfg.className} ${className}`}
      title={
        status === 'paused'
          ? capacityPaused
            ? 'Paused automatically because they are at their maximum active jobs. Reopens on its own once a job finishes.'
            : 'Not receiving auto-assigned orders. Jobs already assigned are unaffected.'
          : 'Accepting auto-assigned orders.'
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
      {status === 'paused' && capacityPaused && (
        <span className="font-medium opacity-70">· at capacity</span>
      )}
    </span>
  );
};
