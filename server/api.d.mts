import type { IncomingMessage, ServerResponse } from 'node:http'

export declare const APP_ROOT: string
export declare const CACHE_DIR: string
export declare const VERSION: string
export declare function loadToken(): string
export declare function fetchProjects(): Promise<unknown>
export declare function fetchProject(id: string): Promise<unknown>
export declare function resolveRef(ref: string): Promise<string>
export declare function cachedProject(ref: string): unknown | null
export declare function cachedProjects(): unknown | null
export declare function createApiHandler(opts?: {
  onShutdown?: () => void
}): (req: IncomingMessage, res: ServerResponse, next: () => void) => void
