import { lstat } from "node:fs/promises";

export async function assertRealDirectory(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${path}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

export async function assertRealFile(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${path}`);
  }
  if (!info.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}
