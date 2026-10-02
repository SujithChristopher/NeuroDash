---
name: clinical-scale-ui
description: Rules for building NeuroDash UI that renders clinical assessment scales (PHQ-9, MoCA, FMA, ARAT, NIHSS, MAL, EQ-5D, mRS, etc.) from the JSON definitions in clinical_scales/neuro. Use whenever the user builds, changes or reviews a scale form, assessment entry screen, questionnaire, score display, or anything that collects clinician/patient responses, even if they don't say "scale". Enforces click-only input (buttons, dropdowns, pickers, steppers) and keeps free-text clinical notes out of the UI.
---

# Clinical scale UI

Scales are data, not hand-written screens. Render them with one generic renderer from the JSON in
`clinical_scales/neuro/<scale>.json` (see that folder's README for the item schema). Do not hard-code a
scale's questions in a component; a new or changed scale must need zero UI code.

## Why click-only
Assessments run at the bedside, often on a tablet, often with gloves or a patient who has hemiparesis, and in
several languages. Typing is slow, error-prone, and produces data that cannot be scored, compared or exported to
REDCap. Every value we store should come from a closed set the definition controls.

## Input rules (map `widget` -> control)
| widget | control |
|---|---|
| `buttons` | large segmented/radio buttons, one row (wrap on narrow screens), whole label tappable |
| `segmented` | single button row for numeric scales (e.g. MAL 0-5 in 0.5 steps); never a typed number |
| `dropdown` | native-feeling select, only when more than ~12 choices |
| `checkboxes` | tappable chips/checkboxes, multi-select |
| `datepicker` | date picker, default today; no typed date |
| `staff_dropdown` | pre-filled from logged-in user; changeable via dropdown only |
| `stepper` | +/- buttons with min/max from the definition (block counts); `eq5d_vas` renders as a slider 0-100 |
| `subject_ref` | filled from the selected patient, read-only |
| `computed` | read-only live score; never an input |
| `info` | instructions/headers only (render `label`, use `labelHtml` only after sanitizing) |

- Touch targets at least 44px; keyboard reachable (arrow keys move within a radio group); visible selected state that does not rely on colour alone.
- Show every section and question on one page (no Next / Previous steps) with a sticky progress indicator, even for long scales (MAL has 120+ items). Save answers as they are chosen so a page reload loses nothing.
- Honour `showIf` (hide and clear answers for hidden items) and `required` (block submit, scroll to the first missing item).
- Show computed scores live and mark them auto-calculated; do not let users edit them.
- Labels come from the definition/i18n files keyed by item `id`; never hard-code strings. Scale text can be Hindi, Kannada, Punjabi, Tamil or Telugu, so allow long labels and do not truncate.

## No typed notes
Do not add free-text fields for clinical notes, comments, remarks, "other", explanations or reasons, even where the
REDCap source has a `notes`/`text` field (`*_notes`, `*_comments`, `mal_comm_*`, `nihss_*_un_explain`,
`scr_exclude_reason`, exit-questionnaire comments, `ae_name`). Free text in a clinical record is a privacy risk
(names, identifiers), is unstructured, and cannot be translated or analysed.

Replace each with a structured control:
- **Reason / explanation** -> single-choice dropdown of preset reasons (e.g. NIHSS "UN" -> amputation, joint fusion, other/not stated).
- **Comment / note** -> multi-select preset chips, or omit. If a note field is genuinely required by the protocol, flag it to the user instead of silently adding a textarea.
- **Adverse event name** -> dropdown of standard events (plus severity/relatedness choices), with "Other" as a choice, not a text box.
- **"Other"** -> a choice value only; no follow-up text box.

If the definition still contains a `text` widget (see `non_clickable_report.json`), render the structured replacement
above and record the decision; do not fall back to a textarea. The preset lists belong in the scale JSON
(as `choices`), so they are versioned and translatable. If the preset list is unknown, ask the user or a clinician
rather than inventing clinical categories.

## Building it
- Stack: SvelteKit + Svelte 5, tokens in `src/lib/styles/tokens.css`, shared components in `src/lib/components/ui`. Reuse them; check what exists before adding a control.
- One `ScaleForm` renderer + one small component per widget. Pure logic (visibility, score evaluation, validation) in plain TS with vitest tests, not inside components.
- Store answers as `{scaleId, version, subjectId, visit, answers: {itemId: value}}`; recompute scores from the definition rather than trusting stored ones.
- Keep item ids equal to REDCap variable names so export stays 1:1.
- Changing a scale: edit the CSV in `clinical_scales/redcap_bak`, rerun `python clinical_scales/redcap_bak/convert_to_json.py`, bump `version`. Do not hand-edit generated JSON unless the source of truth has moved.

## Check before finishing
1. Can every scale be completed with taps/clicks only (no keyboard)?
2. Any `<input type="text">` or `<textarea>` in a scale screen? There should be none.
3. Scores match REDCap calc for sample answers (add a vitest case).
4. Works at tablet width and with a long translated label.
