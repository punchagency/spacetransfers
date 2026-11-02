export interface Asset {
  id: string;
  name: string;
  size: string;
  type: "artwork" | "preview" | "proofs" | "production" | "documents";
  fileType: "pdf" | "png" | "jpg" | "xlsx";
  thumbnailUrl?: string | null;
}
