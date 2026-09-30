# clinical_scales/redcap_bak

Backup of the original REDCap data-dictionary exports and the scripts that process them. Source material for
[`../neuro`](../neuro); kept so REDCap imports can be reproduced and the JSON regenerated.

## Contents
| Item | Purpose |
|---|---|
| `*.csv` | One REDCap data dictionary per form/scale (PHQ-9, MoCA, FMA, ARAT, NIHSS, MAL, ...) |
| `final/final.csv` | Merged dictionary of all forms plus demographics, ready for REDCap import |
| `final/form_display_logic.csv` | Form display logic per event (which forms show in which arm/event) |
| `translation/*.json` | REDCap MLM translations (hi, kn, pa, ta, te), per-scale and `*_single_doc.json` per language, keyed by field id |
| `clean_redcap.py` | Merges the CSVs into `final/final.csv` (normalizes names, adds demographics form) |
| `convert_to_json.py` | Converts each CSV into JSON scale definitions in `../neuro` |

## Notes
- Standard REDCap columns: `Variable / Field Name`, `Form Name`, `Field Type`, `Field Label`, `Choices, Calculations, OR Slider Labels`, branching logic, etc.
- `fma`, `FSS_vertical`, `mrs`, `nprs`, `SIPSO`, `vafs` have an unquoted header that shifts columns; `convert_to_json.py` reads by position to handle it.
- Treat these files as the REDCap-side record. If the dictionary changes in REDCap, update the CSV here and rerun `convert_to_json.py`.

## Usage
```
python convert_to_json.py    # regenerates ../neuro/*.json
```
