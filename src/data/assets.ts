export interface Asset {
  id: string;
  name: string;
  size: string;
  type: "artwork" | "preview" | "proofs" | "production" | "documents";
  fileType: "pdf" | "png" | "jpg" | "xlsx";
  thumbnailUrl?: string | null;
}

export const MOCK_ASSETS: Asset[] = [
  {
    id: "1",
    name: "Space Sticker",
    size: "2.4 MB",
    type: "artwork",
    fileType: "pdf",
  },
  {
    id: "2",
    name: "Design Preview.png",
    size: "856 KB",
    type: "preview",
    fileType: "png",
  },
  {
    id: "3",
    name: "Space Man.pdf",
    size: "1.2 MB",
    type: "proofs",
    fileType: "pdf",
  },
  {
    id: "4",
    name: "Gangsheet Layout.pdf",
    size: "3.8 MB",
    type: "production",
    fileType: "pdf",
  },
  {
    id: "5",
    name: "Customer Mockup.jpg",
    size: "624 KB",
    type: "preview",
    fileType: "jpg",
  },
  {
    id: "6",
    name: "Print Specifications.xlsx",
    size: "45 KB",
    type: "documents",
    fileType: "xlsx",
  },
];
