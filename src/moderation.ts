export type Flag = "insult" | "threat" | "shouting";
export interface Verdict {
  ok: boolean;
  flag?: Flag;
}

const INSULTS = /\b(idiot|stupid|dumb|moron|useless|pathetic|bastard|jerk|loser|shut up|bodoh|sial|babi|celaka|bangang|fool|trash|scum|hate you|asshole|bitch)\b/i;
const SWEARS = /\b(f+u+c+k+\w*|shit\w*|crap|damn you)\b/i;
const THREATS = /\b(kill|beat|hurt|smash|punch|stab|burn)\b.{0,12}\b(you|him|her|them|your)\b|\bi('| wi)ll (get|find|teach) you\b|\bor else\b/i;

export function moderate(text: string): Verdict {
  const t = text.trim();
  if (THREATS.test(t)) return { ok: false, flag: "threat" };
  if (INSULTS.test(t) || SWEARS.test(t)) return { ok: false, flag: "insult" };
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 14 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) return { ok: false, flag: "shouting" };
  return { ok: true };
}

export function modWarning(flag: Flag, strikes: number): string {
  const base: Record<Flag, string> = {
    insult: "That message was held back because it may hurt the other person. Let's keep this about the problem, not the person.",
    threat: "That message was held back because it sounds like a threat. Threats are never okay, and repeated ones are sent to the admin.",
    shouting: "That message was held back because it reads as shouting. Try the same point in a calmer tone.",
  };
  const tail = strikes >= 2 ? " This is your third warning, so I'm letting your admin know." : " Try something like: “I feel … when …, could we …?”";
  return base[flag] + tail;
}

export const modIntro = (name: string, subject: string, ruleLine?: string) =>
  `Hi ${name} and all your neighbors, I'm the ROES Mediator (an AI assistant). ${name} raised: “${subject}”. I'll help everyone talk it through respectfully, and I'll step in if a message gets heated.${ruleLine ? ` A reminder from your community rules: ${ruleLine}` : ""}`;
