import type { ZCodeCommand } from "@zcode/shared";

const POSITIONAL_ARGUMENT_PATTERN = /\$(\d+)/g;

function splitArguments(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (escaping) current += "\\";
  if (current) result.push(current);
  return result;
}

export function resolveZcodeCommandPrompt(
  input: string,
  commands: readonly ZCodeCommand[],
): string {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return input;
  const name = `/${match[1]}`;
  const command = commands.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!command) return input;
  if (!command.enabled || (command.source === "plugin" && !command.pluginEnabled)) {
    throw new Error(`Custom command ${name} is disabled.`);
  }
  const template = command.prompt.trim();
  if (!template) throw new Error(`Custom command ${name} has an empty prompt.`);
  // ZCode 的动态 shell 扩展需要 CLI 执行环境；在 renderer 中执行会绕过 DSH 的工具审批。
  if (/!`[^`]*`/.test(template) || /```!\s*[\s\S]*?```/.test(template)) {
    throw new Error(`Custom command ${name} uses unsupported shell expansion.`);
  }
  const args = (match[2] ?? "").trim();
  const positional = splitArguments(args);
  let usedPlaceholder = template.includes("$ARGUMENTS");
  let body = template
    .replaceAll("$ARGUMENTS", args)
    .replace(POSITIONAL_ARGUMENT_PATTERN, (_, index: string) => {
      usedPlaceholder = true;
      return positional[Number(index) - 1] ?? "";
    });
  if (args && !usedPlaceholder) body = `${body.trimEnd()}\n\nUser arguments:\n${args}`;
  const source = command.source === "user" ? `${command.scope}/user` : "global/plugin";
  return [`Run custom command ${name}.`, `Command source: ${source}.`, "", body.trim()].join("\n");
}
