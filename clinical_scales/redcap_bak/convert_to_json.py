"""Convert per-scale REDCap data-dictionary CSVs into UI-ready JSON scale definitions.

Usage: python convert_to_json.py [out_dir]   (default: ../neuro)

One file per scale + index.json + non_clickable_report.json (items needing a non-choice widget).
Item ids are the REDCap variable names so responses export back to REDCap 1:1.
"""
import csv
import glob
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "neuro")

COL = {
    "id": "Variable / Field Name",
    "form": "Form Name",
    "section": "Section Header",
    "type": "Field Type",
    "label": "Field Label",
    "choices": "Choices, Calculations, OR Slider Labels",
    "note": "Field Note",
    "validation": "Text Validation Type OR Show Slider Number",
    "vmin": "Text Validation Min",
    "vmax": "Text Validation Max",
    "branch": "Branching Logic (Show field only if...)",
    "required": "Required Field?",
    "annotation": "Field Annotation",
}

# Scale id + title overrides (file stem -> (id, title)); everything else derives from the stem.
TITLES = {
    "FSS_vertical": ("fss", "Fatigue Severity Scale (FSS)"),
    "SIPSO": ("sipso", "Stroke Impact / SIPSO"),
    "adverse_event": ("adverse_event", "Adverse Event"),
    "arat": ("arat", "Action Research Arm Test (ARAT)"),
    "box_and_block_test": ("bbt", "Box and Block Test"),
    "cahai7": ("cahai7", "Chedoke Arm and Hand Activity Inventory (CAHAI-7)"),
    "csi": ("csi", "Caregiver Strain Index (CSI)"),
    "eq5d": ("eq5d", "EQ-5D"),
    "fma": ("fma", "Fugl-Meyer Assessment (Upper Extremity)"),
    "mal": ("mal", "Motor Activity Log (MAL)"),
    "mas": ("mas", "Modified Ashworth Scale (MAS)"),
    "moca": ("moca", "Montreal Cognitive Assessment (MoCA)"),
    "mrs": ("mrs", "Modified Rankin Scale (mRS)"),
    "nihss": ("nihss", "NIH Stroke Scale (NIHSS)"),
    "nprs": ("nprs", "Numeric Pain Rating Scale (NPRS)"),
    "phq9": ("phq9", "Patient Health Questionnaire-9 (PHQ-9)"),
    "vafs": ("vafs", "Visual Analogue Fatigue Scale (VAFS)"),
}

STD_HEADER = [COL[k] for k in ("id", "form", "section", "type", "label", "choices", "note", "validation", "vmin", "vmax")] + [
    "Identifier?", COL["branch"], COL["required"], "Custom Alignment", "Question Number (surveys only)",
    "Matrix Group Name", "Matrix Ranking?", COL["annotation"],
]

SUBJECT_REF_IDS = {"record_id", "screening_subject_id"}


def strip_html(s):
    s = re.sub(r"<br\s*/?>|</(p|div|li|tr)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()


def coerce(v):
    v = v.strip()
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in v else f
    except ValueError:
        return v


def parse_choices(raw):
    out = []
    for part in raw.split("|"):
        if "," not in part:
            continue
        value, label = part.split(",", 1)
        out.append({"value": coerce(value), "label": label.strip()})
    return out


def norm_logic(raw):
    """[a] -> a; keep everything else as-is (REDCap syntax, evaluated later)."""
    return re.sub(r"\[([A-Za-z0-9_]+)(?:\((\w+)\))?\]", lambda m: m.group(1) + (f"({m.group(2)})" if m.group(2) else ""), raw).strip()


def widget_for(choices):
    n = len(choices)
    if n <= 6:
        return "buttons"
    if n <= 12 and all(isinstance(c["value"], (int, float)) for c in choices):
        return "segmented"
    return "dropdown"


def convert_item(row):
    rid, ftype = row[COL["id"]].strip(), row[COL["type"]].strip()
    label_raw = row[COL["label"]]
    item = {"id": rid, "redcapType": ftype}
    branch = row[COL["branch"]].strip()
    if branch:
        item["showIf"] = norm_logic(branch)
    req = row[COL["required"]].strip().lower()
    if req == "y":
        item["required"] = True

    if ftype == "descriptive":
        item["type"] = "info"
    elif ftype in ("radio", "dropdown"):
        ch = parse_choices(row[COL["choices"]])
        item.update(type="single_choice", choices=ch, widget=widget_for(ch))
    elif ftype == "yesno":
        item.update(type="yesno", choices=[{"value": 1, "label": "Yes"}, {"value": 0, "label": "No"}], widget="buttons")
    elif ftype == "checkbox":
        item.update(type="multi_choice", choices=parse_choices(row[COL["choices"]]), widget="checkboxes")
    elif ftype == "calc":
        item.update(type="computed", expr=norm_logic(row[COL["choices"]]), exprRaw=row[COL["choices"]].strip())
    elif ftype in ("text", "notes"):
        val = row[COL["validation"]].strip()
        if rid in SUBJECT_REF_IDS:
            item["type"], item["source"] = "subject_ref", "patient"
        elif val.startswith("date") or rid.endswith("_date") or rid == "date_of_assessment":
            item.update(type="date", widget="datepicker", defaultToday=True)
        elif rid.endswith("_examiner"):
            item.update(type="examiner", widget="staff_dropdown", source="current_user")
        elif val in ("number", "int", "integer"):
            item.update(type="number", widget="stepper")
            if row[COL["vmin"]].strip():
                item["min"] = coerce(row[COL["vmin"]])
            if row[COL["vmax"]].strip():
                item["max"] = coerce(row[COL["vmax"]])
        else:
            item.update(type="text", widget="textarea" if ftype == "notes" else "text")
    else:
        item["type"] = "unsupported"

    if "<" in label_raw:
        item["label"] = strip_html(label_raw)
        item["labelHtml"] = label_raw.strip()
    else:
        item["label"] = label_raw.strip()
    note = row[COL["note"]].strip()
    if note:
        item["note"] = note
    return item


def convert(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    sid, title = TITLES.get(stem, (stem.lower(), stem.replace("_", " ").title()))
    # Some exports have an unquoted header ("Choices, Calculations, ...") that shifts DictReader keys,
    # so map columns by position onto the standard REDCap header instead.
    with open(path, encoding="utf-8-sig", newline="") as f:
        raw_rows = list(csv.reader(f))[1:]
    rows = [dict(zip(STD_HEADER, r)) for r in raw_rows if r and r[0].strip()]
    for r in rows:
        for k in STD_HEADER:
            r.setdefault(k, "")
    form = rows[0][COL["form"]].strip()

    sections, current = [], None
    for row in rows:
        header = row[COL["section"]].strip()
        if current is None or header:
            current = {"id": f"s{len(sections) + 1}", "title": header, "items": []}
            sections.append(current)
        current["items"].append(convert_item(row))

    items = [i for s in sections for i in s["items"]]
    scale = {
        "id": sid,
        "version": 1,
        "title": title,
        "redcapForm": form,
        "sections": sections,
    }
    return scale, items


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    index, report = [], {}
    skip = {"completed_assessment", "completed_screening", "consent_form"}  # bookkeeping forms, still converted below
    for path in sorted(glob.glob(os.path.join(HERE, "*.csv"))):
        scale, items = convert(path)
        answerable = [i for i in items if i["type"] not in ("info", "computed", "subject_ref")]
        typed = [i for i in items if i["type"] in ("text", "number", "date", "examiner", "unsupported")]
        scale["kind"] = "bookkeeping" if os.path.splitext(os.path.basename(path))[0] in skip else "scale"
        with open(os.path.join(OUT_DIR, scale["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(scale, f, indent=2, ensure_ascii=False)
        index.append({
            "id": scale["id"], "title": scale["title"], "redcapForm": scale["redcapForm"], "kind": scale["kind"],
            "items": len(answerable), "computed": sum(i["type"] == "computed" for i in items),
        })
        report[scale["id"]] = [
            {"id": i["id"], "type": i["type"], "widget": i.get("widget")} for i in typed
            if i["type"] != "date" and i["type"] != "examiner"
        ]
        assert not any(i["type"] == "unsupported" for i in items), f"unsupported field in {path}"
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "non_clickable_report.json"), "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in report.items() if v}, f, indent=2)
    print(f"wrote {len(index)} scales to {os.path.normpath(OUT_DIR)}")


if __name__ == "__main__":
    main()
