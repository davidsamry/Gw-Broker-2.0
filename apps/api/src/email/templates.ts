// Lightweight Handlebars-style template renderer. Substitutes {{var}}
// occurrences with the corresponding value from the context map. We
// deliberately do NOT pull in handlebars itself — the only feature we
// need is interpolation, no logic, no partials, no helpers. Keeping the
// dependency surface small keeps the bundle lean.
//
// Escaping: we DO NOT HTML-escape values. The expectation is the admin
// writes safe HTML in the template, and the values come from internal
// state (user.name, amount) — never raw user input from an untrusted
// source. If we ever pass user-supplied free text (e.g. ticket message
// body) we'll add an explicit {{{raw}}} vs {{escaped}} convention.
// For now, all template values flow through trusted backend paths.

const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(VAR_PATTERN, (_match, key: string) => {
    const v = vars[key]
    if (v == null) {
      // Leave the placeholder in so it's visible in the rendered email
      // that something is missing — easier to debug than a silent blank.
      return `{{${key}}}`
    }
    return String(v)
  })
}

/**
 * Extracts the list of distinct {{var}} names used in a template body.
 * Used by the admin endpoint when seeding the `variables` column from
 * a freshly-edited body — keeps the panel hints in sync with reality.
 */
export function extractTemplateVariables(template: string): string[] {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  // Reset lastIndex defensively (regex has /g flag — stateful across calls).
  VAR_PATTERN.lastIndex = 0
  while ((match = VAR_PATTERN.exec(template)) !== null) {
    found.add(match[1])
  }
  return Array.from(found).sort()
}
