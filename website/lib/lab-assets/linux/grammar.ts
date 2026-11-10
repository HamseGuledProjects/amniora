/** Choose an English indefinite article for common Linux host-role labels. */
export function linuxIndefiniteArticle(value: string) {
  const word = value.trim().split(/\s+/, 1)[0] || "";
  if (/^[aeiou]/i.test(word)) return "an";
  // Initialisms such as SSH are spoken with an initial vowel sound ("ess").
  if (/^[AEFHILMNORSX](?:[A-Z0-9.-]|$)/.test(word)) return "an";
  return "a";
}
