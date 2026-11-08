import type { WebSocketEvent } from "./types/engine";

const collisionPrefix = "The planned target already exists: ";

export function targetPrefix(prompt: string, suffix: string): string {
  const slug = prompt.slice(0, 160).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .match(/[a-z0-9]+/g)?.slice(0, 5).join("_").slice(0, 42).replace(/_+$/, "") || "task";
  return `${/^\d/.test(slug) ? `task_${slug}` : slug}_${suffix}`;
}

export function availableTarget(prefix: string, unavailable: ReadonlySet<string>): string {
  let filename = `${prefix}.py`;
  for (let index = 2; unavailable.has(filename.toLowerCase()); index += 1) {
    filename = `${prefix}_${index}.py`;
  }
  return filename;
}

export function executionPrompt(prompt: string, filename: string, conflicts: readonly string[]): string {
  const instruction = `Create a new standalone Python file for this task. Set the plan's target_filename to exactly ${JSON.stringify(filename)}, relative to the workspace. Leave all existing files intact.`;
  const previous = conflicts.length > 0
    ? `\nEarlier planning selected existing targets ${conflicts.map((conflict) => JSON.stringify(conflict)).join(", ")}. Use the new target filename above for this retry.`
    : "";
  return `${prompt}\n\n${instruction}${previous}`;
}

export function conflictingTarget(event: WebSocketEvent): string | undefined {
  if (event.stage !== "FAILURE" || (event.payload?.attempts ?? 0) !== 0 || !event.message.startsWith(collisionPrefix)) {
    return undefined;
  }
  const path = event.message.slice(collisionPrefix.length);
  const separator = path.includes("/") ? "/" : "\\";
  const filename = path.slice(path.lastIndexOf(separator) + 1);
  return filename.endsWith(".py") ? filename : undefined;
}
