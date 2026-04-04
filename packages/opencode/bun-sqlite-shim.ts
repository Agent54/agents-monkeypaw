import { DatabaseSync } from "node:sqlite"

type RunResult = {
  changes: number
  lastInsertRowid: number | bigint
}

type NativeStatement = ReturnType<DatabaseSync["prepare"]>

class Statement {
  #stmt: NativeStatement
  #raw = false

  constructor(stmt: NativeStatement) {
    this.#stmt = stmt
  }

  raw(flag = true) {
    this.#raw = flag
    return this
  }

  run(...params: unknown[]) {
    const res = this.#stmt.run(...(params as never[]))
    return {
      changes: Number(res.changes ?? 0),
      lastInsertRowid: res.lastInsertRowid ?? 0,
    } satisfies RunResult
  }

  all(...params: unknown[]) {
    if (!this.#raw) return this.#stmt.all(...(params as never[]))
    const rows = this.#stmt.all(...(params as never[]))
    if (!Array.isArray(rows)) return rows
    return rows.map((row) =>
      row && typeof row === "object" && !Array.isArray(row) ? Object.values(row) : row,
    )
  }

  get(...params: unknown[]) {
    if (!this.#raw) return this.#stmt.get(...(params as never[]))
    const row = this.#stmt.get(...(params as never[]))
    if (!row || typeof row !== "object" || Array.isArray(row)) return row
    return Object.values(row)
  }
}

class BunDatabase {
  #db: DatabaseSync

  constructor(filename: string, options?: { create?: boolean; readonly?: boolean }) {
    this.#db = new DatabaseSync(filename, {
      open: true,
      readOnly: options?.readonly ?? false,
    })
  }

  prepare(sql: string) {
    return new Statement(this.#db.prepare(sql))
  }

  query(sql: string) {
    return this.prepare(sql)
  }

  run(sql: string, ...params: unknown[]) {
    return this.prepare(sql).run(...params)
  }

  exec(sql: string, ...params: unknown[]) {
    if (params.length === 0) {
      this.#db.exec(sql)
      return
    }
    return this.prepare(sql).run(...params)
  }

  transaction<T>(fn: (db: BunDatabase) => T, options?: { behavior?: "deferred" | "immediate" | "exclusive" }) {
    const sql =
      options?.behavior === "immediate"
        ? "BEGIN IMMEDIATE"
        : options?.behavior === "exclusive"
          ? "BEGIN EXCLUSIVE"
          : "BEGIN"

    this.#db.exec(sql)
    try {
      const res = fn(this)
      this.#db.exec("COMMIT")
      return res
    } catch (err) {
      this.#db.exec("ROLLBACK")
      throw err
    }
  }

  close() {
    this.#db.close()
  }
}

export { BunDatabase, BunDatabase as Database }
export default BunDatabase