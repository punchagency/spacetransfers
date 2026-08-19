import type { AiMessage, AiSendOptions } from "../../lib/hooks/useAiConversation";
import type { AiEditStatus } from "../../lib/hooks/useAiEdit";

/**
 * Everything the per-image AI panel needs, bundled so it can be threaded from
 * Artboard → CanvasContainer → ArtboardItem as a single prop instead of a dozen
 * individual ones. The conversation + edit state lives at the Artboard root
 * (one instance, so only one panel can ever be open); each ArtboardItem just
 * reads `openItemId` to know whether it's the one showing the panel.
 */
export interface AiPanelBridge {
  /** Id of the item whose panel is open, or null when none is. */
  openItemId: number | null;
  isRunning: boolean;
  status: AiEditStatus | null;
  messages: AiMessage[];
  /** Open the panel for a specific item (replaces any other open panel). */
  onOpen: (itemId: number) => void;
  onClose: () => void;
  onSend: (prompt: string, options?: AiSendOptions) => void;
  onCancel: () => void;
  /**
   * The open item's current image and its own AI edit chain. Passed through the
   * bridge rather than re-read inside the panel so the panel stays a pure view
   * — it never has to know how to find an item by id.
   */
  imageUrl?: string;
  editHistory?: Array<{ prompt: string; url: string; at: number }>;
  onRevertHistory?: (entryIndex: number) => void;
}
