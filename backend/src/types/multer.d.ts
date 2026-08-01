// Minimal local type shim for multer 2.x (which ships no types of its own).
//
// We deliberately do NOT install @types/multer: it depends on @types/express,
// and adding it makes npm re-resolve @types/express-serve-static-core, floating
// it from 5.0.6 to 5.1.x — which retypes `req.params.x` as `string | string[]`
// and breaks type-checking across the whole backend. This shim declares only
// the surface mediaController uses and pulls in nothing.
//
// Kept as an ambient (non-module) .d.ts so `declare module "multer"` provides
// the module's types. mediaController types the uploaded file inline rather
// than augmenting the global Express namespace (which would require this file
// to be a module and disable the ambient declaration).
declare module "multer" {
  import { RequestHandler } from "express";

  namespace multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
    }

    interface StorageEngine {
      _handleFile(req: any, file: File, cb: (error?: any, info?: Partial<File>) => void): void;
      _removeFile(req: any, file: File, cb: (error: Error | null) => void): void;
    }

    interface DiskStorageOptions {
      destination?:
        | string
        | ((req: any, file: File, cb: (error: Error | null, destination: string) => void) => void);
      filename?: (req: any, file: File, cb: (error: Error | null, filename: string) => void) => void;
    }

    interface Options {
      dest?: string;
      storage?: StorageEngine;
      limits?: {
        fileSize?: number;
        files?: number;
        fields?: number;
        [key: string]: number | undefined;
      };
    }

    interface Instance {
      single(fieldname: string): RequestHandler;
      array(fieldname: string, maxCount?: number): RequestHandler;
      fields(fields: { name: string; maxCount?: number }[]): RequestHandler;
      none(): RequestHandler;
      any(): RequestHandler;
    }
  }

  interface Multer {
    (options?: multer.Options): multer.Instance;
    diskStorage(options: multer.DiskStorageOptions): multer.StorageEngine;
    memoryStorage(): multer.StorageEngine;
  }

  const multer: Multer;
  export = multer;
}
