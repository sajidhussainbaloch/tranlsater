// Version registry. Protocol numbers are configurable via config/proxy.yml,
// but the proxy must know the numeric protocol id for the JSON status it sends
// and (later) which packet layouts to use. Add new versions here.

export const JAVA_VERSIONS: Record<string, number> = {
  '1.21.1': 767,
  '1.21.5': 770
}

export function javaProtocolNumber(version: string): number {
  const p = JAVA_VERSIONS[version]
  if (p === undefined) {
    throw new Error(`Unsupported Java version in config: ${version}. Known: ${Object.keys(JAVA_VERSIONS).join(', ')}`)
  }
  return p
}

export const BEDROCK_VERSIONS: Record<string, string> = {
  '26.40': '1.26.40'
}

/** bedrock-protocol library version string for a user-facing bedrock version. */
export function bedrockLibraryVersion(version: string): string {
  const v = BEDROCK_VERSIONS[version]
  if (v === undefined) {
    throw new Error(`Unsupported Bedrock version in config: ${version}. Known: ${Object.keys(BEDROCK_VERSIONS).join(', ')}`)
  }
  return v
}