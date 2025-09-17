declare module 'pdfkit' {
  import type { Readable } from 'stream';
  interface PDFKitOptions {
    autoFirstPage?: boolean;
    bufferPages?: boolean;
    compress?: boolean;
    margin?: number;
    size?: string | [number, number];
  }
  class PDFDocument extends Readable {
    constructor(options?: PDFKitOptions);
    fontSize(size: number): this;
    text(text: string): this;
    moveDown(lines?: number): this;
    end(): void;
  }
  export default PDFDocument;
}

declare module 'csurf' {
  import type { RequestHandler } from 'express';

  type SameSiteOption = boolean | 'lax' | 'strict' | 'none';

  interface CookieOptions {
    key?: string;
    path?: string;
    maxAge?: number;
    signed?: boolean;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: SameSiteOption;
  }

  interface CsurfOptions {
    value?: (req: any) => string;
    cookie?: boolean | CookieOptions;
  }

  function csrf(options?: CsurfOptions): RequestHandler;
  export = csrf;
}
