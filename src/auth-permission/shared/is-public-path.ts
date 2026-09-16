export function isPublicPath(path: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((p) => path === p || path.startsWith(`${p}/`));
}
