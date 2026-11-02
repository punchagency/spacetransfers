import { imageCount } from "../../lib/failedUploads";
import { IssueChip } from "./IssueChip";

export const UPLOAD_GUIDANCE =
  "They are on your sheet, outlined in red, but only on this device. Retry them from the list at the bottom left of the sheet, or remove them. Until then the sheet is saved without them and can't go in the cart.";

/** Top-bar count of images that did not upload, in the red their outline carries on the sheet. */
export const UploadIssueChip = ({
  count = 0,
  onGoTo,
  compact,
}: {
  count?: number;
  onGoTo?: () => void;
  compact?: boolean;
}) => (
  <IssueChip
    count={count}
    // Short: a longer label pushed the brand name out of the bar. The hover
    // card and the list on the sheet say what failed.
    label="failed"
    tone="red"
    heading="Upload Check"
    lines={[`${imageCount(count)} didn't upload`]}
    guidance={UPLOAD_GUIDANCE}
    ariaLabel={`${imageCount(count)} didn't upload.`}
    onGoTo={onGoTo}
    compact={compact}
  />
);
