// Fixed objection/question list the voice coach (Owner B) draws from during
// the ~60s objection phase. Grouped so the agent can pick a spread rather
// than four objections from the same angle.

export interface ObjectionPrompt {
  id: string;
  category: "price" | "trust" | "timing" | "competitor" | "technical";
  text: string;
}

export const OBJECTIONS: ObjectionPrompt[] = [
  { id: "obj-price-1", category: "price", text: "This is way more expensive than what we're paying now. Why should I switch?" },
  { id: "obj-price-2", category: "price", text: "I don't have budget approved for this quarter." },
  { id: "obj-trust-1", category: "trust", text: "How do I know this will actually work for a company our size?" },
  { id: "obj-trust-2", category: "trust", text: "Your last rep promised something similar and it didn't pan out." },
  { id: "obj-timing-1", category: "timing", text: "Can we revisit this in six months? We're slammed right now." },
  { id: "obj-timing-2", category: "timing", text: "I need to loop in my team before deciding anything." },
  { id: "obj-competitor-1", category: "competitor", text: "We're already talking to [Competitor] and they're cheaper." },
  { id: "obj-competitor-2", category: "competitor", text: "What makes you different from everyone else pitching me this month?" },
  { id: "obj-technical-1", category: "technical", text: "Does this integrate with our existing CRM without custom engineering work?" },
  { id: "obj-technical-2", category: "technical", text: "What happens to our data if we ever want to cancel?" },
];

/** Pick a small, varied set of objections for one training session. */
export function pickObjections(count = 4): ObjectionPrompt[] {
  const byCategory = new Map<string, ObjectionPrompt[]>();
  for (const o of OBJECTIONS) {
    const list = byCategory.get(o.category) ?? [];
    list.push(o);
    byCategory.set(o.category, list);
  }
  const categories = Array.from(byCategory.keys());
  const picked: ObjectionPrompt[] = [];
  let i = 0;
  while (picked.length < count && i < 20) {
    const cat = categories[i % categories.length];
    const options = byCategory.get(cat) ?? [];
    const next = options.find((o) => !picked.includes(o));
    if (next) picked.push(next);
    i++;
  }
  return picked;
}
