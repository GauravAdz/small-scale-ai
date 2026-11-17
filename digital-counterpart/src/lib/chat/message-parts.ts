import type { CounterpartDataParts, CounterpartMessage } from "@/types/chat";

/**
 * Return the newest value for one streamed data-part key.
 *
 * The SDK can append repeated data parts while a turn progresses. Keeping the
 * lookup and its one unavoidable runtime cast here gives renderers a typed API
 * and keeps protocol strings out of components.
 */
export function latestDataPart<Key extends keyof CounterpartDataParts>(
  message: CounterpartMessage,
  key: Key,
): CounterpartDataParts[Key] | undefined {
  const type = `data-${key}`;

  for (let index = message.parts.length - 1; index >= 0; index--) {
    const part = message.parts[index];
    if (part.type === type && "data" in part) {
      return part.data as CounterpartDataParts[Key];
    }
  }

  return undefined;
}
