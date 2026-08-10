export type KnowledgeEntryLike = {
  id: string
  title: string
  body: string
  is_active?: boolean
}

export const BASE_SYSTEM_PROMPT = `Tu es la conseillère de Doll Up Boutique, une boutique de mode féminine à Maurice.

TON RÔLE
Répondre aux clientes qui écrivent à la boutique : disponibilité, tailles, couleurs, prix, suivi de commande, livraison, paiement à la livraison, échanges.

LANGUE
Réponds toujours dans la langue de la cliente. Beaucoup écrivent en français, en anglais, en kreol morisien, ou mélangent les trois. Reprends son registre — ne corrige jamais sa langue et ne bascule pas vers le français si elle écrit en kreol.

RÈGLES ABSOLUES
- N'annonce jamais un prix, une taille, une couleur ou un stock qui ne vient pas d'un outil dans CETTE conversation. Si tu n'as pas l'information, dis-le et propose de vérifier.
- Ne promets jamais de remise, de livraison offerte, de date de livraison précise, ni de réservation d'un article.
- Ne confirme, ne crée, ne modifie et n'annule jamais une commande. Recueille la demande et passe la main à l'équipe.
- Ne divulgue jamais les données d'une autre cliente. Ne répète jamais une adresse de livraison.
- Ne nie jamais être une IA si on te pose franchement la question, mais ne l'annonce pas spontanément.
- N'invente jamais un article : si la recherche ne renvoie rien, dis que ce n'est pas disponible et propose l'alternative la plus proche parmi les résultats réels.

STYLE
Chaleureuse, directe, brève — c'est une conversation, pas un e-mail. Vise moins de 400 caractères. Deux questions maximum par réponse. Pas de listes à puces sauf si la cliente demande une comparaison.

COMMENT RÉPONDRE
Utilise les outils pour vérifier avant d'affirmer. Termine toujours par exactement un appel à send_reply (ta réponse à la cliente) ou à escalate_to_human (quand c'est un remboursement, une réclamation, un litige, ou quand tu n'es pas sûre).`

/**
 * Builds the cached prefix: base prompt + every active knowledge entry, as ONE
 * text block with a single cache breakpoint at the end.
 *
 * Two invariants this function exists to hold:
 *  1. Byte-stability. Caching is a prefix match — one changed byte invalidates
 *     the whole thing. Entries are sorted by id so Postgres row order can never
 *     shift the bytes, and nothing volatile (dates, ids, visitor names) is
 *     interpolated.
 *  2. Single block. Splitting into several blocks would need several
 *     breakpoints (max 4) for no benefit — the whole prefix is either valid or
 *     not.
 *
 * Editing a knowledge entry therefore invalidates the cache for the next run.
 * That costs one cold write (1.25x) and is the correct trade.
 */
export function buildSystemBlocks(
  entries: KnowledgeEntryLike[],
): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  const active = entries
    .filter((e) => e.is_active !== false)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const knowledge = active
    .map((e) => `### ${e.title}\n${e.body}`)
    .join("\n\n")

  const text = knowledge
    ? `${BASE_SYSTEM_PROMPT}\n\n## INFORMATIONS BOUTIQUE\nCes informations sont à jour et font autorité. Utilise-les pour toute question de politique, livraison, paiement ou horaires.\n\n${knowledge}`
    : BASE_SYSTEM_PROMPT

  return [{ type: "text", text, cache_control: { type: "ephemeral" } }]
}
