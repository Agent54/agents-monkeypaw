import * as fs from "node:fs/promises"

function isRecursive(options?: { recursive?: boolean } | BufferEncoding | null) {
  return typeof options === "object" && options !== null && "recursive" in options && options.recursive === true
}

function isEexist(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST"
}

export const mkdir: typeof fs.mkdir = async (path, options) => {
  try {
    return await fs.mkdir(path, options as never)
  } catch (error) {
    if (isRecursive(options) && isEexist(error)) {
      const stat = await fs.stat(path).catch(() => undefined)
      if (stat?.isDirectory()) return undefined as Awaited<ReturnType<typeof fs.mkdir>>
    }
    throw error
  }
}

export const appendFile = fs.appendFile
export const access = fs.access
export const chmod = fs.chmod
export const chown = fs.chown
export const constants = fs.constants
export const copyFile = fs.copyFile
export const cp = fs.cp
export const glob = fs.glob
export const lchmod = fs.lchmod
export const lchown = fs.lchown
export const link = fs.link
export const lstat = fs.lstat
export const lutimes = fs.lutimes
export const mkdtemp = fs.mkdtemp
export const mkdtempDisposable = fs.mkdtempDisposable
export const open = fs.open
export const opendir = fs.opendir
export const readFile = fs.readFile
export const readdir = fs.readdir
export const readlink = fs.readlink
export const realpath = fs.realpath
export const rename = fs.rename
export const rm = fs.rm
export const rmdir = fs.rmdir
export const stat = fs.stat
export const statfs = fs.statfs
export const symlink = fs.symlink
export const truncate = fs.truncate
export const unlink = fs.unlink
export const utimes = fs.utimes
export const watch = fs.watch
export const writeFile = fs.writeFile

export default {
  access,
  appendFile,
  chmod,
  chown,
  constants,
  copyFile,
  cp,
  glob,
  lchmod,
  lchown,
  link,
  lstat,
  lutimes,
  mkdir,
  mkdtemp,
  mkdtempDisposable,
  open,
  opendir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  symlink,
  truncate,
  unlink,
  utimes,
  watch,
  writeFile,
}
