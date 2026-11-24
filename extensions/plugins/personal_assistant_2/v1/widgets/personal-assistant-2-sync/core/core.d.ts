// Types of the shared offline core, for the phone and desktop apps.
export type Status = 'open' | 'started' | 'done'
export interface Task {
  id: string; title: string; context: 'work' | 'private'; duration: number; deadline: string | null
  must_do: boolean; status: Status; started_at: string | null; finished_at: string | null
  parent: string | null; rev: number
}
export interface Operation {
  op_id: string; at: string; type: 'task' | 'inbox' | 'schedule' | 'settings' | 'error'
  action: 'create' | 'update' | 'delete' | 'resolve'; id: string | null
  fields?: Record<string, unknown>; base_rev?: number | null
}
export interface Storage {
  durable: boolean
  load(): Promise<{ meta: Record<string, unknown>; ops: Operation[]; rejected: { op: Operation; message: string }[] }>
  add(op: Operation): Promise<void>
  settle(change: { state?: unknown; done?: string[]; rejected?: { op: Operation; message: string }[] }): Promise<void>
  dropRejected(id: string): Promise<void>
  setMeta(name: string, value: unknown): Promise<void>
}
export interface StoreOptions {
  storage: Storage
  /** Rejects with error.offline === true when the server cannot be reached. */
  send(path: string, body: unknown): Promise<unknown>
  now?(): Date
  timezone?: string | null
  online?(): boolean
  exclusively?<T>(work: () => Promise<T>): Promise<T>
  broadcast?(): void
  id?(): string
}
