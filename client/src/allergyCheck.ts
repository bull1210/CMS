/**
 * Best-effort drug ↔ allergy cross-check for the prescription screen.
 *
 * This is a SAFETY NET, not a clinical authority. It exists to catch the single
 * most dangerous everyday miss — prescribing a penicillin to a patient whose
 * chart says "penicillin allergy" — by turning the free-text allergy field into
 * a loud warning at the moment of prescribing. The doctor always makes the
 * final call and can override; we never block.
 *
 * It is deliberately conservative: it flags likely matches and says "please
 * double-check", and never claims a drug is safe.
 */

/** Drug families: an allergy to any term on the left implicates the members. */
const FAMILIES: { allergyTerms: string[]; members: string[]; label: string }[] = [
  {
    label: 'penicillin group',
    allergyTerms: ['penicillin', 'pen v', 'pen g', 'amoxicillin', 'ampicillin', 'augmentin', 'betalactam', 'beta-lactam'],
    members: ['amoxicillin', 'ampicillin', 'augmentin', 'clavulan', 'penicillin', 'cloxacillin', 'dicloxacillin', 'piperacillin'],
  },
  {
    label: 'cephalosporins',
    allergyTerms: ['cephalosporin', 'cephalexin', 'cefixime', 'ceftriaxone', 'cefuroxime'],
    members: ['cephalexin', 'cefixime', 'ceftriaxone', 'cefuroxime', 'cefadroxil', 'cef'],
  },
  {
    label: 'NSAID / painkillers',
    allergyTerms: ['nsaid', 'ibuprofen', 'diclofenac', 'aspirin', 'aceclofenac', 'ketorolac', 'naproxen'],
    members: ['ibuprofen', 'diclofenac', 'aspirin', 'aceclofenac', 'ketorolac', 'naproxen', 'nimesulide'],
  },
  {
    label: 'sulfa drugs',
    allergyTerms: ['sulfa', 'sulpha', 'sulfonamide', 'cotrimoxazole', 'bactrim', 'septran'],
    members: ['sulfa', 'sulpha', 'cotrimoxazole', 'trimethoprim', 'sulfamethoxazole'],
  },
  {
    label: 'metronidazole',
    allergyTerms: ['metronidazole', 'flagyl', 'metrogyl'],
    members: ['metronidazole', 'flagyl', 'metrogyl'],
  },
  {
    label: 'macrolides',
    allergyTerms: ['erythromycin', 'azithromycin', 'clarithromycin', 'macrolide'],
    members: ['erythromycin', 'azithromycin', 'clarithromycin', 'azithro'],
  },
];

export interface AllergyHit {
  medicine: string;
  /** Human explanation, e.g. "chart lists a penicillin allergy". */
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

/**
 * Returns one hit per prescribed medicine that clashes with the recorded
 * allergies. Empty array = nothing flagged (which is NOT a guarantee of safety).
 */
export function checkAllergies(allergyText: string | undefined, medicineNames: string[]): AllergyHit[] {
  const allergy = norm(allergyText ?? '').trim();
  if (!allergy) return [];

  const hits: AllergyHit[] = [];
  for (const raw of medicineNames) {
    const med = norm(raw).trim();
    if (!med) continue;

    // 1. Direct substring: the allergy text literally names the drug.
    //    Split the allergy field on commas/"and" so "penicillin, latex" works.
    const allergyTokens = allergy.split(/[,;/]| and | & /).map((t) => t.trim()).filter((t) => t.length >= 3);
    const directWord = allergyTokens.find((tok) => med.includes(tok) || tok.split(' ').some((w) => w.length >= 4 && med.includes(w)));
    if (directWord) {
      hits.push({ medicine: raw, reason: `chart lists an allergy to "${directWord}"` });
      continue;
    }

    // 2. Family match: allergy names a family member, drug is another member.
    const fam = FAMILIES.find(
      (f) => f.allergyTerms.some((t) => allergy.includes(t)) && f.members.some((m) => med.includes(m)),
    );
    if (fam) {
      hits.push({ medicine: raw, reason: `chart lists a ${fam.label} allergy` });
    }
  }
  return hits;
}
