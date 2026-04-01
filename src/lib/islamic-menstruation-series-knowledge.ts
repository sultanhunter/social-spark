export type FiqhCertainty = "ijma" | "majority" | "disputed";

export interface MenstruationSeriesTopic {
  id: string;
  title: string;
  phase: "foundations" | "practical" | "madhab" | "advanced";
  learningGoal: string;
  keyPoints: string[];
  certaintyTags: FiqhCertainty[];
  sourceNotes: string[];
}

export interface MenstruationSeriesKnowledgePack {
  seriesId: string;
  title: string;
  targetDurationSeconds: number;
  style: string;
  sequencingRule: string;
  methodology: string[];
  sourceFiles: string[];
  quranReferences: string[];
  hadithReferences: string[];
  madhabReferenceSummary: string[];
  scriptGuardrails: string[];
  topics: MenstruationSeriesTopic[];
}

export const ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE: MenstruationSeriesKnowledgePack = {
  seriesId: "islamic_menstruation_series_3d",
  title: "Islamic Menstruation Teachings Series",
  targetDurationSeconds: 150,
  style: "3D animated teacher-led explainer with engaging state graphics",
  sequencingRule: "Move from basics to practical actions, then madhab differences, then advanced case labs.",
  methodology: [
    "Use app-backed fiqh constants and tests as baseline.",
    "Tag claims by certainty: ijma, majority, disputed.",
    "Separate all-school rulings from madhab-specific rulings.",
    "End each episode with one practical action and one caveat for personal scholar guidance when needed.",
  ],
  sourceFiles: [
    "Desktop/Perri/constants/islamic/fiqh-rulings.ts",
    "Desktop/Perri/constants/islamic/madhab-thresholds.ts",
    "Desktop/Perri/constants/islamic/worship-actions.ts",
    "Desktop/Perri/constants/islamic/time-rule-config.ts",
    "Desktop/Perri/services/worship-status.service.ts",
    "Desktop/Perri/services/__tests__/worship-status.madhab-matrix.test.ts",
  ],
  quranReferences: ["Al-Baqarah 2:222"],
  hadithReferences: [
    "Bukhari & Muslim: leave prayer during menses, resume after purity.",
    "Aisha (Bukhari & Muslim): make up fasts, not prayers.",
    "Fatimah bint Abi Hubaysh (Bukhari & Muslim): hayd vs istihadah distinction.",
    "Umm Habibah (Muslim): habit-based handling in persistent bleeding.",
    "Umm Atiyyah (Bukhari): post-purity yellow/brown discharge treatment.",
  ],
  madhabReferenceSummary: [
    "Hanafi: min/max hayd 3/10, min purity gap 15, nifas max 40.",
    "Maliki: min/max hayd 1/15, min purity gap 15, nifas max 60.",
    "Shafii: min/max hayd 1/15, min purity gap 15, nifas max 60.",
    "Hanbali: min/max hayd 1/15, min purity gap 13, nifas max 40.",
  ],
  scriptGuardrails: [
    "Do not present disputed rulings as unanimous.",
    "For madhab differences, state each view clearly and neutrally.",
    "Avoid definitive personal-fatwa language.",
    "Use compassionate and practical wording.",
    "Include one concise source-aware note in each episode.",
  ],
  topics: [
    {
      id: "ep01-why-it-matters",
      title: "Why menstrual fiqh literacy matters",
      phase: "foundations",
      learningGoal: "Frame menstruation rulings as worship clarity, not fear.",
      keyPoints: [
        "Cycle changes worship obligations in precise ways.",
        "Confusion often comes from mixing hayd and istihadah.",
        "A structured fiqh workflow reduces anxiety.",
      ],
      certaintyTags: ["majority"],
      sourceNotes: ["Perri learning + worship-status architecture"],
    },
    {
      id: "ep02-hayd-basics",
      title: "Hayd basics and worship pause",
      phase: "foundations",
      learningGoal: "Clarify what pauses and what continues in hayd.",
      keyPoints: [
        "Prayer pauses and no qada for missed prayers.",
        "Fasting pauses and missed Ramadan days require qada.",
        "Dhikr and dua remain open.",
      ],
      certaintyTags: ["ijma"],
      sourceNotes: ["Bukhari & Muslim narrations used in app constants"],
    },
    {
      id: "ep03-istihadah-basics",
      title: "Istihadah and ongoing worship",
      phase: "foundations",
      learningGoal: "Show why istihadah does not pause core worship.",
      keyPoints: [
        "Salah remains obligatory.",
        "Fasting remains valid.",
        "Wudu and hygiene routine are important.",
      ],
      certaintyTags: ["ijma", "majority"],
      sourceNotes: ["Fatimah bint Abi Hubaysh hadith, app fiqh rules"],
    },
    {
      id: "ep04-ghusl-and-purity-signs",
      title: "Purity signs and ghusl reset",
      phase: "practical",
      learningGoal: "Teach exact transition from paused to resumed worship.",
      keyPoints: [
        "Identify purity sign.",
        "Perform ghusl and resume.",
        "Post-purity yellow/brown handling.",
      ],
      certaintyTags: ["ijma", "majority"],
      sourceNotes: ["Umm Atiyyah hadith + app discharge logic"],
    },
    {
      id: "ep05-madhab-thresholds",
      title: "Madhab thresholds explained",
      phase: "madhab",
      learningGoal: "Compare min/max hayd and purity-gap values.",
      keyPoints: [
        "Hanafi 3-10; others 1-15.",
        "Purity gap: 15 except Hanbali 13.",
        "Why this changes state classification.",
      ],
      certaintyTags: ["majority"],
      sourceNotes: ["madhab-thresholds.ts"],
    },
    {
      id: "ep06-intermittent-gaps",
      title: "Intermittent bleeding and gap-day rulings",
      phase: "madhab",
      learningGoal: "Show Hanafi hukmi-hayd vs others' purity-gap treatment.",
      keyPoints: [
        "Hanafi counts gaps as hayd within range.",
        "Others treat clean gaps as purity.",
        "Resulting prayer difference by day.",
      ],
      certaintyTags: ["majority"],
      sourceNotes: ["fiqh-rulings + madhab matrix tests"],
    },
    {
      id: "ep07-early-purity-intimacy",
      title: "Early purity and intimacy divergence",
      phase: "madhab",
      learningGoal: "Separate resumed worship from intimacy rulings.",
      keyPoints: [
        "Prayer/fasting resume after ghusl.",
        "Hanafi/Maliki defer intimacy until habit-end.",
        "Shafii/Hanbali permit after ghusl.",
      ],
      certaintyTags: ["majority", "disputed"],
      sourceNotes: ["worship-status logic + fiqh rulings"],
    },
    {
      id: "ep08-nifas-and-postpartum",
      title: "Nifas structure and max-day differences",
      phase: "practical",
      learningGoal: "Teach postpartum pause and transition to resumed worship.",
      keyPoints: [
        "Nifas follows hayd-like worship pause rules.",
        "Max differs: 40 vs 60.",
        "Beyond max becomes istihadah.",
      ],
      certaintyTags: ["ijma", "majority"],
      sourceNotes: ["fiqh-rulings + thresholds + tests"],
    },
    {
      id: "ep09-pregnancy-bleeding",
      title: "Pregnancy bleeding across madhabs",
      phase: "advanced",
      learningGoal: "Teach school-based differences without confusion.",
      keyPoints: [
        "Hanafi/Hanbali: generally istihadah.",
        "Shafii: may classify as hayd if criteria match.",
        "Maliki: staged maximum limits.",
      ],
      certaintyTags: ["majority", "disputed"],
      sourceNotes: ["fiqh-rulings + matrix tests"],
    },
    {
      id: "ep10-advanced-case-lab",
      title: "Advanced mixed-pattern case lab",
      phase: "advanced",
      learningGoal: "Walk through real classification logic step by step.",
      keyPoints: [
        "Habit baseline then threshold checks.",
        "Insufficient purity-gap classification.",
        "When to escalate to scholar support.",
      ],
      certaintyTags: ["majority", "disputed"],
      sourceNotes: ["worship-status engine and test scenarios"],
    },
  ],
};
