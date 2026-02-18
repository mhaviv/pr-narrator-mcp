---
applyTo: "src/**/*.ts"
---

# TypeScript Review Rules

## Type Safety

- Strict null checks — no `!` non-null assertions without a comment justifying why it is safe
- All function parameters must be explicitly typed (no implicit `any`)
- Use `unknown` instead of `any` — narrow with type guards
- Flag `as any` casts — use `as Record<string, unknown>` or proper types instead
- Async functions must have explicit `Promise<T>` return types on public APIs
- Use optional chaining (`?.`) and nullish coalescing (`??`) over manual null checks

```typescript
// Avoid
const name = obj && obj.user && obj.user.name;

// Prefer
const name = obj?.user?.name;
```

## Zod Type Derivation

- Use `z.infer<typeof schema>` for deriving types from Zod schemas — never duplicate types manually
- Tool input types must always be derived from the tool's Zod schema

```typescript
// Avoid: manual type that duplicates the Zod schema
interface MyInput {
  repoPath?: string;
  summary?: string;
}

// Prefer: derive from Zod
export const mySchema = z.object({
  repoPath: z.string().optional().describe("Path to the git repository"),
  summary: z.string().optional().describe("Summary text"),
});
export type MyInput = z.infer<typeof mySchema>;
```

## Interface vs Type

- Use `interface` for object shapes, especially tool result types
- Use `type` only for unions, intersections, or mapped types
- Tool results must use `interface` with `Result` suffix

```typescript
// Prefer: interface for result objects
export interface GenerateCommitMessageResult {
  success: boolean;
  title: string;
  errors: string[];
}

// Acceptable: type for unions
type PrefixStyle = "capitalized" | "bracketed";
```

## Error Handling in Tools

- Tool handlers must never throw — return structured error results
- Use try/catch internally and populate the `errors` array

```typescript
// Avoid: throwing in a tool handler
export async function myTool(input: MyInput, config: Config) {
  const data = getSomething();
  if (!data) throw new Error("Not found");
  return data;
}

// Prefer: return structured error
export async function myTool(input: MyInput, config: Config): Promise<MyResult> {
  const data = getSomething();
  if (!data) {
    return { success: false, errors: ["Not found"], data: null };
  }
  return { success: true, data, errors: [] };
}
```

## Exports and Imports

- No default exports — named exports only
- ESM import paths must end with `.js` (even for `.ts` source files)
- Use `import type` for type-only imports

```typescript
// Correct
import { getConfig } from "./config/loader.js";
import type { Config } from "./config/schema.js";

// Wrong — missing .js extension (runtime ESM error)
import { getConfig } from "./config/loader";
```

## Tool Module Exports

Every file in `src/tools/` must export exactly:

1. A Zod schema: `export const toolNameSchema = z.object({...})`
2. An input type: `export type ToolNameInput = z.infer<typeof toolNameSchema>`
3. A result interface: `export interface ToolNameResult { ... }`
4. An async handler: `export async function toolName(input, config): Promise<ToolNameResult>`
5. A tool definition: `export const toolNameTool = { name, description, inputSchema, handler }`

## Collections and Iteration

- Prefer `Array.from(map.entries())` over `[...map.entries()]` for Map/Set conversions when chaining
- Use `Map` and `Set` for lookups instead of array `.find()` or `.includes()` in loops
- Prefer `for...of` over `forEach` for side-effectful iteration

```typescript
// Prefer
const sorted = Array.from(byExtension.entries())
  .sort((a, b) => b[1].count - a[1].count);

// Avoid repeated array searches
for (const item of items) {
  if (allowedList.includes(item)) { ... }  // O(n²)
}
// Prefer
const allowedSet = new Set(allowedList);
for (const item of items) {
  if (allowedSet.has(item)) { ... }  // O(n)
}
```

## String Handling

- Use template literals over string concatenation
- Use destructuring for accessing multiple properties from the same object

```typescript
// Avoid
const message = prefix + ": " + title;

// Prefer
const message = `${prefix}: ${title}`;
```

## Config Usage

- Config is passed as a parameter to tool handlers — never import `getConfig()` in tool files
- Access config fields via the passed `config` object
- New config properties must be added to the Zod schema in `schema.ts` with `.default()` and `.describe()`
