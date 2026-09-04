export interface BackgroundRequest {
  prompt: string;
  aspectRatio: string;
  seed?: number;
  outputFormat: "png";
  referenceImage?: Buffer;
  referenceMimeType?: string;
}

export interface BackgroundProvider {
  readonly id: string;
  generate(request: BackgroundRequest): Promise<Buffer>;
}

export interface SegmentationProvider {
  readonly id: string;
  createMask(image: Buffer, mimeType: string): Promise<Buffer>;
}
