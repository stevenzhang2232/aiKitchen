export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function bad(message: string, code?: string): never {
  throw new HttpError(400, message, code);
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

export function conflict(message: string, code?: string): never {
  throw new HttpError(409, message, code);
}
