export interface ArtboardItem {
  id: number;
  url: string;
  rotation: number;
  locked: boolean;
  expanded: boolean;
  flipped: boolean;
  autoCrop: boolean;
  copies: number;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  linked: boolean;
  price: number;
  name?: string;
  isAnimating?: boolean;
  dropY?: number;
  velocityY?: number;
  gravityActive?: boolean;
  originalUrl?: string;
  originalWidthIn?: number;
  originalHeightIn?: number;
  isDropping?: boolean;
}

export interface ArtboardProps {
  onHeaderInfoChange?: (info: HeaderInfo) => void;
  showRulers?: boolean;
  showGrid?: boolean;
  snapToGrid?: boolean;
  showMargins?: boolean;
  marginSize?: number;
  autoNestStickers?: boolean;
  spacing?: number;
  onRequestAutoNest?: (enabled: boolean) => void;
  onDataChange?: (data: any) => void;
  initialData?: any;
  onAddToCart?: (item: any) => void;
  onActionPerformed?: (action: { type: string; id?: number; payload?: any }) => void;
}

export interface HeaderInfo {
  hasItem: boolean;
  areaSf?: number;
  widthIn?: number;
  heightIn?: number;
  name?: string;
  price?: number;
  imageNames?: string[];
}
