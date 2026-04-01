# Islamic Menstruation Series - Research Documentation

## Purpose
This document defines the knowledge base for a long-form (about 2:30 per episode) 3D animation video series about Islamic menstruation rulings.

The series objective is to teach from foundational concepts to advanced madhab-based edge cases in a calm, engaging, and visually clear format.

## Methodology and Source Boundaries
- **Primary app-aligned source base:** `Desktop/Perri` fiqh engine, constants, and tests.
- **Quran references:** direct ayat relevant to menstruation/intimacy and worship framing.
- **Hadith references:** reports used in app rulings and mainstream fiqh discussion.
- **Fiqh layers:**
  - `ijma` (consensus)
  - `majority` (jumhur / prevalent view)
  - `disputed` (ikhtilaf; requires careful language)
- **Safety policy:** this content is educational, not a fatwa. Include local scholar referral for unresolved personal cases.

## App-Backed Reference Files (Perri)
- `constants/islamic/fiqh-rulings.ts`
- `constants/islamic/madhab-thresholds.ts`
- `constants/islamic/worship-actions.ts`
- `constants/islamic/time-rule-config.ts`
- `services/worship-status.service.ts`
- `services/__tests__/worship-status.madhab-matrix.test.ts`

## Canonical Source Map

### Quran
- **Al-Baqarah 2:222**: menstruation and intimacy boundary.

### Hadith (core teaching set)
- **Bukhari & Muslim**: when menstruation comes, prayer is left; when it ends, purification and prayer resume.
- **Aisha (Bukhari & Muslim)**: missed fasts are made up, missed prayers are not.
- **Fatimah bint Abi Hubaysh (Bukhari & Muslim)**: distinction between hayd and istihadah.
- **Umm Habibah (Muslim)**: habit-based handling in persistent bleeding.
- **Umm Atiyyah (Bukhari)**: yellow/brown discharge after purity sign is not treated as hayd.

## Core Teaching Framework (by certainty)

### 1) Ijma / broad consensus topics
- Salah paused during hayd and nifas; no prayer qada for those days.
- Fasting paused during hayd and nifas; missed Ramadan fasts need qada.
- Ghusl required at confirmed end of hayd/nifas before full worship resumes.
- Istihadah does not pause salah/fasting.
- Intercourse prohibited during hayd and nifas.

### 2) Majority-leaning topics
- Istihadah practice includes wudu management and protective hygiene for prayer.
- Habit-based allocation in persistent bleeding (mustahadah).
- Intimacy in istihadah generally permitted by majority.

### 3) Disputed topics (must be labeled clearly)
- Quran recitation/touching mushaf during hayd/nifas.
- Entering/staying in masjid during hayd/nifas.
- Some timing micro-rulings around prayer-window catch-up models.

## Madhab Matrix (advanced layer)

### Hayd thresholds
- **Hanafi**: min 3, max 10, min purity gap 15.
- **Maliki**: min 1, max 15, min purity gap 15.
- **Shafii**: min 1, max 15, min purity gap 15.
- **Hanbali**: min 1, max 15, min purity gap 13.

### Nifas max
- **Hanafi/Hanbali**: 40 days.
- **Maliki/Shafii**: 60 days.

### Intermittent bleeding gaps
- **Hanafi**: gap days within max span treated as hukmi hayd.
- **Others**: clean gaps treated as purity days.

### Early purity intimacy
- **Hanafi/Maliki**: wait until habit-end window.
- **Shafii/Hanbali**: permitted after ghusl once purity established.

### Pregnancy bleeding
- **Hanafi/Hanbali**: generally treated as istihadah.
- **Shafii**: may be hayd if criteria met.
- **Maliki**: stage-based hayd max (15/20/30 by gestational stage).

## Worship Status Teaching Model (what audience should learn)
- **States**: full purity, hayd, istihadah, nifas, nifas_end, early_purity, pregnancy context.
- **Action categories**: paused, obligatory, permitted, modified, recommended.
- **Confidence layer**: high/medium/low for uncertain logs.
- **Reason layer** (educational): within_habit, exceeds_max_hayd, insufficient_purity_gap, early_purity_detected, etc.

## Suggested Series Arc (2:30 each)

### Phase A - Foundations (Episodes 1-6)
1. Why Islamic menstruation literacy matters
2. Hayd basics: what changes in worship
3. Fasting vs prayer makeup (clear difference)
4. Purity signs and ghusl reset
5. Istihadah basics and why worship continues
6. Nifas basics postpartum

### Phase B - Practical Daily Life (Episodes 7-12)
7. Daily worship actions by state (paused/permitted/obligatory)
8. Discharge after purity and common confusion
9. Early purity: what to do the same day
10. When bleeding returns after purity
11. Habit tracking and why aadah matters
12. Ramadan planning with cycle-aware worship

### Phase C - Madhab Differences (Episodes 13-18)
13. Madhab thresholds explained visually (3/10/15 etc.)
14. Intermittent bleeding: Hanafi vs others
15. Early purity intimacy: 2-school split
16. Nifas max differences (40 vs 60)
17. Pregnancy bleeding: 4-school landscape
18. Time-window rulings for prayer and fasting (advanced)

### Phase D - Advanced Case Labs (Episodes 19-24)
19. Persistent bleeding (mustahadah) decision model
20. Insufficient purity-gap scenarios
21. Complex mixed-pattern timeline walkthrough
22. Certainty labels: consensus vs dispute
23. Scholar-escalation cases and safe language
24. Full recap + how to apply personally with scholar support

## Episode Template (engaging 3D style)
- **0:00-0:15 Hook**: confusion scenario or myth-bust statement.
- **0:15-0:40 Concept setup**: 1 teaching goal.
- **0:40-1:35 Visual breakdown**: timeline graphics + state cards.
- **1:35-2:10 Madhab/edge-case note**: clearly marked certainty.
- **2:10-2:30 Recap + action**: one practical step and tomorrow teaser.

## Visual Language Guidance (fun but respectful)
- Character-led 3D storytelling with clear emotional beats.
- State-color cards (hayd / istihadah / purity / nifas) shown consistently.
- Timeline and threshold counters for fiqh logic clarity.
- "Consensus" and "Difference" badges to prevent confusion.
- No preachy tone; use supportive teacher voice.

## Language Rules for Script Generation
- Always state whether a ruling is consensus, majority, or disputed.
- For disputed topics, avoid absolute wording.
- Do not turn advanced differences into fear-based messaging.
- Include one "what to do now" step every episode.
- Add "consult local scholar" on high-ambiguity scenarios.

## Content QA Checklist (before final script)
- Is the ruling certainty label correct?
- Is madhab-specific wording isolated from all-school wording?
- Are Quran/Hadith references relevant and non-forced?
- Is practical user action clear in 1 line?
- Is the episode engaging without sacrificing accuracy?

## Implementation Note for Upcoming Agent
Use this doc as the canonical knowledge source for a new `islamic_menstruation_series_3d` video agent mode:
- Fixed runtime target: about 150 seconds.
- 3D animated explainer style.
- Curriculum order: basic -> practical -> madhab advanced -> case labs.
- Script output must include certainty labels and source-aware language.
