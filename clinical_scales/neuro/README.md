# clinical_scales/neuro

UI-ready JSON definitions of the neuro clinical assessment scales (one file per scale). Generated from the REDCap
data dictionaries in [`../redcap_bak`](../redcap_bak) by `convert_to_json.py`.

## Files
| File | Purpose |
|---|---|
| `<scale>.json` | One scale: `id`, `version`, `title`, `redcapForm`, `kind`, `sections[] > items[]` |
| `index.json` | List of scales with answerable-item and computed-score counts |
| `non_clickable_report.json` | Items that are not choice-based (notes, comments, steppers) and need a non-click widget |

Scales: fss, sipso, adverse_event, arat, bbt, cahai7, csi, eq5d, exit_questionnaire_control,
exit_questionnaire_intervention, fma, homer_screening_form, mal, mas, moca, mrs, nihss, nprs, phq9, vafs.
`kind: "bookkeeping"` marks completed_assessment, completed_screening, consent_form (not real scales).

## Item shape
```json
{ "id": "phq9_1_interest", "type": "single_choice", "widget": "buttons", "label": "...",
  "choices": [{ "value": 0, "label": "0 - Not at all" }], "required": true,
  "showIf": "nihss_5a = 'UN'", "redcapType": "radio" }
```
- `id` is the REDCap variable name, so answers export back to REDCap 1:1.
- `type`: `single_choice`, `multi_choice`, `yesno`, `number`, `date`, `examiner`, `subject_ref`, `text`, `computed`, `info`.
- `widget`: `buttons` (6 or fewer choices), `segmented` (numeric, up to 12), `dropdown`, `checkboxes`, `stepper`, `datepicker`, `staff_dropdown`, `text`, `textarea`.
- `computed` items carry `expr` (REDCap formula, `[var]` brackets stripped) and `exprRaw`. `showIf` is a REDCap-style condition. Neither has an evaluator yet.
- Descriptive HTML labels keep the original in `labelHtml`; `label` is plain text.

## Non-click fields
Dates, examiner and record ids are auto-filled or picked. Remaining free text: MAL `mal_comm_*`, `ae_name`, `nihss_*_un_explain`
and the notes/comments fields. See `non_clickable_report.json`.

## Regenerating
Do not hand-edit long term without deciding the source of truth. To regenerate from the CSVs:
```
python ../redcap_bak/convert_to_json.py          # writes here
python ../redcap_bak/convert_to_json.py <dir>    # or elsewhere
```

## Not done yet
Schema validation (zod), score/`showIf` evaluator, translation split (`i18n/<lang>/<scale>.json`), form renderer.
